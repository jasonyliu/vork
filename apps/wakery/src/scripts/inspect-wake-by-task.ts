import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const taskId = process.argv[2];
if (!taskId) {
  console.error('usage: tsx src/scripts/inspect-wake-by-task.ts <task_id>');
  process.exit(1);
}

const pool = createPool(loadConfig());
const r = await pool.query(
  `SELECT id, task_id, task_status, task_audit, status, task_labels, task_relations, create_time, update_time
     FROM wake WHERE task_id = $1 ORDER BY create_time DESC LIMIT 5`,
  [taskId]
);
for (const w of r.rows) {
  console.log(`${w.id}`);
  console.log(`  state=${w.task_status}+${w.task_audit}  status=${w.status}`);
  console.log(`  task_labels=${JSON.stringify(w.task_labels)}`);
  console.log(`  task_relations=${JSON.stringify(w.task_relations)}`);
  console.log(`  created=${new Date(Number(w.create_time)).toISOString()}`);
  console.log(`  updated=${new Date(Number(w.update_time)).toISOString()}`);
  console.log();
}
await pool.end();
