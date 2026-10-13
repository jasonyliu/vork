import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from './helpers.js';
import { runMigrations } from '@vork/data';
import { WakeRepository } from '../src/db/wake-repository.js';
import type { TaskRelations, Wake } from '../src/shared/types.js';

let pool: Pool;
let wakeRepo: WakeRepository;

// The dispatch sweep's SQL pool head — the gate assertions read the first
// ordered candidate (the task-turn gate halves are worker-side JS and are
// covered in worker.test.ts).
async function nextCandidate() {
  const candidates = await wakeRepo.findSelectionCandidates(0);
  return candidates[0] ?? null;
}

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  wakeRepo = new WakeRepository(pool);
});

function makeWake(overrides: Partial<Wake>): Wake {
  const now = Date.now();
  return {
    id: 'wake-1',
    task_key: 'tk-1',
    state_key: 'sk-1',
    project_id: 'proj-1',
    project_name: null,
    task_id: '42',
    task_type: 'spec',
    task_title: 'Wake',
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
    queue_attempts: 0,
    dispatch_attempts: 0,
    wake_attempts: 0,
    status: 'queued',
    create_time: now - 10_000,
    update_time: now - 10_000,
    ...overrides
  };
}

describe('Parent Task dispatch gate', () => {
  test('leaf wake (no task:parent label) passes the gate', async () => {
    await wakeRepo.create(makeWake({ task_labels: ['type:spec', 'priority:high'] }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('Parent wake with incomplete children is suspended', async () => {
    const relations: TaskRelations = { children: { total: 3, completed: 1 } };
    await wakeRepo.create(makeWake({
      task_labels: ['task:parent', 'type:project_draft'],
      task_relations: relations
    }));
    const result = await nextCandidate();
    expect(result).toBeNull();
  });

  test('Parent wake with all children completed passes the gate', async () => {
    const relations: TaskRelations = { children: { total: 3, completed: 3 } };
    await wakeRepo.create(makeWake({
      task_labels: ['task:parent'],
      task_relations: relations
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('Parent label with empty children (label-only) is suspended', async () => {
    const relations: TaskRelations = { children: { total: 0, completed: 0 } };
    await wakeRepo.create(makeWake({
      task_labels: ['task:parent'],
      task_relations: relations
    }));
    const result = await nextCandidate();
    expect(result).toBeNull();
  });

  test('Parent label with missing task_relations is suspended (defensive)', async () => {
    await wakeRepo.create(makeWake({
      task_labels: ['task:parent'],
      task_relations: null
    }));
    const result = await nextCandidate();
    expect(result).toBeNull();
  });

  test('Child wake (task:child label, no children entry) passes the gate', async () => {
    const relations: TaskRelations = { parent: { task_id: '10' } };
    await wakeRepo.create(makeWake({
      task_labels: ['task:child', 'type:spec'],
      task_relations: relations
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('updateTaskRelationsByTaskId updates all open wakes for a task', async () => {
    await wakeRepo.create(makeWake({
      id: 'wake-parent-1',
      task_labels: ['task:parent'],
      task_relations: { children: { total: 2, completed: 0 } }
    }));
    const updated = await wakeRepo.updateTaskRelationsByTaskId(
      'proj-1',
      '42',
      { children: { total: 2, completed: 2 } }
    );
    expect(updated).toBe(1);

    // Now the wake should pass the gate
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-parent-1');
    expect((result?.task_relations as TaskRelations | null)?.children?.completed).toBe(2);
  });

  test('findOpenGated returns task:parent and task:blocked open wakes only', async () => {
    await wakeRepo.create(makeWake({
      id: 'wake-leaf',
      task_id: '1',
      task_labels: ['type:spec']
    }));
    await wakeRepo.create(makeWake({
      id: 'wake-parent-a',
      task_id: '2',
      task_labels: ['task:parent'],
      task_relations: { children: { total: 1, completed: 0 } }
    }));
    await wakeRepo.create(makeWake({
      id: 'wake-parent-b',
      task_id: '3',
      task_labels: ['task:parent', 'priority:high'],
      task_relations: { children: { total: 5, completed: 3 } }
    }));
    await wakeRepo.create(makeWake({
      id: 'wake-blocked-a',
      task_id: '4',
      task_labels: ['task:blocked'],
      task_relations: { blocked_by: { total: 2, completed: 0 } }
    }));
    await wakeRepo.create(makeWake({
      id: 'wake-blocking-only',
      task_id: '5',
      task_labels: ['task:blocking'],
      task_relations: { blocking: { total: 1, completed: 0 } }
    }));
    const gated = await wakeRepo.findOpenGated();
    const ids = gated.map((p) => p.id).sort();
    expect(ids).toEqual(['wake-blocked-a', 'wake-parent-a', 'wake-parent-b']);
  });

  test('Blocked wake with incomplete blocked_by is suspended at the audit queue (Todo:Gated)', async () => {
    await wakeRepo.create(makeWake({
      task_audit: 'Gated',
      task_labels: ['task:blocked', 'type:spec'],
      task_relations: { blocked_by: { total: 2, completed: 1 } }
    }));
    expect(await nextCandidate()).toBeNull();
  });

  test('F3: owner-lane Init:Gated cue flows despite incomplete blockers', async () => {
    await wakeRepo.create(makeWake({
      task_status: 'Init',
      task_audit: 'Gated',
      task_labels: ['task:blocked', 'type:spec'],
      task_relations: { blocked_by: { total: 2, completed: 0 } }
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('F3: owner-lane Pending reclaim wake flows despite incomplete blockers', async () => {
    await wakeRepo.create(makeWake({
      task_status: 'Pending',
      task_audit: 'Revise',
      task_labels: ['task:blocked'],
      task_relations: { blocked_by: { total: 1, completed: 0 } }
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('Blocked wake with all blockers complete passes the gate', async () => {
    await wakeRepo.create(makeWake({
      task_labels: ['task:blocked'],
      task_relations: { blocked_by: { total: 3, completed: 3 } }
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('Blocked label with empty blocked_by (label-only) is suspended at the audit queue', async () => {
    await wakeRepo.create(makeWake({
      task_audit: 'Gated',
      task_labels: ['task:blocked'],
      task_relations: { blocked_by: { total: 0, completed: 0 } }
    }));
    expect(await nextCandidate()).toBeNull();
  });

  test('Blocked label with missing blocked_by entry is suspended at the audit queue (defensive)', async () => {
    await wakeRepo.create(makeWake({
      task_audit: 'Gated',
      task_labels: ['task:blocked'],
      task_relations: null
    }));
    expect(await nextCandidate()).toBeNull();
  });

  test('Blocking-only label does not gate dispatch', async () => {
    await wakeRepo.create(makeWake({
      task_labels: ['task:blocking', 'type:spec'],
      task_relations: { blocking: { total: 2, completed: 0 } }
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });

  test('Both Parent and Blocked: either incomplete summary suspends', async () => {
    await wakeRepo.create(makeWake({
      id: 'wake-parent-blocked-ok',
      task_id: '10',
      task_audit: 'Gated',
      task_labels: ['task:parent', 'task:blocked'],
      task_relations: {
        children:   { total: 1, completed: 1 },
        blocked_by: { total: 1, completed: 0 }  // incomplete blocked_by
      }
    }));
    expect(await nextCandidate()).toBeNull();

    await wakeRepo.create(makeWake({
      id: 'wake-parent-blocked-incomplete',
      task_id: '11',
      task_labels: ['task:parent', 'task:blocked'],
      task_relations: {
        children:   { total: 1, completed: 0 },  // incomplete children
        blocked_by: { total: 1, completed: 1 }
      }
    }));
    expect(await nextCandidate()).toBeNull();
  });

  test('Both Parent and Blocked: both complete passes the composite gate', async () => {
    await wakeRepo.create(makeWake({
      task_labels: ['task:parent', 'task:blocked'],
      task_relations: {
        children:   { total: 2, completed: 2 },
        blocked_by: { total: 1, completed: 1 }
      }
    }));
    const result = await nextCandidate();
    expect(result?.id).toBe('wake-1');
  });
});
