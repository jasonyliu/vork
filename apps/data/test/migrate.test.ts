import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, seedProject } from '../src/testing.js';
import { addGithubRepoProjectProjectNumber, migrateLeaseTurnSignal, runMigrations } from '../src/migrate.js';

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

describe('migrate: github_repo_project.project_number', () => {
  test('fresh DB: runMigrations creates github_repo_project with github_project_number INTEGER, nullable, between github_project_id and github_project_title', async () => {
    pool = await createTestPool();
    await runMigrations(pool);

    const columns = await pool.query(
      `SELECT column_name, data_type, ordinal_position
       FROM information_schema.columns
       WHERE table_name = 'github_repo_project'
       ORDER BY ordinal_position`
    );
    const byName = new Map<string, any>(columns.rows.map((r: any) => [r.column_name, r]));

    expect(byName.has('github_project_number')).toBe(true);
    expect(byName.get('github_project_number').data_type).toBe('integer');

    // Column order: github_project_number sits between github_project_id and github_project_title.
    const pid = byName.get('github_project_id').ordinal_position;
    const pnum = byName.get('github_project_number').ordinal_position;
    const ptitle = byName.get('github_project_title').ordinal_position;
    expect(pnum).toBeGreaterThan(pid);
    expect(pnum).toBeLessThan(ptitle);

    // Behavioral nullability check — an INSERT omitting github_project_number
    // must succeed and read back NULL (project row seeded first — FK).
    await seedProject(pool, 'prj_vork', 'vork');
    await pool.query(
      `INSERT INTO github_repo_project (id, project_id, github_repo_id, github_owner_id, github_owner_name, github_repo, github_project_id, github_project_title, status, create_time, update_time)
       VALUES ('rp-fresh', 'prj_vork', 'R_1', 'O_1', 'owner-login', 'vork', 'PVT_1', 'Vork', 'active', 1700000000000, 1700000000000)`
    );
    const fetched = await pool.query(`SELECT github_project_number FROM github_repo_project WHERE id = 'rp-fresh'`);
    expect(fetched.rows[0].github_project_number).toBeNull();
  });

  test('smoke copy of production: an existing github_repo_project without project_number gets the column added (existing rows preserved with NULL)', async () => {
    // Simulate the pre-migration production schema with a minimal table holding
    // only the columns the addGithubRepoProjectProjectNumber probe touches, so
    // we don't trip pg-mem's CREATE TABLE constraint-AST coverage on the full
    // canonical schema.
    pool = await createTestPool();
    await pool.query(`CREATE TABLE github_repo_project (id TEXT, project_id TEXT, project_title TEXT)`);
    await pool.query(
      `INSERT INTO github_repo_project (id, project_id, project_title) VALUES ('rp-existing', 'PVT_1', 'Vork')`
    );

    await addGithubRepoProjectProjectNumber(pool);

    const columns = await pool.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = 'github_repo_project' AND column_name = 'project_number'`
    );
    expect(columns.rows).toHaveLength(1);
    expect(columns.rows[0].data_type).toBe('integer');

    const existing = await pool.query(`SELECT project_number FROM github_repo_project WHERE id = 'rp-existing'`);
    expect(existing.rows).toHaveLength(1);
    expect(existing.rows[0].project_number).toBeNull();
  });

  test('migration is idempotent: re-running addGithubRepoProjectProjectNumber post-F9 is a no-op — no stray project_number column appears', async () => {
    pool = await createTestPool();
    await runMigrations(pool);

    // Second run — the probe sees github_project_number and short-circuits.
    await expect(addGithubRepoProjectProjectNumber(pool)).resolves.not.toThrow();

    const stray = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'github_repo_project' AND column_name = 'project_number'`
    );
    expect(stray.rows).toHaveLength(0);
    const canonical = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'github_repo_project' AND column_name = 'github_project_number'`
    );
    expect(canonical.rows).toHaveLength(1);
  });
});

describe('migrate: turn-signal lease surfaces (milestone_wakery-turn-signal_v2026.07.29)', () => {
  test('fresh DB: wake gains wake_attempts (default 0); lease has activity_time and no retired columns in the fresh DDL', async () => {
    pool = await createTestPool();
    await runMigrations(pool);

    await pool.query(
      `INSERT INTO wake (id, task_key, state_key, project_id, task_id, task_type, task_status, task_audit, status, create_time, update_time)
       VALUES ('w-1','tk','sk','p','t','coding','Todo','Approved','queued',1,1)`
    );
    const wakeRow = await pool.query(`SELECT wake_attempts FROM wake WHERE id='w-1'`);
    expect(Number(wakeRow.rows[0].wake_attempts)).toBe(0);

    const leaseCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'wake_route_lease'`
    );
    const names = leaseCols.rows.map((r: any) => r.column_name);
    expect(names).toContain('activity_time');
    expect(names).not.toContain('dispatch_time');
    expect(names).not.toContain('probe_attempts');
  });

  test('fresh DB: wake_id carries NO uniqueness — a wake accumulates one lease per turn', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedProject(pool, 'p');
    await pool.query(
      `INSERT INTO route (id, project_id, actor, agent_id, delivery, status, create_time, update_time)
       VALUES ('r-1','p','assignee','a','run','active',1,1)`
    );
    const insertLease = (id: string) => pool.query(
      `INSERT INTO wake_route_lease (id, route_id, wake_id, wake_task_status, task_key, activity_time, status, create_time, update_time)
       VALUES ('${id}','r-1','w-1','Todo','tk',1,'completed',1,1)`
    );
    await insertLease('lease-turn-1');
    await expect(insertLease('lease-turn-2')).resolves.toBeTruthy();
  });

  test('existing DB: migrateLeaseTurnSignal adds activity_time and backfills it from update_time; retired columns are left in place', async () => {
    pool = await createTestPool();
    // Pre-migration shape: retired columns present, no activity_time.
    await pool.query(`
      CREATE TABLE wake_route_lease (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        wake_id TEXT NOT NULL,
        wake_task_status TEXT NOT NULL,
        task_key TEXT,
        dispatch_time BIGINT,
        probe_attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        create_time BIGINT NOT NULL,
        update_time BIGINT NOT NULL
      )
    `);
    await pool.query(
      `INSERT INTO wake_route_lease (id, route_id, wake_id, wake_task_status, status, create_time, update_time)
       VALUES ('lease-old','r-1','w-1','Todo','active',1000,4321)`
    );

    await migrateLeaseTurnSignal(pool);

    const row = await pool.query(`SELECT activity_time, dispatch_time, probe_attempts FROM wake_route_lease WHERE id='lease-old'`);
    expect(Number(row.rows[0].activity_time)).toBe(4321);
    // The physical retired columns survive for the deploy-time data migration.
    expect(row.rows[0]).toHaveProperty('dispatch_time');
    expect(row.rows[0]).toHaveProperty('probe_attempts');

    // Idempotent: a second run is a no-op.
    await expect(migrateLeaseTurnSignal(pool)).resolves.not.toThrow();
  });
});
