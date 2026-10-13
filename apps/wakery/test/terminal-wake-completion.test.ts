// Terminal-ack protocol (a sibling project's #33/#34; spec_wakery-conduction-chaining.md):
// the chain consumer closes the predecessor issue as its final act, after the
// chained work is done. Under the two-ledger rule
// (milestone_wakery-turn-signal_v2026.07.29) the close completes the closed
// task's open WAKE only — the cue turn's lease completes at its own turn end
// via the dispatch worker's watcher/reconcile, never here. The lost-close
// backstop is the dispatch worker's terminal verifier (worker.test.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, createTempDir, seedProject } from './helpers.js';
import { runMigrations } from '@vork/data';
import { WakeRepository } from '../src/db/wake-repository.js';
import { RouteRepository } from '../src/db/route-repository.js';
import { LeaseRepository } from '../src/db/lease-repository.js';
import { handleIssuesEvent } from '../src/adapters/github/webhook-handlers.js';
import { makeTaskKey } from '../src/shared/ids.js';
import { EventWriter } from '../src/events/writer.js';
import type { Wake } from '../src/shared/types.js';

let pool: Pool;
let wakeRepo: WakeRepository;
let routeRepo: RouteRepository;
let leaseRepo: LeaseRepository;

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  await seedProject(pool, 'proj-1');
  wakeRepo = new WakeRepository(pool);
  routeRepo = new RouteRepository(pool);
  leaseRepo = new LeaseRepository(pool);
});

async function createWake(overrides: Partial<Wake> = {}) {
  return wakeRepo.create({
    id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1',
    project_id: 'proj-1', project_name: null,
    task_id: 'task-1', task_title: 'Task', task_priority: 10,
    task_status: 'Cancelled', task_status_expected: null,
    task_audit: 'Revise', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: null, task_payload: null,
    assignee_id: 'agent-1', assignee_name: null, owner_id: 'agent-1', owner_name: null,
    task_type: 'implementation',
    queue_attempts: 0, dispatch_attempts: 0, wake_attempts: 0, status: 'queued',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  });
}

async function seedOwnerRunRoute() {
  return routeRepo.create({
    id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'owner',
    session_key: 'agent:sarge:proj:task:run:[wake_route_lease_id]',
    agent_id: 'agent-1', agent_name: 'Agent 1',
    delivery: 'run', max_run: 1, status: 'active',
    create_time: Date.now(), update_time: Date.now()
  });
}

describe('issues.closed terminal-ack completion (wake ledger only)', () => {
  const PROJECT_ID = 'proj-1';
  const REPO_NODE_ID = 'R_repo1';

  // The handler's later relations refresh calls fetchIssueState — keep the
  // suite off the network; a not-ok response makes it return early after the
  // ack completion (which deliberately runs before the fetch).
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => ({ ok: false }) as Response);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function payloadFor(issueNumber: number) {
    return { repository: { node_id: REPO_NODE_ID }, issue: { number: issueNumber } };
  }

  function stubDeps() {
    return {
      githubToken: '',
      githubRepoProjectRepo: {
        findByRepoId: async (repoId: string) =>
          repoId === REPO_NODE_ID
            ? { id: 'rp-1', repo_id: REPO_NODE_ID, owner_name: 'owner', repo: 'repo', project_id: PROJECT_ID }
            : null
      } as any,
      refresher: { refreshTask: async () => {} } as any,
      wakeRepo,
      eventWriter: new EventWriter(createTempDir())
    };
  }

  test('a DISPATCHED terminal cue completes on the close — the chain ack; its open lease is NOT touched', async () => {
    await seedOwnerRunRoute();
    const tk = makeTaskKey(PROJECT_ID, '6');
    const wake = await createWake({ task_key: tk, task_id: '6', status: 'dispatched', dispatch_attempts: 1, wake_attempts: 1 });
    await leaseRepo.create({
      id: 'lease-cue-turn', route_id: 'route-1', wake_id: wake.id,
      wake_task_status: 'Cancelled', task_key: tk, activity_time: Date.now(),
      status: 'active', create_time: Date.now(), update_time: Date.now()
    });

    await handleIssuesEvent(payloadFor(6), 'closed', stubDeps());

    expect((await wakeRepo.findById(wake.id))?.status).toBe('completed');
    // Two-ledger rule: the cue turn's lease still belongs to the dispatch
    // worker and completes at its own turn end.
    expect((await leaseRepo.findLatestByWakeId(wake.id))?.status).toBe('active');
  });

  test('a QUEUED terminal cue survives an early close — it must reach its consumer first', async () => {
    const tk = makeTaskKey(PROJECT_ID, '8');
    const wake = await createWake({ task_key: tk, task_id: '8', status: 'queued' });

    await handleIssuesEvent(payloadFor(8), 'closed', stubDeps());

    expect((await wakeRepo.findById(wake.id))?.status).toBe('queued');
  });

  test('an open NON-terminal wake (straggler — lost transition comment) completes; leases untouched', async () => {
    await seedOwnerRunRoute();
    const tk = makeTaskKey(PROJECT_ID, '7');
    const wake = await createWake({ task_key: tk, task_id: '7', task_status: 'Todo', task_audit: 'Revise', status: 'dispatched' });
    await leaseRepo.create({
      id: 'lease-straggler-turn', route_id: 'route-1', wake_id: wake.id,
      wake_task_status: 'Todo', task_key: tk, activity_time: Date.now(),
      status: 'active', create_time: Date.now(), update_time: Date.now()
    });

    await handleIssuesEvent(payloadFor(7), 'closed', stubDeps());

    expect((await wakeRepo.findById(wake.id))?.status).toBe('completed');
    expect((await leaseRepo.findLatestByWakeId(wake.id))?.status).toBe('active');
  });

  test('a queued NON-terminal straggler also completes — a closed task has nothing left to dispatch', async () => {
    const tk = makeTaskKey(PROJECT_ID, '10');
    const wake = await createWake({ task_key: tk, task_id: '10', task_status: 'Progress', task_audit: 'Gated', status: 'queued' });

    await handleIssuesEvent(payloadFor(10), 'closed', stubDeps());

    expect((await wakeRepo.findById(wake.id))?.status).toBe('completed');
  });

  test('reopened performs no completion', async () => {
    const tk = makeTaskKey(PROJECT_ID, '9');
    const wake = await createWake({ task_key: tk, task_id: '9', task_status: 'Todo', task_audit: 'Revise', status: 'dispatched' });

    await handleIssuesEvent(payloadFor(9), 'reopened', stubDeps());

    expect((await wakeRepo.findById(wake.id))?.status).toBe('dispatched');
  });
});
