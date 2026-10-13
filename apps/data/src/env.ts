import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

// The data module's connection contract (specs/data/spec_config.md §Data):
// VORK_DATABASE_* is the canonical surface; each var falls back to its
// WAKERY_DATABASE_* twin so the deployed wakery .env drives the module
// unchanged. The migrate/seed/cutover CLIs run as vork_owner — point
// VORK_DATABASE_USER / _PASSWORD_PATH at the owner credentials for those
// invocations (#35 ruling (b)).

export interface DataDbConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function pick(name: string): string | undefined {
  return process.env[`VORK_DATABASE_${name}`] ?? process.env[`WAKERY_DATABASE_${name}`];
}

function required(name: string): string {
  const value = pick(name);
  if (value === undefined || value === '') {
    throw new Error(`VORK_DATABASE_${name} (or WAKERY_DATABASE_${name}) is required`);
  }
  return value;
}

export function loadDataDbConfig(): DataDbConfig {
  const passwordPath = expandHome(required('PASSWORD_PATH'));
  if (!existsSync(passwordPath)) throw new Error(`database password file not found: ${passwordPath}`);
  return {
    host: required('HOST'),
    port: Number(pick('PORT') ?? '5432'),
    user: required('USER'),
    database: required('NAME'),
    password: readFileSync(passwordPath, 'utf8').trim()
  };
}
