import type { GithubRepoProjectRepository } from '../../db/github-repo-project-repository.js';
import type { WakeRepository } from '../../db/wake-repository.js';
import type { EventWriter } from '../../events/writer.js';
import { EVENT_CODES } from '../../events/codes.js';
import { makeTaskKey } from '../../shared/ids.js';
import { fetchIssueBlockingNumbers, fetchIssueState } from './adapter.js';
import type { TaskRelationsRefresher } from './task-relations-refresher.js';

export interface IssuesWebhookDeps {
  githubToken: string;
  githubRepoProjectRepo: GithubRepoProjectRepository;
  refresher: TaskRelationsRefresher;
  // Terminal-ack completion (optional so relation-only callers keep working):
  // `issues.closed` is the chain consumer's acknowledgment — under the
  // two-ledger rule it completes the closed task's open WAKE only; the cue
  // turn's lease completes at its own turn end
  // (spec_wakery-conduction-chaining.md; spec_wakery-queue-and-leases.md).
  wakeRepo?: WakeRepository;
  eventWriter?: EventWriter;
}

interface HandlerResult {
  status: 'handled' | 'ignored';
  message: string;
}

/**
 * Handle the `issues` webhook for actions `closed` / `reopened`. The closed
 * or reopened issue itself doesn't need a task_relations refresh, but two
 * sets of related Tasks do:
 *   1. its Parent (if any) — `children.completed` just changed
 *   2. every Task this issue is Blocking (if any) — `blocked_by.completed`
 *      just changed for each of them
 */
export async function handleIssuesEvent(
  payload: any,
  action: string,
  deps: IssuesWebhookDeps
): Promise<HandlerResult> {
  if (action !== 'closed' && action !== 'reopened') {
    return { status: 'ignored', message: `issues.${action} not relevant for task_relations` };
  }

  const repoNodeId: string = payload.repository?.node_id ?? '';
  const issueNumber = payload.issue?.number;
  if (!repoNodeId || !issueNumber) {
    return { status: 'ignored', message: 'missing repository.node_id or issue.number' };
  }

  const repoProject = await deps.githubRepoProjectRepo.findByRepoId(repoNodeId);
  if (!repoProject) return { status: 'ignored', message: `repo ${repoNodeId} not tracked` };

  // Terminal-ack completion — runs before the state fetch so a failed GitHub
  // read cannot skip it. Under the ack protocol the issue close is the chain
  // consumer's final act, performed after the chained work is done, so the
  // close completes the task's open WAKE. Leases are never touched here
  // (two-ledger rule): the cue turn's lease completes at its own turn end via
  // the dispatch worker's watcher/reconcile. Two cases complete here:
  //   - a DISPATCHED terminal wake — the chain cue the closer just consumed
  //   - any NON-terminal open wake — a straggler whose terminal transition
  //     comment was lost or never posted
  // A terminal wake still pre-dispatch survives: its cue must reach the
  // consumer first; if this close event is lost, the dispatch worker's
  // terminal verifier completes it later against the already-closed issue.
  let acked: string | null = null;
  if (action === 'closed' && deps.wakeRepo) {
    const tk = makeTaskKey(repoProject.project_id, String(issueNumber));
    const openWake = await deps.wakeRepo.findCurrentByTaskKey(tk);
    if (openWake) {
      const isTerminal = openWake.task_status === 'Completed' || openWake.task_status === 'Cancelled';
      const completable = isTerminal ? openWake.status === 'dispatched' : true;
      if (completable) {
        await deps.wakeRepo.completeOpenByTaskKey(tk);
        deps.eventWriter?.emit(EVENT_CODES.WAKE_TERMINAL_CLEANUP_ON_CLOSE, {
          wake_id: openWake.id,
          task_key: tk,
          task_status: openWake.task_status,
          wake_status: openWake.status,
          kind: isTerminal ? 'chain_ack' : 'straggler',
          issue_number: Number(issueNumber)
        });
        acked = `${isTerminal ? 'chain-ack' : 'straggler'} wake ${openWake.id} completed`;
      }
    }
  }

  const state = await fetchIssueState(
    deps.githubToken,
    repoProject.github_repo_id,
    Number(issueNumber),
    repoProject.github_project_id
  );
  if (!state) return { status: 'ignored', message: 'failed to fetch issue state' };

  const triggerEvent = action === 'closed' ? 'issues.closed' : 'issues.reopened';
  let refreshedCount = 0;
  const messages: string[] = [];
  if (acked) messages.push(acked);

  // (1) Parent path: refresh the closed/reopened issue's parent if any
  if (state.parentNumber !== null) {
    await deps.refresher.refreshTask(
      repoProject.project_id,
      String(state.parentNumber),
      triggerEvent,
      String(issueNumber)
    );
    refreshedCount++;
    messages.push(`parent #${state.parentNumber}`);
  }

  // (2) Blockee path: refresh every Task this issue blocks. Only worth
  //     querying when the issue actually blocks something (cheap check via
  //     the summary we already have).
  if (state.blockingTotal > 0) {
    const blockees = await fetchIssueBlockingNumbers(
      deps.githubToken,
      repoProject.github_repo_id,
      Number(issueNumber)
    );
    for (const blockee of blockees) {
      await deps.refresher.refreshTask(
        repoProject.project_id,
        String(blockee),
        triggerEvent,
        String(issueNumber)
      );
      refreshedCount++;
    }
    if (blockees.length > 0) {
      messages.push(`${blockees.length} blockee(s): ${blockees.join(', ')}`);
    }
  }

  if (refreshedCount === 0 && messages.length === 0) {
    return { status: 'ignored', message: `issue #${issueNumber} has no parent and blocks nothing; no refresh needed` };
  }
  return {
    status: 'handled',
    message: `refreshed on issues.${action} of #${issueNumber}: ${messages.join('; ')}`
  };
}

