import type { GithubAgent, GithubRepoProject, Route, Wake } from '../shared/types.js';
import type { CapAlertMessageTemplate, GovernNoticeMessageTemplate, RewakeMessageTemplate, StallNoticeMessageTemplate, WakeMessageTemplate } from './validator.js';
import { substitute, findUnsubstitutedTokens } from './substituter.js';

// project_number is added to github_repo_project by Feature 2 / Task T5.
// The renderer treats it as a required field on the resolved repo-project row.
// The renderer's mapping view: the integration row plus the registry slug the
// homespace derives from (specs/data/spec_database.md §11 — homespace follows
// the platform slug, not the GitHub repo name).
export type RepoProjectView = GithubRepoProject & { project_slug: string };

// Fetchers may be sync or async — production wires DB-backed promises, tests
// provide sync stubs. render()/renderRewake() await internally so callers see
// a uniform Promise<string>.
export type MaybeAsync<T> = T | Promise<T>;

/** One settled hold rendered into {{settled_holds_block}} (spec_wakery-rewake-message.md). */
export interface RewakeSettledHold {
  typeName: string;
  status: 'completed' | 'timeout';
  heldMinutes: number;
}

/**
 * The re-wake template's derived placeholder context, computed by the
 * dispatch worker per re-dispatch (spec_wakery-rewake-message.md §Placeholders).
 */
export interface RewakeRenderContext {
  /** wake.wake_attempts AFTER the increment this turn will apply — 2 on the first re-wake. */
  wakeAttempts: number;
  /** WAKERY_REWAKE_MAX_ATTEMPTS. */
  rewakeCap: number;
  /** Minutes since the wake's most recent completed lease ended. */
  lastTurnMinutesAgo: number;
  /** Settled snoozes of the wake's branch+scope since the previous turn ended. */
  settledHolds: RewakeSettledHold[];
  /**
   * Cap-alert marker (spec_wakery-cap-alert-message.md, self-healing F2b):
   * true selects the cap-alert template for the one-duty delivery turn the
   * worker dispatches when the wake reaches the re-wake cap.
   */
  capAlert?: boolean;
}

export interface RendererDeps {
  template: WakeMessageTemplate;
  rewakeTemplate?: RewakeMessageTemplate;
  governNoticeTemplate?: GovernNoticeMessageTemplate;
  capAlertTemplate?: CapAlertMessageTemplate;
  stallNoticeTemplate?: StallNoticeMessageTemplate;
  fetchAgent: (wake: Wake, route: Route) => MaybeAsync<GithubAgent | null>;
  fetchRepoProject: (wake: Wake) => MaybeAsync<RepoProjectView | null>;
  projectStoragePath: string;
  now?: () => Date;
}

export class RenderError extends Error {
  constructor(
    public readonly wakeId: string,
    public readonly unresolved: string[],
    detail?: string
  ) {
    super(
      `render failed for wake ${wakeId}: unresolved [${unresolved.join(', ')}]${detail ? ` (${detail})` : ''}`
    );
    this.name = 'RenderError';
  }
}

/**
 * The settled-holds context block (spec_wakery-rewake-message.md §Composition
 * delta 2) — the folded resume message: type-aware, outcome-blind. Returns
 * the empty string when nothing settled — the one allowed-empty placeholder.
 */
export function buildSettledHoldsBlock(settled: RewakeSettledHold[]): string {
  if (settled.length === 0) return '';
  const list = settled.map((s) => `${s.typeName} (${s.status}, held ${s.heldMinutes}m)`).join(', ');
  return [
    `External holds settled since your last turn: ${list}.`,
    'Wakery reads no outcomes. Check the real external state yourself — the CI conclusion, the pull request, the merge.',
    'A hold marked `timeout` never sent its completion signal: verify that external process is not still running before you proceed.'
  ].join('\n');
}

export class Renderer {
  private readonly now: () => Date;

