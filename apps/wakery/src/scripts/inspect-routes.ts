import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const pool = createPool(loadConfig());
const r = await pool.query(`SELECT project_id, task_type, actor, agent_id, agent_name, delivery, session_key, max_run, status FROM route ORDER BY actor, task_type NULLS LAST`);
for (const row of r.rows) console.log(JSON.stringify(row));
await pool.end();
