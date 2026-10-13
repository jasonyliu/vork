import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const pool = createPool(loadConfig());

try {
  const db = await pool.query(`select current_database() as database, current_user as user`);
  const tables = await pool.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`);

  console.log(JSON.stringify({
    ok: true,
    database: db.rows[0]?.database,
    user: db.rows[0]?.user,
    tables: tables.rows.map((row) => row.tablename)
  }, null, 2));
} finally {
  await pool.end();
}
