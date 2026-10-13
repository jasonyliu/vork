import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { EXIT, ResolverError } from './errors.js';

// Load .env from the app directory (one level up from src/), not the caller's
// cwd. Required because the stable ~/.local/bin/resolver symlink is invoked from
// arbitrary working directories; a bare dotenv.config() would miss the app's .env.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

// DB connection parameters for the Wakery Postgres instance, per
// `spec_resolver-contracts.md §Configuration (env)`. The password is loaded from a
// file path (the keystore-by-path convention mirrored from Wakery), never pasted
// into an env value.
export interface ResolverConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new ResolverError(EXIT.CONFIG, `Required env var ${name} is unset`, { env_var: name });
  }
  return value;
}

// Load config at process start. A missing required env var or an unreadable
// password-path file aborts with exit 3 / `error.class = config`.
export function loadConfig(): ResolverConfig {
  const host = required('RESOLVER_DATABASE_HOST');
  const user = required('RESOLVER_DATABASE_USER');
  const database = required('RESOLVER_DATABASE_NAME');
  const passwordPath = required('RESOLVER_DATABASE_PASSWORD_PATH');

  const portRaw = process.env.RESOLVER_DATABASE_PORT;
  let port = 5432;
  if (portRaw !== undefined && portRaw.trim() !== '') {
    port = Number(portRaw);
    if (!Number.isInteger(port) || port <= 0) {
      throw new ResolverError(EXIT.CONFIG, `RESOLVER_DATABASE_PORT is not a valid port`, {
        env_var: 'RESOLVER_DATABASE_PORT',
        value: portRaw
      });
    }
  }

  const expanded = expandHome(passwordPath);
  if (!existsSync(expanded)) {
    throw new ResolverError(EXIT.CONFIG, `Password file not found: ${expanded}`, {
      env_var: 'RESOLVER_DATABASE_PASSWORD_PATH',
      path: expanded
    });
  }
  let password: string;
  try {
    password = readFileSync(expanded, 'utf8').trim();
  } catch (err) {
    throw new ResolverError(EXIT.CONFIG, `Password file unreadable: ${expanded}`, {
      env_var: 'RESOLVER_DATABASE_PASSWORD_PATH',
      path: expanded,
      reason: err instanceof Error ? err.message : String(err)
    });
  }

  return { host, port, user, database, password };
}
