import crypto from 'node:crypto';
import type { TaskRelations, WakeRequest } from '../../shared/types.js';
import type { GithubAgentRepository } from '../../db/github-agent-repository.js';
import type { GithubRepoProjectRepository } from '../../db/github-repo-project-repository.js';
import type { TaskTypeLabelRepository } from '../../db/task-type-label-repository.js';
import { EVENT_CODES, LANELESS_TASK_TYPES } from '../../events/codes.js';
import type { EventWriter } from '../../events/writer.js';
import { makeTaskKey } from '../../shared/ids.js';
import { isReachableOrSame } from '../../shared/lifecycle.js';

export const TASK_PARENT_LABEL = 'task:parent';
export const TASK_CHILD_LABEL = 'task:child';
export const TASK_BLOCKED_LABEL = 'task:blocked';
export const TASK_BLOCKING_LABEL = 'task:blocking';

export function verifyGitHubSignature(payload: string, signature: string, secret: string) {
  if (!secret || !signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, sigBuf);
}

/**
 * Detect whether a comment body is a TASK.md transition comment.
 * Transition comments contain structured From/To/Actor fields.
 */
export function isTransitionComment(body: string): boolean {
  if (!body) return false;
  const hasFrom = /\bFrom\s*:/i.test(body);
  const hasTo = /\bTo\s*:/i.test(body);
  const hasActor = /\bActor\s*:/i.test(body);
  return hasFrom && hasTo && hasActor;
}

// Two-gate machine (TASK.md §Transition) — `Rework` does not exist.
const LIFECYCLE_STATES = new Set(['Init', 'Todo', 'Pending', 'Progress', 'Done', 'Reviewed', 'Completed', 'Cancelled']);
const AUDIT_STATES = new Set(['Gated', 'Approved', 'Revise', 'Govern']);

export interface TransitionTargets {
  taskStatus?: string;
  taskAudit?: string;
}

function canonicalState(value: string, allowed: Set<string>) {
  const normalized = value.trim().toLowerCase();
  for (const state of allowed) {
    if (state.toLowerCase() === normalized) return state;
  }
  return null;
}

