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
  project_name: 'Sample Project',
  project_key: 'sample',
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
  it('accepts the mission core, visibility defaulting to private and ruleset to standard', () => {
    expect(validateBundle(VALID_BUNDLE)).toEqual({ ...VALID_BUNDLE, visibility: 'private', ruleset: 'standard' });
  });

  it('accepts an explicit ruleset and exits 2 naming an unknown one', () => {
    expect(validateBundle({ ...VALID_BUNDLE, ruleset: 'none' }).ruleset).toBe('none');
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, ruleset: 'strict' }), /malformed: ruleset/);
  });

  it('accepts an explicit visibility', () => {
    expect(validateBundle({ ...VALID_BUNDLE, visibility: 'public' }).visibility).toBe('public');
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

  it('exits 2 naming an unknown visibility', () => {
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, visibility: 'internal' }), /malformed: visibility/);
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, visibility: 7 }), /malformed: visibility/);
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
  FOUNDRY_VORK_TOKEN_PATH: '/t/vork',
  FOUNDRY_VORK_NAME: 'Vork Bot',
  FOUNDRY_VORK_EMAIL: 'vork@example.com',
  FOUNDRY_PROJECT_STORAGE_PATH: '/t/projects'
};

describe('environment', () => {
  it('loads the five required vars', () => {
    expect(loadEnv(VALID_ENV)).toEqual({
      owner_token_path: '/t/owner',
      vork_token_path: '/t/vork',
      vork_name: 'Vork Bot',
      vork_email: 'vork@example.com',
      project_storage_path: '/t/projects'
    });
  });

  it.each(['FOUNDRY_OWNER_TOKEN_PATH', 'FOUNDRY_VORK_TOKEN_PATH', 'FOUNDRY_VORK_NAME', 'FOUNDRY_VORK_EMAIL', 'FOUNDRY_PROJECT_STORAGE_PATH'])('exits 2 naming a missing %s', (name) => {
    expectUsage(() => loadEnv({ ...VALID_ENV, [name]: undefined }), new RegExp(`missing or empty: ${name}`));
    expectUsage(() => loadEnv({ ...VALID_ENV, [name]: '  ' }), new RegExp(`missing or empty: ${name}`));
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
