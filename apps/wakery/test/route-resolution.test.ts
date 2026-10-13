import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, seedProject } from './helpers.js';
import { runMigrations } from '@vork/data';
import { RouteRepository } from '../src/db/route-repository.js';
import { WakeRepository } from '../src/db/wake-repository.js';
import type { Wake } from '../src/shared/types.js';

let pool: Pool;
let routeRepo: RouteRepository;
let wakeRepo: WakeRepository;

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  await seedProject(pool, 'proj-1');
  routeRepo = new RouteRepository(pool);
  wakeRepo = new WakeRepository(pool);
});

function wake(overrides: Partial<Wake>): Wake {
  const now = Date.now();
  return {
    id: 'wake-default',
    task_key: 'tk-default',
    state_key: 'sk-default',
    project_id: 'proj-1',
    project_name: null,
    task_id: 'task-default',
    task_title: 'Task',
    task_priority: 1,
    task_status: 'Todo',
    task_status_expected: null,
    task_audit: 'Approved',
    task_audit_expected: null,
    task_labels: null,
    task_relations: null, task_branch: null,
    task_payload: null,
    assignee_id: 'agent-1',
    assignee_name: null,
    owner_id: null,
    owner_name: null,
    task_type: 'implementation',
    queue_attempts: 0,
    dispatch_attempts: 0,
    wake_attempts: 0,
    status: 'queued',
    create_time: now,
    update_time: now,
    ...overrides
  };
}