  constructor(private readonly deps: RendererDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async render(wake: Wake, route: Route): Promise<string> {
    const { agent, repoProject } = await this.fetchSources(wake, route);
    const laneInstructions = this.laneInstructions(route, wake);
    const values = this.resolveValues(wake, route, agent, repoProject, laneInstructions);
    return this.assemble(wake, this.deps.template.composition, laneInstructions, values);
  }

  /**
   * The re-wake message (spec_wakery-rewake-message.md): the wake-message
   * composition with the re-wake header, settled-holds context, and preamble.
   * Self-sufficient — carries the full task packet, valid as first contact in
   * a context-free fresh session; state-block selection is exactly the wake
   * message's (the task's state has not changed).
   */
  async renderRewake(wake: Wake, route: Route, ctx: RewakeRenderContext): Promise<string> {
    if (!this.deps.rewakeTemplate) {
      throw new RenderError(wake.id, ['rewake-template'], 'rewakeTemplate not configured');
    }
    const { agent, repoProject } = await this.fetchSources(wake, route);
    const laneInstructions = this.laneInstructions(route, wake);
    const values = {
      ...this.resolveValues(wake, route, agent, repoProject, laneInstructions),
      wake_attempts: String(ctx.wakeAttempts),
      rewake_cap: String(ctx.rewakeCap),
      last_turn_minutes_ago: String(ctx.lastTurnMinutesAgo),
      // Allowed-empty: the one placeholder that may render to nothing.
      settled_holds_block: buildSettledHoldsBlock(ctx.settledHolds)
    };
    return this.assemble(wake, this.deps.rewakeTemplate.composition, laneInstructions, values);
  }

  /**
   * The govern-notice message (spec_wakery-govern-notice-message.md): the
   * notification cue turn for a state-based Govern arrival
   * (milestone_govern-notice_v2026.08.05). Placeholders are the shared map
   * plus the derived {{gate}} and {{decision_required}}; render aborts on any
   * missing placeholder (spec §Invariants).
   */
  async renderGovernNotice(wake: Wake, route: Route): Promise<string> {
    if (!this.deps.governNoticeTemplate) {
      throw new RenderError(wake.id, ['govern-notice-template'], 'governNoticeTemplate not configured');
    }
    const { agent, repoProject } = await this.fetchSources(wake, route);
    const values = {
      ...this.resolveValues(wake, route, agent, repoProject, ''),
      gate: deriveGovernGate(wake),
      decision_required: "Approved | Revise (the Principal's verdict in place of the Auditor)"
    };
    return this.assemble(wake, this.deps.governNoticeTemplate.composition, '', values);
  }

  /**
   * The cap-alert message (spec_wakery-cap-alert-message.md, self-healing
   * F2b): the one-duty delivery turn at the re-wake cap — report the blockage
   * and its cause to the Principal, then end. Placeholders are the shared map
   * plus the re-wake counters (the settled-holds block is not carried — the
   * alert delivers a conclusion, it does not resume work).
   */
  async renderCapAlert(wake: Wake, route: Route, ctx: RewakeRenderContext): Promise<string> {
    if (!this.deps.capAlertTemplate) {
      throw new RenderError(wake.id, ['cap-alert-template'], 'capAlertTemplate not configured');
    }
    const { agent, repoProject } = await this.fetchSources(wake, route);
    const values = {
      ...this.resolveValues(wake, route, agent, repoProject, ''),
      wake_attempts: String(ctx.wakeAttempts),
      rewake_cap: String(ctx.rewakeCap),
      last_turn_minutes_ago: String(ctx.lastTurnMinutesAgo)
    };
    return this.assemble(wake, this.deps.capAlertTemplate.composition, '', values);
  }

  /**
   * The stall-notice message (spec_wakery-stall-notice-message.md, self-healing
   * F2): the one-duty confession turn for a project-level full stop. The stall
   * facts ride the synthetic wake's task_payload ({open_task_count,
   * stalled_minutes}), written by the board sweep when it raises the alarm.
   */
  async renderStallNotice(wake: Wake, route: Route): Promise<string> {
    if (!this.deps.stallNoticeTemplate) {
      throw new RenderError(wake.id, ['stall-notice-template'], 'stallNoticeTemplate not configured');
    }
    const { agent, repoProject } = await this.fetchSources(wake, route);
    const payload = (wake.task_payload ?? {}) as { open_task_count?: number; stalled_minutes?: number };
    const values = {
      ...this.resolveValues(wake, route, agent, repoProject, ''),
      open_task_count: payload.open_task_count == null ? null : String(payload.open_task_count),
      stalled_minutes: payload.stalled_minutes == null ? null : String(payload.stalled_minutes)
    };
    return this.assemble(wake, this.deps.stallNoticeTemplate.composition, '', values);
  }

  private async fetchSources(wake: Wake, route: Route) {
    const agent = await this.deps.fetchAgent(wake, route);
    if (!agent) {
      throw new RenderError(wake.id, ['github_agent'], 'fetchAgent returned null');
    }
    const repoProject = await this.deps.fetchRepoProject(wake);
    if (!repoProject) {
      throw new RenderError(wake.id, ['github_repo_project'], 'fetchRepoProject returned null');
    }
    return { agent, repoProject };
  }

  private laneInstructions(route: Route, wake: Wake): string {
    const stateBlock = this.selectStateBlock(route.actor, wake.task_status, wake.task_audit);
    return substitute(stateBlock, this.commentLengthValues());
  }

  private assemble(
    wake: Wake,
    composition: string,
    laneInstructions: string,
    values: Record<string, string | null>
  ): string {
    const stringValues = pruneNulls(values);
    // Splice lane_instructions first, then substitute remaining placeholders
    // against the spliced result so any placeholder introduced by the state
    // block (e.g., {{actor}} in the default block) is resolved.
    const spliced = substitute(composition, { lane_instructions: laneInstructions });
    const rendered = substitute(spliced, stringValues);
    const surviving = findUnsubstitutedTokens(rendered);
    if (surviving.length > 0) {
      throw new RenderError(wake.id, dedupe(surviving));
    }
    return rendered;
  }

  private selectStateBlock(actor: string, taskStatus: string, taskAudit: string): string {
    const key = `${actor}/${taskStatus}/${taskAudit}`;
    const blocks = this.deps.template.stateBlocks;
    if (Object.prototype.hasOwnProperty.call(blocks, key)) {
      return blocks[key];
    }
    return blocks.default;
  }

  private commentLengthValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.deps.template.commentLengths)) {
      out[`comment_length_${name}`] = value;
    }
    return out;
  }

  private resolveValues(
    wake: Wake,
    route: Route,
    agent: GithubAgent,
    repoProject: RepoProjectView,
    laneInstructions: string
  ): Record<string, string | null> {
    const repoFullName = `${repoProject.github_owner_name}/${repoProject.github_repo}`;
    const agentRole = agent.role as unknown as string;
    return {
      utc_timestamp: this.now().toISOString(),
      actor: route.actor,
      lane_instructions: laneInstructions,
      agent_role: agentRole,
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      agent_github_login: agent.github_login,
      project_name: repoProject.github_project_title,
      project_number: repoProject.github_project_number == null ? null : String(repoProject.github_project_number),
      project_url:
        repoProject.github_project_number == null
          ? null
          : `https://github.com/users/${repoProject.github_owner_name}/projects/${repoProject.github_project_number}`,
      owner_name: repoProject.github_owner_name,
      repo: repoProject.github_repo,
      repo_full_name: repoFullName,
      agent_homespace: deriveAgentHomespace(agent.agent_id, repoProject.project_slug, this.deps.projectStoragePath),
      issue_url: `https://github.com/${repoFullName}/issues/${wake.task_id}`,
      wake_id: wake.id,
      project_id: wake.project_id,
      task_id: wake.task_id,
      task_type: wake.task_type,
      task_status: wake.task_status,
      task_audit: wake.task_audit,
      task_title: wake.task_title,
      task_payload_json: JSON.stringify(wake.task_payload ?? null),
      route_id: route.id
    };
  }
}

