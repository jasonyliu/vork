// Canonical core-data seed, standalone: migrations (structure) then seed
// (data). Run as vork_owner.
import { loadDataDbConfig } from '../env.js';
import { createDataPool } from '../pool.js';
import { runMigrations } from '../migrate.js';
import { runSeed } from '../seed.js';

const pool = createDataPool(loadDataDbConfig());
try {
  await runMigrations(pool);
  const results = await runSeed(pool);
  for (const r of results) console.log(`${r.table}: ${r.inserted} inserted, ${r.skipped} skipped (of ${r.total})`);
} finally {
  await pool.end();
}
