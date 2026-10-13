import { EVENT_CODES, STALL_ALARM_LABEL, STALL_ALARM_TASK_ID } from '../events/codes.js';
import type { EventWriter } from '../events/writer.js';
import { makeStateKey, makeTaskKey, mintId } from '../shared/ids.js';
import type { GithubRepoProject, Wake, WakeRequest, WakeResponse } from '../shared/types.js';
import { resolveResponsibleActor } from '../shared/eligibility.js';
import {
  buildTaskRelations,
  fetchIssueState,
  resolveTaskBranch,
  validateTaskTypeLabel
} from '../adapters/github/adapter.js';

/**
 * Board-reconcile sweep (self-healing F1, spec_wakery-board-sweep.md).
 *
 * The GitHub board is the obligation ledger: every open task's
 * (Status, Audit) pair names a responsible actor via the eligibility matrix.
 * The event-driven ingress stays primary; this sweep makes ABSENCE observable —
 * any open task in an actionable state with no open wake and no open lease past
 * a quiet threshold gets a wake minted (`source: board_sweep`), exactly as if
 * the missing webhook had arrived. Safety is inherited, not new: the minted
 * request rides the full ingress path (eligibility, same-state dedup, Govern
 * cue) and the dispatched wake rides every dispatch gate (task-turn, Blocked,
 * Parent, serial-release) — idempotent by the same construction as everything
 * else. Subsumes as backstop: lost webhooks, deleted-comment phantoms,
 * forgotten closeouts/acceptances, create-without-transition (a sibling project's #56/#57).
 */

/** One board item as the sweep query sees it — enough to decide candidacy. */
export interface BoardItem {
  issueNumber: number;
  /** Native GitHub issue state: 'OPEN' | 'CLOSED'. */
  issueState: string;
  repoOwner: string;
  repoName: string;
  taskStatus: string | null;
  taskAudit: string | null;
  /**
   * Scheduled/parked discriminator (TASK.md §Mapping): an open issue with no
   * assignee is parked — a note for a future milestone, invisible to the
   * sweep and the stall accounting alike.
   */
  hasAssignee: boolean;
  /** max(project-item updatedAt, issue updatedAt) — the quiet clock. */
  lastActivityMs: number;
}

const PROJECT_ITEMS_QUERY = `
query($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          updatedAt
          content {
            ... on Issue {
              number
              state
              updatedAt
              assignees(first: 1) { totalCount }
              repository { name owner { login } }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
        }
      }
    }
  }
}
`;

const MAX_BOARD_PAGES = 5;

/**
 * One paginated GraphQL read per project per pass — the whole board in
 * MAX_BOARD_PAGES × 100 items. `null` signals a failed query (distinct from an
 * empty board).
 */
export async function fetchProjectBoardItems(token: string, projectId: string): Promise<BoardItem[] | null> {
  const items: BoardItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_BOARD_PAGES; page++) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: PROJECT_ITEMS_QUERY, variables: { projectId, after } })
    });
    if (!response.ok) return null;
    const json = await response.json() as any;
    const connection = json.data?.node?.items;
    if (!connection) return null;

    for (const node of connection.nodes ?? []) {
      const issue = node?.content;
      if (typeof issue?.number !== 'number') continue; // non-issue items (drafts, PRs)
      let taskStatus: string | null = null;
      let taskAudit: string | null = null;
      for (const fv of node.fieldValues?.nodes ?? []) {
        const fieldName = fv?.field?.name;
        if (fieldName === 'Status') taskStatus = fv.name ?? null;
        if (fieldName === 'Audit') taskAudit = fv.name ?? null;
      }
      const itemUpdated = Date.parse(node.updatedAt ?? '');
      const issueUpdated = Date.parse(issue.updatedAt ?? '');
      items.push({
        issueNumber: issue.number,
        issueState: issue.state ?? '',
        repoOwner: issue.repository?.owner?.login ?? '',
        repoName: issue.repository?.name ?? '',
        taskStatus,
        taskAudit,
        hasAssignee: Number(issue.assignees?.totalCount ?? 0) > 0,
        lastActivityMs: Math.max(
          Number.isFinite(itemUpdated) ? itemUpdated : 0,
          Number.isFinite(issueUpdated) ? issueUpdated : 0
        )
      });
    }

    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return items;
}

