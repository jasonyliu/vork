import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { preflightError, usageError } from './errors.js';
import type { FoundryEnv } from './types.js';

// Environment per `spec_foundry-interface.md §Environment`: `apps/foundry/.env`
// beside the app (loaded from the app directory, so `bin/foundry` runs from
// anywhere). Per-run flags override the environment. Every variable is required
// and carries no built-in default: `provisions/install` writes them.

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// Load `<APP_DIR>/.env` into process.env (existing values win — a runner or a
// test may set them directly).
export function loadDotenv(appDir: string = APP_DIR): void {
  dotenv.config({ path: join(appDir, '.env') });
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined || value.trim() === '') throw usageError(`env var missing or empty: ${name}`);
  return value.trim();
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): FoundryEnv {
  return {
    owner_token_path: required(source, 'FOUNDRY_OWNER_TOKEN_PATH'),
    vork_token_path: required(source, 'FOUNDRY_VORK_TOKEN_PATH'),
    vork_name: required(source, 'FOUNDRY_VORK_NAME'),
    vork_email: required(source, 'FOUNDRY_VORK_EMAIL'),
    project_storage_path: required(source, 'FOUNDRY_PROJECT_STORAGE_PATH')
  };
}
