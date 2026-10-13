import { labelInventory, rulesetPayloads, webhookEvents } from '../artifacts.js';
import { githubError, preflightError } from '../errors.js';
import type {
  CollaboratorRecord,
  LabelRecord,
  ProjectFieldRecord,
  ProjectRepoLinkRecord,
  ProjectV2Record,
  RepoRecord,
  ResourceRecord,
  RulesetRecord,
  BranchRecord,
  WebhookRecord
} from '../events.js';
import { AUDIT_OPTIONS, STATUS_OPTIONS, optionColor } from '../types.js';
import type { BoardInfo, FieldInfo, GitHubApi, OptionSpec, RepoInfo } from './api.js';

// The GitHub bootstrap sub-steps, in pipeline order (`spec_foundry.md §GitHub
// bootstrap`): repo, board, fields, link, labels, forms, webhook, grants — each
// idempotent per the resume table, each streaming its resource event. Rulesets
// and the `dev` branch live here too (F3 artifacts); the pipeline invokes them
// at their later stage.

export interface BootstrapContext {
  api: GitHubApi;
  ownerLogin: string;
  projectKey: string;
  projectName: string;
  webhookUrl: string;
  readWebhookSecret: () => string; // read at configure time, never persisted
  grantLogins: string[]; // deduped (resolved team logins ∪ audit login)
}

export interface GitHubBootstrapResult {
  records: ResourceRecord[];
  repo: RepoInfo;
  board: BoardInfo;
  statusField: FieldInfo;
  auditField: FieldInfo;
}

export async function ensureRepo(ctx: BootstrapContext): Promise<{ record: RepoRecord; repo: RepoInfo }> {
  const existing = await ctx.api.findRepo(ctx.ownerLogin, ctx.projectKey);
  if (existing) {
    if (existing.ownerLogin !== ctx.ownerLogin) {
      throw preflightError(`repo ${ctx.projectKey} exists under foreign owner ${existing.ownerLogin}`);
    }
    return {
      record: { resource: 'repo', name: ctx.projectKey, node_id: existing.nodeId, created_or_skipped: 'skipped', settings_applied: false },
      repo: existing
    };
  }
  const repo = await ctx.api.createUserRepo(ctx.projectKey);
  await ctx.api.patchRepoSettings(ctx.ownerLogin, ctx.projectKey);
  return {
    record: { resource: 'repo', name: ctx.projectKey, node_id: repo.nodeId, created_or_skipped: 'created', settings_applied: true },
    repo
  };
}

export async function ensureBoard(
  ctx: BootstrapContext,
  ownerNodeId: string
): Promise<{ record: ProjectV2Record; board: BoardInfo }> {
  const matches = await ctx.api.findBoardsByTitle(ctx.ownerLogin, ctx.projectName);
  if (matches.length > 1) {
    throw preflightError(`board title "${ctx.projectName}" matches ${matches.length} existing boards`);
  }
  if (matches.length === 1) {
    const board = matches[0]!;
    return { record: { resource: 'project_v2', title: ctx.projectName, node_id: board.id, created_or_skipped: 'skipped' }, board };
  }
  const board = await ctx.api.createBoard(ownerNodeId, ctx.projectName);
  return { record: { resource: 'project_v2', title: ctx.projectName, node_id: board.id, created_or_skipped: 'created' }, board };
}

const CANONICAL_FIELDS: { name: string; options: readonly OptionSpec[] }[] = [
  { name: 'Status', options: STATUS_OPTIONS.map((name) => ({ name, color: optionColor(name) })) },
  { name: 'Audit', options: AUDIT_OPTIONS.map((name) => ({ name, color: optionColor(name) })) }
];

function optionSetMatches(found: FieldInfo, canonical: readonly OptionSpec[]): boolean {
  if (found.options.length !== canonical.length) return false;
  return found.options.every((option, i) => option.name === canonical[i]!.name && (option.color === undefined || option.color === canonical[i]!.color));
}