function cleanTransitionLine(line: string) {
  return line
    .replace(/^\s*[>\-*]+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

/**
 * Extract the target lifecycle/audit state from a TASK.md transition comment.
 *
 * GitHub issue_comment webhooks can arrive before ProjectV2 field reads reflect
 * the just-performed transition. The transition comment is a *hint* that an
 * upstream transition was attempted; the wake-service uses this hint to decide
 * whether to hold the wake in `pending` until ProjectV2 catches up. The hint
 * is **never** used as a substitute for the observed `task_status`/`task_audit`.
 */
export function parseTransitionTargets(body: string): TransitionTargets {
  for (const rawLine of body.split(/\r?\n/)) {
    const line = cleanTransitionLine(rawLine);
    const match = /^To\s*:\s*(.+)$/i.exec(line);
    if (!match) continue;

    const target = match[1].trim();
    const auditTarget = /^Audit\s+(.+)$/i.exec(target)?.[1] ?? target;
    const lifecycle = canonicalState(target, LIFECYCLE_STATES);
    const audit = canonicalState(auditTarget, AUDIT_STATES);

    if (target.toLowerCase().startsWith('audit ') && audit) return { taskAudit: audit };
    if (lifecycle) return { taskStatus: lifecycle };
    if (audit) return { taskAudit: audit };
  }
  return {};
}

// GraphQL addressing rides the immutable repository node ID (node(id:) on
// github_repo_id, specs/data/spec_database.md §5) — rename-proof; owner/repo
// logins are display-only and never API addresses.
const ISSUE_GRAPHQL_QUERY = `
query($repoId: ID!, $number: Int!) {
  node(id: $repoId) {
    ... on Repository {
    issue(number: $number) {
      number
      state
      title
      body
      author { login }
      assignees(first: 10) { nodes { login, id } }
      labels(first: 20) { nodes { name } }
      parent { number }
      subIssuesSummary { total completed }
      issueDependenciesSummary { blockedBy blocking totalBlockedBy totalBlocking }
      linkedBranches(first: 5) { nodes { ref { name } } }
      projectItems(first: 10) {
        nodes {
          project { id, title }
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
}
`;

export interface GitHubIssueState {
  number: number;
  /** Native GitHub issue state: 'OPEN' | 'CLOSED'. */
  issueState: string;
  title: string;
  body: string;
  authorLogin: string;
  assignees: Array<{ login: string; nodeId: string }>;
  labels: string[];
  parentNumber: number | null;
  subIssuesTotal: number;
  subIssuesCompleted: number;
  blockedByOpen: number;
  blockedByTotal: number;
  blockingOpen: number;
  blockingTotal: number;
  linkedBranchNames: string[];
  projectId: string | null;
  projectTitle: string | null;
  taskStatus: string | null;
  taskAudit: string | null;
}

/**
 * Build the task_relations JSON for a wake from the issue's GraphQL state.
 * Returns null when none of the four labels (task:child, task:parent,
 * task:blocked, task:blocking) is present.
 *
 * Each entry is gated on its corresponding label:
 *   - task:child    -> `parent`     (informational, only when parent attached)
 *   - task:parent   -> `children`   (drives Parent gate; empty object signals label-only)
 *   - task:blocked  -> `blocked_by` (drives Blocked gate; empty object signals label-only)
 *   - task:blocking -> `blocking`   (informational, no gate)
 *
 * `completed` for blocked_by/blocking is derived as `total - open` since
 * IssueDependenciesSummary returns the open subset, not the closed count.
 */
export function buildTaskRelations(state: GitHubIssueState): TaskRelations | null {
  const relations: TaskRelations = {};
  if (state.labels.includes(TASK_CHILD_LABEL) && state.parentNumber !== null) {
    relations.parent = { task_id: String(state.parentNumber) };
  }
  if (state.labels.includes(TASK_PARENT_LABEL)) {
    relations.children = { total: state.subIssuesTotal, completed: state.subIssuesCompleted };
  }
  if (state.labels.includes(TASK_BLOCKED_LABEL)) {
    relations.blocked_by = {
      total: state.blockedByTotal,
      completed: state.blockedByTotal - state.blockedByOpen
    };
  }
  if (state.labels.includes(TASK_BLOCKING_LABEL)) {
    relations.blocking = {
      total: state.blockingTotal,
      completed: state.blockingTotal - state.blockingOpen
    };
  }
  return relations.parent || relations.children || relations.blocked_by || relations.blocking ? relations : null;
}

export async function fetchIssueState(
  token: string,
  repoNodeId: string,
  issueNumber: number,
  githubProjectId: string
): Promise<GitHubIssueState | null> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ISSUE_GRAPHQL_QUERY, variables: { repoId: repoNodeId, number: issueNumber } })
  });
  if (!response.ok) return null;
  const json = await response.json() as any;
  const issue = json.data?.node?.issue;
  if (!issue) return null;

  const assignees = (issue.assignees?.nodes ?? []).map((a: any) => ({ login: a.login, nodeId: a.id }));
  const labels = (issue.labels?.nodes ?? []).map((l: any) => l.name);
  const projectItems: any[] = issue.projectItems?.nodes ?? [];

  // the tracked board's item is selected by the ProjectV2 node id
  // (github_repo_project.github_project_id)
  const matched = projectItems.find((pi: any) => pi.project?.id === githubProjectId) ?? null;

  let taskStatus: string | null = null;
  let taskAudit: string | null = null;
  if (matched) {
    for (const fv of matched.fieldValues?.nodes ?? []) {
      const fieldName = fv.field?.name;
      if (fieldName === 'Status') taskStatus = fv.name ?? null;
      if (fieldName === 'Audit') taskAudit = fv.name ?? null;
    }
  }

  const parentNumber: number | null = typeof issue.parent?.number === 'number' ? issue.parent.number : null;
  const subIssuesTotal: number = Number(issue.subIssuesSummary?.total ?? 0);
  const subIssuesCompleted: number = Number(issue.subIssuesSummary?.completed ?? 0);
  const depSummary = issue.issueDependenciesSummary ?? {};
  const blockedByOpen: number = Number(depSummary.blockedBy ?? 0);
  const blockedByTotal: number = Number(depSummary.totalBlockedBy ?? 0);
  const blockingOpen: number = Number(depSummary.blocking ?? 0);
  const blockingTotal: number = Number(depSummary.totalBlocking ?? 0);

  return {
    number: issue.number,
    issueState: issue.state ?? '',
    title: issue.title,
    body: issue.body ?? '',
    authorLogin: issue.author?.login ?? '',
    assignees,
    labels,
    parentNumber,
    subIssuesTotal,
    subIssuesCompleted,
    blockedByOpen,
    blockedByTotal,
    blockingOpen,
    blockingTotal,
    linkedBranchNames: (issue.linkedBranches?.nodes ?? [])
      .map((n: any) => n?.ref?.name)
      .filter((name: any): name is string => typeof name === 'string' && name.length > 0),
    projectId: matched?.project?.id ?? null,
    projectTitle: matched?.project?.title ?? null,
    taskStatus,
    taskAudit
  };
}

