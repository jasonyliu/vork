import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

// Open wakes for a set of task ids, newest first per task — the quick look
// after a test transition. The ids are operator inputs.
const taskIds = process.argv.slice(2);
if (taskIds.length === 0) {
  console.error('usage: tsx src/scripts/inspect-test-wakes.ts <task_id> [<task_id> ...]');
  process.exit(1);
}

const pool = createPool(loadConfig());
const r = await pool.query(
  `SELECT id, task_id, task_status, task_audit, status, task_labels, task_relations, create_time
   FROM wake
   WHERE task_id = ANY($1) AND status IN ('queued','pending','parked','dispatched')
   ORDER BY task_id, create_time DESC`,
  [taskIds]
);
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();