// GitHub seeds every new board with a default `Status` single-select (Todo /
// In Progress / Done). An existing field whose option set differs is converged
// to the canonical set while the board holds no items — the fresh-board case,
// where nothing can lose a value; once items exist the option set is
// operator state and a difference is recorded as drift, untouched.
export async function ensureFields(
  ctx: BootstrapContext,
  projectId: string
): Promise<{ records: ProjectFieldRecord[]; fields: FieldInfo[] }> {
  const existing = await ctx.api.listBoardFields(projectId);
  const records: ProjectFieldRecord[] = [];
  const fields: FieldInfo[] = [];
  let itemCount: number | undefined;
  for (const canonical of CANONICAL_FIELDS) {
    const found = existing.find((f) => f.name === canonical.name);
    if (found) {
      const foundNames = found.options.map((o) => `${o.name}${o.color ? `/${o.color}` : ''}`);
      if (optionSetMatches(found, canonical.options)) {
        records.push({ resource: 'project_field', name: canonical.name, options: found.options, created_or_skipped: 'skipped' });
        fields.push(found);
        continue;
      }
      itemCount ??= await ctx.api.countBoardItems(projectId);
      if (itemCount === 0) {
        await ctx.api.updateSingleSelectFieldOptions(found.id, canonical.options);
        // the mutation's response carries placeholder option ids (observed
        // live: they do not match the persisted ones) — take the fresh read
        const fresh = (await ctx.api.listBoardFields(projectId)).find((f) => f.id === found.id);
        if (!fresh) throw githubError(`field ${canonical.name} vanished after convergence`);
        records.push({ resource: 'project_field', name: canonical.name, options: fresh.options, created_or_skipped: 'converged' });
        fields.push(fresh);
        continue;
      }
      const drift = `options [${foundNames.join(', ')}] differ from canonical [${canonical.options.map((o) => `${o.name}/${o.color}`).join(', ')}] — board holds ${itemCount} items, left untouched`;
      records.push({ resource: 'project_field', name: canonical.name, options: found.options, created_or_skipped: 'skipped', drift });
      fields.push(found);
      continue;
    }
    const created = await ctx.api.createSingleSelectField(projectId, canonical.name, canonical.options);
    records.push({ resource: 'project_field', name: canonical.name, options: created.options, created_or_skipped: 'created' });
    fields.push(created);
  }
  return { records, fields };
}

export async function linkBoard(
  ctx: BootstrapContext,
  projectId: string,
  repoNodeId: string
): Promise<ProjectRepoLinkRecord> {
  await ctx.api.linkBoardToRepo(projectId, repoNodeId); // idempotent
  return { resource: 'project_repo_link', project_node_id: projectId, repo_node_id: repoNodeId };
}

// Upsert by name; an existing different color is recorded as drift and the live
// label left untouched — Foundry adds, never subtracts.
export async function ensureLabels(ctx: BootstrapContext): Promise<LabelRecord[]> {
  const existing = await ctx.api.listLabels(ctx.ownerLogin, ctx.projectKey);
  const byName = new Map(existing.map((l) => [l.name, l]));
  const records: LabelRecord[] = [];
  for (const label of labelInventory()) {
    const found = byName.get(label.name);
    if (found) {
      const drift = found.color.toLowerCase() === label.color.toLowerCase() ? undefined : `color ${found.color} differs from canonical ${label.color}`;
      records.push({ resource: 'label', repo: ctx.projectKey, name: label.name, created_or_updated_or_skipped: 'skipped', ...(drift ? { drift } : {}) });
      continue;
    }
    await ctx.api.createLabel(ctx.ownerLogin, ctx.projectKey, label.name, label.color);
    records.push({ resource: 'label', repo: ctx.projectKey, name: label.name, created_or_updated_or_skipped: 'created' });
  }
  return records;
}

export async function ensureWebhook(ctx: BootstrapContext): Promise<WebhookRecord> {
  const events = webhookEvents();
  const hooks = await ctx.api.listHooks(ctx.ownerLogin, ctx.projectKey);
  const found = hooks.find((hook) => hook.url === ctx.webhookUrl);
  if (found) {
    const wantSorted = [...events].sort();
    const haveSorted = [...found.events].sort();
    const drifts: string[] = [];
    if (JSON.stringify(haveSorted) !== JSON.stringify(wantSorted)) {
      drifts.push(`events [${haveSorted.join(', ')}] differ from canonical [${wantSorted.join(', ')}]`);
    }
    if (!found.active) drifts.push('hook inactive');
    return {
      resource: 'webhook',
      hook_id: found.id,
      url: found.url,
      events: found.events,
      active: found.active,
      created_or_skipped: 'skipped',
      ...(drifts.length > 0 ? { drift: drifts.join('; ') } : {})
    };
  }
  const created = await ctx.api.createHook(ctx.ownerLogin, ctx.projectKey, ctx.webhookUrl, ctx.readWebhookSecret(), events);
  return { resource: 'webhook', hook_id: created.id, url: created.url, events: created.events, active: created.active, created_or_skipped: 'created' };
}