/**
 * Fetch the list of issue numbers that the given issue is blocking. Used by
 * the `issues.closed`/`reopened` webhook handler to refresh task_relations on
 * every Task that this closed/reopened issue feeds into via Blocked-by.
 * Capped at 50 entries — pagination is an edge case left for future work.
 */
export async function fetchIssueBlockingNumbers(
  token: string,
  repoNodeId: string,
  issueNumber: number
): Promise<number[]> {
  const query = `
    query($repoId: ID!, $number: Int!) {
      node(id: $repoId) {
        ... on Repository {
          issue(number: $number) {
            blocking(first: 50) { nodes { number } }
          }
        }
      }
    }
  `;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { repoId: repoNodeId, number: issueNumber } })
  });
  if (!response.ok) return [];
  const json = await response.json() as any;
  const nodes = json.data?.node?.issue?.blocking?.nodes ?? [];
  return nodes.map((n: any) => Number(n.number)).filter((n: number) => Number.isFinite(n));
}

// task_branch resolution hops (spec_wakery-conduction-chaining.md Stage 3).
// The self case rides the main wake-build query; each hop below is the one
// extra query its case costs. `null` signals a failed query (distinct from a
// successful query with no links, which returns []).

async function fetchLinkedBranchNames(
  token: string,
  repoNodeId: string,
  issueNumber: number
): Promise<string[] | null> {
  const query = `
    query($repoId: ID!, $number: Int!) {
      node(id: $repoId) {
        ... on Repository {
          issue(number: $number) {
            linkedBranches(first: 5) { nodes { ref { name } } }
          }
        }
      }
    }
  `;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { repoId: repoNodeId, number: issueNumber } })
  });
  if (!response.ok) return null;
  const json = await response.json() as any;
  const issue = json.data?.node?.issue;
  if (!issue) return null;
  return (issue.linkedBranches?.nodes ?? [])
    .map((n: any) => n?.ref?.name)
    .filter((name: any): name is string => typeof name === 'string' && name.length > 0);
}

// Blocked-by hop: the first blocker's linkedBranches, nested so the hop stays
// one query (Integration Stage Tasks declare Blocked-by their lane's top-level
// Task — spec_wakery-conduction-chaining.md Stage 1).
async function fetchFirstBlockerLinkedBranchNames(
  token: string,
  repoNodeId: string,
  issueNumber: number
): Promise<string[] | null> {
  const query = `
    query($repoId: ID!, $number: Int!) {
      node(id: $repoId) {
        ... on Repository {
          issue(number: $number) {
            blockedBy(first: 1) {
              nodes { linkedBranches(first: 5) { nodes { ref { name } } } }
            }
          }
        }
      }
    }
  `;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { repoId: repoNodeId, number: issueNumber } })
  });
  if (!response.ok) return null;
  const json = await response.json() as any;
  const issue = json.data?.node?.issue;
  if (!issue) return null;
  const blocker = (issue.blockedBy?.nodes ?? [])[0];
  if (!blocker) return [];
  return (blocker.linkedBranches?.nodes ?? [])
    .map((n: any) => n?.ref?.name)
    .filter((name: any): name is string => typeof name === 'string' && name.length > 0);
}

export type BranchUnresolvedReason = 'no_link' | 'ambiguous' | 'query_failed';

export interface TaskBranchResolution {
  taskBranch: string | null;
  // Set when the resolution warrants a wake.branch.unresolved emission:
  // `ambiguous` still resolves (first entry taken); the other two resolve NULL.
  unresolvedReason?: BranchUnresolvedReason;
}

