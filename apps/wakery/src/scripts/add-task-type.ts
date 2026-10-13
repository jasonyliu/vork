/**
 * Management surface for the `task_type_label` registry (E1 / #54,
 * spec_wakery-task-type-registry.md §R3). v1 is a script — no UI.
 *
 * Adding or retiring a task type is an operator action against the table that
 * Stage 6 reads (after E2), so a type change takes effect without a wakery
 * redeploy.
 *
 *   add    — insert a new active type, or reactivate + update an existing one.
 *   retire — set `active = FALSE` (the row is kept for audit, not deleted).
 *
 * CLI:
 *   tsx src/scripts/add-task-type.ts <type_value> --label "Label" --purpose "Purpose"
 *   tsx src/scripts/add-task-type.ts --retire <type_value>
 *
 * Tests import the exported functions directly without triggering the CLI path.
 */
import type { Pool } from 'pg';
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

export interface AddTaskTypeInput {
  typeValue: string;
  label: string;
  purpose?: string | null;
}

export type AddTaskTypeAction = 'inserted' | 'reactivated';

export interface AddTaskTypeResult {
  type_value: string;
  action: AddTaskTypeAction;
}

export interface RetireTaskTypeResult {
  type_value: string;
  action: 'retired' | 'not_found';
}

export interface TaskTypeDeps {
  pool: Pool;
  // Injectable clock for deterministic tests. Production uses Date.now.
  now?: () => number;
}

/**
 * Insert a new active task type, or reactivate an existing one (updating its
 * label/purpose). Idempotent in effect: re-adding an already-active type just
 * refreshes its label/purpose and leaves it active.
 */
export async function addTaskType(deps: TaskTypeDeps, input: AddTaskTypeInput): Promise<AddTaskTypeResult> {
  const now = deps.now ?? Date.now;
  const ts = now();
  const existing = await deps.pool.query(
    `SELECT 1 FROM task_type_label WHERE type_value = $1 LIMIT 1`,
    [input.typeValue]
  );
  if (existing.rows.length > 0) {
    await deps.pool.query(
      `UPDATE task_type_label
         SET label = $2, purpose = $3, active = TRUE, update_time = $4
       WHERE type_value = $1`,
      [input.typeValue, input.label, input.purpose ?? null, ts]
    );
    return { type_value: input.typeValue, action: 'reactivated' };
  }
  await deps.pool.query(
    `INSERT INTO task_type_label (type_value, label, purpose, active, create_time, update_time)
     VALUES ($1, $2, $3, TRUE, $4, $4)`,
    [input.typeValue, input.label, input.purpose ?? null, ts]
  );
  return { type_value: input.typeValue, action: 'inserted' };
}

/** Retire a task type by setting `active = FALSE`. The row is preserved. */
export async function retireTaskType(deps: TaskTypeDeps, typeValue: string): Promise<RetireTaskTypeResult> {
  const now = deps.now ?? Date.now;
  const result = await deps.pool.query(
    `UPDATE task_type_label SET active = FALSE, update_time = $2 WHERE type_value = $1`,
    [typeValue, now()]
  );
  const affected = result.rowCount ?? 0;
  return { type_value: typeValue, action: affected > 0 ? 'retired' : 'not_found' };
}

interface ParsedArgs {
  mode: 'add' | 'retire';
  typeValue: string;
  label?: string;
  purpose?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let mode: 'add' | 'retire' = 'add';
  let typeValue: string | undefined;
  let label: string | undefined;
  let purpose: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--retire') {
      mode = 'retire';
      typeValue = argv[i + 1];
      i += 1;
    } else if (arg === '--label') {
      label = argv[i + 1];
      i += 1;
    } else if (arg === '--purpose') {
      purpose = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith('--') && typeValue === undefined) {
      typeValue = arg;
    }
  }

  if (!typeValue) {
    throw new Error(
      'usage: add-task-type.ts <type_value> --label "Label" [--purpose "Purpose"]  |  add-task-type.ts --retire <type_value>'
    );
  }
  if (mode === 'add' && !label) {
    throw new Error('add requires --label "Label" (a human-readable name for the type)');
  }
  return { mode, typeValue, label, purpose };
}

// CLI entry — runs when invoked as a script (tsx / node).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const parsed = parseArgs(process.argv.slice(2));
  const pool = createPool(loadConfig());
  try {
    const result =
      parsed.mode === 'retire'
        ? await retireTaskType({ pool }, parsed.typeValue)
        : await addTaskType({ pool }, { typeValue: parsed.typeValue, label: parsed.label!, purpose: parsed.purpose });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}
