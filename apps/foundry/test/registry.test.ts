import { describe, expect, it } from 'vitest';
import { runMigrations } from '@vork/data';
import { createTestPool } from '@vork/data/testing';
import { registerProject, type RegistryInput } from '../src/registry.js';
import type { ResolvedAgent } from '../src/types.js';

// Foundry's own DB layer: the register stage's writes against the real schema
// (pg-mem migrated by @vork/data — the lifecycle facility; these writes are
// foundry's runtime DML).

const CREW: ResolvedAgent[] = [
  { name: 'main', tokenPath: '/t/main.token', login: 'worker-login', nodeId: 'U_claw' },
  { name: 'heimdall', tokenPath: '/t/heimdall.token', login: 'auditor-login', nodeId: 'U_heimdall' },
  { name: 'sarge', tokenPath: '/t/sarge.token', login: 'worker-login', nodeId: 'U_claw' }
];
const VISOR: ResolvedAgent = { name: 'visor', tokenPath: '/t/visor.token', login: 'worker-login', nodeId: 'U_claw' };

function input(overrides: Partial<RegistryInput> = {}): RegistryInput {
  return {
    projectKey: 'sample_project',
    projectName: 'Sample Project',
    githubRepoId: 'R_sample',
    githubOwnerId: 'U_owner',
    githubOwnerName: 'owner-login',
    githubRepo: 'sample_project',
    githubProjectId: 'PVT_sample',
    githubProjectNumber: 7,
    githubProjectTitle: 'Sample Project',
    agents: CREW,
    specialists: [],
    ...overrides
  };
}

async function migrated() {
  const db = await createTestPool();
  await runMigrations(db);
  return db;
}

