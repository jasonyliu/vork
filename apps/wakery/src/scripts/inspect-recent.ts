import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const limit = Math.max(1, Number.parseInt(process.argv[2] ?? '20', 10) || 20);
const config = loadConfig();
const pool = createPool(config);

try {
  const result = await pool.query(
    `SELECT
       w.id AS wake_id,
       w.project_id,
       w.task_id,
       w.task_type,
       w.task_status,
       w.task_status_expected,
       w.task_audit,
       w.task_audit_expected,
       w.status AS wake_status,
       w.queue_attempts,
       w.dispatch_attempts,
       w.wake_attempts,
       w.create_time AS wake_create_time,
       r.id AS route_id,
       r.delivery,
       r.session_key,
       r.agent_id,
       l.id AS lease_id,
       l.status AS lease_status,
       l.activity_time AS lease_activity_time,
       l.update_time AS lease_update_time
     FROM wake w
     LEFT JOIN wake_route_lease l ON l.wake_id = w.id
     LEFT JOIN route r ON r.id = l.route_id
     ORDER BY w.create_time DESC
     LIMIT $1`,
    [limit]
  );

  console.log(JSON.stringify({ ok: true, limit, rows: result.rows }, null, 2));
} finally {
  await pool.end();
}
