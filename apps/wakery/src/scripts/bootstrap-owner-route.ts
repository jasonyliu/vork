/**
 * One-off idempotent bootstrap that ensures the owner-lane route exists on
 * an already-seeded database.
 *
 * The fresh-DB path goes through `seed.ts`, which includes the owner-lane
 * route directly. This script exists for a live DB transition only: rows
 * seeded before `route.actor` existed are backfilled to `assignee`/`auditor`
 * by the migration, which cannot invent an owner-lane row out of thin air.
 * Running this script after `npm run migrate` adds the missing row exactly
 * once.
 *
 * Usage: tsx src/scripts/bootstrap-owner-route.ts <project_key>
 */
import { loadConfig } from '../config/env.js';
import { projectIdBySlug } from '@vork/data';
import { createPool } from '../db/pool.js';
import { RouteRepository } from '../db/route-repository.js';
import { mintId } from '../shared/ids.js';

const projectKey = process.argv[2];
if (!projectKey) {
  console.error('usage: tsx src/scripts/bootstrap-owner-route.ts <project_key>');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);
// platform-keyed: the route's project_id is project.id, resolved from the registry slug
const PROJECT_ID = await projectIdBySlug(pool, projectKey);
const routeRepo = new RouteRepository(pool);

const existing = await routeRepo.findActiveByActor(PROJECT_ID, null, 'owner');
if (existing) {
  console.log(`owner-lane route already exists for project ${PROJECT_ID}: ${existing.id}`);
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const route = await routeRepo.create({
  id: mintId('route'),
  project_id: PROJECT_ID,
  task_type: null,
  actor: 'owner',
  session_key: `agent:main:${projectKey}:task:run:[wake_route_lease_id]`,
  agent_id: 'main',
  agent_name: 'Main',
  delivery: 'run',
  max_run: 1,
  status: 'active',
  create_time: now,
  update_time: now
});
console.log(`created owner-lane route ${route.id} for project ${PROJECT_ID}`);

await pool.end();
