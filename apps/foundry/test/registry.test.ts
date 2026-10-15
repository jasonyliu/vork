import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import { formatRegistry, readRegistry, registryPath, upsertProject, type RegistryInput } from '../src/registry.js';

// The machine's project registry: `<foundry-var>/projects.json`, one entry per
// founded key, upserted at bootstrap's close, read by `foundry list`.

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-reg-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function input(overrides: Partial<RegistryInput> = {}): RegistryInput {
  return {
    name: 'Sample Project',
    owner: 'owner-login',
    repository: 'https://github.com/owner-login/sample',
    visibility: 'private',
    ruleset: 'standard',
    owner_plan: 'pro',
    path: '/projects/sample',
    run_id: 'run-1',
    ...overrides
  };
}

describe('registry', () => {
  it('an absent file is an empty registry; list says so', () => {
    const v = tempDir();
    expect(readRegistry(v)).toEqual({ projects: {} });
    expect(formatRegistry(readRegistry(v))).toBe('no projects founded from this clone');
  });

  it('creates the entry with founded_at and updated_at from the run, the file sorted and newline-terminated', () => {
    const v = tempDir();
    const outcome = upsertProject(v, 'sample', input(), '2026-08-24T12:00:00.000Z');
    expect(outcome).toEqual({ path: registryPath(v), outcome: 'created' });
    const raw = readFileSync(registryPath(v), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const entry = readRegistry(v).projects['sample']!;
    expect(entry).toMatchObject({ ...input(), founded_at: '2026-08-24T12:00:00.000Z', updated_at: '2026-08-24T12:00:00.000Z' });
    expect(existsSync(`${registryPath(v)}.tmp.${process.pid}`)).toBe(false);
  });

  it('a re-run updates every field except founded_at; the entry count stays one', () => {
    const v = tempDir();
    upsertProject(v, 'sample', input(), '2026-08-24T12:00:00.000Z');
    const second = upsertProject(v, 'sample', input({ run_id: 'run-2', ruleset: 'none', owner_plan: 'free' }), '2026-08-25T12:00:00.000Z');
    expect(second.outcome).toBe('updated');
    const registry = readRegistry(v);
    expect(Object.keys(registry.projects)).toEqual(['sample']);
    expect(registry.projects['sample']).toMatchObject({ founded_at: '2026-08-24T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z', run_id: 'run-2', ruleset: 'none', owner_plan: 'free' });
  });

  it('keeps further projects side by side, keys sorted', () => {
    const v = tempDir();
    upsertProject(v, 'zeta', input({ name: 'Zeta' }), '2026-08-24T12:00:00.000Z');
    upsertProject(v, 'alpha', input({ name: 'Alpha', visibility: 'public' }), '2026-08-24T13:00:00.000Z');
    expect(Object.keys(readRegistry(v).projects)).toEqual(['alpha', 'zeta']);
    const table = formatRegistry(readRegistry(v));
    const lines = table.split('\n');
    expect(lines[0]).toMatch(/^key\s+name\s+visibility\s+ruleset\s+path\s+founded$/);
    expect(lines[1]).toMatch(/^alpha\s+Alpha\s+public\s+standard\s+\/projects\/sample\s+2026-08-24$/);
    expect(lines[2]).toMatch(/^zeta\s+Zeta\s+private\s+standard/);
  });

  it('an unparseable or malformed file exits 5 naming it', () => {
    const v = tempDir();
    writeFileSync(registryPath(v), '{not json', 'utf8');
    try {
      readRegistry(v);
      expect.unreachable();
    } catch (error) {
      expect((error as FoundryError).exitCode).toBe(EXIT.LOCAL);
      expect((error as FoundryError).message).toMatch(/registry unparseable/);
    }
    writeFileSync(registryPath(v), '{"projects": []}', 'utf8');
    expect(() => readRegistry(v)).toThrow(/registry malformed/);
  });
});
