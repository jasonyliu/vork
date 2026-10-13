/**
 * One-off dump script: emit replayable INSERT statements for the configuration
 * tables (`route`, `github_agent`, `github_repo_project`). Operational tables
 * (`wake`, `wake_route_lease`, events) regenerate naturally from system
 * operation — only the configuration needs preserving as a release baseline.
 *
 * Usage: `npx tsx src/scripts/dump-config-tables.ts > baseline.sql`
 */
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const pool = createPool(loadConfig());

function sqlEscape(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  return `'${String(v).replaceAll("'", "''")}'`;
}

async function dumpTable(table: string, columns: string[]) {
  const r = await pool.query(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY id`);
  console.log(`-- ${table}: ${r.rows.length} rows\n`);
  for (const row of r.rows) {
    const vals = columns.map((c) => sqlEscape(row[c]));
    console.log(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;`);
  }
  console.log();
}

console.log(`-- Wakery configuration baseline dump`);
console.log(`-- Generated: ${new Date().toISOString()}`);
console.log(`-- Restore order: 1) run migrations to create schema, 2) replay these INSERTs.`);
console.log(`-- Operational tables (wake, wake_route_lease, events) are NOT in this dump — they regenerate naturally.\n`);

await dumpTable('github_agent', [
  'id', 'github_login', 'github_node_id', 'agent_id', 'agent_name', 'role', 'status', 'create_time', 'update_time'
]);
await dumpTable('github_repo_project', [
  'id', 'repo_id', 'owner_id', 'owner_name', 'repo', 'project_id', 'project_title', 'status', 'create_time', 'update_time'
]);
await dumpTable('route', [
  'id', 'project_id', 'task_type', 'actor', 'session_key', 'agent_id', 'agent_name', 'delivery', 'max_run', 'status', 'create_time', 'update_time'
]);

await pool.end();
