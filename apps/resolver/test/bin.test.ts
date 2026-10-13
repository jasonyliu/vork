import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// End-to-end smoke against the real `bin/resolver` process for the no-DB exit paths.
// Confirms the bin wrapper is executable, tsx runs the source with no build step,
// and the process exits with the mapped code. DB-dependent paths (0, 4, 5, 6) are
// covered in-process in run.test.ts / resolve.test.ts.
const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'resolver');

function runBin(stdin: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe('bin/resolver — subprocess smoke (no DB)', () => {
  test('empty stdin exits 1 / input_parse (matches `resolver < /dev/null`)', async () => {
    const { code, stdout } = await runBin('');
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error.class).toBe('input_parse');
  }, 30000);

  test('malformed input exits 2 / input_validation before any DB work', async () => {
    const { code, stdout } = await runBin(JSON.stringify({ project: 'p', chain: [] }));
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error.class).toBe('input_validation');
  }, 30000);
});
