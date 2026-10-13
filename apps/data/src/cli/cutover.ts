// The F6/F9 cutover window's data acts (specs/data/spec_database.md §Cutover
// migration, act 6). Run as vork_owner; `--dry-run` wraps everything in one
// transaction on one client and rolls back.
import { loadDataDbConfig } from '../env.js';
import { createDataPool } from '../pool.js';
import { cutoverPlatformKeying } from '../cutover-platform-keying.js';

const dryRun = process.argv.includes('--dry-run');
const pool = createDataPool(loadDataDbConfig());
const client = await pool.connect();
try {
  if (dryRun) await client.query('BEGIN');
  const report = await cutoverPlatformKeying(client);
  if (dryRun) {
    await client.query('ROLLBACK');
    console.log('DRY RUN — rolled back. Would apply:');
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (dryRun) await client.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
