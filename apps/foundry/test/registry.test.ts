import { describe, expect, it } from 'vitest';
import { runMigrations } from '@psyphix/data';
import { createTestPool } from '@psyphix/data/testing';
import { registerProject } from '../src/registry.js';

// Foundry's own DB layer: the register stage writes one `project` row against
// the real schema (pg-mem migrated by @psyphix/data).

async function migrated() {
  const db = await createTestPool();
  await runMigrations(db);
  return db;
}

describe('registerProject', () => {
  it('writes the project row — its existence is the creation', async () => {
    const db = await migrated();
    const outcome = await registerProject(db, { projectKey: 'tutor', projectName: 'Tutor Project' });
    expect(outcome.project).toBe('created');
    const project = await db.query(`SELECT * FROM project WHERE project = 'tutor'`);
    expect(project.rows[0]).toMatchObject({ name: 'Tutor Project', status: 'active' });
    expect(project.rows[0].id).toBe(outcome.project_id);
  });

  it('is idempotent — a re-run reports existing, the row count staying one', async () => {
    const db = await migrated();
    const first = await registerProject(db, { projectKey: 'tutor', projectName: 'Tutor Project' });
    const second = await registerProject(db, { projectKey: 'tutor', projectName: 'Tutor Project' });
    expect(second.project).toBe('existing');
    expect(second.project_id).toBe(first.project_id);
    const projects = await db.query(`SELECT count(*)::int AS n FROM project`);
    expect(Number(projects.rows[0].n)).toBe(1);
  });

  it('registers further projects side by side', async () => {
    const db = await migrated();
    await registerProject(db, { projectKey: 'tutor', projectName: 'Tutor Project' });
    const other = await registerProject(db, { projectKey: 'otherproj', projectName: 'Other' });
    expect(other.project).toBe('created');
    const projects = await db.query(`SELECT count(*)::int AS n FROM project`);
    expect(Number(projects.rows[0].n)).toBe(2);
  });
});
