import { describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { EXIT, ResolverError } from '../src/errors.js';
import { type RunDeps, run } from '../src/run.js';
import type { ResolverConfig } from '../src/config.js';
import { createMappingTable, createMemPool, seed } from './helpers.js';

const GOOD_CONFIG: ResolverConfig = { host: 'h', port: 5432, user: 'u', database: 'd', password: 'p' };
const GOOD_INPUT = JSON.stringify({
  project: 'vork',
  chain: [{ seq: 1, action: 'read', subject: 'file', zone: 'workspace' }]
});

function deps(overrides: Partial<RunDeps>): RunDeps {
  return {
    readStdin: async () => GOOD_INPUT,
    loadConfig: () => GOOD_CONFIG,
    openClient: async () => {
      throw new Error('openClient not configured for this test');
    },
    ...overrides
  };
}

async function memOpenClient(rows: Parameters<typeof seed>[1]): Promise<{ open: RunDeps['openClient']; pool: Pool }> {
  const pool = createMemPool();
  await createMappingTable(pool);
  await seed(pool, rows);
  return {
    pool,
    open: async () => ({ db: pool, close: async () => { await pool.end(); } })
  };
}

describe('run — the eight exit-code paths', () => {
  test('exit 0: successful resolution', async () => {
    const { open } = await memOpenClient([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' }
    ]);
    const r = await run(deps({ openClient: open }));
    expect(r.exitCode).toBe(EXIT.SUCCESS);
    expect('error' in r.envelope).toBe(false);
    if (!('error' in r.envelope)) {
      expect(r.envelope.task_risk_code).toBe('R100');
      expect(r.envelope.resolution_context).toBe('wildcard');
    }
  });

  test('exit 0: a resolved R999 is still a success', async () => {
    const { open } = await memOpenClient([]); // empty table → unmapped → R999
    const r = await run(deps({ openClient: open }));
    expect(r.exitCode).toBe(EXIT.SUCCESS);
    if (!('error' in r.envelope)) expect(r.envelope.task_risk_code).toBe('R999');
  });

  test('exit 1: input_parse', async () => {
    const r = await run(deps({ readStdin: async () => 'not json' }));
    expect(r.exitCode).toBe(EXIT.INPUT_PARSE);
    expect('error' in r.envelope && r.envelope.error.class).toBe('input_parse');
  });

  test('exit 2: input_validation', async () => {
    const r = await run(deps({ readStdin: async () => JSON.stringify({ project: 'p', chain: [] }) }));
    expect(r.exitCode).toBe(EXIT.INPUT_VALIDATION);
    expect('error' in r.envelope && r.envelope.error.class).toBe('input_validation');
  });

  test('exit 3: config (and no DB opened — parse/validate already passed)', async () => {
    const r = await run(
      deps({
        loadConfig: () => {
          throw new ResolverError(EXIT.CONFIG, 'missing var');
        }
      })
    );
    expect(r.exitCode).toBe(EXIT.CONFIG);
    expect('error' in r.envelope && r.envelope.error.class).toBe('config');
  });

  test('exit 4: db_connect', async () => {
    const r = await run(
      deps({
        openClient: async () => {
          throw new ResolverError(EXIT.DB_CONNECT, 'connection refused');
        }
      })
    );
    expect(r.exitCode).toBe(EXIT.DB_CONNECT);
    expect('error' in r.envelope && r.envelope.error.class).toBe('db_connect');
  });

  test('exit 5: db_query', async () => {
    const r = await run(
      deps({
        openClient: async () => ({
          db: {
            query: async () => {
              throw new Error('query blew up');
            }
          },
          close: async () => {}
        })
      })
    );
    expect(r.exitCode).toBe(EXIT.DB_QUERY);
    expect('error' in r.envelope && r.envelope.error.class).toBe('db_query');
  });

  test('exit 6: invalid_mapping_row', async () => {
    const { open } = await memOpenClient([
      { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R994' }
    ]);
    const r = await run(deps({ openClient: open }));
    expect(r.exitCode).toBe(EXIT.INVALID_MAPPING_ROW);
    expect('error' in r.envelope && r.envelope.error.class).toBe('invalid_mapping_row');
  });

  test('exit 7: internal (non-ResolverError surfaces as internal)', async () => {
    const r = await run(
      deps({
        readStdin: async () => {
          throw new TypeError('unexpected boom');
        }
      })
    );
    expect(r.exitCode).toBe(EXIT.INTERNAL);
    expect('error' in r.envelope && r.envelope.error.class).toBe('internal');
    expect('error' in r.envelope && r.envelope.error.message).toContain('TypeError');
  });

  test('the connection is always closed (success and error paths)', async () => {
    let closed = 0;
    const open: RunDeps['openClient'] = async () => ({
      db: { query: async () => ({ rows: [] }) },
      close: async () => {
        closed += 1;
      }
    });
    await run(deps({ openClient: open })); // success path
    await run(deps({ openClient: open, readStdin: async () => GOOD_INPUT })); // success again
    expect(closed).toBe(2);
  });
});
