import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../src/testing.js';
import { createSnoozeTable, createSnoozeTaskTypeTable, runMigrations } from '../src/migrate.js';
import { SNOOZE_TASK_TYPE_SEED, SNOOZE_TYPE_CI, SNOOZE_TYPE_PR, seedSnoozeTaskTypes } from '../src/seed.js';

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

describe('migrate: snooze surfaces (spec_wakery-snooze.md, contracts §9/§10)', () => {
  test('fresh DB: runMigrations creates snooze and snooze_task_type; wake.task_branch exists', async () => {
    pool = await createTestPool();
    await runMigrations(pool);

    for (const table of ['snooze', 'snooze_task_type']) {
      const probe = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`, [table]
      );
      expect(probe.rowCount, `${table} exists`).toBe(1);
    }

    const wakeCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'wake'`
    );
    expect(wakeCols.rows.map((r: any) => r.column_name)).toContain('task_branch');
  });

  test('snooze_key is unique — one row per external process instance', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    const row = (id: string) =>
      `INSERT INTO snooze (id, snooze_key, type, snooze_payload, task_status, task_audit, status, create_time, update_time)
       VALUES ('${id}', 'k-dup', 1, '{"branch":"feature/x/y","ci_head_sha":"abc"}', 'Progress', 'Approved', 'active', 1, 1)`;
    await pool.query(row('sn-1'));
    await expect(pool.query(row('sn-2'))).rejects.toThrow();
  });

  test('idempotent: creators are probe-guarded and re-runnable', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await createSnoozeTable(pool);
    await createSnoozeTaskTypeTable(pool);
    const probe = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'snooze' LIMIT 1`
    );
    expect(probe.rowCount).toBe(1);
  });
});

describe('seed: snooze_task_type (repo-changing set, both types)', () => {
  test('seeds 14 task types per snooze type, excludes the laneless set, and is idempotent', async () => {
    pool = await createTestPool();
    await runMigrations(pool);

    const first = await seedSnoozeTaskTypes(pool, () => 1700000000000);
    expect(first.inserted).toBe(SNOOZE_TASK_TYPE_SEED.length);
    expect(SNOOZE_TASK_TYPE_SEED.length).toBe(28); // 14 repo-changing types × 2 snooze types

    for (const laneless of ['project_operation', 'project_deployment', 'dbops']) {
      expect(SNOOZE_TASK_TYPE_SEED.some((m) => m.task_type === laneless)).toBe(false);
    }
    for (const type of [SNOOZE_TYPE_CI, SNOOZE_TYPE_PR]) {
      const rows = await pool.query(
        `SELECT task_type FROM snooze_task_type WHERE snooze_type = $1 AND active = TRUE`, [type]
      );
      expect(rows.rowCount).toBe(14);
      expect(rows.rows.map((r: any) => r.task_type)).toContain('project_integration');
    }

    const second = await seedSnoozeTaskTypes(pool, () => 1700000000001);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(SNOOZE_TASK_TYPE_SEED.length);
  });
});
