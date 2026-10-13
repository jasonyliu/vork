import { describe, expect, test, beforeEach } from 'vitest';
import { WakeRepository } from '../src/db/wake-repository.js';
import { RouteRepository } from '../src/db/route-repository.js';
import { LeaseRepository } from '../src/db/lease-repository.js';
import { GithubAgentRepository } from '../src/db/github-agent-repository.js';
import { runMigrations } from '@vork/data';
import { EventWriter } from '../src/events/writer.js';
import { DispatchWorker, type FieldSyncReader, type FieldSyncSnapshot } from '../src/worker/dispatch-worker.js';
import { makeStateKey } from '../src/shared/ids.js';
import { createTestPool, createTempDir } from './helpers.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

let pool: Pool;
let wakeRepo: WakeRepository;
let routeRepo: RouteRepository;
let leaseRepo: LeaseRepository;
let githubAgentRepo: GithubAgentRepository;

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  wakeRepo = new WakeRepository(pool);
  routeRepo = new RouteRepository(pool);
  leaseRepo = new LeaseRepository(pool);
  githubAgentRepo = new GithubAgentRepository(pool);
});

async function seedPending(opts: { queue_attempts?: number; expected_status?: string; expected_audit?: string; update_time?: number; owner_id?: string | null; owner_name?: string | null; task_branch?: string | null } = {}) {
  const now = opts.update_time ?? Date.now();
  await wakeRepo.create({
    id: 'wake-pending-1',
    task_key: 'tk-1', state_key: 'sk-1',
    project_id: 'proj-1', project_name: null,
    task_id: '8', task_type: 'spec',
    task_title: 'Pending wake', task_priority: 1,
    task_status: 'Todo',
    task_status_expected: opts.expected_status ?? 'Progress',
    task_audit: 'Approved',
    task_audit_expected: opts.expected_audit ?? null,
    task_labels: null,
    task_relations: null, task_branch: opts.task_branch ?? null,
    task_payload: null,
    assignee_id: 'agent-1', assignee_name: null,
    owner_id: opts.owner_id ?? null, owner_name: opts.owner_name ?? null,
    queue_attempts: opts.queue_attempts ?? 0,
    dispatch_attempts: 0,
    wake_attempts: 0,
    status: 'pending',
    create_time: now,
    update_time: now
  });
  return wakeRepo.findById('wake-pending-1');
}

async function seedAgents() {
  const now = Date.now();
  await githubAgentRepo.create({ id: 'am-1', github_login: 'worker-login', github_node_id: 'U_worker', agent_id: 'agent-main', agent_name: 'Main Agent', role: 'agent', status: 'active', create_time: now, update_time: now });
  await githubAgentRepo.create({ id: 'am-2', github_login: 'owner-login', github_node_id: 'U_owner', agent_id: 'principal', agent_name: 'Principal', role: 'principal', status: 'active', create_time: now, update_time: now });
}

function makeReader(snapshot: FieldSyncSnapshot | null): FieldSyncReader {
  return { readCurrentFields: async () => snapshot };
}

function makeWorker(reader: FieldSyncReader | undefined, opts?: { maxAttempts?: number; intervalMs?: number; eventDir?: string }) {
  return new DispatchWorker({
    wakeRepo, routeRepo, leaseRepo, githubAgentRepo,
    adapter: {
      renderTurn: async () => { throw new Error('should not dispatch'); },
      send: async () => { throw new Error('should not dispatch'); }
    },
    eventWriter: new EventWriter(opts?.eventDir ?? createTempDir()),
    fieldSyncReader: reader,
    pendingMaxAttempts: opts?.maxAttempts,
    pendingRetryIntervalMs: opts?.intervalMs ?? 0
  });
}

function readEventLog(dir: string): Array<Record<string, unknown>> {
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  );
}

describe('DispatchWorker.runFieldSyncSweep', () => {
  test('graduates pending wake to queued when upstream fields match expected', async () => {
    await seedPending({ expected_status: 'Progress', update_time: Date.now() - 1000 });

    const reader = makeReader({ task_status: 'Progress', task_audit: 'Approved' });
    const worker = makeWorker(reader, { intervalMs: 0 });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('queued');
    expect(wake?.task_status).toBe('Progress');
    expect(wake?.task_audit).toBe('Approved');
    expect(wake?.task_status_expected).toBeNull();
    expect(wake?.task_audit_expected).toBeNull();
  });

  test('graduation recomputes state_key from the resolved task fields', async () => {
    await seedPending({ expected_status: 'Progress', update_time: Date.now() - 1000 });
    const before = await wakeRepo.findById('wake-pending-1');

    const reader = makeReader({ task_status: 'Progress', task_audit: 'Approved' });
    const worker = makeWorker(reader, { intervalMs: 0 });

    await worker.runFieldSyncSweep();

    const after = await wakeRepo.findById('wake-pending-1');
    expect(after?.state_key).toBe(makeStateKey('proj-1', '8', 'Progress', 'Approved'));
    expect(after?.state_key).not.toBe(before?.state_key);
  });

  test('keeps pending wake pending and bumps queue_attempts when upstream still mismatches', async () => {
    await seedPending({ expected_status: 'Progress', update_time: Date.now() - 1000 });

    const reader = makeReader({ task_status: 'Todo', task_audit: 'Approved' });
    const worker = makeWorker(reader, { intervalMs: 0, maxAttempts: 3 });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('pending');
    expect(wake?.queue_attempts).toBe(1);
    expect(wake?.task_status_expected).toBe('Progress');
  });

  test('after max attempts wake stays pending and is excluded from future sweeps', async () => {
    await seedPending({ queue_attempts: 2, expected_status: 'Progress', update_time: Date.now() - 1000 });
    const reader = makeReader({ task_status: 'Todo', task_audit: 'Approved' });
    const worker = makeWorker(reader, { intervalMs: 0, maxAttempts: 3 });

    // Hits the cap on this run; queue_attempts goes 2 → 3.
    await worker.runFieldSyncSweep();
    let wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('pending');
    expect(wake?.queue_attempts).toBe(3);

    // Subsequent sweep must not bump further — capped rows are filtered out by the query.
    await worker.runFieldSyncSweep();
    wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.queue_attempts).toBe(3);
  });

  test('does not pick up pending rows whose update_time is younger than the retry interval', async () => {
    await seedPending({ update_time: Date.now() }); // fresh
    const reader = makeReader({ task_status: 'Progress', task_audit: 'Approved' });
    const worker = makeWorker(reader, { intervalMs: 60_000 });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('pending');
    expect(wake?.queue_attempts).toBe(0);
  });

  test('reader returning null is treated as transient: bumps update_time, does NOT burn an attempt', async () => {
    await seedPending({ queue_attempts: 1, expected_status: 'Progress', update_time: Date.now() - 1000 });
    const reader = makeReader(null);
    const worker = makeWorker(reader, { intervalMs: 0, maxAttempts: 3 });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('pending');
    expect(wake?.queue_attempts).toBe(1); // unchanged
    // update_time should be fresh (within 5s of now)
    expect(Date.now() - wake!.update_time).toBeLessThan(5000);
  });

  test('field-sync sweep is a no-op when no fieldSyncReader is wired', async () => {
    await seedPending({ update_time: Date.now() - 1000 });
    const worker = makeWorker(undefined, { intervalMs: 0 });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('pending');
    expect(wake?.queue_attempts).toBe(0);
  });
});

