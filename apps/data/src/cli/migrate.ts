// Structure migrations, standalone (#35 ruling (b)): run as vork_owner —
// apps never migrate at startup. From an app's deployed directory (its .env in
// cwd): `npm run migrate` delegates here.
import { loadDataDbConfig } from '../env.js';
import { createDataPool } from '../pool.js';
import { runMigrations } from '../migrate.js';

const pool = createDataPool(loadDataDbConfig());
try {
  await runMigrations(pool);
  console.log('migrations applied');
} finally {
  await pool.end();
}
