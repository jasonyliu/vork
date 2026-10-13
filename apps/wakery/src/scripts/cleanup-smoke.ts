import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const prefix = process.argv[2] ?? 'wakery/smoke-dispatch-flow/';
const apply = process.argv.includes('--apply');
const config = loadConfig();
const pool = createPool(config);

try {
  const wakes = await pool.query(`SELECT id FROM wake WHERE project_id LIKE $1`, [`${prefix}%`]);
  const routes = await pool.query(`SELECT id FROM route WHERE project_id LIKE $1`, [`${prefix}%`]);

  const summary = {
    ok: true,
    prefix,
    apply,
    wake_count: wakes.rowCount ?? 0,
    route_count: routes.rowCount ?? 0
  };

  if (!apply) {
    console.log(JSON.stringify({ ...summary, mode: 'dry-run' }, null, 2));
  } else {
    await pool.query('BEGIN');
    try {
      await pool.query(`DELETE FROM wake_route_lease WHERE wake_id IN (SELECT id FROM wake WHERE project_id LIKE $1)`, [`${prefix}%`]);
      await pool.query(`DELETE FROM wake WHERE project_id LIKE $1`, [`${prefix}%`]);
      await pool.query(`DELETE FROM route WHERE project_id LIKE $1`, [`${prefix}%`]);
      await pool.query('COMMIT');
      console.log(JSON.stringify({ ...summary, mode: 'applied' }, null, 2));
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await pool.end();
}
