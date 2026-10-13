import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { ResolverConfig } from './config.js';
import { EXIT, ResolverError } from './errors.js';

// A minimal queryable surface satisfied by both `pg.Pool` and `pg.PoolClient`, and
// by the pg-mem adapter used in tests. `resolve` depends only on this.
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export function createPool(config: ResolverConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    password: config.password
  });
}

// Open one connection for the invocation. A connection failure before any query is
// exit 4 / `db_connect`.
export async function connect(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (err) {
    throw new ResolverError(EXIT.DB_CONNECT, 'Postgres connection failed', {
      reason: err instanceof Error ? err.message : String(err)
    });
  }
}

// Run a query, mapping any failure to exit 5 / `db_query`. Partial work is discarded
// by the caller (the connection is closed on the error path).
export async function queryRows(db: Queryable, sql: string, params: unknown[]): Promise<any[]> {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (err) {
    throw new ResolverError(EXIT.DB_QUERY, 'Postgres query failed mid-resolution', {
      reason: err instanceof Error ? err.message : String(err)
    });
  }
}
