/**
 * One-off idempotent bootstrap that ensures the assignee-lane `coding` route
 * exists for a project.
 *
 * Implementation tasks carry the `type:coding` label. Without an explicit
 * `(project_id, task_type='coding', actor='assignee')` route, dispatch falls
 * back to the `task_type IS NULL` assignee route — which works, but doesn't
 * surface the intended lane for coding work and makes a future swap to a
 * dedicated coding agent (Visor) harder to reason about.
 *
 * Session-key choice: targets the AI Lead's spec session. When a dedicated
 * coding agent is brought online, this route's `session_key` and
 * `agent_id`/`agent_name` are updated in place (or the route disabled and a
 * new one created targeting that agent's coding session). The route exists so
 * the swap is a config change, not a schema change.
 *
 * Usage: tsx src/scripts/bootstrap-assignee-coding-route.ts <project_key>
 */
import { loadConfig } from '../config/env.js';
import { projectIdBySlug } from '@vork/data';
import { createPool } from '../db/pool.js';
import { RouteRepository } from '../db/route-repository.js';
import { mintId } from '../shared/ids.js';

const projectKey = process.argv[2];
if (!projectKey) {
  console.error('usage: tsx src/scripts/bootstrap-assignee-coding-route.ts <project_key>');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);
// platform-keyed: the route's project_id is project.id, resolved from the registry slug
const PROJECT_ID = await projectIdBySlug(pool, projectKey);
const routeRepo = new RouteRepository(pool);

const existing = await routeRepo.findActiveByActor(PROJECT_ID, 'coding', 'assignee');
if (existing) {
  console.log(`assignee/coding route already exists for project ${PROJECT_ID}: ${existing.id}`);
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const route = await routeRepo.create({
  id: mintId('route'),
  project_id: PROJECT_ID,
  task_type: 'coding',
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
console.log(`created assignee/coding route ${route.id} for project ${PROJECT_ID}`);

await pool.end();