/**
 * Handle the `sub_issues` webhook for actions `sub_issue_added`,
 * `sub_issue_removed`, `parent_issue_added`, `parent_issue_removed`.
 * Each of these affects both sides of the relation — the affected parent's
 * children summary and the affected child's parent reference — so we refresh
 * both wakes.
 */
export async function handleSubIssuesEvent(
  payload: any,
  action: string,
  deps: IssuesWebhookDeps
): Promise<HandlerResult> {
  const allowed = new Set(['sub_issue_added', 'sub_issue_removed', 'parent_issue_added', 'parent_issue_removed']);
  if (!allowed.has(action)) {
    return { status: 'ignored', message: `sub_issues.${action} not handled` };
  }

  const repoNodeId: string = payload.repository?.node_id ?? '';
  if (!repoNodeId) return { status: 'ignored', message: 'missing repository.node_id' };

  // The sub_issues webhook payload carries both halves of the relation. The
  // exact key naming differs slightly per action; accept either casing.
  const parentNumber = payload.parent_issue?.number ?? payload.parentIssue?.number ?? null;
  const childNumber = payload.sub_issue?.number ?? payload.subIssue?.number ?? null;

  if (parentNumber === null && childNumber === null) {
    return { status: 'ignored', message: 'no parent_issue or sub_issue in payload' };
  }

  const repoProject = await deps.githubRepoProjectRepo.findByRepoId(repoNodeId);
  if (!repoProject) return { status: 'ignored', message: `repo ${repoNodeId} not tracked` };

  const triggerEvent =
    action === 'sub_issue_added' ? 'sub_issues.sub_issue_added'
    : action === 'sub_issue_removed' ? 'sub_issues.sub_issue_removed'
    : action === 'parent_issue_added' ? 'sub_issues.parent_issue_added'
    : 'sub_issues.parent_issue_removed';

  // Refresh both sides where present; pass the opposite side as triggerTaskId
  // so operators can see the cause of each refresh in the event log.
  if (parentNumber !== null) {
    await deps.refresher.refreshTask(
      repoProject.project_id,
      String(parentNumber),
      triggerEvent,
      childNumber !== null ? String(childNumber) : null
    );
  }
  if (childNumber !== null) {
    await deps.refresher.refreshTask(
      repoProject.project_id,
      String(childNumber),
      triggerEvent,
      parentNumber !== null ? String(parentNumber) : null
    );
  }

  return {
    status: 'handled',
    message: `refreshed task_relations on sub_issues.${action} (parent=${parentNumber ?? 'none'}, child=${childNumber ?? 'none'})`
  };
}

/**
 * Handle the `issue_dependencies` webhook for actions `blocked_by_added`,
 * `blocked_by_removed`, `blocking_added`, `blocking_removed`. Each action
 * affects both sides of the relation — the dependent's `blocked_by` summary
 * and the blocker's `blocking` summary — so we refresh both Tasks.
 */
export async function handleIssueDependenciesEvent(
  payload: any,
  action: string,
  deps: IssuesWebhookDeps
): Promise<HandlerResult> {
  const allowed = new Set(['blocked_by_added', 'blocked_by_removed', 'blocking_added', 'blocking_removed']);
  if (!allowed.has(action)) {
    return { status: 'ignored', message: `issue_dependencies.${action} not handled` };
  }

  const repoNodeId: string = payload.repository?.node_id ?? '';
  if (!repoNodeId) return { status: 'ignored', message: 'missing repository.node_id' };

  // The payload carries both halves of the relation. GitHub's documented
  // shape uses `dependent_issue` (the Blocked side) and `blocker_issue` (the
  // Blocking side); accept several casings defensively.
  const dependentNumber =
    payload.dependent_issue?.number ?? payload.dependentIssue?.number ??
    payload.blocked_by_issue?.number ?? null;
  const blockerNumber =
    payload.blocker_issue?.number ?? payload.blockerIssue?.number ??
    payload.blocking_issue?.number ?? null;

  if (dependentNumber === null && blockerNumber === null) {
    return { status: 'ignored', message: 'no dependent_issue or blocker_issue in payload' };
  }

  const repoProject = await deps.githubRepoProjectRepo.findByRepoId(repoNodeId);
  if (!repoProject) return { status: 'ignored', message: `repo ${repoNodeId} not tracked` };

  const triggerEvent =
    action === 'blocked_by_added' ? 'issue_dependencies.blocked_by_added'
    : action === 'blocked_by_removed' ? 'issue_dependencies.blocked_by_removed'
    : action === 'blocking_added' ? 'issue_dependencies.blocking_added'
    : 'issue_dependencies.blocking_removed';

  if (dependentNumber !== null) {
    await deps.refresher.refreshTask(
      repoProject.project_id,
      String(dependentNumber),
      triggerEvent,
      blockerNumber !== null ? String(blockerNumber) : null
    );
  }
  if (blockerNumber !== null) {
    await deps.refresher.refreshTask(
      repoProject.project_id,
      String(blockerNumber),
      triggerEvent,
      dependentNumber !== null ? String(dependentNumber) : null
    );
  }

  return {
    status: 'handled',
    message: `refreshed task_relations on issue_dependencies.${action} (dependent=${dependentNumber ?? 'none'}, blocker=${blockerNumber ?? 'none'})`
  };
}
