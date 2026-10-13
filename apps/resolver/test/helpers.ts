import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export interface SeedRow {
  project: string | null;
  action: string;
  subject: string;
  zone: string;
  risk_code: string;
}

// A pg-mem-backed pool. The test mapping table is intentionally constraint-free
// (no PK / unique index / CHECK) so tests can seed exactly the rows they need —
// including a deliberately-bad risk_code for the invalid_mapping_row path. The
// resolver reads rows agnostically of how uniqueness/validity is enforced at the
// schema level (that enforcement is E2's migration concern).
export function createMemPool(): Pool {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

export async function createMappingTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE project_risk_mapping (
      project text,
      action text,
      subject text,
      zone text,
      risk_code text,
      create_time bigint,
      update_time bigint
    )
  `);
}

export async function seed(pool: Pool, rows: SeedRow[]): Promise<void> {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO project_risk_mapping
         (project, action, subject, zone, risk_code, create_time, update_time)
       VALUES ($1, $2, $3, $4, $5, 1700000000000, 1700000000000)`,
      [r.project, r.action, r.subject, r.zone, r.risk_code]
    );
  }
}
