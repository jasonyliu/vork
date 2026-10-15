import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { preflightError, usageError } from './errors.js';
import type { FoundryEnv } from './types.js';

// Environment per `spec_foundry-interface.md §Environment` and
// `specs/data/spec_config.md §Foundry`: `apps/foundry/.env` in the run surface
// (loaded from the app directory — `bin/foundry` runs from anywhere). Per-run
// flags override the environment; the environment overrides built-in defaults.

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PROJECT_STORAGE_PATH = '~/Vork/projects';

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function readToken(path: string): string {
  const expanded = expandHome(path);
  if (!existsSync(expanded)) throw preflightError(`token file not found: ${path}`);
  const token = readFileSync(expanded, 'utf8').trim();
  if (token === '') throw preflightError(`token file empty: ${path}`);
  return token;
}

// Load `<APP_DIR>/.env` into process.env (existing values win — a deployed
// runner or a test may set them directly).
export function loadDotenv(appDir: string = APP_DIR): void {
  dotenv.config({ path: join(appDir, '.env') });
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined || value.trim() === '') throw usageError(`env var missing or empty: ${name}`);
  return value.trim();
}

function optional(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = source[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): FoundryEnv {
  const ruleset = optional(source, 'FOUNDRY_RULESET') ?? 'standard';
  if (ruleset !== 'standard' && ruleset !== 'none') throw usageError('env var invalid: FOUNDRY_RULESET must be "standard" or "none"');
  // optional registry connection — a missing host means the register stage is
  // skipped (standalone mode)
  const host = optional(source, 'PSYPHIX_DATABASE_HOST');
  const database: FoundryEnv['database'] = host === undefined
    ? undefined
    : {
        host,
        port: Number(optional(source, 'PSYPHIX_DATABASE_PORT') ?? '5432'),
        name: optional(source, 'PSYPHIX_DATABASE_NAME') ?? 'psyphix',
        user: optional(source, 'PSYPHIX_DATABASE_USER') ?? 'psyphix_app',
        password_path: required(source, 'PSYPHIX_DATABASE_PASSWORD_PATH')
      };
  return {
    owner_token_path: required(source, 'FOUNDRY_OWNER_TOKEN_PATH'),
    work_token_path: required(source, 'FOUNDRY_WORK_TOKEN_PATH'),
    ruleset,
    project_storage_path: optional(source, 'FOUNDRY_PROJECT_STORAGE_PATH') ?? DEFAULT_PROJECT_STORAGE_PATH,
    ...(database !== undefined ? { database } : {})
  };
}
