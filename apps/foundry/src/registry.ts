import { readFileSync } from 'node:fs';
import pg from 'pg';
import { CREW, mintId, routeTemplate, type Queryable, type Specialist } from '@vork/data';
import { expandHome } from './config.js';
import { localError } from './errors.js';
import type { DatabaseConfig, ResolvedAgent } from './types.js';

// Foundry's own DB layer — the register stage's runtime DML, app-local the way
// wakery's repositories and resolver's queries are (`@vork/data` stays the
// schema-lifecycle facility and the home of the route template). A `project`
// row IS the project's creation (specs/data/spec_database.md §11): bootstrap
// writes the registry directly — the platform row, the GitHub integration
// mapping, the crew's and specialists' identity rows, and the project's route
// set — idempotently, as the `vork_app` seeding act (#35 role ruling).

export interface RegistryInput {
  projectKey: string;
  projectName: string;
  githubRepoId: string;
  githubOwnerId: string;
  githubOwnerName: string;
  githubRepo: string;
  githubProjectId: string;
  githubProjectNumber: number | null;
  githubProjectTitle: string;
  agents: ResolvedAgent[]; // crew ∪ specialists
  specialists: Specialist[];
}

export interface RouteDrift {
  task_type: string | null;
  actor: string;
  agent_id: string; // the agent the existing row is bound to
}

export interface RegistryOutcome {
  project_id: string;
  project: 'created' | 'existing';
  mapping: 'created' | 'existing';
  agents_created: string[];
  agents_existing: string[];
  routes_created: number;
  routes_existing: number;
  routes_drift: RouteDrift[];
}

export function openRegistryPool(config: DatabaseConfig): pg.Pool {
  const password = readFileSync(expandHome(config.password_path), 'utf8').trim();
  if (password === '') throw localError(`registry password file empty: ${config.password_path}`);
  return new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.name,
    user: config.user,
    password
  });
}

export async function pingRegistry(db: Queryable): Promise<void> {
  await db.query('SELECT 1 FROM project LIMIT 1');
}

export async function registerProject(db: Queryable, input: RegistryInput): Promise<RegistryOutcome> {
  const now = Date.now();

  // platform registry row — its existence is the project's creation
  const existingProject = await db.query(`SELECT id FROM project WHERE project = $1 LIMIT 1`, [input.projectKey]);
  let projectId: string;
  let projectOutcome: 'created' | 'existing';
  if (existingProject.rows.length > 0) {
    projectId = existingProject.rows[0].id as string;
    projectOutcome = 'existing';
  } else {
    projectId = mintId('prj');
    await db.query(
      `INSERT INTO project (id, project, name, status, create_time, update_time)
       VALUES ($1,$2,$3,'active',$4,$4)`,
      [projectId, input.projectKey, input.projectName, now]
    );
    projectOutcome = 'created';
  }

  // GitHub integration mapping — one repo per project, keyed by the immutable
  // repository node id
  const existingMapping = await db.query(`SELECT id FROM github_repo_project WHERE github_repo_id = $1 LIMIT 1`, [
    input.githubRepoId
  ]);
  let mappingOutcome: 'created' | 'existing';
  if (existingMapping.rows.length > 0) {
    mappingOutcome = 'existing';
  } else {
    await db.query(
      `INSERT INTO github_repo_project (id, project_id, github_repo_id, github_owner_id, github_owner_name, github_repo, github_project_id, github_project_number, github_project_title, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)`,
      [
        mintId('grp'),
        projectId,
        input.githubRepoId,
        input.githubOwnerId,
        input.githubOwnerName,
        input.githubRepo,
        input.githubProjectId,
        input.githubProjectNumber,
        input.githubProjectTitle,
        now
      ]
    );
    mappingOutcome = 'created';
  }

  // agent identities — platform-global rows keyed by agent_id (the agent name);
  // the shared work account means most rows already exist. The auditor's row
  // carries role `auditor`; the Principal's own row is platform seed, never
  // written here.
  const agentsCreated: string[] = [];
  const agentsExisting: string[] = [];
  for (const agent of input.agents) {
    const existing = await db.query(`SELECT 1 FROM github_agent WHERE agent_id = $1 LIMIT 1`, [agent.name]);
    if (existing.rows.length > 0) {
      agentsExisting.push(agent.name);
      continue;
    }
    const role = agent.name === CREW.auditor ? 'auditor' : 'agent';
    await db.query(
      `INSERT INTO github_agent (id, github_login, github_node_id, agent_id, agent_name, role, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7)`,
      [mintId('ga'), agent.login, agent.nodeId, agent.name, agent.name, role, now]
    );
    agentsCreated.push(agent.name);
  }

  // routes — the template applied to this project (spec_database.md §2 Route
  // provisioning); one active route per (project_id, task_type, actor). An
  // existing row bound to another agent is ops state: recorded as drift,
  // never overridden.
  let routesCreated = 0;
  let routesExisting = 0;
  const routesDrift: RouteDrift[] = [];
  for (const row of routeTemplate(input.projectKey, input.specialists)) {
    const existing = row.task_type === null
      ? await db.query(`SELECT agent_id FROM route WHERE project_id = $1 AND task_type IS NULL AND actor = $2 AND status = 'active' LIMIT 1`, [projectId, row.actor])
      : await db.query(`SELECT agent_id FROM route WHERE project_id = $1 AND task_type = $2 AND actor = $3 AND status = 'active' LIMIT 1`, [projectId, row.task_type, row.actor]);
    if (existing.rows.length > 0) {
      routesExisting += 1;
      const boundTo = existing.rows[0].agent_id as string;
      if (boundTo !== row.agent_id) routesDrift.push({ task_type: row.task_type, actor: row.actor, agent_id: boundTo });
      continue;
    }
    await db.query(
      `INSERT INTO route (id, project_id, task_type, actor, session_key, agent_id, agent_name, delivery, max_run, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)`,
      [mintId('route'), projectId, row.task_type, row.actor, row.session_key, row.agent_id, row.agent_name, row.delivery, row.max_run, now]
    );
    routesCreated += 1;
  }

  return {
    project_id: projectId,
    project: projectOutcome,
    mapping: mappingOutcome,
    agents_created: agentsCreated,
    agents_existing: agentsExisting,
    routes_created: routesCreated,
    routes_existing: routesExisting,
    routes_drift: routesDrift
  };
}
