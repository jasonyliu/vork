/**
 * One-off idempotent bootstrap that ensures the assignee-lane fallback route
 * exists for a project.
 *
 * The fresh-DB path goes through `seed.ts`. This script exists for a live DB
 * transition only: where the assignee-lane fallback route is missing, any
 * task_type with actor=assignee that has no exact route (e.g. `coding`,
 * `spec`, `bug`, `enhancement`) parks for lack of a match.
 *
 * Session-key choice diverges from `seed.ts`'s bare AI Lead session target:
 * it points at the AI Lead's spec session, so dispatches land in the session
 * that drives the spec work. A future split into a dedicated coding session
 * (or a dedicated coding agent) can update this route's `session_key` without
 * schema changes.
 *
 * Usage: tsx src/scripts/bootstrap-assignee-fallback-route.ts <project_key>
 */
import { loadConfig } from '../config/env.js';
import { projectIdBySlug } from '@vork/data';
import { createPool } from '../db/pool.js';
import { RouteRepository } from '../db/route-repository.js';
import { mintId } from '../shared/ids.js';

const projectKey = process.argv[2];
if (!projectKey) {
  console.error('usage: tsx src/scripts/bootstrap-assignee-fallback-route.ts <project_key>');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);
// platform-keyed: the route's project_id is project.id, resolved from the registry slug
const PROJECT_ID = await projectIdBySlug(pool, projectKey);
const routeRepo = new RouteRepository(pool);

const existing = await routeRepo.findActiveByActor(PROJECT_ID, null, 'assignee');
if (existing) {
  console.log(`assignee-lane fallback route already exists for project ${PROJECT_ID}: ${existing.id}`);
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const route = await routeRepo.create({
  id: mintId('route'),
  project_id: PROJECT_ID,
  task_type: null,
  actor: 'assignee',
  session_key: `agent:main:${projectKey}:spec`,
  agent_id: 'main',
  agent_name: 'Main',
  delivery: 'session',
  max_run: null,
  status: 'active',
  create_time: now,
  update_time: now
});
console.log(`created assignee-lane fallback route ${route.id} for project ${PROJECT_ID}`);

await pool.end();