export interface BoardSweeperDeps {
  githubToken: string;
  githubRepoProjectRepo: { listAll(): Promise<GithubRepoProject[]> };
  wakeRepo: {
    findCurrentByTaskKey(taskKey: string): Promise<{ id: string } | null>;
    countOpenByProjectId(projectId: string, excludeTaskId?: string): Promise<number>;
    create(wake: Wake): Promise<unknown>;
    completeOpenByTaskKey(taskKey: string): Promise<unknown>;
  };
  leaseRepo: {
    findOpenByTaskKey(taskKey: string): Promise<{ id: string } | null>;
    countOpenByProjectId(projectId: string, excludeTaskId?: string): Promise<number>;
  };
  taskTypeLabelRepo: { activeTypeValues(): Promise<ReadonlySet<string>> };
  githubAgentRepo: { findByGitHubLogin(login: string): Promise<{ github_node_id: string } | null> };
  ingress: { handleWakeRequest(request: WakeRequest): Promise<WakeResponse> };
  eventWriter: Pick<EventWriter, 'emit'>;
  /** Minimum idle age (no board/issue activity) before a wakeless task is minted for. */
  quietMs?: number;
  /** Minimum persistence of the full-stop condition before the stall alarm raises (F2). */
  stallThresholdMs?: number;
  /** Injectable for tests; defaults to the live GraphQL readers. */
  fetchBoardItems?: typeof fetchProjectBoardItems;
  fetchIssue?: typeof fetchIssueState;
}

const NON_TERMINAL_EXCLUDED = new Set(['Completed', 'Cancelled']);

export class BoardSweeper {
  /**
   * Stall-episode clock (self-healing F2): first tick the full-stop condition
   * was observed, per project. In-memory only — a restart merely restarts the
   * threshold clock; the standing stall wake (if any) still dedupes.
   */
  private readonly stalledSince = new Map<string, number>();

  constructor(private readonly deps: BoardSweeperDeps) {}

  private get quietMs(): number {
    return this.deps.quietMs ?? 180_000;
  }

  private get stallThresholdMs(): number {
    return this.deps.stallThresholdMs ?? 1_800_000;
  }

