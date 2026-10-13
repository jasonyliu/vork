import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const pool = createPool(loadConfig());
const fragments = process.argv.slice(2);
if (fragments.length === 0) {
  console.error('usage: tsx src/scripts/resolve-wakes.ts <id_fragment> [<id_fragment> ...]');
  process.exit(1);
}
for (const f of fragments) {
  const r = await pool.query(
    `SELECT id, task_id, task_type, task_status, task_audit, create_time
       FROM wake WHERE id LIKE $1 ORDER BY create_time ASC`,
    [`%${f}%`]
  );
  for (const w of r.rows) {
    console.log(`${f}  task#${w.task_id}  type=${w.task_type}  state=${w.task_status}+${w.task_audit}  created=${new Date(Number(w.create_time)).toISOString().slice(11,19)}`);
  }
  if (r.rows.length === 0) console.log(`${f}  (not found)`);
}
await pool.end();
