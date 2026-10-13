import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { EXIT, ResolverError } from '../src/errors.js';
import { resolveChain } from '../src/resolve.js';
import type { Queryable } from '../src/db.js';
import { createMappingTable, createMemPool, seed } from './helpers.js';

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

async function freshPool(rows: Parameters<typeof seed>[1]): Promise<Pool> {
  pool = createMemPool();
  await createMappingTable(pool);
  await seed(pool, rows);
  return pool;
}

const op = (seq: number, action: string, subject: string, zone: string) => ({ seq, action, subject, zone });

describe('resolveChain — wildcard branch', () => {
  test('resolves against the wildcard set when no operation matches a project row', async () => {
    const p = await freshPool([
      { project: null, action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R200' },
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'update', 'file', 'workspace'), op(2, 'read', 'file', 'workspace')]
    });
    expect(out.resolution_context).toBe('wildcard');
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R200', 'R100']);
    expect(out.task_risk_code).toBe('R200');
  });

  test('an unmapped cell in the wildcard set resolves to R999', async () => {
    const p = await freshPool([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'delete', 'repository', 'external')]
    });
    expect(out.resolution_context).toBe('wildcard');
    expect(out.chain[0].risk_code).toBe('R999');
    expect(out.task_risk_code).toBe('R999');
  });
});

describe('resolveChain — project overlay branch (partial-overlay rule)', () => {
  test('a project row wins for its cell; uncovered cells fall back to wildcard', async () => {
    const p = await freshPool([
      // wildcard covers both cells...
      { project: null, action: 'push', subject: 'repository', zone: 'external', risk_code: 'R200' },
      { project: null, action: 'read', subject: 'record', zone: 'external', risk_code: 'R200' },
      // ...and the project overlays push×repository×external only.
      { project: 'vork', action: 'push', subject: 'repository', zone: 'external', risk_code: 'R100' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'push', 'repository', 'external'), op(2, 'read', 'record', 'external')]
    });
    expect(out.resolution_context).toBe('project:vork');
    // push×repository×external resolves to the project row's R100...
    expect(out.chain[0].risk_code).toBe('R100');
    // ...and read×record×external has no project row, so it falls back to its
    // wildcard row (the partial-overlay rule).
    expect(out.chain[1].risk_code).toBe('R200');
    expect(out.task_risk_code).toBe('R200');
  });

  test('a cell mapped in neither partition resolves R999 even with the overlay engaged', async () => {
    const p = await freshPool([
      { project: null, action: 'push', subject: 'repository', zone: 'external', risk_code: 'R200' },
      { project: 'vork', action: 'push', subject: 'repository', zone: 'external', risk_code: 'R100' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'push', 'repository', 'external'), op(2, 'truncate', 'store', 'internal')]
    });
    expect(out.resolution_context).toBe('project:vork');
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R100', 'R999']);
    expect(out.task_risk_code).toBe('R999');
  });

  test('an overlay row can tighten its cell above the wildcard code', async () => {
    const p = await freshPool([
      { project: null, action: 'control', subject: 'service', zone: 'external', risk_code: 'R200' },
      { project: 'vork', action: 'control', subject: 'service', zone: 'external', risk_code: 'R300' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'control', 'service', 'external')]
    });
    expect(out.chain[0].risk_code).toBe('R300');
    expect(out.task_risk_code).toBe('R300');
  });

  test('a project with no matching project rows falls through to wildcard', async () => {
    const p = await freshPool([
      { project: null, action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R200' },
      { project: 'other', action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R100' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'update', 'file', 'workspace')]
    });
    expect(out.resolution_context).toBe('wildcard');
    expect(out.chain[0].risk_code).toBe('R200');
  });
});

describe('resolveChain — aggregation', () => {
  test('task_risk_code is the max across R100/R200/R300/R999', async () => {
    const p = await freshPool([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' },
      { project: null, action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R200' },
      { project: null, action: 'delete', subject: 'file', zone: 'workspace', risk_code: 'R300' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [
        op(1, 'read', 'file', 'workspace'),
        op(2, 'update', 'file', 'workspace'),
        op(3, 'delete', 'file', 'workspace'),
        op(4, 'invoke', 'service', 'external') // unmapped → R999
      ]
    });
    expect(out.chain.map((o) => o.risk_code)).toEqual(['R100', 'R200', 'R300', 'R999']);
    expect(out.task_risk_code).toBe('R999');
  });

  test('aggregation across R100/R200/R300 only yields R300', async () => {
    const p = await freshPool([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' },
      { project: null, action: 'delete', subject: 'file', zone: 'workspace', risk_code: 'R300' }
    ]);
    const out = await resolveChain(p, {
      project: 'vork',
      chain: [op(1, 'read', 'file', 'workspace'), op(2, 'delete', 'file', 'workspace')]
    });
    expect(out.task_risk_code).toBe('R300');
  });

  test('echoes seq, action, subject, zone verbatim onto each resolved op', async () => {
    const p = await freshPool([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' }
    ]);
    const out = await resolveChain(p, { project: 'p', chain: [op(1, 'read', 'file', 'workspace')] });
    expect(out.chain[0]).toEqual({ seq: 1, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' });
  });
});

describe('resolveChain — error paths', () => {
  test('a matched row with an unsupported risk_code is exit 6 / invalid_mapping_row', async () => {
    const p = await freshPool([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R994' }
    ]);
    try {
      await resolveChain(p, { project: 'p', chain: [op(1, 'read', 'file', 'workspace')] });
    } catch (err) {
      expect(err).toBeInstanceOf(ResolverError);
      expect((err as ResolverError).exitCode).toBe(EXIT.INVALID_MAPPING_ROW);
      expect((err as ResolverError).detail).toMatchObject({
        action: 'read',
        subject: 'file',
        zone: 'workspace',
        risk_code: 'R994'
      });
      return;
    }
    throw new Error('expected an invalid_mapping_row ResolverError');
  });

  test('a query failure is exit 5 / db_query', async () => {
    const throwing: Queryable = {
      query: async () => {
        throw new Error('connection reset mid-query');
      }
    };
    try {
      await resolveChain(throwing, { project: 'p', chain: [op(1, 'read', 'file', 'workspace')] });
    } catch (err) {
      expect(err).toBeInstanceOf(ResolverError);
      expect((err as ResolverError).exitCode).toBe(EXIT.DB_QUERY);
      return;
    }
    throw new Error('expected a db_query ResolverError');
  });

  test('determinism: identical inputs and mapping data yield identical output', async () => {
    const rows = [
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' },
      { project: null, action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R200' }
    ];
    const p = await freshPool(rows);
    const input = {
      project: 'vork',
      chain: [op(1, 'read', 'file', 'workspace'), op(2, 'update', 'file', 'workspace')]
    };
    const a = await resolveChain(p, input);
    const b = await resolveChain(p, input);
    expect(a).toEqual(b);
  });
});
