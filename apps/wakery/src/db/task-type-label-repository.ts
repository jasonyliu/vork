import type { Pool } from 'pg';

/**
 * Read access to `task_type_label` — the runtime authority for the valid
 * task-type set (spec_wakery-task-type-registry.md §R1/§R2). Stage 6 of the
 * GitHub adapter loads the active set from here on each evaluation, so a row
 * added/retired via `add-task-type` takes effect without a wakery redeploy.
 */
export class TaskTypeLabelRepository {
  constructor(private readonly pool: Pool) {}

  /** The set of `type_value`s currently active (retired rows excluded). */
  async activeTypeValues(): Promise<Set<string>> {
    const result = await this.pool.query(
      `SELECT type_value FROM task_type_label WHERE active = TRUE`
    );
    return new Set(result.rows.map((row) => row.type_value as string));
  }
}
