import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The CLI entrypoint end to end, through bin/foundry: exit codes and messages
// a unit test of the modules cannot reach.

const BIN = join(import.meta.dirname, '..', 'bin', 'foundry');
const ENV = {
  ...process.env,
  FOUNDRY_OWNER_TOKEN_PATH: '/nope/owner',
  FOUNDRY_VORK_TOKEN_PATH: '/nope/vork',
  FOUNDRY_VORK_NAME: 'Vork Bot',
  FOUNDRY_VORK_EMAIL: 'vork@example.com',
  FOUNDRY_PROJECT_STORAGE_PATH: '/nope/projects'
};

function run(args: string[], input = ''): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(BIN, args, { env: ENV, input, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe('bin/foundry', () => {
  it('prints usage and exits 2 without a command', () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage: foundry <bootstrap\|verify\|kickoff\|list>/);
  });

  it('--interactive without a terminal exits 2 and points at --bundle', () => {
    const r = run(['bootstrap', '--interactive', '--dry-run'], 'Piped\npiped\nm\nd\ns\n\n\n');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--interactive needs a terminal; pass --bundle/);
  });

  it('a missing token file exits 3 naming the path, before any API call', () => {
    const bundle = join(import.meta.dirname, 'fixtures-bundle.json');
    const r = run(['bootstrap', '--bundle', bundle, '--dry-run']);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/token file not found: \/nope\/owner/);
  });
});
