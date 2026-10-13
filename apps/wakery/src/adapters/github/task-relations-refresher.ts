import type { TaskRelations } from '../../shared/types.js';
import type { GithubRepoProjectRepository } from '../../db/github-repo-project-repository.js';
import type { WakeRepository } from '../../db/wake-repository.js';
import type { EventWriter } from '../../events/writer.js';
import { EVENT_CODES } from '../../events/codes.js';
import { buildTaskRelations, fetchIssueState } from './adapter.js';

export type TaskRelationsRefreshTrigger =
  | 'issues.closed'
  | 'issues.reopened'
  | 'sub_issues.sub_issue_added'
  | 'sub_issues.sub_issue_removed'
  | 'sub_issues.parent_issue_added'
  | 'sub_issues.parent_issue_removed'
  | 'issue_dependencies.blocked_by_added'
  | 'issue_dependencies.blocked_by_removed'
  | 'issue_dependencies.blocking_added'
  | 'issue_dependencies.blocking_removed'
  | 'periodic.stale_refresh';

export interface TaskRelationsRefresher {
  refreshTask(
    projectId: string,
    taskId: string,
    trigger: TaskRelationsRefreshTrigger,
    triggerTaskId: string | null
  ): Promise<TaskRelations | null>;
}

/**
 * Refresh `wake.task_relations` for a given Task by re-querying the issue's
 * `parent` + `subIssuesSummary` from the GitHub GraphQL API and applying the
 * result to all open wake rows for that Task.
 *
 * Used by:
 *   - the GitHub webhook handlers for `issues.closed`/`reopened` and the
 *     four `sub_issues` events
 *   - the dispatch worker's periodic stale-relations sweep
 *
 * Best-effort: if the GraphQL query or repo lookup fails, returns null and
 * leaves the wake rows' task_relations unchanged.
 */
export class GitHubTaskRelationsRefresher implements TaskRelationsRefresher {
  constructor(
    private readonly githubToken: string,
    private readonly githubRepoProjectRepo: GithubRepoProjectRepository,
    private readonly wakeRepo: WakeRepository,
    private readonly eventWriter: EventWriter
  ) {}

  async refreshTask(
    projectId: string,
    taskId: string,
    trigger: TaskRelationsRefreshTrigger,
    triggerTaskId: string | null
  ): Promise<TaskRelations | null> {
    const repoProject = await this.githubRepoProjectRepo.findByProjectId(projectId);
    if (!repoProject) return null;
    const issueNumber = Number(taskId);
    if (!Number.isFinite(issueNumber)) return null;

    const state = await fetchIssueState(this.githubToken, repoProject.github_repo_id, issueNumber, repoProject.github_project_id);
    if (!state) return null;

    const newRelations = buildTaskRelations(state);
    const affected = await this.wakeRepo.updateTaskRelationsByTaskId(projectId, taskId, newRelations);
    if (affected > 0) {
      this.eventWriter.emit(EVENT_CODES.WAKE_TASK_RELATIONS_REFRESHED, {
        project_id: projectId,
        task_id: taskId,
        affected_wakes: affected,
        task_relations: newRelations,
        trigger_event: trigger,
        trigger_task_id: triggerTaskId
      });
    }
    return newRelations;
  }
}
