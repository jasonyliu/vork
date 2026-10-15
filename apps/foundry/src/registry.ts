import { readFileSync } from 'node:fs';
import pg from 'pg';
import { mintId, type Queryable } from '@psyphix/data';
import { expandHome } from './config.js';
import { localError } from './errors.js';
import type { DatabaseConfig } from './types.js';

// Foundry's own DB layer — the register stage's runtime DML. A `project` row
// IS the project's creation (specs/data/spec_database.md §11): one row,
// idempotent, written as the `psyphix_app` seeding act. The project row
// completes the stage.

export interface RegistryInput {
  projectKey: string;
  projectName: string;
}

export interface RegistryOutcome {
  project_id: string;
  project: 'created' | 'existing';
}

export function openRegistryPool(config: DatabaseConfig): pg.Pool {
  const password = readFileSync(expandHome(config.password_path), 'utf8').trim();
  if (password === '') throw localError(`registry password file empty: ${config.password_path}`);
  return new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.name,
    user: config.user,
    password
  });
}

export async function pingRegistry(db: Queryable): Promise<void> {
  await db.query('SELECT 1 FROM project LIMIT 1');
}

export async function registerProject(db: Queryable, input: RegistryInput): Promise<RegistryOutcome> {
  const now = Date.now();
  const existing = await db.query(`SELECT id FROM project WHERE project = $1 LIMIT 1`, [input.projectKey]);
  if (existing.rows.length > 0) {
    return { project_id: existing.rows[0].id as string, project: 'existing' };
  }
  const projectId = mintId('prj');
  await db.query(
    `INSERT INTO project (id, project, name, status, create_time, update_time)
     VALUES ($1,$2,$3,'active',$4,$4)`,
    [projectId, input.projectKey, input.projectName, now]
  );
  return { project_id: projectId, project: 'created' };
}
