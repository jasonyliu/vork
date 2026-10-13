import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';
import { ROUTE_SEED, TASK_TYPE_LABEL_SEED, seedProjects, seedRoutes } from '../src/seed.js';
import { CREW, LEASE_TOKEN, STAGE_TASK_TYPES, TASK_TYPES, routeTemplate } from '../src/routes.js';
import { createTestPool } from '../src/testing.js';

// The route template (spec_database.md §2 Route provisioning) and the platform
// seed expressed through it.

function key(row: { task_type: string | null; actor: string }): string {
  return `${row.task_type ?? '*'}/${row.actor}`;
}

describe('routeTemplate', () => {
  it('yields twelve rows crew-only: nine stage types + three wildcards, all run delivery', () => {
    const rows = routeTemplate('sample_project');
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.delivery === 'run')).toBe(true);
    expect(rows.every((row) => row.session_key.endsWith(`:run:${LEASE_TOKEN}`))).toBe(true);
    for (const stage of STAGE_TASK_TYPES) {
      const row = rows.find((candidate) => candidate.task_type === stage && candidate.actor === 'assignee')!;
      expect(row.agent_id).toBe(CREW.ai_lead);
      expect(row.session_key).toBe(`agent:main:sample_project:stage:run:${LEASE_TOKEN}`);
    }
    expect(rows.find((row) => row.task_type === null && row.actor === 'assignee')).toMatchObject({ agent_id: 'main', session_key: `agent:main:sample_project:all:run:${LEASE_TOKEN}`, max_run: 1 });
    expect(rows.find((row) => row.task_type === null && row.actor === 'auditor')).toMatchObject({ agent_id: 'heimdall', session_key: `agent:heimdall:sample_project:audit:run:${LEASE_TOKEN}`, max_run: 3 });
    expect(rows.find((row) => row.task_type === null && row.actor === 'owner')).toMatchObject({ agent_id: 'sarge', session_key: `agent:sarge:sample_project:task:run:${LEASE_TOKEN}`, max_run: 1 });
    // one active route per (task_type, actor)
    expect(new Set(rows.map(key)).size).toBe(rows.length);
  });

  it('adds one exact assignee route per specialist task, lane = the task type', () => {
    const rows = routeTemplate('sample_project', [{ name: 'visor', tasks: ['coding', 'bug'] }]);
    expect(rows).toHaveLength(14);
    expect(rows.find((row) => row.task_type === 'coding')).toMatchObject({ actor: 'assignee', agent_id: 'visor', agent_name: 'Visor', session_key: `agent:visor:sample_project:coding:run:${LEASE_TOKEN}` });
    expect(rows.find((row) => row.task_type === 'bug')?.session_key).toBe(`agent:visor:sample_project:bug:run:${LEASE_TOKEN}`);
  });

  it("a specialist's claim on a stage type replaces the AI Lead's row for that type", () => {
    const rows = routeTemplate('sample_project', [{ name: 'visor', tasks: ['project_integration'] }]);
    expect(rows).toHaveLength(12);
    const integration = rows.filter((row) => row.task_type === 'project_integration');
    expect(integration).toHaveLength(1);
    expect(integration[0]!.agent_id).toBe('visor');
  });

  it('rejects crew names, duplicates, empty task lists, unknown types, and overlapping claims', () => {
    expect(() => routeTemplate('t', [{ name: 'main', tasks: ['coding'] }])).toThrow(/crew agent/);
    expect(() => routeTemplate('t', [{ name: 'visor', tasks: ['coding'] }, { name: 'visor', tasks: ['bug'] }])).toThrow(/listed twice/);
    expect(() => routeTemplate('t', [{ name: 'visor', tasks: [] }])).toThrow(/no tasks/);
    expect(() => routeTemplate('t', [{ name: 'visor', tasks: ['painting'] }])).toThrow(/unknown task type/);
    expect(() => routeTemplate('t', [{ name: 'visor', tasks: ['coding'] }, { name: 'scribe', tasks: ['coding'] }])).toThrow(/claimed by both/);
  });

  it('pins the task-type constant to the task_type_label seed', () => {
    expect(new Set(TASK_TYPE_LABEL_SEED.map((row) => row.type_value))).toEqual(new Set(TASK_TYPES));
    expect(TASK_TYPES).toHaveLength(17);
  });
});

describe('platform route seed', () => {
  it('is the template applied to the platform project and seeds idempotently on (project, task_type, actor)', async () => {
    expect(ROUTE_SEED.every((row) => row.project === 'vork')).toBe(true);
    expect(ROUTE_SEED.filter((row) => row.agent_id === 'visor').map((row) => row.task_type).sort()).toEqual(['bug', 'coding', 'dbops', 'defect', 'enhancement']);

    const pool = await createTestPool();
    await runMigrations(pool);
    await seedProjects(pool);
    const first = await seedRoutes(pool);
    expect(first.inserted).toBe(ROUTE_SEED.length);
    const second = await seedRoutes(pool);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(ROUTE_SEED.length);
  });

  it('leaves a hand-shaped existing row standing — live lanes are ops state', async () => {
    const pool = await createTestPool();
    await runMigrations(pool);
    await seedProjects(pool);
    const project = await pool.query(`SELECT id FROM project WHERE project='vork'`);
    const projectId = project.rows[0].id as string;
    await pool.query(
      `INSERT INTO route (id, project_id, task_type, actor, session_key, agent_id, agent_name, delivery, max_run, status, create_time, update_time)
       VALUES ('route_hand', $1, 'coding', 'assignee', 'agent:visor:vork:coding:run:[wake_route_lease_id]', 'visor', 'Visor', 'run', 1, 'active', 1, 1)`,
      [projectId]
    );
    const result = await seedRoutes(pool);
    expect(result.inserted).toBe(ROUTE_SEED.length - 1);
    const coding = await pool.query(`SELECT id, session_key FROM route WHERE project_id=$1 AND task_type='coding' AND actor='assignee'`, [projectId]);
    expect(coding.rows).toHaveLength(1);
    expect(coding.rows[0].id).toBe('route_hand');
  });
});
