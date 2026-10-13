import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from './helpers.js';
import { runMigrations } from '@vork/data';
import { TaskTypeLabelRepository } from '../src/db/task-type-label-repository.js';
import { validateTaskTypeLabel } from '../src/adapters/github/adapter.js';
import { addTaskType, retireTaskType } from '../src/scripts/add-task-type.js';
import { seedTaskTypeLabels } from '@vork/data';

// E2 (#54, spec_wakery-task-type-registry §R2): Stage-6 validation sources its
// valid set from `task_type_label` (loaded per evaluation), so add/retire takes
// effect without a wakery redeploy. These tests exercise the full path:
// add-task-type → TaskTypeLabelRepository.activeTypeValues() → validateTaskTypeLabel.

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

describe('Stage 6 reads the task_type_label registry', () => {
  test('deliberation and dbops validate (the seeded set), unknown drops, multi is ambiguous', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);
    const repo = new TaskTypeLabelRepository(pool);
    const valid = await repo.activeTypeValues();

    expect(validateTaskTypeLabel(['type:deliberation'], valid)).toEqual({ outcome: 'ok', taskType: 'deliberation' });
    expect(validateTaskTypeLabel(['type:dbops'], valid)).toEqual({ outcome: 'ok', taskType: 'dbops' });
    expect(validateTaskTypeLabel(['type:coding'], valid)).toEqual({ outcome: 'ok', taskType: 'coding' });

    expect(validateTaskTypeLabel(['type:weird-not-in-registry'], valid).outcome).toBe('unknown_task_type');
    expect(validateTaskTypeLabel(['type:coding', 'type:spec'], valid).outcome).toBe('ambiguous_task_type');
    expect(validateTaskTypeLabel(['task:parent'], valid).outcome).toBe('not_a_task_issue');
  });

  test('a type added via the script validates on the next load — no redeploy', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);
    const repo = new TaskTypeLabelRepository(pool);

    // Before: `experimental` is unknown (not in the canonical 15) → would drop 1011.
    const before = await repo.activeTypeValues();
    expect(validateTaskTypeLabel(['type:experimental'], before).outcome).toBe('unknown_task_type');

    // Operator adds it via the add-task-type script (a row insert, no process restart).
    await addTaskType({ pool }, { typeValue: 'experimental', label: 'Experimental', purpose: 'Trial type' });

    // The next per-evaluation load reflects it → validates.
    const after = await repo.activeTypeValues();
    expect(validateTaskTypeLabel(['type:experimental'], after)).toEqual({ outcome: 'ok', taskType: 'experimental' });
  });

  test('a retired type stops validating on the next load (drops 1011)', async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedTaskTypeLabels(pool);
    const repo = new TaskTypeLabelRepository(pool);

    expect(validateTaskTypeLabel(['type:enhancement'], await repo.activeTypeValues())).toEqual({
      outcome: 'ok',
      taskType: 'enhancement'
    });

    await retireTaskType({ pool }, 'enhancement');

    expect(validateTaskTypeLabel(['type:enhancement'], await repo.activeTypeValues()).outcome).toBe('unknown_task_type');
  });
});
