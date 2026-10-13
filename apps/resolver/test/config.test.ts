import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import { EXIT, ResolverError } from '../src/errors.js';

const KEYS = [
  'RESOLVER_DATABASE_HOST',
  'RESOLVER_DATABASE_PORT',
  'RESOLVER_DATABASE_USER',
  'RESOLVER_DATABASE_NAME',
  'RESOLVER_DATABASE_PASSWORD_PATH'
];

let saved: Record<string, string | undefined>;
let passwordPath: string;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const dir = mkdtempSync(join(tmpdir(), 'resolver-cfg-'));
  passwordPath = join(dir, 'pw');
  writeFileSync(passwordPath, 'sekret\n');
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setAll() {
  process.env.RESOLVER_DATABASE_HOST = 'db.example';
  process.env.RESOLVER_DATABASE_USER = 'wakery';
  process.env.RESOLVER_DATABASE_NAME = 'wakery';
  process.env.RESOLVER_DATABASE_PASSWORD_PATH = passwordPath;
}

function expectConfigError(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ResolverError);
    expect((err as ResolverError).exitCode).toBe(EXIT.CONFIG);
    expect((err as ResolverError).errorClass).toBe('config');
    return;
  }
  throw new Error('expected a config ResolverError');
}

describe('loadConfig — exit 3 / config', () => {
  test('loads a complete config and reads the trimmed password', () => {
    setAll();
    const cfg = loadConfig();
    expect(cfg).toMatchObject({ host: 'db.example', user: 'wakery', database: 'wakery', port: 5432 });
    expect(cfg.password).toBe('sekret');
  });

  test('defaults the port to 5432 and honors an override', () => {
    setAll();
    expect(loadConfig().port).toBe(5432);
    process.env.RESOLVER_DATABASE_PORT = '6000';
    expect(loadConfig().port).toBe(6000);
  });

  test('rejects each missing required var', () => {
    for (const missing of [
      'RESOLVER_DATABASE_HOST',
      'RESOLVER_DATABASE_USER',
      'RESOLVER_DATABASE_NAME',
      'RESOLVER_DATABASE_PASSWORD_PATH'
    ]) {
      setAll();
      delete process.env[missing];
      expectConfigError(() => loadConfig());
    }
  });

  test('rejects an invalid port', () => {
    setAll();
    process.env.RESOLVER_DATABASE_PORT = 'abc';
    expectConfigError(() => loadConfig());
  });

  test('rejects an unreadable password path', () => {
    setAll();
    process.env.RESOLVER_DATABASE_PASSWORD_PATH = '/no/such/file/here';
    expectConfigError(() => loadConfig());
  });
});
