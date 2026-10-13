import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../src/testing.js';
import { runMigrations } from '../src/migrate.js';
import {
  RISK_MAPPING_OVERLAY_ROWS,
  RISK_MAPPING_ROWS,
  RISK_MAPPING_WILDCARD_ROWS,
  seedProjects,
  seedRiskMappings
} from '../src/seed.js';

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

async function freshSeededPool(): Promise<Pool> {
  pool = await createTestPool();
  await runMigrations(pool);
  await seedProjects(pool);
  return pool;
}

const ALLOWED_CODES = new Set(['R100', 'R200', 'R300', 'R999']);

describe('seed: project_risk_mapping — row data integrity', () => {
  test('54 rows total: 54 wildcard, no overlay in the platform seed', () => {
    expect(RISK_MAPPING_WILDCARD_ROWS).toHaveLength(54);
    expect(RISK_MAPPING_OVERLAY_ROWS).toHaveLength(0);
    expect(RISK_MAPPING_ROWS).toHaveLength(54);
  });

  test('wildcard code distribution is 11×R100, 27×R200, 13×R300, 3×R999', () => {
    const count = (code: string) => RISK_MAPPING_WILDCARD_ROWS.filter((r) => r.risk_code === code).length;
    expect(count('R100')).toBe(11);
    expect(count('R200')).toBe(27);
    expect(count('R300')).toBe(13);
    expect(count('R999')).toBe(3);
  });

  test('wildcard rows are all project NULL; the platform seed carries no overlay rows', () => {
    expect(RISK_MAPPING_WILDCARD_ROWS.every((r) => r.project === null)).toBe(true);
    expect(RISK_MAPPING_OVERLAY_ROWS).toEqual([]);
  });

  test('components are lowercase and risk codes are in the Resolver-emit set', () => {
    for (const r of RISK_MAPPING_ROWS) {
      expect(r.action).toBe(r.action.toLowerCase());
      expect(r.subject).toBe(r.subject.toLowerCase());
      expect(r.zone).toBe(r.zone.toLowerCase());
      expect(ALLOWED_CODES.has(r.risk_code)).toBe(true);
    }
  });

  test('each partition has unique cells (no internal duplicates)', () => {
    const cells = (rows: typeof RISK_MAPPING_ROWS) => rows.map((r) => `${r.action}/${r.subject}/${r.zone}`);
    const w = cells(RISK_MAPPING_WILDCARD_ROWS);
    const p = cells(RISK_MAPPING_OVERLAY_ROWS);
    expect(new Set(w).size).toBe(w.length);
    expect(new Set(p).size).toBe(p.length);
  });

  test('growth-path cells added during Resolver-v1 and the 2026-06 churn are present with the right codes', () => {
    const byCell = new Map(RISK_MAPPING_WILDCARD_ROWS.map((r) => [`${r.action}/${r.subject}/${r.zone}`, r.risk_code]));
    expect(byCell.get('inspect/file/local')).toBe('R100');        // #42 unmapped-cell
    expect(byCell.get('update/repository/workspace')).toBe('R200'); // #44 worktree reconciliation
    expect(byCell.get('inspect/repository/workspace')).toBe('R100'); // #44 worktree/tag verification
    expect(byCell.get('invoke/endpoint/local')).toBe('R200');      // #44 resolver smoke
    expect(byCell.get('control/service/internal')).toBe('R300');   // 2026-06 churn (OP2 service restart)
    expect(byCell.get('query/record/internal')).toBe('R100');      // 2026-06 churn (audit lookups)
    expect(byCell.get('create/credential/internal')).toBe('R300'); // 2026-06 churn (least-privilege)
  });

  test('deployment-verification cells are present with the ruled codes', () => {
    const byCell = new Map(RISK_MAPPING_WILDCARD_ROWS.map((r) => [`${r.action}/${r.subject}/${r.zone}`, r.risk_code]));
    expect(byCell.get('inspect/repository/external')).toBe('R100'); // release-tag / merge / tip correlation
    expect(byCell.get('inspect/job/external')).toBe('R100');        // Workers Builds job verification
    expect(byCell.get('inspect/service/external')).toBe('R100');    // serving-state confirmation
    expect(byCell.get('invoke/endpoint/public')).toBe('R200');      // production HTTP smoke checks
    expect(byCell.get('control/service/external')).toBe('R300');    // rollback control — wildcard stays conservative
  });

  test('conduction data-op rows (live-first 2026-08-06..08-08) are reflected', () => {
    const byCell = new Map(RISK_MAPPING_WILDCARD_ROWS.map((r) => [`${r.action}/${r.subject}/${r.zone}`, r.risk_code]));
    expect(byCell.get('submit/repository/external')).toBe('R200');  // PR-flow (comment-contract)
    expect(byCell.get('update/repository/external')).toBe('R200');  // PR-flow (comment-contract)
    expect(byCell.get('inspect/surface/external')).toBe('R200');    // stall fix (2026-08-06)
  });
});

describe('seed: project_risk_mapping — DB behavior', () => {
  test('fresh DB: seeds 54 wildcard rows with the correct codes and no overlay rows', async () => {
    const p = await freshSeededPool();
    const result = await seedRiskMappings(p, () => 1700000000000);
    expect(result).toMatchObject({ total: 54, inserted: 54, skipped: 0 });

    const total = await p.query(`SELECT count(*)::int AS n FROM project_risk_mapping`);
    expect(total.rows[0].n).toBe(54);

    const wildcard = await p.query(`SELECT count(*)::int AS n FROM project_risk_mapping WHERE project IS NULL`);
    expect(wildcard.rows[0].n).toBe(54);

    const overlay = await p.query(`SELECT count(*)::int AS n FROM project_risk_mapping WHERE project IS NOT NULL`);
    expect(overlay.rows[0].n).toBe(0);

    const cell = await p.query(
      `SELECT risk_code FROM project_risk_mapping WHERE project IS NULL AND action='delete' AND subject='repository' AND zone='external'`
    );
    expect(cell.rows[0].risk_code).toBe('R999');

    const inspectLocal = await p.query(
      `SELECT risk_code FROM project_risk_mapping WHERE project IS NULL AND action='inspect' AND subject='file' AND zone='local'`
    );
    expect(inspectLocal.rows[0].risk_code).toBe('R100');
  });

  test('idempotent: a second run inserts nothing and the row count is unchanged', async () => {
    const p = await freshSeededPool();
    await seedRiskMappings(p);
    const second = await seedRiskMappings(p);
    expect(second).toMatchObject({ total: 54, inserted: 0, skipped: 54 });

    const total = await p.query(`SELECT count(*)::int AS n FROM project_risk_mapping`);
    expect(total.rows[0].n).toBe(54);
  });

  test('the wildcard partial unique index is in force (a duplicate plain insert fails)', async () => {
    const p = await freshSeededPool();
    await seedRiskMappings(p);
    await expect(
      p.query(
        `INSERT INTO project_risk_mapping (project, action, subject, zone, risk_code, create_time, update_time)
         VALUES (NULL, 'read', 'file', 'workspace', 'R100', 1, 1)`
      )
    ).rejects.toThrow();
  });
});
