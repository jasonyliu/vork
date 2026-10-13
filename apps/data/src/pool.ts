import pg from 'pg';
import type { DataDbConfig } from './env.js';

export function createDataPool(config: DataDbConfig): pg.Pool {
  return new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    password: config.password
  });
}
