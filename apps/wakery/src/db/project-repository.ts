import type { Pool } from 'pg';
import type { Project } from '../shared/types.js';

function mapRow(row: any): Project {
  return { ...row, create_time: Number(row.create_time), update_time: Number(row.update_time) };
}

// The project registry (specs/data/spec_database.md §11) — the platform key of
// the runtime. Rows land by deploy-time data acts (existing projects) or the
// manifest-derived seeding act after `foundry bootstrap` (new projects).
export class ProjectRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Project | null> {
    const result = await this.pool.query(`SELECT * FROM project WHERE id=$1 LIMIT 1`, [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Project | null> {
    const result = await this.pool.query(`SELECT * FROM project WHERE project=$1 LIMIT 1`, [slug]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }
}
