import type { Pool } from 'pg';
import type { GithubAgent } from '../shared/types.js';

function mapRow(row: any): GithubAgent {
  return { ...row, create_time: Number(row.create_time), update_time: Number(row.update_time) };
}

export class GithubAgentRepository {
  constructor(private readonly pool: Pool) {}

  async create(entry: GithubAgent) {
    await this.pool.query(
      `INSERT INTO github_agent (id, github_login, github_node_id, agent_id, agent_name, role, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [entry.id, entry.github_login, entry.github_node_id, entry.agent_id, entry.agent_name, entry.role, entry.status, entry.create_time, entry.update_time]
    );
    return entry;
  }

  async resolveByGitHub(githubLogin: string, githubNodeId: string): Promise<GithubAgent | null> {
    const result = await this.pool.query(
      `SELECT * FROM github_agent WHERE github_login=$1 AND github_node_id=$2 AND status='active' LIMIT 1`,
      [githubLogin, githubNodeId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByGitHubLogin(githubLogin: string): Promise<GithubAgent | null> {
    const result = await this.pool.query(
      `SELECT * FROM github_agent WHERE github_login=$1 AND status='active' LIMIT 1`,
      [githubLogin]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByAgentId(agentId: string): Promise<GithubAgent | null> {
    const result = await this.pool.query(
      `SELECT * FROM github_agent WHERE agent_id=$1 AND status='active' LIMIT 1`,
      [agentId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listAll(): Promise<GithubAgent[]> {
    const result = await this.pool.query('SELECT * FROM github_agent ORDER BY create_time ASC');
    return result.rows.map(mapRow);
  }
}
