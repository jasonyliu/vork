import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { Snooze, SnoozeStatus } from '../shared/types.js';

// Data layer of the snooze module (spec_wakery-snooze.md). Rows are pure delay
// records: one external process instance per row, no wake/lease references.
// Predicate matching against snooze_payload is done in JS over small
// status-filtered row sets rather than with jsonb operators in SQL — pg-mem
// (the test DB) has patchy jsonb-operator support, and the live active
// population is tiny by design (holds drain within the timeout).

/**
 * The one snooze_key form (contracts §snooze_snooze_key semantics):
 * md5(type + correlation value). The upsert identity — repeat start events
 * land on the same row; a new process instance is a new key. The former
 * wake-derived full form is retired with intake correlation.
 */
export function makeSnoozeKey(type: number, correlationValue: string): string {
  return crypto.createHash('md5').update(`${type}${correlationValue}`).digest('hex');
}

function mapSnooze(row: any): Snooze {
  return {
    ...row,
    snooze_payload: row.snooze_payload ?? {},
    project_id: row.project_id ?? null,
    project_name: row.project_name ?? null,
    create_time: Number(row.create_time),
    update_time: Number(row.update_time)
  };
}

export class SnoozeRepository {
  constructor(private readonly pool: Pool) {}

  async findBySnoozeKey(snoozeKey: string): Promise<Snooze | null> {
    const result = await this.pool.query('SELECT * FROM snooze WHERE snooze_key=$1 LIMIT 1', [snoozeKey]);
    return result.rows[0] ? mapSnooze(result.rows[0]) : null;
  }

  async findById(id: string): Promise<Snooze | null> {
    const result = await this.pool.query('SELECT * FROM snooze WHERE id=$1 LIMIT 1', [id]);
    return result.rows[0] ? mapSnooze(result.rows[0]) : null;
  }

  async findByStatuses(statuses: SnoozeStatus[]): Promise<Snooze[]> {
    const result = await this.pool.query(
      `SELECT * FROM snooze WHERE status = ANY($1) ORDER BY create_time ASC`,
      [statuses]
    );
    return result.rows.map(mapSnooze);
  }

  async create(snooze: Snooze): Promise<Snooze> {
    await this.pool.query(
      `INSERT INTO snooze (id, snooze_key, type, snooze_payload, project_id, project_name, task_status, task_audit, status, create_time, update_time)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
      [
        snooze.id, snooze.snooze_key, snooze.type, JSON.stringify(snooze.snooze_payload),
        snooze.project_id, snooze.project_name, snooze.task_status, snooze.task_audit,
        snooze.status, snooze.create_time, snooze.update_time
      ]
    );
    return snooze;
  }

  /** Repeat start events refresh the same row (snooze_key upsert identity). */
  async refresh(id: string) {
    await this.pool.query('UPDATE snooze SET update_time=$2 WHERE id=$1', [id, Date.now()]);
  }

  async updateStatus(id: string, status: SnoozeStatus) {
    await this.pool.query('UPDATE snooze SET status=$2, update_time=$3 WHERE id=$1', [id, status, Date.now()]);
  }

  /**
   * The timeout sweep's flip (spec_wakery-snooze.md Stage 4): expired active
   * rows → timeout. Bookkeeping only — the consult predicate excludes expired
   * rows by update_time age directly. Returns the flipped rows so the caller
   * can emit snooze.timeout once per row.
   */
  async expireActiveOlderThan(updateTimeCutoffMs: number): Promise<Snooze[]> {
    const expired = await this.pool.query(
      `SELECT * FROM snooze WHERE status='active' AND update_time < $1 ORDER BY create_time ASC`,
      [updateTimeCutoffMs]
    );
    if ((expired.rowCount ?? 0) === 0) return [];
    await this.pool.query(
      `UPDATE snooze SET status='timeout', update_time=$2 WHERE status='active' AND update_time < $1`,
      [updateTimeCutoffMs, Date.now()]
    );
    return expired.rows.map(mapSnooze);
  }
}
