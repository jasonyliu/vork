import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The pg-mem pool (md5 registered) and the config-plane project fixture seeder
// live in the data module's testing surface — one home for every suite.
export { createTestPool, seedProject } from '@vork/data/testing';

export function createTempDir(prefix = 'wakery-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(dir, { recursive: true });
  return dir;
}
