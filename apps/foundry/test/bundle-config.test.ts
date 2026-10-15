import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateBundle, loadBundle } from '../src/bundle.js';
import { loadDotenv, loadEnv } from '../src/config.js';
import { EXIT, FoundryError } from '../src/errors.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-cfg-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const VALID_BUNDLE = {
  project_name: 'Tutor Project',
  project_key: 'tutor',
  mission: 'm',
  description: 'd',
  scope: 's'
};

function expectUsage(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
    expect.unreachable('expected a usage error');
  } catch (error) {
    expect(error).toBeInstanceOf(FoundryError);
    expect((error as FoundryError).exitCode).toBe(EXIT.USAGE);
    expect((error as FoundryError).message).toMatch(pattern);
  }
}

describe('bundle validation', () => {
  it('accepts the mission core', () => {
    expect(validateBundle(VALID_BUNDLE)).toEqual(VALID_BUNDLE);
  });

  it.each(['project_name', 'project_key', 'mission', 'description', 'scope'])(
    'exits 2 naming an omitted or empty %s',
    (field) => {
      expectUsage(() => validateBundle({ ...VALID_BUNDLE, [field]: undefined }), new RegExp(`missing or empty: ${field}`));
      expectUsage(() => validateBundle({ ...VALID_BUNDLE, [field]: '' }), new RegExp(`missing or empty: ${field}`));
    }
  );

  it('exits 2 naming a malformed project_key', () => {
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, project_key: 'Bad-Key' }), /malformed: project_key/);
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, project_key: '9lead' }), /malformed: project_key/);
  });

  it.each(['channel', 'specialists', 'team'])('exits 2 on the retired %s field', (field) => {
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, [field]: 'x' }), new RegExp(`retired: ${field}`));
  });

  it('exits 2 naming an unparseable or missing bundle file', () => {
    const dir = tempDir();
    expectUsage(() => loadBundle(join(dir, 'nope.json')), /not found/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json', 'utf8');
    expectUsage(() => loadBundle(bad), /unparseable/);
  });
});

const VALID_ENV: NodeJS.ProcessEnv = {
  FOUNDRY_OWNER_TOKEN_PATH: '/t/owner',
  FOUNDRY_WORK_TOKEN_PATH: '/t/work'
};

describe('environment', () => {
  it('loads the required vars and applies the defaults; a missing database host means standalone', () => {
    const env = loadEnv(VALID_ENV);
    expect(env).toMatchObject({
      owner_token_path: '/t/owner',
      work_token_path: '/t/work',
      ruleset: 'standard',
      project_storage_path: '~/Vork/projects'
    });
    expect(env.database).toBeUndefined();
  });

  it('reads the platform PSYPHIX_DATABASE_* section with its defaults when a host is set', () => {
    const env = loadEnv({ ...VALID_ENV, PSYPHIX_DATABASE_HOST: 'db', PSYPHIX_DATABASE_PASSWORD_PATH: '/t/pw' });
    expect(env.database).toEqual({ host: 'db', port: 5432, name: 'psyphix', user: 'psyphix_app', password_path: '/t/pw' });
  });

  it.each(['FOUNDRY_OWNER_TOKEN_PATH', 'FOUNDRY_WORK_TOKEN_PATH'])('exits 2 naming a missing %s', (name) => {
    expectUsage(() => loadEnv({ ...VALID_ENV, [name]: undefined }), new RegExp(`missing or empty: ${name}`));
    expectUsage(() => loadEnv({ ...VALID_ENV, [name]: '  ' }), new RegExp(`missing or empty: ${name}`));
  });

  it('exits 2 when a database host is set without a password path, and on an invalid ruleset', () => {
    expectUsage(() => loadEnv({ ...VALID_ENV, PSYPHIX_DATABASE_HOST: 'db' }), /PSYPHIX_DATABASE_PASSWORD_PATH/);
    expectUsage(() => loadEnv({ ...VALID_ENV, FOUNDRY_RULESET: 'fancy' }), /FOUNDRY_RULESET/);
  });

  it('loads apps/foundry/.env from the app directory, set values winning', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'FOUNDRY_TEST_FROM_FILE=file\nFOUNDRY_TEST_PRESET=file\n', 'utf8');
    process.env['FOUNDRY_TEST_PRESET'] = 'process';
    loadDotenv(dir);
    expect(process.env['FOUNDRY_TEST_FROM_FILE']).toBe('file');
    expect(process.env['FOUNDRY_TEST_PRESET']).toBe('process');
    delete process.env['FOUNDRY_TEST_FROM_FILE'];
    delete process.env['FOUNDRY_TEST_PRESET'];
  });
});