  /** One full pass over every active project. Returns the number of wakes minted. */
  async runOnce(): Promise<number> {
    const projects = (await this.deps.githubRepoProjectRepo.listAll()).filter((p) => p.status === 'active');
    let minted = 0;
    for (const project of projects) {
      try {
        minted += await this.sweepProject(project);
      } catch (err) {
        this.deps.eventWriter.emit(EVENT_CODES.WAKE_BOARD_SWEEP_ERROR, {
          project_id: project.project_id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    return minted;
  }

  private async sweepProject(project: GithubRepoProject): Promise<number> {
    const fetchBoard = this.deps.fetchBoardItems ?? fetchProjectBoardItems;
    // the board read addresses GitHub by the ProjectV2 node id; keys and
    // counters below ride the platform project_id
    const items = await fetchBoard(this.deps.githubToken, project.github_project_id);
    if (items === null) {
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_BOARD_SWEEP_ERROR, {
        project_id: project.project_id,
        error: 'board items query failed'
      });
      return 0;
    }

    const now = Date.now();
    let minted = 0;
    for (const item of items) {
      if (item.issueState !== 'OPEN') continue;
      if (!item.taskStatus || !item.taskAudit) continue;
      // Parked exclusion (TASK.md §Mapping): no assignee = not scheduled —
      // the sweep must never rescue a note the Principal parked on purpose.
      if (!item.hasAssignee) continue;
      // Actionable state = the matrix names a responsible actor ('principal'
      // included: a wakeless Govern state still owes its notification cue).
      if (resolveResponsibleActor(item.taskStatus, item.taskAudit) === null) continue;
      if (now - item.lastActivityMs < this.quietMs) continue;

      const taskKey = makeTaskKey(project.project_id, String(item.issueNumber));
      if (await this.deps.wakeRepo.findCurrentByTaskKey(taskKey)) continue;
      if (await this.deps.leaseRepo.findOpenByTaskKey(taskKey)) continue;

      if (await this.mintFor(project, item)) minted++;
    }

    // F2 — the stall alarm floors the sweep: evaluated on the same board
    // snapshot, after minting, so a mint this pass already clears the stall.
    await this.evaluateStall(project, items);

    return minted;
  }

  /**
   * Stall alarm (self-healing F2, spec_wakery-board-sweep.md §Stall alarm):
   * open non-terminal tasks + zero open wakes + zero open leases (the
   * synthetic stall wake and its own turn excluded), persisting past the
   * threshold → store one stall-notice wake (owner lane, one confession
   * turn). Cleared — completed — when any real wake or lease appears or the
   * open tasks drain. One standing stall wake per project by task_key dedupe.
   */
  private async evaluateStall(project: GithubRepoProject, items: BoardItem[]): Promise<void> {
    // Parked issues (no assignee) are excluded here too: a board holding only
    // parked notes is idle by design, never a stall.
    const openTaskCount = items.filter(
      (i) => i.issueState === 'OPEN' && i.hasAssignee && i.taskStatus !== null && !NON_TERMINAL_EXCLUDED.has(i.taskStatus)
    ).length;
    const openWakes = await this.deps.wakeRepo.countOpenByProjectId(project.project_id, STALL_ALARM_TASK_ID);
    const openLeases = await this.deps.leaseRepo.countOpenByProjectId(project.project_id, STALL_ALARM_TASK_ID);
    const stalled = openTaskCount > 0 && openWakes === 0 && openLeases === 0;
    const stallKey = makeTaskKey(project.project_id, STALL_ALARM_TASK_ID);

    if (!stalled) {
      this.stalledSince.delete(project.project_id);
      if (await this.deps.wakeRepo.findCurrentByTaskKey(stallKey)) {
        await this.deps.wakeRepo.completeOpenByTaskKey(stallKey);
        this.deps.eventWriter.emit(EVENT_CODES.WAKE_STALL_CLEARED, {
          project_id: project.project_id,
          task_key: stallKey,
          open_task_count: openTaskCount,
          open_wakes: openWakes,
          open_leases: openLeases
        });
      }
      return;
    }

    const now = Date.now();
    const since = this.stalledSince.get(project.project_id) ?? now;
    this.stalledSince.set(project.project_id, since);
    if (now - since < this.stallThresholdMs) return;
    if (await this.deps.wakeRepo.findCurrentByTaskKey(stallKey)) return; // already confessed

    const stalledMinutes = Math.round((now - since) / 60_000);
    const wake: Wake = {
      id: mintId('wake'),
      task_key: stallKey,
      state_key: makeStateKey(project.project_id, STALL_ALARM_TASK_ID, 'Pending', 'Approved'),
      project_id: project.project_id,
      project_name: project.github_project_title,
      task_id: STALL_ALARM_TASK_ID,
      // Laneless type; state Pending resolves the owner lane via the matrix's
      // wildcard, riding the project's (task_type NULL, owner) fallback route.
      task_type: 'project_operation',
      task_title: `Wakery stall alarm — ${project.github_project_title ?? project.github_repo}`,
      task_priority: null,
      task_status: 'Pending',
      task_status_expected: null,
      task_audit: 'Approved',
      task_audit_expected: null,
      task_labels: [STALL_ALARM_LABEL],
      task_relations: null,
      task_branch: null,
      task_payload: { open_task_count: openTaskCount, stalled_minutes: stalledMinutes },
      assignee_id: null,
      assignee_name: null,
      owner_id: null,
      owner_name: null,
      queue_attempts: 0,
      dispatch_attempts: 0,
      wake_attempts: 0,
      status: 'queued',
      create_time: now,
      update_time: now
    };
    await this.deps.wakeRepo.create(wake);
    this.deps.eventWriter.emit(EVENT_CODES.WAKE_STALL_ALARMED, {
      project_id: project.project_id,
      wake_id: wake.id,
      task_key: stallKey,
      open_task_count: openTaskCount,
      stalled_minutes: stalledMinutes
    });
  }

  /**
   * Candidate confirmed absent from both ledgers — synthesize the WakeRequest
   * the lost webhook would have produced (fresh canonical fetch, no transition
   * hints) and hand it to ingress. Everything downstream is the ordinary path.
   */
  private async mintFor(project: GithubRepoProject, item: BoardItem): Promise<boolean> {
    const fetchIssue = this.deps.fetchIssue ?? fetchIssueState;
    const state = await fetchIssue(
      this.deps.githubToken,
      project.github_repo_id,
      item.issueNumber,
      project.github_project_id
    );
    // Re-derive candidacy from the fresh read — the board snapshot may have
    // raced a real webhook. Any disqualification is a silent skip: the next
    // pass re-evaluates from scratch.
    if (!state || !state.projectId || !state.taskStatus || !state.taskAudit) return false;
    if (state.issueState !== 'OPEN') return false;
    if (state.assignees.length === 0) return false; // parked on the fresh read too
    if (resolveResponsibleActor(state.taskStatus, state.taskAudit) === null) return false;

    // Type-label validation reuses the ingress rule but skips silently on
    // non-ok: a board item without a valid `type:*` is either not a task issue
    // or already warned about at transition time (1010-1012) — a 5-minute
    // cadence must not turn a standing condition into a warn stream.
    const validTypes = await this.deps.taskTypeLabelRepo.activeTypeValues();
    const typeOutcome = validateTaskTypeLabel(state.labels, validTypes);
    if (typeOutcome.outcome !== 'ok') return false;

    const branchResolution = await resolveTaskBranch(this.deps.githubToken, project.github_repo_id, state);

    const primaryAssignee = state.assignees[0] ?? null;
    let ownerId: string | undefined;
    if (state.authorLogin) {
      const ownerMapping = await this.deps.githubAgentRepo.findByGitHubLogin(state.authorLogin);
      ownerId = ownerMapping?.github_node_id;
    }

    const request: WakeRequest = {
      request_id: mintId('sweep'),
      source: 'board_sweep',
      // platform key from the mapping row, matching the webhook path's stamping
      project_id: project.project_id,
      project_name: state.projectTitle ?? undefined,
      task_id: String(state.number),
      task_type: typeOutcome.taskType,
      task_title: state.title,
      task_priority: 1,
      task_status: state.taskStatus,
      task_audit: state.taskAudit,
      task_labels: state.labels,
      task_relations: buildTaskRelations(state) ?? undefined,
      task_branch: branchResolution.taskBranch ?? undefined,
      task_payload: { body: state.body, labels: state.labels, author_login: state.authorLogin },
      assignee_id: primaryAssignee?.nodeId,
      assignee_name: primaryAssignee?.login,
      owner_id: ownerId,
      owner_name: state.authorLogin || undefined,
      timestamp: Date.now()
    };

    const response = await this.deps.ingress.handleWakeRequest(request);
    // 'accepted' = the absence is repaired. 'updated' = a wake appeared in the
    // race window — the ledger is whole, nothing to record. 'dropped' = ingress
    // already emitted its own outcome event (1003/1009).
    if (response.status !== 'accepted') return false;
    this.deps.eventWriter.emit(EVENT_CODES.WAKE_BOARD_SWEEP_MINTED, {
      request_id: request.request_id,
      project_id: request.project_id,
      task_id: request.task_id,
      task_key: makeTaskKey(request.project_id, request.task_id),
      task_status: request.task_status,
      task_audit: request.task_audit,
      task_type: request.task_type,
      quiet_ms: Date.now() - item.lastActivityMs
    });
    return true;
  }
}