// Grants per distinct login, on both surfaces — repo (invite `push`, accepted
// in-run with a token of the invited account) and board (`WRITER`). A single
// failed entry records `failed` and continues — grants never abort the bootstrap.
export async function ensureGrants(ctx: BootstrapContext, projectId: string): Promise<CollaboratorRecord[]> {
  const records: CollaboratorRecord[] = [];
  for (const login of ctx.grantLogins) {
    let repoStatus: CollaboratorRecord['repo_invite_status'] = 'failed';
    let invitationId: number | undefined;
    let acceptedAt: string | undefined;
    let error: string | undefined;
    try {
      if (await ctx.api.isCollaborator(ctx.ownerLogin, ctx.projectKey, login)) {
        repoStatus = 'already_collaborator';
      } else {
        const invite = await ctx.api.inviteCollaborator(ctx.ownerLogin, ctx.projectKey, login);
        if (invite.invitationId === null) {
          repoStatus = 'already_collaborator';
        } else {
          invitationId = invite.invitationId;
          repoStatus = 'invited';
          await ctx.api.acceptInvitationAs(login, invite.invitationId);
          repoStatus = 'accepted';
          acceptedAt = new Date().toISOString();
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    let projectStatus: CollaboratorRecord['project_grant_status'] = 'failed';
    try {
      const userNodeId = await ctx.api.userNodeId(login);
      await ctx.api.grantBoardWriter(projectId, userNodeId);
      projectStatus = 'granted';
    } catch (caught) {
      error = error ?? (caught instanceof Error ? caught.message : String(caught));
    }
    records.push({
      resource: 'collaborator',
      github_login: login,
      repo_invite_status: repoStatus,
      project_grant_status: projectStatus,
      ...(invitationId !== undefined ? { invitation_id: invitationId } : {}),
      ...(acceptedAt !== undefined ? { accepted_at: acceptedAt } : {}),
      ...(error !== undefined ? { error } : {})
    });
  }
  return records;
}

// Apply the committed shapes; an existing same-name ruleset converges by delta,
// recorded. Skipped wholly when `github.ruleset = none`.
export async function ensureRulesets(ctx: BootstrapContext, mode: 'standard' | 'none'): Promise<RulesetRecord[]> {
  if (mode === 'none') return [];
  const existing = await ctx.api.listRulesets(ctx.ownerLogin, ctx.projectKey);
  const records: RulesetRecord[] = [];
  for (const payload of rulesetPayloads()) {
    const wantRules = payload.rules.map((rule) => rule.type);
    const found = existing.find((ruleset) => ruleset.name === payload.name);
    if (found) {
      const drifts: string[] = [];
      if (found.enforcement !== payload.enforcement) drifts.push(`enforcement ${found.enforcement} → ${payload.enforcement}`);
      const foundRules = [...found.ruleTypes].sort();
      if (JSON.stringify(foundRules) !== JSON.stringify([...wantRules].sort())) {
        drifts.push(`rules [${foundRules.join(', ')}] → [${wantRules.join(', ')}]`);
      }
      if (drifts.length > 0) await ctx.api.updateRuleset(ctx.ownerLogin, ctx.projectKey, found.id, payload);
      records.push({
        resource: 'ruleset',
        name: payload.name,
        enforcement: payload.enforcement,
        rules_applied: wantRules,
        created_or_skipped: drifts.length > 0 ? 'converged' : 'skipped',
        ...(drifts.length > 0 ? { drift: drifts.join('; ') } : {})
      });
      continue;
    }
    await ctx.api.createRuleset(ctx.ownerLogin, ctx.projectKey, payload);
    records.push({ resource: 'ruleset', name: payload.name, enforcement: payload.enforcement, rules_applied: wantRules, created_or_skipped: 'created' });
  }
  return records;
}

// Create `dev` at the scaffold commit, so both standing branches exist before
// protection (`spec_foundry.md §Scaffold commit, push, dev`).
export async function ensureDevBranch(ctx: BootstrapContext, scaffoldSha: string): Promise<BranchRecord> {
  const existing = await ctx.api.getRef(ctx.ownerLogin, ctx.projectKey, 'heads/dev');
  if (existing !== null) {
    return { resource: 'branch', name: 'dev', sha: existing, created_or_skipped: 'skipped' };
  }
  await ctx.api.createRef(ctx.ownerLogin, ctx.projectKey, 'refs/heads/dev', scaffoldSha);
  return { resource: 'branch', name: 'dev', sha: scaffoldSha, created_or_skipped: 'created' };
}

// A sink records resource acts as they complete — the run event log in
// production, a plain array in tests. Mid-stage failure leaves everything that
// ran already recorded.
export interface RecordSink {
  push(...records: ResourceRecord[]): number;
}

// The GitHub bootstrap pipeline stage: sub-steps in order, each emitting its
// resource record into `sink` as it completes. Failure anywhere throws exit 4;
// the event trail already covers the completed sub-steps
// (`spec_foundry.md §GitHub bootstrap`).
export async function runGitHubBootstrap(ctx: BootstrapContext, sink: RecordSink = []): Promise<GitHubBootstrapResult> {
  const all: ResourceRecord[] = [];
  const keep = (...records: ResourceRecord[]) => {
    all.push(...records);
    sink.push(...records);
  };
  try {
    const { record: repoRecord, repo } = await ensureRepo(ctx);
    keep(repoRecord);
    const { record: boardRecord, board } = await ensureBoard(ctx, repo.ownerNodeId);
    keep(boardRecord);
    const { records: fieldRecords, fields } = await ensureFields(ctx, board.id);
    keep(...fieldRecords);
    keep(await linkBoard(ctx, board.id, repo.nodeId));
    keep(...(await ensureLabels(ctx)));
    keep(await ensureWebhook(ctx));
    keep(...(await ensureGrants(ctx, board.id)));
    return {
      records: all,
      repo,
      board,
      statusField: fields.find((f) => f.name === 'Status')!,
      auditField: fields.find((f) => f.name === 'Audit')!
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'FoundryError') throw error;
    throw githubError(error instanceof Error ? error.message : String(error));
  }
}
