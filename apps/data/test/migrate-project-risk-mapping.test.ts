import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, seedProject } from '../src/testing.js';
import { addProjectRiskMapping, runMigrations } from '../src/migrate.js';

// E2 (#31): the `project_risk_mapping` migration. Constraint behavior is asserted
// behaviorally (try-and-fail INSERT) rather than via information_schema, per the
// decomposition's pg-mem-divergence contingency.
let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

function insertMapping(
  p: string | null,
  action: string,
  subject: string,
  zone: string,
  riskCode: string
): Promise<unknown> {
  return pool.query(
    `INSERT INTO project_risk_mapping
       (project, action, subject, zone, risk_code, create_time, update_time)
     VALUES ($1, $2, $3, $4, $5, 1700000000000, 1700000000000)`,
    [p, action, subject, zone, riskCode]
  );
}

describe('migrate: project_risk_mapping', () => {
  test('fresh DB: runMigrations creates the table with the seven documented columns', async () => {
    pool = await createTestPool();
    await runMigrations(pool);

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'project_risk_mapping'`
    );
    const names = new Set(columns.rows.map((r: any) => r.column_name));
    for (const col of ['project', 'action', 'subject', 'zone', 'risk_code', 'create_time', 'update_time']) {
      expect(names.has(col)).toBe(true);
    }

    // Behavioral: a wildcard row (project NULL) inserts and reads back.
    await insertMapping(null, 'read', 'file', 'workspace', 'R100');
    const fetched = await pool.query(
      `SELECT risk_code FROM project_risk_mapping WHERE project IS NULL AND action = 'read'`
    );
    expect(fetched.rows[0].risk_code).toBe('R100');
  });

  test('smoke copy of production: an existing DB without the table gets it added, existing data preserved', async () => {
    // Simulate a production DB that predates this migration: a stand-in existing
    // table holding a row, and no project_risk_mapping. (Mirrors the hand-built
    // pre-existing table approach in migrate.test.ts; addProjectRiskMapping is the
    // same step runMigrations invokes on real Postgres.)
    pool = await createTestPool();
    await pool.query(`CREATE TABLE github_agent (id TEXT, github_login TEXT, status TEXT)`);
    await pool.query(`INSERT INTO github_agent (id, github_login, status) VALUES ('agent-existing', 'worker-login', 'active')`);
    // runMigrations creates the project registry before this step on any real
    // path; the FK target must exist here too
    await pool.query(`CREATE TABLE project (id TEXT PRIMARY KEY, project TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL)`);

    await addProjectRiskMapping(pool);

    // New table is present and usable...
    await insertMapping(null, 'update', 'file', 'workspace', 'R200');
    const m = await pool.query(`SELECT risk_code FROM project_risk_mapping WHERE action = 'update'`);
    expect(m.rows[0].risk_code).toBe('R200');
    // ...and the pre-existing row in the existing table is untouched.
    const a = await pool.query(`SELECT id FROM github_agent WHERE id = 'agent-existing'`);
    expect(a.rows).toHaveLength(1);
  });

  test('idempotent: re-running the migration step is a no-op and preserves seeded rows', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedProject(pool, 'prj_vork', 'vork');
    await insertMapping('vork', 'push', 'repository', 'external', 'R100');

    // The information_schema probe short-circuits, so a re-run neither errors nor
    // recreates the table (which would drop the seeded row).
    await expect(addProjectRiskMapping(pool)).resolves.not.toThrow();
    await expect(addProjectRiskMapping(pool)).resolves.not.toThrow();

    const rows = await pool.query(`SELECT project, risk_code FROM project_risk_mapping`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].risk_code).toBe('R100');
  });

  test('CHECK rejects a risk_code outside the Resolver-emit set', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await expect(insertMapping(null, 'read', 'file', 'workspace', 'R994')).rejects.toThrow();
    for (const valid of ['R100', 'R200', 'R300', 'R999']) {
      await expect(insertMapping(null, 'read', 'file', `zone_${valid}`, valid)).resolves.toBeTruthy();
    }
  });

  test('wildcard partition: single row per cell, distinct cells coexist', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await insertMapping(null, 'read', 'file', 'workspace', 'R100');
    // distinct wildcard cell is fine
    await expect(insertMapping(null, 'update', 'file', 'workspace', 'R200')).resolves.toBeTruthy();
    // duplicate wildcard cell rejected by the partial unique index
    await expect(insertMapping(null, 'read', 'file', 'workspace', 'R300')).rejects.toThrow();
  });

  test('project partition: single row per cell, and project/wildcard rows for one cell coexist', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedProject(pool, 'prj_vork', 'vork');
    await seedProject(pool, 'prj_other', 'other');
    await insertMapping(null, 'push', 'repository', 'external', 'R200'); // wildcard
    // same cell, project-specific — different partition, allowed
    await expect(insertMapping('vork', 'push', 'repository', 'external', 'R100')).resolves.toBeTruthy();
    // another project, same cell — allowed
    await expect(insertMapping('other', 'push', 'repository', 'external', 'R300')).resolves.toBeTruthy();
    // duplicate project cell — rejected
    await expect(insertMapping('vork', 'push', 'repository', 'external', 'R300')).rejects.toThrow();
  });
});
