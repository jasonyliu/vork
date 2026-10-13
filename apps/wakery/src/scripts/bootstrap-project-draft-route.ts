/**
 * One-off idempotent bootstrap that adds an assignee-lane route for
 * `task_type = project_draft` pointing at the spec session.
 *
 * Without this row, project_draft Tasks fall through to the assignee wildcard
 * route, which directs them at the AI Lead's main session. Routing
 * project_draft Stage Tasks at the spec session keeps the project-management
 * work alongside the spec-authoring sessions it coordinates.
 *
 * Usage: tsx src/scripts/bootstrap-project-draft-route.ts <project_key>
 */
import { loadConfig } from '../config/env.js';
import { projectIdBySlug } from '@vork/data';
import { createPool } from '../db/pool.js';
import { RouteRepository } from '../db/route-repository.js';
import { mintId } from '../shared/ids.js';

const projectKey = process.argv[2];
if (!projectKey) {
  console.error('usage: tsx src/scripts/bootstrap-project-draft-route.ts <project_key>');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);
// platform-keyed: the route's project_id is project.id, resolved from the registry slug
const PROJECT_ID = await projectIdBySlug(pool, projectKey);
const routeRepo = new RouteRepository(pool);

const existing = await routeRepo.findActiveByActor(PROJECT_ID, 'project_draft', 'assignee');
if (existing) {
  console.log(`project_draft assignee route already exists for project ${PROJECT_ID}: ${existing.id}`);
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const route = await routeRepo.create({
  id: mintId('route'),
  project_id: PROJECT_ID,
  task_type: 'project_draft',
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
console.log(`created project_draft assignee route ${route.id} -> ${route.session_key}`);

await pool.end();