// Terminal-graduation gate (spec_wakery-dispatch-worker.md Stage 0;
// spec_wakery-conduction-chaining.md Stage 2): a hint-lagged terminal
// materializes its chain cue at graduation, so the sweep re-runs the owner
// identity rules there — no path dispatches a Principal-owned chain cue.
describe('DispatchWorker.runFieldSyncSweep — terminal graduation', () => {
  test('agent-owned lagged terminal graduates to queued and emits 1016 trigger=field_sync', async () => {
    await seedAgents();
    await seedPending({
      expected_status: 'Completed', update_time: Date.now() - 1000,
      owner_id: 'U_worker', owner_name: 'worker-login', task_branch: 'feature/wake-radar'
    });
    const eventDir = createTempDir();
    const worker = makeWorker(makeReader({ task_status: 'Completed', task_audit: 'Approved' }), { intervalMs: 0, eventDir });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('queued');
    expect(wake?.task_status).toBe('Completed');

    const events = readEventLog(eventDir);
    const cue = events.find((e) => e.event_code === 1016);
    expect(cue).toBeDefined();
    expect(cue?.trigger).toBe('field_sync');
    expect(cue?.task_branch).toBe('feature/wake-radar');
  });

  test('Principal-owned lagged terminal is suppressed: completed, 1009, never queued, no 1016', async () => {
    await seedAgents();
    await seedPending({
      expected_status: 'Completed', update_time: Date.now() - 1000,
      owner_id: 'U_owner', owner_name: 'owner-login'
    });
    const eventDir = createTempDir();
    const worker = makeWorker(makeReader({ task_status: 'Completed', task_audit: 'Approved' }), { intervalMs: 0, eventDir });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('completed');
    expect(wake?.task_status).toBe('Completed'); // row records the true terminal state

    const events = readEventLog(eventDir);
    const handled = events.find((e) => e.event_code === 1009);
    expect(handled).toBeDefined();
    expect(handled?.trigger).toBe('field_sync');
    expect(handled?.reason).toBe('identity_based');
    expect(events.find((e) => e.event_code === 1016)).toBeUndefined();

    // The suppressed cue must never be selectable by the dispatch sweep.
    expect(await wakeRepo.findSelectionCandidates(0)).toHaveLength(0);
  });

  test('unmapped-owner lagged terminal is suppressed with 1003 (mirrors the ingress drop)', async () => {
    await seedAgents();
    await seedPending({
      expected_status: 'Cancelled', update_time: Date.now() - 1000,
      owner_name: 'some-stranger'
    });
    const eventDir = createTempDir();
    const worker = makeWorker(makeReader({ task_status: 'Cancelled', task_audit: 'Approved' }), { intervalMs: 0, eventDir });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('completed');

    const events = readEventLog(eventDir);
    const drop = events.find((e) => e.event_code === 1003);
    expect(drop).toBeDefined();
    expect(drop?.trigger).toBe('field_sync');
    expect(events.find((e) => e.event_code === 1016)).toBeUndefined();
  });

  test('non-terminal graduation is untouched by the gate — no identity lookup consequences', async () => {
    // No github_agent rows seeded at all: a Progress graduation must not care.
    await seedPending({ expected_status: 'Progress', update_time: Date.now() - 1000, owner_name: 'owner-login' });
    const eventDir = createTempDir();
    const worker = makeWorker(makeReader({ task_status: 'Progress', task_audit: 'Approved' }), { intervalMs: 0, eventDir });

    await worker.runFieldSyncSweep();

    const wake = await wakeRepo.findById('wake-pending-1');
    expect(wake?.status).toBe('queued');
    const events = readEventLog(eventDir);
    expect(events.find((e) => e.event_code === 1016)).toBeUndefined();
    expect(events.find((e) => e.event_code === 1009)).toBeUndefined();
  });
});
