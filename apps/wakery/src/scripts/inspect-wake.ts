import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const wakeIdArg = process.argv[2];
if (!wakeIdArg) {
  console.error('usage: tsx src/scripts/inspect-wake.ts <wake_id_or_fragment>');
  process.exit(1);
}

const pool = createPool(loadConfig());

const wake = await pool.query(
  `SELECT id, task_id, task_type, task_title, task_status, task_audit, status,
          dispatch_attempts, wake_attempts, create_time, update_time
     FROM wake
    WHERE id = $1 OR id LIKE $2
    ORDER BY create_time DESC
    LIMIT 1`,
  [wakeIdArg, `%${wakeIdArg}%`]
);
console.log('--- wake ---');
if (!wake.rows[0]) {
  console.log('  (no row matched)');
  await pool.end();
  process.exit(0);
}
const w = wake.rows[0];
const wakeAgeMin = Math.round((Date.now() - Number(w.create_time)) / 60000);
console.log(`  id:                ${w.id}`);
console.log(`  task_id:           ${w.task_id}  (task_type=${w.task_type})`);
console.log(`  task_title:        ${w.task_title}`);
console.log(`  state:             status=${w.status}  task_status=${w.task_status}  task_audit=${w.task_audit}`);
console.log(`  dispatch_attempts: ${w.dispatch_attempts}  wake_attempts: ${w.wake_attempts}`);
console.log(`  create_time:       ${new Date(Number(w.create_time)).toISOString()} (${wakeAgeMin}m ago)`);
console.log(`  update_time:       ${new Date(Number(w.update_time)).toISOString()}`);

const lease = await pool.query(
  `SELECT id, route_id, wake_id, wake_task_status, status, activity_time, create_time, update_time
     FROM wake_route_lease
    WHERE wake_id = $1
    ORDER BY create_time DESC
    LIMIT 5`,
  [w.id]
);
console.log('\n--- leases ---');
for (const r of lease.rows) {
  const ageMin = Math.round((Date.now() - Number(r.create_time)) / 60000);
  const updMin = Math.round((Date.now() - Number(r.update_time)) / 60000);
  console.log(`  ${r.id}`);
  const actMin = Math.round((Date.now() - Number(r.activity_time)) / 60000);
  console.log(`    status=${r.status}  activity ${actMin}m ago`);
  console.log(`    created ${ageMin}m ago, updated ${updMin}m ago`);
}

await pool.end();
