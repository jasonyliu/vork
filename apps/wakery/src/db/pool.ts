import { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';

export function createPool(config: AppConfig) {
  return new Pool({
    host: config.WAKERY_DATABASE_HOST,
    port: config.WAKERY_DATABASE_PORT,
    user: config.WAKERY_DATABASE_USER,
    database: config.WAKERY_DATABASE_NAME,
    password: config.WAKERY_DATABASE_PASSWORD
  });
}
