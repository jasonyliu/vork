import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateBundle, loadBundle } from '../src/bundle.js';
import { agentTokenPath, loadDotenv, loadEnv } from '../src/config.js';
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
  project_key: 'sample_project',
  mission: 'm',
  description: 'd',
  scope: 's',
  channel: 'c'
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
  it('accepts a crew-only bundle — specialists absent or empty', () => {
    expect(validateBundle(VALID_BUNDLE)).toMatchObject({ project_key: 'sample_project', specialists: [] });
    expect(validateBundle({ ...VALID_BUNDLE, specialists: [] }).specialists).toEqual([]);
    expect(validateBundle({ ...VALID_BUNDLE, specialists: null }).specialists).toEqual([]);
  });

  it('accepts specialists with canonical tasks, stage types included', () => {
    const bundle = validateBundle({ ...VALID_BUNDLE, specialists: [{ name: 'visor', tasks: ['coding', 'bug', 'project_integration'] }] });
    expect(bundle.specialists).toEqual([{ name: 'visor', tasks: ['coding', 'bug', 'project_integration'] }]);
  });

  it.each(['project_name', 'project_key', 'mission', 'description', 'scope', 'channel'])(
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

  it('exits 2 on the retired team field', () => {
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, team: ['sarge'] }), /retired: team/);
  });

  it.each(['main', 'heimdall', 'sarge'])('exits 2 when a specialist is the crew agent %s', (name) => {
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, specialists: [{ name, tasks: ['coding'] }] }), new RegExp(`specialists\\[0\\]\\.name "${name}" is a crew agent`));
  });

  it('exits 2 on a duplicate specialist, an empty task list, an unknown task type, and an overlapping claim', () => {
    expectUsage(
      () => validateBundle({ ...VALID_BUNDLE, specialists: [{ name: 'visor', tasks: ['coding'] }, { name: 'visor', tasks: ['bug'] }] }),
      /specialists\[1\]\.name "visor" listed twice/
    );
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, specialists: [{ name: 'visor', tasks: [] }] }), /missing or empty: specialists\[0\]\.tasks/);
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, specialists: [{ name: 'visor' }] }), /missing or empty: specialists\[0\]\.tasks/);
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, specialists: [{ name: 'visor', tasks: ['painting'] }] }), /specialists\[0\]\.tasks names unknown task type "painting"/);
    expectUsage(
      () => validateBundle({ ...VALID_BUNDLE, specialists: [{ name: 'visor', tasks: ['coding'] }, { name: 'scribe', tasks: ['coding'] }] }),
      /specialists\[1\]\.tasks — "coding" already claimed by "visor"/
    );
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, specialists: [{ tasks: ['coding'] }] }), /missing or empty: specialists\[0\]\.name/);
    expectUsage(() => validateBundle({ ...VALID_BUNDLE, specialists: 'visor' }), /specialists must be a list/);
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
  FOUNDRY_AGENT_TOKEN_DIR: '/keys',
  FOUNDRY_PROJECT_STORAGE_PATH: '/projects',
  FOUNDRY_WEBHOOK_URL: 'https://x/webhook',
  FOUNDRY_WEBHOOK_SECRET_PATH: '/t/secret'
};

describe('environment', () => {
  it('loads the required vars and applies the ruleset default; no database host means standalone', () => {
    const env = loadEnv(VALID_ENV);
    expect(env).toMatchObject({
      owner_token_path: '/t/owner',
      agent_token_dir: '/keys',
      ruleset: 'standard',
      project_storage_path: '/projects',
      webhook_url: 'https://x/webhook',
      webhook_secret_path: '/t/secret'
    });
    expect(env.database).toBeUndefined();
  });

  it('reads the platform VORK_DATABASE_* section with its defaults when a host is set', () => {
    const env = loadEnv({ ...VALID_ENV, VORK_DATABASE_HOST: 'db', VORK_DATABASE_PASSWORD_PATH: '/t/pw' });
    expect(env.database).toEqual({ host: 'db', port: 5432, name: 'vork', user: 'vork_app', password_path: '/t/pw' });
  });

  it.each(['FOUNDRY_OWNER_TOKEN_PATH', 'FOUNDRY_AGENT_TOKEN_DIR', 'FOUNDRY_PROJECT_STORAGE_PATH', 'FOUNDRY_WEBHOOK_URL', 'FOUNDRY_WEBHOOK_SECRET_PATH'])('exits 2 naming a missing %s', (name) => {
    expectUsage(() => loadEnv({ ...VALID_ENV, [name]: undefined }), new RegExp(`missing or empty: ${name}`));
    expectUsage(() => loadEnv({ ...VALID_ENV, [name]: '  ' }), new RegExp(`missing or empty: ${name}`));
  });

  it('exits 2 when a database host is set without a password path, and on an invalid ruleset', () => {
    expectUsage(() => loadEnv({ ...VALID_ENV, VORK_DATABASE_HOST: 'db' }), /VORK_DATABASE_PASSWORD_PATH/);
    expectUsage(() => loadEnv({ ...VALID_ENV, FOUNDRY_RULESET: 'fancy' }), /FOUNDRY_RULESET/);
  });

  it('loads apps/foundry/.env from the app directory without overriding set values', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'FOUNDRY_TEST_FROM_FILE=file\nFOUNDRY_TEST_PRESET=file\n', 'utf8');
    process.env['FOUNDRY_TEST_PRESET'] = 'process';
    loadDotenv(dir);
    expect(process.env['FOUNDRY_TEST_FROM_FILE']).toBe('file');
    expect(process.env['FOUNDRY_TEST_PRESET']).toBe('process');
    delete process.env['FOUNDRY_TEST_FROM_FILE'];
    delete process.env['FOUNDRY_TEST_PRESET'];
  });

  it('resolves crew and specialist tokens as <name>.token under the agent token dir', () => {
    const env = loadEnv({ ...VALID_ENV, FOUNDRY_AGENT_TOKEN_DIR: '/keys' });
    expect(agentTokenPath(env, 'main')).toBe('/keys/main.token');
    expect(agentTokenPath(env, 'visor')).toBe('/keys/visor.token');
  });
});