/**
 * Resolve the branch↔task binding for a wake being built
 * (spec_wakery-conduction-chaining.md Stage 3). Resolution order: own
 * linkedBranches → parent issue's linkedBranches (Child Tasks) → first
 * Blocked-by blocker's linkedBranches (Integration Stage Tasks). First
 * non-empty wins; a multi-entry list takes the first entry with reason
 * `ambiguous`. Never blocks wake storage — failures degrade to NULL.
 */
export async function resolveTaskBranch(
  token: string,
  repoNodeId: string,
  issueState: GitHubIssueState
): Promise<TaskBranchResolution> {
  const pick = (names: string[]): TaskBranchResolution => names.length > 1
    ? { taskBranch: names[0], unresolvedReason: 'ambiguous' }
    : { taskBranch: names[0] };

  if (issueState.linkedBranchNames.length > 0) return pick(issueState.linkedBranchNames);

  if (issueState.parentNumber !== null) {
    const parentNames = await fetchLinkedBranchNames(token, repoNodeId, issueState.parentNumber);
    if (parentNames === null) return { taskBranch: null, unresolvedReason: 'query_failed' };
    if (parentNames.length > 0) return pick(parentNames);
  }

  if (issueState.blockedByTotal > 0) {
    const blockerNames = await fetchFirstBlockerLinkedBranchNames(token, repoNodeId, issueState.number);
    if (blockerNames === null) return { taskBranch: null, unresolvedReason: 'query_failed' };
    if (blockerNames.length > 0) return pick(blockerNames);
  }

  return { taskBranch: null, unresolvedReason: 'no_link' };
}

// Stage 6 — Validate `type:*` label and extract `task_type`.
// Returns one of four outcomes per spec_wakery-github-adapter.md §Stage 6:
//   - 'ok' (exactly one canonical `type:<value>` label)
//   - 'not_a_task_issue' (zero `type:*` labels)
//   - 'unknown_task_type' (one `type:*` label whose value is not in `validTypes`)
//   - 'ambiguous_task_type' (more than one `type:*` label, any combination)
//
// `validTypes` is the active set loaded from `task_type_label` (the runtime
// authority, spec_wakery-task-type-registry.md §R2) — no longer the code
// constant. The function stays pure (set in, outcome out); the caller owns the
// per-evaluation load so a newly inserted/retired row takes effect without a
// wakery redeploy.
export type TypeLabelOutcome =
  | { outcome: 'ok'; taskType: string }
  | { outcome: 'not_a_task_issue'; typeLabels: string[] }
  | { outcome: 'unknown_task_type'; typeLabel: string }
  | { outcome: 'ambiguous_task_type'; typeLabels: string[] };

export function validateTaskTypeLabel(labels: string[], validTypes: ReadonlySet<string>): TypeLabelOutcome {
  const typeLabels = labels.filter((l) => l.startsWith('type:'));
  if (typeLabels.length === 0) {
    return { outcome: 'not_a_task_issue', typeLabels: [] };
  }
  if (typeLabels.length > 1) {
    return { outcome: 'ambiguous_task_type', typeLabels };
  }
  const value = typeLabels[0].slice('type:'.length).trim();
  if (!validTypes.has(value)) {
    return { outcome: 'unknown_task_type', typeLabel: typeLabels[0] };
  }
  return { outcome: 'ok', taskType: value };
}

export interface GitHubAdapterDeps {
  githubToken: string;
  githubAgentRepo: GithubAgentRepository;
  githubRepoProjectRepo: GithubRepoProjectRepository;
  // Stage 6 loads the valid task-type set from this repo per evaluation, so a
  // type added/retired via `add-task-type` takes effect without a redeploy (§R2).
  taskTypeLabelRepo: TaskTypeLabelRepository;
  // Stage 6 emits 1010/1011/1012 directly when it drops; passing the
  // eventWriter through deps keeps the per-outcome payload (issue URL, full
  // label set, offending label) at the call site without the higher caller
  // having to know the four-outcome shape.
  eventWriter?: EventWriter;
  // Stage 6a (E10, #76) reads the current-state wake's create_time to detect a
  // stale/delayed webhook delivery. Narrow read-only view of WakeRepository so the
  // adapter does not depend on the full wake-storage surface. Optional — when
  // absent the stale gate is skipped (e.g. the no-DB unit paths).
  wakeStateReader?: { findCurrentByTaskKey(taskKey: string): Promise<{ create_time: number } | null> };
}

