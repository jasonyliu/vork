import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { EXIT } from '../src/errors.js';
import { type RunDeps, run } from '../src/run.js';
import type { ResolverConfig } from '../src/config.js';
import type { SuccessEnvelope } from '../src/types.js';
import { createMappingTable, createMemPool, type SeedRow, seed } from './helpers.js';

// A representative test mapping set modeling the shape described in
// `manual.md §DB seeding`: wildcard rows (active R100/R200, destructive R300, three
// designated-R999 cells) plus a small project overlay loosening universal-transition
// cells from R200 → R100. Values here are a fixture, not the production seed (which
// E3 loads from the research record).
const WILDCARD: SeedRow[] = [
  { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' },
  { project: null, action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'interpret', subject: 'job', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'delete', subject: 'file', zone: 'workspace', risk_code: 'R300' },
  { project: null, action: 'push', subject: 'repository', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'send', subject: 'message', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'read', subject: 'record', zone: 'external', risk_code: 'R200' },
  // three designated-R999 wildcard cells
  { project: null, action: 'delete', subject: 'repository', zone: 'external', risk_code: 'R999' },
  { project: null, action: 'revoke', subject: 'permission', zone: 'external', risk_code: 'R999' },
  { project: null, action: 'publish', subject: 'publication', zone: 'public', risk_code: 'R999' }
];

const PROJECT_OVERLAY: SeedRow[] = [
  { project: 'vork', action: 'push', subject: 'repository', zone: 'external', risk_code: 'R100' },
  { project: 'vork', action: 'send', subject: 'message', zone: 'external', risk_code: 'R100' },
  { project: 'vork', action: 'read', subject: 'record', zone: 'external', risk_code: 'R100' }
];

const CONFIG: ResolverConfig = { host: 'h', port: 5432, user: 'u', database: 'd', password: 'p' };

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

async function runWith(inputDoc: unknown): Promise<SuccessEnvelope> {
  pool = createMemPool();
  await createMappingTable(pool);
  await seed(pool, [...WILDCARD, ...PROJECT_OVERLAY]);
  const deps: RunDeps = {
    readStdin: async () => JSON.stringify(inputDoc),
    loadConfig: () => CONFIG,
    openClient: async () => ({ db: pool, close: async () => {} })
  };
  const r = await run(deps);
  expect(r.exitCode).toBe(EXIT.SUCCESS);
  if ('error' in r.envelope) throw new Error(`unexpected error envelope: ${JSON.stringify(r.envelope)}`);
  return r.envelope;
}

describe('integration — end-to-end against a seeded mapping table', () => {
  test('wildcard resolution when no operation matches a project row', async () => {
    const out = await runWith({
      project: 'vork',
      chain: [
        { seq: 1, action: 'update', subject: 'file', zone: 'workspace' },
        { seq: 2, action: 'interpret', subject: 'job', zone: 'workspace' }
      ]
    });
    expect(out.resolution_context).toBe('wildcard');
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R200', 'R200']);
    expect(out.task_risk_code).toBe('R200');
  });

  test('overlay: a project row loosens its own cell R200 → R100', async () => {
    const out = await runWith({
      project: 'vork',
      chain: [{ seq: 1, action: 'push', subject: 'repository', zone: 'external' }]
    });
    expect(out.resolution_context).toBe('project:vork');
    expect(out.chain[0].risk_code).toBe('R100');
    expect(out.task_risk_code).toBe('R100');
  });

  test('overlay: cells without a project row fall back to their wildcard rows', async () => {
    const out = await runWith({
      project: 'vork',
      chain: [
        { seq: 1, action: 'push', subject: 'repository', zone: 'external' }, // project overlay → R100
        { seq: 2, action: 'update', subject: 'file', zone: 'workspace' } // no project row → wildcard R200
      ]
    });
    expect(out.resolution_context).toBe('project:vork');
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R100', 'R200']);
    expect(out.task_risk_code).toBe('R200');
  });

  test('overlay engaged: a cell unmapped in both partitions still resolves R999', async () => {
    const out = await runWith({
      project: 'vork',
      chain: [
        { seq: 1, action: 'push', subject: 'repository', zone: 'external' }, // project overlay → R100
        { seq: 2, action: 'truncate', subject: 'store', zone: 'internal' } // in neither partition → R999
      ]
    });
    expect(out.resolution_context).toBe('project:vork');
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R100', 'R999']);
    expect(out.task_risk_code).toBe('R999');
  });

  test('a designated-R999 wildcard cell resolves to R999', async () => {
    const out = await runWith({
      project: 'vork',
      chain: [{ seq: 1, action: 'delete', subject: 'repository', zone: 'external' }]
    });
    expect(out.resolution_context).toBe('wildcard');
    expect(out.chain[0].risk_code).toBe('R999');
    expect(out.task_risk_code).toBe('R999');
  });

  test('aggregation across the wildcard set yields the strictest code', async () => {
    const out = await runWith({
      project: 'unmapped-project',
      chain: [
        { seq: 1, action: 'read', subject: 'file', zone: 'workspace' }, // R100
        { seq: 2, action: 'update', subject: 'file', zone: 'workspace' }, // R200
        { seq: 3, action: 'delete', subject: 'file', zone: 'workspace' } // R300
      ]
    });
    expect(out.resolution_context).toBe('wildcard');
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R100', 'R200', 'R300']);
    expect(out.task_risk_code).toBe('R300');
  });
});
