import type { Pool } from 'pg';
import type { GithubRepoProject } from '../shared/types.js';

function mapRow(row: any): GithubRepoProject {
  return { ...row, create_time: Number(row.create_time), update_time: Number(row.update_time) };
}

export class GithubRepoProjectRepository {
  constructor(private readonly pool: Pool) {}

  async create(entry: GithubRepoProject) {
    await this.pool.query(
      `INSERT INTO github_repo_project (id, project_id, github_repo_id, github_owner_id, github_owner_name, github_repo, github_project_id, github_project_number, github_project_title, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.id,
        entry.project_id,
        entry.github_repo_id,
        entry.github_owner_id,
        entry.github_owner_name,
        entry.github_repo,
        entry.github_project_id,
        entry.github_project_number,
        entry.github_project_title,
        entry.status,
        entry.create_time,
        entry.update_time
      ]
    );
    return entry;
  }

  // Webhook-delivery lookup: github_repo_id is the repository global node ID
  // from the payload — the rename-proof key.
  async findByRepoId(githubRepoId: string): Promise<GithubRepoProject | null> {
    const result = await this.pool.query(
      `SELECT * FROM github_repo_project WHERE github_repo_id=$1 AND status='active' LIMIT 1`,
      [githubRepoId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  // Reverse lookup by the platform project key carried on flow rows
  // (wake.project_id = project.id); one repo per project makes it unique.
  async findByProjectId(projectId: string): Promise<GithubRepoProject | null> {
    const result = await this.pool.query(
      `SELECT * FROM github_repo_project WHERE project_id=$1 AND status='active' LIMIT 1`,
      [projectId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listAll(): Promise<GithubRepoProject[]> {
    const result = await this.pool.query('SELECT * FROM github_repo_project ORDER BY create_time ASC');
    return result.rows.map(mapRow);
  }
}
