import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from './helpers.js';
import { runMigrations } from '@vork/data';
import { TASK_TYPE_LABEL_SEED, seedTaskTypeLabels } from '@vork/data';
import { addTaskType, retireTaskType, parseArgs } from '../src/scripts/add-task-type.js';

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

// The 17 canonical task types (9 Stage + 8 Execution). Stated independently here
// so a drift in seed.ts's TASK_TYPE_LABEL_SEED is caught. Kept in sync 3 ways:
// this seed ↔ prod DB ↔ GitHub `type:*` labels.
const EXPECTED_SET = new Set<string>([
  'project_inception', 'project_draft', 'project_decomposition', 'project_integration',
  'project_review', 'project_release', 'project_deployment', 'project_operation', 'project_hotfix',
  'spec', 'research', 'coding', 'bug', 'enhancement', 'deliberation', 'dbops', 'defect'
]);

async function typeRows(p: Pool) {
  const r = await p.query(`SELECT type_value, label, purpose, active FROM task_type_label ORDER BY type_value`);
  return r.rows as Array<{ type_value: string; label: string; purpose: string | null; active: boolean }>;
}

describe('seed: task_type_label', () => {
  test('migrate creates the table empty (structure only); seed populates the canonical 17, all active', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    // migrate.ts builds structure only — table exists but carries no data.
    expect(await typeRows(pool)).toHaveLength(0);

    await seedTaskTypeLabels(pool);
    const rows = await typeRows(pool);
    expect(new Set(rows.map((r) => r.type_value))).toEqual(EXPECTED_SET);
    expect(rows).toHaveLength(EXPECTED_SET.size);
    expect(rows.every((r) => r.active === true)).toBe(true);
    expect(rows.every((r) => typeof r.label === 'string' && r.label.length > 0)).toBe(true);
  });

  test('seed includes project_integration, deliberation, dbops, and defect', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);
    const values = new Set((await typeRows(pool)).map((r) => r.type_value));
    expect(values.has('project_integration')).toBe(true);
    expect(values.has('deliberation')).toBe(true); // the 2026-06-04 incident type
    expect(values.has('dbops')).toBe(true);
    expect(values.has('defect')).toBe(true);
  });

  test('seed const matches the expected set with no duplicates', () => {
    const fromConst = new Set(TASK_TYPE_LABEL_SEED.map((r) => r.type_value));
    expect(fromConst).toEqual(EXPECTED_SET);
    expect(TASK_TYPE_LABEL_SEED).toHaveLength(fromConst.size);
  });

  test('idempotent: a second seed run inserts nothing and the row count is unchanged', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    const first = await seedTaskTypeLabels(pool);
    expect(first.inserted).toBe(EXPECTED_SET.size);

    const second = await seedTaskTypeLabels(pool);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(EXPECTED_SET.size);
    expect(await typeRows(pool)).toHaveLength(EXPECTED_SET.size);
  });

  test('idempotent seed does not revive an operator-retired row', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);
    await retireTaskType({ pool }, 'bug');

    await seedTaskTypeLabels(pool); // re-run must not reactivate a retired type

    const bug = (await typeRows(pool)).find((r) => r.type_value === 'bug');
    expect(bug?.active).toBe(false);
  });
});

describe('add-task-type script', () => {
  test('addTaskType inserts a new (non-canonical) row the table reflects', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);

    const result = await addTaskType({ pool }, { typeValue: 'experimental', label: 'Experimental', purpose: 'Trial type' });
    expect(result).toEqual({ type_value: 'experimental', action: 'inserted' });

    const rows = await typeRows(pool);
    const added = rows.find((r) => r.type_value === 'experimental');
    expect(added).toBeDefined();
    expect(added?.active).toBe(true);
    expect(added?.label).toBe('Experimental');
    expect(rows).toHaveLength(EXPECTED_SET.size + 1);
  });

  test('addTaskType on an existing type reactivates it and updates label/purpose', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);
    await retireTaskType({ pool }, 'enhancement');

    const result = await addTaskType({ pool }, { typeValue: 'enhancement', label: 'Enhancement', purpose: 'Updated' });
    expect(result).toEqual({ type_value: 'enhancement', action: 'reactivated' });

    const row = (await typeRows(pool)).find((r) => r.type_value === 'enhancement');
    expect(row?.active).toBe(true);
    expect(row?.purpose).toBe('Updated');
  });

  test('retireTaskType sets active=false; unknown type reports not_found', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);

    const retired = await retireTaskType({ pool }, 'coding');
    expect(retired).toEqual({ type_value: 'coding', action: 'retired' });
    const row = (await typeRows(pool)).find((r) => r.type_value === 'coding');
    expect(row?.active).toBe(false);

    const missing = await retireTaskType({ pool }, 'no_such_type');
    expect(missing.action).toBe('not_found');
  });

  test('parseArgs handles add and retire forms', () => {
    expect(parseArgs(['defect', '--label', 'Defect', '--purpose', 'A defect'])).toEqual({
      mode: 'add',
      typeValue: 'defect',
      label: 'Defect',
      purpose: 'A defect'
    });
    expect(parseArgs(['--retire', 'coding'])).toMatchObject({ mode: 'retire', typeValue: 'coding' });
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['defect'])).toThrow(); // add requires --label
  });
});
