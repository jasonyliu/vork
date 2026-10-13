import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { preflightError, usageError } from './errors.js';
import type { FoundryEnv } from './types.js';

// Environment per `spec_foundry-interface.md §Environment` and
// `specs/data/spec_config.md §Foundry`: `apps/foundry/.env` in the run surface
// (loaded from the app directory, not the caller's cwd — `bin/foundry` runs
// from anywhere). Per-run flags override the environment; the environment
// overrides built-in defaults.

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// No built-in default for the keystore token directory or the project storage
// path: both are required environment inputs. The original instance supplied
// them from its own estate; a release carries no estate value.

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
// LaunchAgent or a test may set them directly).
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
  // optional registry connection — no host means the register stage is skipped
  const host = optional(source, 'VORK_DATABASE_HOST');
  const database: FoundryEnv['database'] = host === undefined
    ? undefined
    : {
        host,
        port: Number(optional(source, 'VORK_DATABASE_PORT') ?? '5432'),
        name: optional(source, 'VORK_DATABASE_NAME') ?? 'vork',
        user: optional(source, 'VORK_DATABASE_USER') ?? 'vork_app',
        password_path: required(source, 'VORK_DATABASE_PASSWORD_PATH')
      };
  return {
    owner_token_path: required(source, 'FOUNDRY_OWNER_TOKEN_PATH'),
    agent_token_dir: required(source, 'FOUNDRY_AGENT_TOKEN_DIR'),
    ruleset,
    project_storage_path: required(source, 'FOUNDRY_PROJECT_STORAGE_PATH'),
    webhook_url: required(source, 'FOUNDRY_WEBHOOK_URL'),
    webhook_secret_path: required(source, 'FOUNDRY_WEBHOOK_SECRET_PATH'),
    ...(database !== undefined ? { database } : {})
  };
}

// Agent-name → token resolution: `<FOUNDRY_AGENT_TOKEN_DIR>/<name>.token`
// for crew and specialists alike — the platform keystore convention: the work
// accounts serve every bootstrapped project, so the token directory belongs to
// the platform, not the target project.
export function agentTokenPath(env: FoundryEnv, agentName: string): string {
  return join(expandHome(env.agent_token_dir), `${agentName}.token`);
}
