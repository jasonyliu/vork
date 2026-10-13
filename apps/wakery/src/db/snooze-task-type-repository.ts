import type { Pool } from 'pg';

// Reader for the snooze_task_type lookup table (spec_wakery-contracts.md §10):
// which task types each snooze type may hold. Data, not code — the mapping
// evolves by row changes with no deploy. Read per correlation evaluation, the
// same no-redeploy authority pattern as task_type_label.
export class SnoozeTaskTypeRepository {
  constructor(private readonly pool: Pool) {}

  async allowedTaskTypes(snoozeType: number): Promise<Set<string>> {
    const result = await this.pool.query(
      `SELECT task_type FROM snooze_task_type WHERE snooze_type=$1 AND active=TRUE`,
      [snoozeType]
    );
    return new Set(result.rows.map((r: any) => String(r.task_type)));
  }
}