export async function buildWakeRequestFromComment(
  deliveryId: string | undefined,
  payload: any,
  deps: GitHubAdapterDeps
): Promise<{ wakeRequest: WakeRequest } | { ignored: string; reason?: string }> {
  const action = payload.action;
  if (action !== 'created') return { ignored: 'action is not created' };

  // PR-origin comment guard (spec_wakery-github-adapter.md Stage 2): every pull
  // request is an issue — `issue_comment` fires identically for both, and the
  // raw payload's `issue.pull_request` key is the only discriminator (the
  // GraphQL issue fetch does not carry it). A comment on a PR never proceeds
  // to wake building.
  if (payload.issue?.pull_request) {
    return { ignored: 'comment on a pull request, not an issue', reason: 'pull_request_comment' };
  }

  const commentBody = payload.comment?.body ?? '';
  if (!isTransitionComment(commentBody)) return { ignored: 'not a transition comment' };

  const repoFullName: string = payload.repository?.full_name ?? '';
  const [owner, repo] = repoFullName.split('/');
  const repoNodeId: string = payload.repository?.node_id ?? '';
  const issueNumber = payload.issue?.number;
  if (!owner || !repo || !issueNumber) return { ignored: 'missing repo or issue number' };
  if (!repoNodeId) return { ignored: 'missing repository node_id in webhook payload' };

  const repoProject = await deps.githubRepoProjectRepo.findByRepoId(repoNodeId);
  if (!repoProject) return { ignored: `repository ${repoFullName} (node_id=${repoNodeId}) is not tracked in github_repo_project` };

  const issueState = await fetchIssueState(deps.githubToken, repoProject.github_repo_id, issueNumber, repoProject.github_project_id);
  if (!issueState) return { ignored: 'failed to fetch issue state from GitHub API' };
  if (!issueState.projectId) return { ignored: `issue not associated with tracked project ${repoProject.github_project_id}` };
  if (!issueState.taskStatus) return { ignored: 'no Status field on project item' };
  if (!issueState.taskAudit) return { ignored: 'no Audit field on project item' };

  // Stage 6 — validate type:* label. Drops short-circuit with a specific
  // 1010/1011/1012 event per spec_wakery-github-adapter.md §Stage 6.
  const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
  // Per-evaluation load of the valid set from task_type_label (§R2 no-redeploy):
  // a row inserted/retired since the last webhook is reflected on the next one.
  const validTypes = await deps.taskTypeLabelRepo.activeTypeValues();
  const typeOutcome = validateTaskTypeLabel(issueState.labels, validTypes);
  if (typeOutcome.outcome !== 'ok') {
    if (deps.eventWriter) {
      const base = {
        request_id: deliveryId ?? `gh-${Date.now()}`,
        source: 'github',
        issue_url: issueUrl,
        repo: repoFullName,
        issue_number: issueNumber
      };
      if (typeOutcome.outcome === 'not_a_task_issue') {
        deps.eventWriter.emit(EVENT_CODES.REQUEST_DROPPED_NOT_A_TASK_ISSUE, {
          ...base,
          labels: issueState.labels
        });
      } else if (typeOutcome.outcome === 'unknown_task_type') {
        deps.eventWriter.emit(EVENT_CODES.REQUEST_DROPPED_UNKNOWN_TASK_TYPE, {
          ...base,
          type_label: typeOutcome.typeLabel
        });
      } else {
        deps.eventWriter.emit(EVENT_CODES.REQUEST_DROPPED_AMBIGUOUS_TASK_TYPE, {
          ...base,
          type_labels: typeOutcome.typeLabels
        });
      }
    }
    return { ignored: `stage 6 drop: ${typeOutcome.outcome}` };
  }
  const taskType = typeOutcome.taskType;

  const transitionTargets = parseTransitionTargets(commentBody);

  // Stage 6a — Stale/delayed webhook gate (E10, #76). A delayed delivery of an old
  // transition comment can arrive after the task has moved well past it (the #69
  // late-webhook class). Drop it when BOTH hold:
  //   (1) the comment's lifecycle `To:` is not consistent with where the task is now
  //       (not the observed state and not one legal step ahead — `isReachableOrSame`),
  //       which still passes legitimate backward transitions (Done→Rework, Govern→Init)
  //       and still-lagging forward ones; and
  //   (2) the comment predates the current-state wake (so it really is an old delivery,
  //       not a fresh out-of-order/malformed one).
  const intendedTo = transitionTargets.taskStatus;
  if (intendedTo && deps.wakeStateReader && !isReachableOrSame(issueState.taskStatus, intendedTo)) {
    const commentCreatedAt = Date.parse(payload.comment?.created_at ?? '');
    // task_key rides the platform project key stamped from the mapping row
    const taskKey = makeTaskKey(repoProject.project_id, String(issueState.number));
    const currentWake = await deps.wakeStateReader.findCurrentByTaskKey(taskKey);
    if (currentWake && Number.isFinite(commentCreatedAt) && commentCreatedAt < currentWake.create_time) {
      deps.eventWriter?.emit(EVENT_CODES.REQUEST_DROPPED_STALE_WEBHOOK, {
        request_id: deliveryId ?? `gh-${Date.now()}`,
        source: 'github',
        issue_url: issueUrl,
        intended_to: intendedTo,
        observed_state: issueState.taskStatus,
        comment_created_at: commentCreatedAt,
        current_wake_create_time: currentWake.create_time
      });
      return { ignored: `stale webhook: To=${intendedTo} not legal from observed=${issueState.taskStatus}, comment predates current-state wake` };
    }
  }

  // task_branch resolution (spec_wakery-conduction-chaining.md Stage 3) — after
  // Stage 6 so the laneless-type suppression can read taskType, and after the
  // stale gate so a dropped delivery costs no hop queries. Never blocks the wake.
  const branchResolution = await resolveTaskBranch(deps.githubToken, repoProject.github_repo_id, issueState);
  if (branchResolution.unresolvedReason && !LANELESS_TASK_TYPES.has(taskType)) {
    deps.eventWriter?.emit(EVENT_CODES.WAKE_BRANCH_UNRESOLVED, {
      request_id: deliveryId ?? `gh-${Date.now()}`,
      source: 'github',
      issue_url: issueUrl,
      task_key: makeTaskKey(repoProject.project_id, String(issueState.number)),
      task_type: taskType,
      reason: branchResolution.unresolvedReason,
      ...(branchResolution.taskBranch ? { task_branch: branchResolution.taskBranch } : {})
    });
  }

  const primaryAssignee = issueState.assignees[0] ?? null;
  const authorLogin = issueState.authorLogin;

  let assigneeId: string | undefined;
  let assigneeName: string | undefined;
  if (primaryAssignee) {
    assigneeId = primaryAssignee.nodeId;
    assigneeName = primaryAssignee.login;
  }

  let ownerId: string | undefined;
  let ownerName: string | undefined;
  if (authorLogin) {
    ownerName = authorLogin;
    const ownerMapping = await deps.githubAgentRepo.findByGitHubLogin(authorLogin);
    ownerId = ownerMapping?.github_node_id;
  }

  const taskRelations = buildTaskRelations(issueState) ?? undefined;

  return {
    wakeRequest: {
      request_id: deliveryId ?? `gh-${Date.now()}`,
      source: 'github',
      // the platform project key (project.id), stamped from the mapping row —
      // GitHub node ids never leave the github_-prefixed integration fields
      project_id: repoProject.project_id,
      project_name: issueState.projectTitle ?? undefined,
      task_id: String(issueState.number),
      task_type: taskType,
      task_title: issueState.title,
      task_priority: 1,
      task_status: issueState.taskStatus,
      task_status_expected: transitionTargets.taskStatus,
      task_audit: issueState.taskAudit,
      task_audit_expected: transitionTargets.taskAudit,
      task_labels: issueState.labels,
      task_relations: taskRelations,
      task_branch: branchResolution.taskBranch ?? undefined,
      task_payload: { body: issueState.body, labels: issueState.labels, author_login: authorLogin },
      assignee_id: assigneeId,
      assignee_name: assigneeName,
      owner_id: ownerId,
      owner_name: ownerName,
      timestamp: Date.now()
    }
  };
}
