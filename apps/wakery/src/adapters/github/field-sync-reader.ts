import type { Wake } from '../../shared/types.js';
import type { FieldSyncReader, FieldSyncSnapshot } from '../../worker/dispatch-worker.js';
import type { GithubRepoProjectRepository } from '../../db/github-repo-project-repository.js';
import { fetchIssueState } from './adapter.js';

export class GitHubFieldSyncReader implements FieldSyncReader {
  constructor(
    private readonly githubToken: string,
    private readonly githubRepoProjectRepo: GithubRepoProjectRepository
  ) {}

  async readCurrentFields(wake: Wake): Promise<FieldSyncSnapshot | null> {
    // wake.project_id is the platform key; the mapping row supplies the GitHub
    // addresses (node-id repo, ProjectV2 id)
    const repoProject = await this.githubRepoProjectRepo.findByProjectId(wake.project_id);
    if (!repoProject) return null;

    const issueNumber = Number(wake.task_id);
    if (!Number.isFinite(issueNumber)) return null;

    const issueState = await fetchIssueState(
      this.githubToken,
      repoProject.github_repo_id,
      issueNumber,
      repoProject.github_project_id
    );
    if (!issueState || !issueState.taskStatus || !issueState.taskAudit) return null;

    return { task_status: issueState.taskStatus, task_audit: issueState.taskAudit };
  }
}