describe('registerProject', () => {
  it('writes the project row, the integration mapping, the crew identities, and the twelve crew-default routes', async () => {
    const db = await migrated();

    const outcome = await registerProject(db, input());
    expect(outcome.project).toBe('created');
    expect(outcome.mapping).toBe('created');
    expect(outcome.agents_created).toEqual(['main', 'heimdall', 'sarge']);
    expect(outcome.routes_created).toBe(12);
    expect(outcome.routes_existing).toBe(0);
    expect(outcome.routes_drift).toEqual([]);

    const project = await db.query(`SELECT * FROM project WHERE project = 'sample_project'`);
    expect(project.rows[0]).toMatchObject({ name: 'Sample Project', status: 'active' });
    const mapping = await db.query(`SELECT * FROM github_repo_project WHERE github_repo_id = 'R_sample'`);
    expect(mapping.rows[0]).toMatchObject({ project_id: project.rows[0].id, github_owner_name: 'owner-login', github_project_id: 'PVT_sample', github_project_number: 7 });
    const heimdall = await db.query(`SELECT * FROM github_agent WHERE agent_id = 'heimdall'`);
    expect(heimdall.rows[0]).toMatchObject({ github_login: 'auditor-login', role: 'auditor' });
    const sarge = await db.query(`SELECT * FROM github_agent WHERE agent_id = 'sarge'`);
    expect(sarge.rows[0]).toMatchObject({ github_login: 'worker-login', role: 'agent' });

    const routes = await db.query(`SELECT task_type, actor, agent_id, session_key, delivery, max_run FROM route WHERE project_id = $1 AND status = 'active'`, [project.rows[0].id]);
    expect(routes.rows).toHaveLength(12);
    expect(routes.rows.every((row: any) => row.delivery === 'run')).toBe(true);
    expect(routes.rows.filter((row: any) => row.actor === 'assignee' && row.task_type !== null).map((row: any) => row.agent_id)).toEqual(Array(9).fill('main'));
    expect(routes.rows.find((row: any) => row.actor === 'owner')).toMatchObject({ task_type: null, agent_id: 'sarge', session_key: 'agent:sarge:sample_project:task:run:[wake_route_lease_id]', max_run: 1 });
    expect(routes.rows.find((row: any) => row.actor === 'auditor')).toMatchObject({ task_type: null, agent_id: 'heimdall', max_run: 3 });
    expect(routes.rows.find((row: any) => row.actor === 'assignee' && row.task_type === null)).toMatchObject({ agent_id: 'main', session_key: 'agent:main:sample_project:all:run:[wake_route_lease_id]' });
  });

  it('adds one exact assignee route per specialist task and the specialist identity', async () => {
    const db = await migrated();
    const outcome = await registerProject(db, input({ agents: [...CREW, VISOR], specialists: [{ name: 'visor', tasks: ['coding', 'bug', 'project_integration'] }] }));
    expect(outcome.agents_created).toEqual(['main', 'heimdall', 'sarge', 'visor']);
    expect(outcome.routes_created).toBe(14); // 8 stage (integration claimed) + 3 wildcards + 3 specialist
    const visorRoutes = await db.query(`SELECT task_type, session_key FROM route WHERE agent_id = 'visor' ORDER BY task_type`);
    expect(visorRoutes.rows.map((row: any) => row.task_type)).toEqual(['bug', 'coding', 'project_integration']);
    expect(visorRoutes.rows[1].session_key).toBe('agent:visor:sample_project:coding:run:[wake_route_lease_id]');
    const integration = await db.query(`SELECT agent_id FROM route WHERE task_type = 'project_integration' AND actor = 'assignee'`);
    expect(integration.rows).toEqual([{ agent_id: 'visor' }]);
  });

  it('is idempotent — a re-run reports everything existing and writes nothing new', async () => {
    const db = await migrated();
    const first = await registerProject(db, input());
    const second = await registerProject(db, input());

    expect(second.project).toBe('existing');
    expect(second.project_id).toBe(first.project_id);
    expect(second.mapping).toBe('existing');
    expect(second.agents_existing).toEqual(['main', 'heimdall', 'sarge']);
    expect(second.agents_created).toEqual([]);
    expect(second.routes_created).toBe(0);
    expect(second.routes_existing).toBe(12);
    expect(second.routes_drift).toEqual([]);
    const projects = await db.query(`SELECT count(*)::int AS n FROM project`);
    expect(Number(projects.rows[0].n)).toBe(1);
    const routes = await db.query(`SELECT count(*)::int AS n FROM route`);
    expect(Number(routes.rows[0].n)).toBe(12);
  });

  it('records an ops-changed route as drift and leaves it standing', async () => {
    const db = await migrated();
    const first = await registerProject(db, input());
    await db.query(`UPDATE route SET agent_id = 'scribe', agent_name = 'Scribe' WHERE project_id = $1 AND task_type = 'project_review' AND actor = 'assignee'`, [first.project_id]);
    const second = await registerProject(db, input());
    expect(second.routes_existing).toBe(12);
    expect(second.routes_drift).toEqual([{ task_type: 'project_review', actor: 'assignee', agent_id: 'scribe' }]);
    const review = await db.query(`SELECT agent_id FROM route WHERE project_id = $1 AND task_type = 'project_review' AND actor = 'assignee'`, [first.project_id]);
    expect(review.rows).toEqual([{ agent_id: 'scribe' }]);
  });

  it('shares agent rows across projects — the platform-global identity set — while routes are per project', async () => {
    const db = await migrated();
    await registerProject(db, input());
    const other = await registerProject(db, input({ projectKey: 'otherproj', projectName: 'Other', githubRepoId: 'R_other', githubProjectId: 'PVT_other' }));
    expect(other.project).toBe('created');
    expect(other.agents_existing).toEqual(['main', 'heimdall', 'sarge']);
    expect(other.routes_created).toBe(12);
    const agents = await db.query(`SELECT count(*)::int AS n FROM github_agent WHERE agent_id = 'sarge'`);
    expect(Number(agents.rows[0].n)).toBe(1);
    const routes = await db.query(`SELECT count(*)::int AS n FROM route`);
    expect(Number(routes.rows[0].n)).toBe(24);
  });
});