describe('RouteRepository.resolveForWake', () => {
  test('prefers the most recently created matching active route', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-old', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'sess-old', agent_id: 'agent-1', agent_name: 'Agent 1', delivery: 'session', max_run: 1, status: 'active',
      create_time: now - 1000, update_time: now - 1000
    });
    await routeRepo.create({
      id: 'route-new', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'sess-new', agent_id: 'agent-1', agent_name: 'Agent 1', delivery: 'session', max_run: 1, status: 'active',
      create_time: now, update_time: now
    });

    const storedWake = await wakeRepo.create(wake({
      id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1', task_id: 'task-1', task_type: 'implementation', create_time: now, update_time: now
    }));

    const route = await routeRepo.resolveForWake(storedWake);
    expect(route?.id).toBe('route-new');
  });

  test('routes Todo Gated wakes to the Heimdall audit catch-all regardless of task type', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-main-catchall', project_id: 'proj-1', task_type: null, actor: 'assignee',
      session_key: 'agent:main:sample_project', agent_id: 'main', agent_name: 'Main', delivery: 'session', max_run: null, status: 'active',
      create_time: now, update_time: now
    });
    await routeRepo.create({
      id: 'route-visor-coding', project_id: 'proj-1', task_type: 'coding', actor: 'assignee',
      session_key: 'agent:visor:sample_project:coding', agent_id: 'visor', agent_name: 'Visor', delivery: 'session', max_run: null, status: 'active',
      create_time: now + 1, update_time: now + 1
    });
    await routeRepo.create({
      id: 'route-heimdall-audit', project_id: 'proj-1', task_type: null, actor: 'auditor',
      session_key: 'agent:heimdall:sample_project:run:[wake_route_lease_id]', agent_id: 'heimdall', agent_name: 'Heimdall', delivery: 'run', max_run: 1, status: 'active',
      create_time: now + 2, update_time: now + 2
    });

    const storedWake = await wakeRepo.create(wake({
      id: 'wake-audit', task_key: 'tk-audit', state_key: 'sk-audit', task_id: 'task-audit', task_type: 'coding', task_status: 'Todo', task_audit: 'Gated'
    }));

    const route = await routeRepo.resolveForWake(storedWake);
    expect(route?.id).toBe('route-heimdall-audit');
  });

  test('uses exact specialist routes for non-auditor wakes before project catch-all', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-main-catchall', project_id: 'proj-1', task_type: null, actor: 'assignee',
      session_key: 'agent:main:sample_project', agent_id: 'main', agent_name: 'Main', delivery: 'session', max_run: null, status: 'active',
      create_time: now, update_time: now
    });
    await routeRepo.create({
      id: 'route-visor-coding', project_id: 'proj-1', task_type: 'coding', actor: 'assignee',
      session_key: 'agent:visor:sample_project:coding', agent_id: 'visor', agent_name: 'Visor', delivery: 'session', max_run: null, status: 'active',
      create_time: now + 1, update_time: now + 1
    });
    await routeRepo.create({
      id: 'route-heimdall-audit', project_id: 'proj-1', task_type: null, actor: 'auditor',
      session_key: 'agent:heimdall:sample_project:run:[wake_route_lease_id]', agent_id: 'heimdall', agent_name: 'Heimdall', delivery: 'run', max_run: 1, status: 'active',
      create_time: now + 2, update_time: now + 2
    });

    const storedWake = await wakeRepo.create(wake({
      id: 'wake-coding', task_key: 'tk-coding', state_key: 'sk-coding', task_id: 'task-coding', task_type: 'coding', task_status: 'Todo', task_audit: 'Approved'
    }));

    const route = await routeRepo.resolveForWake(storedWake);
    expect(route?.id).toBe('route-visor-coding');
  });

  test('owner-lane wake routes to the actor=owner route, not the actor=assignee route, even when the same agent owns both routes', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-spec-assignee', project_id: 'proj-1', task_type: 'spec', actor: 'assignee',
      session_key: 'agent:main:proj:spec', agent_id: 'main', agent_name: 'Main', delivery: 'session', max_run: null, status: 'active',
      create_time: now, update_time: now
    });
    await routeRepo.create({
      id: 'route-owner-run', project_id: 'proj-1', task_type: null, actor: 'owner',
      session_key: 'agent:main:proj:task:run:[wake_route_lease_id]', agent_id: 'main', agent_name: 'Main', delivery: 'run', max_run: 1, status: 'active',
      create_time: now + 1, update_time: now + 1
    });

    // Pending+Approved is the Owner reclaim wake per the eligibility matrix.
    const storedWake = await wakeRepo.create(wake({
      id: 'wake-pending-approved', task_key: 'tk-pa', state_key: 'sk-pa', task_id: 'task-pa', task_type: 'spec', task_status: 'Pending', task_audit: 'Approved'
    }));

    const route = await routeRepo.resolveForWake(storedWake);
    expect(route?.id).toBe('route-owner-run');
    expect(route?.actor).toBe('owner');
    expect(route?.delivery).toBe('run');
  });

  test('actor lanes resolve independently — assignee wake never picks an owner-lane route', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-owner-catchall', project_id: 'proj-1', task_type: null, actor: 'owner',
      session_key: 'agent:main:proj:task:run:[wake_route_lease_id]', agent_id: 'main', agent_name: 'Main', delivery: 'run', max_run: 1, status: 'active',
      create_time: now, update_time: now
    });
    // No assignee route configured for this project/task_type — assignee wakes should park.

    const storedWake = await wakeRepo.create(wake({
      id: 'wake-todo-approved', task_key: 'tk-ta', state_key: 'sk-ta', task_id: 'task-ta', task_type: 'spec', task_status: 'Todo', task_audit: 'Approved'
    }));

    const route = await routeRepo.resolveForWake(storedWake);
    expect(route).toBeNull();
  });

  test('a Govern cue wake resolves the owner-lane route (Principal cue → Owner lane carve-out)', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-assignee-coding', project_id: 'proj-1', task_type: 'coding', actor: 'assignee',
      session_key: 'agent:visor:sample_project:coding', agent_id: 'visor', agent_name: 'Visor', delivery: 'session', max_run: null, status: 'active',
      create_time: now, update_time: now
    });
    await routeRepo.create({
      id: 'route-owner-run', project_id: 'proj-1', task_type: null, actor: 'owner',
      session_key: 'agent:main:proj:task:run:[wake_route_lease_id]', agent_id: 'main', agent_name: 'Main', delivery: 'run', max_run: 1, status: 'active',
      create_time: now + 1, update_time: now + 1
    });

    for (const [id, status] of [['wake-todo-govern', 'Todo'], ['wake-done-govern', 'Done']] as const) {
      const storedWake = await wakeRepo.create(wake({
        id, task_key: `tk-${id}`, state_key: `sk-${id}`, task_id: `task-${id}`,
        task_type: 'coding', task_status: status, task_audit: 'Govern'
      }));
      const route = await routeRepo.resolveForWake(storedWake);
      expect(route?.id, `${status}:Govern`).toBe('route-owner-run');
      expect(route?.actor).toBe('owner');
    }
  });

  test('uses the non-auditor project catch-all instead of Heimdall for unmatched non-auditor wakes', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-main-catchall', project_id: 'proj-1', task_type: null, actor: 'assignee',
      session_key: 'agent:main:sample_project', agent_id: 'main', agent_name: 'Main', delivery: 'session', max_run: null, status: 'active',
      create_time: now, update_time: now
    });
    await routeRepo.create({
      id: 'route-heimdall-audit', project_id: 'proj-1', task_type: null, actor: 'auditor',
      session_key: 'agent:heimdall:sample_project:run:[wake_route_lease_id]', agent_id: 'heimdall', agent_name: 'Heimdall', delivery: 'run', max_run: 1, status: 'active',
      create_time: now + 1, update_time: now + 1
    });

    const storedWake = await wakeRepo.create(wake({
      id: 'wake-spec', task_key: 'tk-spec', state_key: 'sk-spec', task_id: 'task-spec', task_type: 'spec', task_status: 'Todo', task_audit: 'Approved'
    }));

    const route = await routeRepo.resolveForWake(storedWake);
    expect(route?.id).toBe('route-main-catchall');
  });
});
