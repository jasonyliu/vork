import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const pool = createPool(loadConfig());

const cols = await pool.query(
  `SELECT column_name, data_type, is_nullable, ordinal_position
     FROM information_schema.columns
    WHERE table_name = 'route'
    ORDER BY ordinal_position`
);
console.log('--- route columns (current physical order) ---');
for (const r of cols.rows) {
  console.log(`  ${String(r.ordinal_position).padStart(2)}  ${r.column_name.padEnd(20)} ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
}

const rows = await pool.query(
  `SELECT id, project_id, task_type, actor, agent_id, agent_name, session_key, delivery, max_run, status
     FROM route
    ORDER BY project_id, actor, task_type NULLS LAST, create_time`
);
console.log('\n--- routes ---');
for (const r of rows.rows) {
  console.log(`  ${r.status === 'active' ? '●' : '○'} actor=${(r.actor ?? '?').padEnd(9)} task_type=${(r.task_type ?? '(null/fallback)').padEnd(22)} agent=${(r.agent_id ?? '?').padEnd(10)} delivery=${r.delivery.padEnd(8)} session_key=${r.session_key ?? '(null)'}  project=${r.project_id}`);
}

console.log(`\n(${rows.rowCount} routes total)`);
await pool.end();