// The AI Lead's homespace is the canonical `main/` clone; every other agent works
// in `team/<agent_id>/` (PROJECT.md §Project path). The AI Lead is identified by
// the identity model — its agent_id is `main` — NOT by agent_role: the DB
// `github_agent.role` column stores the enum 'principal'|'auditor'|'agent', so the
// AI Lead's role is 'agent' (indistinguishable from a specialist) and a
// `role === 'AI Lead'` test never matches in production — the #22 homespace bug
// that emitted the non-existent `team/main` path. agent_id is the unique, reliable
// signal.
function deriveAgentHomespace(
  agentId: string,
  projectSlug: string,
  projectStoragePath: string
): string {
  if (agentId === 'main') {
    return `${projectStoragePath}/${projectSlug}/main`;
  }
  return `${projectStoragePath}/${projectSlug}/team/${agentId}`;
}

/**
 * {{gate}} derivation (spec_wakery-govern-notice-message.md §Placeholders):
 * `Todo:Govern` → the first gate, `Done:Govern` → the second. Any other
 * lifecycle carrying a Govern audit has no gate to name — the render aborts
 * (spec §Invariants: render aborts on any missing placeholder).
 */
function deriveGovernGate(wake: Wake): string {
  if (wake.task_status === 'Todo') return 'pre-execution (Preview)';
  if (wake.task_status === 'Done') return 'post-execution (Review)';
  throw new RenderError(
    wake.id,
    ['gate'],
    `no gate derivation for ${wake.task_status}:${wake.task_audit}`
  );
}

function pruneNulls(values: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v != null) out[k] = v;
  }
  return out;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
