import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestPool, createTempDir, seedProject } from './helpers.js';
import { runMigrations } from '@vork/data';
import { WakeRepository } from '../src/db/wake-repository.js';
import { RouteRepository } from '../src/db/route-repository.js';
import { LeaseRepository } from '../src/db/lease-repository.js';
import { GithubAgentRepository } from '../src/db/github-agent-repository.js';
import { DispatchWorker, type DispatchWorkerDeps, type TerminalVerifier } from '../src/worker/dispatch-worker.js';
import { RenderError, type RewakeRenderContext } from '../src/templates/renderer.js';
import { EventWriter } from '../src/events/writer.js';
import type { AgentWaitVerdict } from '../src/adapters/openclaw/link.js';
import type { Route, Wake, WakeRouteLease } from '../src/shared/types.js';

let pool: Pool;
let wakeRepo: WakeRepository;
let routeRepo: RouteRepository;
let leaseRepo: LeaseRepository;
let githubAgentRepo: GithubAgentRepository;
let sent: Array<{ wake: Wake; route: Route; lease: WakeRouteLease; message: string }>;
let rendered: Array<{ wakeId: string; template: 'wake' | 'rewake' | 'govern-notice'; ctx?: RewakeRenderContext }>;

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  await seedProject(pool, 'proj-1');
  wakeRepo = new WakeRepository(pool);
  routeRepo = new RouteRepository(pool);
  leaseRepo = new LeaseRepository(pool);
  githubAgentRepo = new GithubAgentRepository(pool);
  sent = [];
  rendered = [];
});

function makeAdapter(opts: { renderFailFor?: (wakeId: string) => boolean; sendFail?: () => boolean } = {}) {
  return {
    renderTurn: async (wake: Wake, _route: Route, ctx?: RewakeRenderContext) => {
      if (opts.renderFailFor?.(wake.id)) throw new RenderError(wake.id, ['github_agent']);
      // Mirrors the adapter's Stage 4 selection precedence (the real seam is
      // covered by openclaw-adapter.test.ts): Govern first, then rewake/wake.
      const template = wake.task_audit === 'Govern' ? 'govern-notice' as const : ctx ? 'rewake' as const : 'wake' as const;
      rendered.push({ wakeId: wake.id, template, ctx });
      return template === 'govern-notice' ? 'GOVERN-MSG' : ctx ? 'REWAKE-MSG' : 'WAKE-MSG';
    },
    send: async (routed: { wake: Wake; route: Route; lease: WakeRouteLease }, message: string) => {
      if (opts.sendFail?.()) throw new Error('gateway link down: cannot send chat.send');
      sent.push({ ...routed, message });
    }
  };
}

function makeWorker(overrides: Partial<DispatchWorkerDeps> = {}, eventDir = createTempDir()) {
  return {
    worker: new DispatchWorker({
      wakeRepo, routeRepo, leaseRepo, githubAgentRepo,
      adapter: makeAdapter(),
      eventWriter: new EventWriter(eventDir),
      ...overrides
    }),
    eventDir
  };
}

function readEvents(dir: string) {
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  );
}

let wakeSeq = 0;
async function createWake(overrides: Partial<Wake> = {}): Promise<Wake> {
  wakeSeq += 1;
  const now = Date.now();
  return wakeRepo.create({
    id: `wake-${wakeSeq}`,
    task_key: `tk-${wakeSeq}`,
    state_key: `sk-${wakeSeq}`,
    project_id: 'proj-1',
    project_name: null,
    task_id: `task-${wakeSeq}`,
    task_type: 'implementation',
    task_title: 'Task',
    task_priority: 10,
    task_status: 'Todo',
    task_status_expected: null,
    task_audit: 'Approved',
    task_audit_expected: null,
    task_labels: null,
    task_relations: null,
    task_branch: null,
    task_payload: { hello: 'world' },
    assignee_id: 'agent-1',
    assignee_name: null,
    owner_id: null,
    owner_name: null,
    queue_attempts: 0,
    dispatch_attempts: 0,
    wake_attempts: 0,
    status: 'queued',
    create_time: now,
    update_time: now,
    ...overrides
  });
}

async function createRoute(overrides: Partial<Route> = {}): Promise<Route> {
  return routeRepo.create({
    id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
    session_key: 'sess-1', agent_id: 'agent-1', agent_name: 'Agent 1', delivery: 'session', max_run: 1, status: 'active',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  });
}

async function createOpenLease(overrides: Partial<WakeRouteLease> = {}): Promise<WakeRouteLease> {
  const now = Date.now();
  return leaseRepo.create({
    id: `lease-${crypto.randomUUID()}`,
    route_id: 'route-1',
    wake_id: 'wake-other',
    wake_task_status: 'Todo',
    task_key: 'tk-other',
    activity_time: now,
    status: 'active',
    create_time: now,
    update_time: now,
    ...overrides
  });
}

// ── Stage 1 — selection under the task-turn gate ────────────────────────────

describe('DispatchWorker selection (task-turn gate)', () => {
  test('first-time queued wake dispatches: lease minted per turn, runId = lease.id, task_key carried', async () => {
    const wake = await createWake();
    await createRoute();
    const { worker } = makeWorker();

    await worker.runOnce();

    const updated = await wakeRepo.findById(wake.id);
    expect(updated?.status).toBe('dispatched');
    expect(updated?.wake_attempts).toBe(1);
    expect(updated?.dispatch_attempts).toBe(1);

    expect(sent).toHaveLength(1);
    const lease = await leaseRepo.findOpenByWakeId(wake.id);
    expect(lease).not.toBeNull();
    // The lease handed to the send IS the persisted row — its id is the runId.
    expect(sent[0]!.lease.id).toBe(lease!.id);
    expect(lease!.task_key).toBe(wake.task_key);
    expect(lease!.wake_task_status).toBe('Todo');
    expect(rendered[0]).toMatchObject({ wakeId: wake.id, template: 'wake' });
  });

  test('rebounded wake within the cooldown window is not re-selected; older than cooldown is', async () => {
    const wake = await createWake();
    await createRoute();
    await wakeRepo.bumpDispatchAttempts(wake.id, 'queued');
    const { worker } = makeWorker({ dispatchReboundCooldownMs: 60_000 });

    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(0);

    await pool.query('UPDATE wake SET update_time=$2 WHERE id=$1', [wake.id, Date.now() - 120_000]);
    expect(await worker.runOnce()).toBe(true);
    expect(sent).toHaveLength(1);
  });

  test('gate 1: an open lease for the task_key on ANY route blocks every wake of that task', async () => {
    const wake = await createWake();
    await createRoute();
    // An open turn for the same task on a DIFFERENT route.
    await createRoute({ id: 'route-2', task_type: 'other' });
    await createOpenLease({ route_id: 'route-2', wake_id: 'wake-prior', task_key: wake.task_key });

    const { worker } = makeWorker();
    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await wakeRepo.findById(wake.id))?.status).toBe('queued');
  });

  test('gate 2: an older sibling never dispatches past its successor — only the newest open wake is eligible', async () => {
    const older = await createWake({ id: 'wake-old', task_key: 'tk-same', create_time: Date.now() - 10_000, task_priority: 99 });
    const newer = await createWake({ id: 'wake-new', task_key: 'tk-same', state_key: 'sk-new', task_priority: 1 });
    await createRoute();

    const { worker } = makeWorker();
    await worker.runOnce();

    // Despite higher priority, the older sibling is skipped; the newest dispatches.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.wake.id).toBe(newer.id);
    expect((await wakeRepo.findById(older.id))?.status).toBe('queued');
  });

  test('a dispatched wake under its own open lease is not an empty run — nothing re-dispatches mid-turn', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 1, dispatch_attempts: 1 });
    await createRoute();
    await createOpenLease({ wake_id: wake.id, task_key: wake.task_key });

    const { worker } = makeWorker();
    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

// ── Stages 2–4 — route, capacity, admission, send ───────────────────────────

describe('DispatchWorker dispatch stages', () => {
  test('missing route parks the wake', async () => {
    const wake = await createWake();
    const { worker } = makeWorker();
    await worker.runOnce();
    expect((await wakeRepo.findById(wake.id))?.status).toBe('parked');
  });

  test('capacity: open-lease count at route.max_run rebounds the wake (stays queued, dispatch_attempts bumped)', async () => {
    const wake = await createWake();
    await createRoute({ delivery: 'run', max_run: 1, session_key: 'agent:a:run:[wake_route_lease_id]' });
    await createOpenLease({ wake_id: 'wake-other', task_key: 'tk-other' });
    const { worker, eventDir } = makeWorker();

    await worker.runOnce();

    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('queued');
    expect(after?.dispatch_attempts).toBe(1);
    expect(after?.wake_attempts).toBe(0);
    expect(readEvents(eventDir).some((e) => e.event_code === 2004)).toBe(true);
  });

  test('session routes are capacity 1 by construction regardless of max_run', async () => {
    await createWake();
    await createRoute({ delivery: 'session', max_run: 5 });
    await createOpenLease({ wake_id: 'wake-other', task_key: 'tk-other' });
    const { worker } = makeWorker();

    await worker.runOnce();
    expect(sent).toHaveLength(0);
  });

  test('render failure parks the wake with NOTHING persisted — no lease row exists', async () => {
    const wake = await createWake();
    await createRoute();
    const { worker, eventDir } = makeWorker({ adapter: makeAdapter({ renderFailFor: () => true }) });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect((await wakeRepo.findById(wake.id))?.status).toBe('parked');
    expect(await leaseRepo.listByWakeId(wake.id)).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const park = readEvents(eventDir).find((e) => e.event_code === 2014);
    expect(park?.wake_id).toBe(wake.id);
  });

  test('a render-failing wake does not poison the cycle — the next wake still dispatches (E7)', async () => {
    await createWake({ id: 'wake-bad', task_priority: 20 });
    await createWake({ id: 'wake-good', task_priority: 10 });
    await createRoute();
    const { worker } = makeWorker({ adapter: makeAdapter({ renderFailFor: (id) => id === 'wake-bad' }) });

    await worker.runOnce(); // bad parks
    await worker.runOnce(); // good dispatches
    expect((await wakeRepo.findById('wake-bad'))?.status).toBe('parked');
    expect((await wakeRepo.findById('wake-good'))?.status).toBe('dispatched');
    expect(sent).toHaveLength(1);
  });

  test('a non-render adapter throw during render propagates (not parked)', async () => {
    const wake = await createWake();
    await createRoute();
    const { worker } = makeWorker({
      adapter: {
        renderTurn: async () => { throw new Error('template store exploded'); },
        send: async () => {}
      }
    });
    await expect(worker.runOnce()).rejects.toThrow('template store exploded');
    expect((await wakeRepo.findById(wake.id))?.status).not.toBe('parked');
  });

  test('send failure: lease completed send_failed, wake stays queued, wake_attempts untouched; retry uses a FRESH lease', async () => {
    const wake = await createWake();
    await createRoute();
    let fail = true;
    const { worker, eventDir } = makeWorker({ adapter: makeAdapter({ sendFail: () => fail }) });

    await worker.runOnce();

    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('queued'); // the send never took
    expect(after?.wake_attempts).toBe(0);
    expect(after?.dispatch_attempts).toBe(1);
    const leases = await leaseRepo.listByWakeId(wake.id);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.status).toBe('completed');
    const completedEvent = readEvents(eventDir).find((e) => e.event_code === 2007);
    expect(completedEvent?.cause).toBe('send_failed');

    // Next sweep retries with a fresh lease.
    fail = false;
    await worker.runOnce();
    expect((await wakeRepo.findById(wake.id))?.status).toBe('dispatched');
    const leasesAfter = await leaseRepo.listByWakeId(wake.id);
    expect(leasesAfter).toHaveLength(2);
    expect(leasesAfter[1]!.id).not.toBe(leases[0]!.id);
    expect(leasesAfter[1]!.status).toBe('active');
  });

  test('run delivery rides the same one-lease-one-send path', async () => {
    const wake = await createWake();
    await createRoute({ delivery: 'run', max_run: 2, session_key: 'agent:a:run:[wake_route_lease_id]' });
    const { worker } = makeWorker();
    await worker.runOnce();
    expect(sent).toHaveLength(1);
    expect((await wakeRepo.findById(wake.id))?.status).toBe('dispatched');
    expect((await leaseRepo.findOpenByWakeId(wake.id))?.id).toBe(sent[0]!.lease.id);
  });
});

// ── Stage 6 — the lifecycle watcher ─────────────────────────────────────────

describe('DispatchWorker watcher (lifecycle events)', () => {
  async function dispatched() {
    const wake = await createWake();
    await createRoute();
    const eventDir = createTempDir();
    const { worker } = makeWorker({}, eventDir);
    await worker.runOnce();
    const lease = (await leaseRepo.findOpenByWakeId(wake.id))!;
    return { wake, lease, worker, eventDir };
  }

  test('lifecycle end completes the lease — and ONLY the lease (the wake stays dispatched; two-ledger rule)', async () => {
    const { wake, lease, worker, eventDir } = await dispatched();

    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'end', endedAt: Date.now() } });

    expect((await leaseRepo.findById(lease.id))?.status).toBe('completed');
    expect((await wakeRepo.findById(wake.id))?.status).toBe('dispatched');
    const ev = readEvents(eventDir).find((e) => e.event_code === 2007);
    expect(ev?.cause).toBe('lifecycle_end');
  });

  test('lifecycle error completes the lease with cause lifecycle_error', async () => {
    const { lease, worker, eventDir } = await dispatched();
    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'error' } });
    expect((await leaseRepo.findById(lease.id))?.status).toBe('completed');
    expect(readEvents(eventDir).find((e) => e.event_code === 2007)?.cause).toBe('lifecycle_error');
  });

  test('finishing is activity, NOT completion; assistant/tool/heartbeat traffic refreshes activity_time', async () => {
    const { lease, worker } = await dispatched();
    await pool.query('UPDATE wake_route_lease SET activity_time=$2 WHERE id=$1', [lease.id, 1000]);

    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'finishing', endedAt: Date.now() } });
    let row = await leaseRepo.findById(lease.id);
    expect(row?.status).toBe('active');
    expect(row?.activity_time).toBeGreaterThan(1000);

    await pool.query('UPDATE wake_route_lease SET activity_time=$2 WHERE id=$1', [lease.id, 1000]);
    await worker.handleAgentEvent({ runId: lease.id, stream: 'assistant', data: { text: '…' } });
    row = await leaseRepo.findById(lease.id);
    expect(row?.status).toBe('active');
    expect(row?.activity_time).toBeGreaterThan(1000);
  });

  test('a runId matching no open lease is ignored silently', async () => {
    const { lease, worker } = await dispatched();
    await worker.handleAgentEvent({ runId: 'run-foreign', stream: 'lifecycle', data: { phase: 'end' } });
    expect((await leaseRepo.findById(lease.id))?.status).toBe('active');
  });

  test('completion is idempotent: a late duplicate end emits no second 2007', async () => {
    const { lease, worker, eventDir } = await dispatched();
    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'end' } });
    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'end' } });
    expect(readEvents(eventDir).filter((e) => e.event_code === 2007)).toHaveLength(1);
  });

  test('the agent method final response is an auxiliary completion signal, handled idempotently', async () => {
    const { lease, worker, eventDir } = await dispatched();

    await worker.handleAgentFinal(lease.id, 'ok');
    expect((await leaseRepo.findById(lease.id))?.status).toBe('completed');
    const ev = readEvents(eventDir).find((e) => e.event_code === 2007);
    expect(ev?.cause).toBe('lifecycle_end');
    expect(ev?.signal).toBe('agent_final');

    // The lifecycle end for the same run arriving later is a no-op.
    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'end' } });
    expect(readEvents(eventDir).filter((e) => e.event_code === 2007)).toHaveLength(1);
  });

  test('an error-status final response completes with cause lifecycle_error', async () => {
    const { lease, worker, eventDir } = await dispatched();
    await worker.handleAgentFinal(lease.id, 'error');
    expect(readEvents(eventDir).find((e) => e.event_code === 2007)?.cause).toBe('lifecycle_error');
  });
});

// ── Stage 6 — reconcile (agent.wait) ────────────────────────────────────────

describe('DispatchWorker reconcile', () => {
  test('reconnect bulk reconcile maps the full verdict table over all open leases', async () => {
    const verdicts = new Map<string, AgentWaitVerdict>();
    const mk = async (id: string, verdict: AgentWaitVerdict) => {
      await createOpenLease({ id, wake_id: `w-${id}`, task_key: `tk-${id}` });
      verdicts.set(id, verdict);
    };
    await createRoute();
    await mk('lease-ok', { status: 'ok', endedAt: Date.now() });
    await mk('lease-err', { status: 'error' });
    await mk('lease-alive', { status: 'timeout', timeoutPhase: 'gateway_draining' });
    await mk('lease-gone', { status: 'timeout', timeoutPhase: 'queue', providerStarted: false });
    await mk('lease-unavailable', { status: 'unavailable', error: 'link down' });

    const { worker, eventDir } = makeWorker({
      agentWait: async (runId) => verdicts.get(runId)!
    });
    await worker.reconcileAllOpenLeases();

    expect((await leaseRepo.findById('lease-ok'))?.status).toBe('completed');
    expect((await leaseRepo.findById('lease-err'))?.status).toBe('completed');
    expect((await leaseRepo.findById('lease-alive'))?.status).toBe('active');
    expect((await leaseRepo.findById('lease-gone'))?.status).toBe('completed');
    expect((await leaseRepo.findById('lease-unavailable'))?.status).toBe('active');

    const events = readEvents(eventDir);
    const causes = events.filter((e) => e.event_code === 2007).map((e) => e.cause).sort();
    expect(causes).toEqual(['reconcile_error', 'reconcile_never_started', 'reconcile_ok']);
    const reconciled = events.find((e) => e.event_code === 3008);
    expect(reconciled).toMatchObject({
      trigger: 'reconnect', checked: 5,
      completed_ok: 1, completed_error: 1, completed_never_started: 1,
      left_running: 1, skipped: 1
    });
  });

  test('quiet-lease reconcile checks only leases whose activity_time is past the threshold', async () => {
    await createRoute();
    const old = Date.now() - 600_000;
    await createOpenLease({ id: 'lease-quiet', wake_id: 'w-1', task_key: 'tk-1', activity_time: old });
    await createOpenLease({ id: 'lease-busy', wake_id: 'w-2', task_key: 'tk-2' }); // fresh activity

    const checked: string[] = [];
    const { worker } = makeWorker({
      agentWait: async (runId) => { checked.push(runId); return { status: 'ok' }; },
      leaseQuietThresholdMs: 300_000,
      leaseReconcileIntervalMs: 0
    });
    await worker.runOnce();

    expect(checked).toEqual(['lease-quiet']);
    expect((await leaseRepo.findById('lease-quiet'))?.status).toBe('completed');
    expect((await leaseRepo.findById('lease-busy'))?.status).toBe('active');
  });
});

// ── Stage 5 — empty-run recovery ────────────────────────────────────────────

describe('DispatchWorker empty-run recovery', () => {
  test('a completed turn without progression re-wakes: fresh lease, rewake template, wake_attempts increments', async () => {
    const wake = await createWake();
    await createRoute();
    const eventDir = createTempDir();
    const { worker } = makeWorker({ rewakeMaxAttempts: 5 }, eventDir);

    await worker.runOnce(); // turn 1 (wake template)
    const lease1 = (await leaseRepo.findOpenByWakeId(wake.id))!;
    await worker.handleAgentEvent({ runId: lease1.id, stream: 'lifecycle', data: { phase: 'end' } });

    await worker.runOnce(); // empty run detected → turn 2 (rewake template)

    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('dispatched');
    expect(after?.wake_attempts).toBe(2);
    const leases = await leaseRepo.listByWakeId(wake.id);
    expect(leases).toHaveLength(2);
    expect(leases.filter((l) => l.status === 'active')).toHaveLength(1);
    expect(rendered[1]).toMatchObject({ wakeId: wake.id, template: 'rewake' });
    expect(rendered[1]!.ctx).toMatchObject({ wakeAttempts: 2, rewakeCap: 5 });
    expect(typeof rendered[1]!.ctx!.lastTurnMinutesAgo).toBe('number');

    const events = readEvents(eventDir);
    const dispatchedEvents = events.filter((e) => e.event_code === 2005);
    expect(dispatchedEvents).toHaveLength(2);
    expect(dispatchedEvents[1]).toMatchObject({ wake_attempts: 2, template: 'rewake' });
    expect(events.filter((e) => e.event_code === 2016)).toHaveLength(1);
  });

  test('at the cap one alert turn delivers (F2b), then the wake leaves the pool permanently — 2017 fires exactly once', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 3, dispatch_attempts: 3 });
    await createRoute();
    const eventDir = createTempDir();
    const { worker } = makeWorker({ rewakeMaxAttempts: 3 }, eventDir);

    // Exactly at the cap: the one-duty cap-alert turn dispatches
    // (spec_wakery-cap-alert-message.md) and consumes the wake past the cap.
    expect(await worker.runOnce()).toBe(true);
    expect(sent).toHaveLength(1);
    expect((await wakeRepo.findById(wake.id))?.wake_attempts).toBe(4);

    // Close the alert turn and age the wake past the rebound cooldown: past
    // the cap the wake never re-enters the pool.
    const lease = await leaseRepo.findOpenByTaskKey(wake.task_key);
    await pool.query(`UPDATE wake_route_lease SET status='completed' WHERE id=$1`, [lease!.id]);
    await pool.query(`UPDATE wake SET update_time=$1 WHERE id=$2`, [Date.now() - 600_000, wake.id]);
    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(1);
    expect((await wakeRepo.findById(wake.id))?.status).toBe('dispatched'); // stays; the alert was the delivery

    const events = readEvents(eventDir);
    const capEvents = events.filter((e) => e.event_code === 2017);
    expect(capEvents).toHaveLength(1);
    expect(capEvents[0]).toMatchObject({ wake_id: wake.id, wake_attempts: 3, max_attempts: 3 });
    expect(events.filter((e) => e.event_code === 2022)).toHaveLength(1);
    expect(events.find((e) => e.event_code === 2005 && e.template === 'cap-alert')).toBeTruthy();
  });

  test('terminal guard: live issue closed → wake completed locally (2018), no turn spent', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 1, dispatch_attempts: 1, task_status: 'Completed' });
    await createRoute();
    const verifier: TerminalVerifier = async () => true;
    const eventDir = createTempDir();
    const { worker } = makeWorker({ terminalVerifier: verifier }, eventDir);

    await worker.runOnce();

    expect((await wakeRepo.findById(wake.id))?.status).toBe('completed');
    expect(sent).toHaveLength(0);
    expect(readEvents(eventDir).some((e) => e.event_code === 2018)).toBe(true);
  });

  test('terminal guard: live issue open → the cue is re-wake eligible', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 1, dispatch_attempts: 1, task_status: 'Cancelled', task_audit: 'Gated' });
    await createRoute({ actor: 'owner' });
    const { worker } = makeWorker({ terminalVerifier: async () => false });

    await worker.runOnce();

    expect(sent).toHaveLength(1);
    expect((await wakeRepo.findById(wake.id))?.wake_attempts).toBe(2);
    expect(rendered[0]!.template).toBe('rewake');
  });

  test('terminal guard: lookup failure is conservative — left for the next sweep', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 1, dispatch_attempts: 1, task_status: 'Completed' });
    await createRoute();
    const { worker } = makeWorker({ terminalVerifier: async () => null });

    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await wakeRepo.findById(wake.id))?.status).toBe('dispatched');
  });
});

// ── Govern cue wakes (milestone_govern-notice_v2026.08.05) ──────────────────

describe('DispatchWorker Govern cue wakes', () => {
  test('a Govern cue wake derives actor=owner, dispatches on the owner-lane route with the govern-notice template', async () => {
    const wake = await createWake({ task_status: 'Todo', task_audit: 'Govern', assignee_id: null, owner_id: 'agent-1' });
    // Only an owner-lane route exists — the Govern carve-out must reach it.
    await createRoute({ actor: 'owner', task_type: null });
    const eventDir = createTempDir();
    const { worker } = makeWorker({}, eventDir);

    expect(await worker.runOnce()).toBe(true);

    expect(sent).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ wakeId: wake.id, template: 'govern-notice' });
    expect(rendered[0]!.ctx).toBeUndefined(); // never a rewake context
    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('dispatched');
    expect(after?.wake_attempts).toBe(1);

    const events = readEvents(eventDir);
    expect(events.find((e) => e.event_code === 2002)).toMatchObject({ wake_id: wake.id, actor: 'owner' });
    expect(events.find((e) => e.event_code === 2005)).toMatchObject({ wake_id: wake.id, actor: 'owner', template: 'govern-notice' });
  });

  test('govern-notice precedence holds on a retried Govern wake (wake_attempts > 0 selects no re-wake context)', async () => {
    // A send-failed retry leaves the wake queued with wake_attempts already
    // counted; the re-dispatch must still render the govern notice, not the
    // re-wake message.
    const wake = await createWake({ task_status: 'Done', task_audit: 'Govern', wake_attempts: 1, status: 'queued' });
    await createRoute({ actor: 'owner', task_type: null });
    const { worker } = makeWorker();

    await worker.runOnce();

    expect(rendered[0]).toMatchObject({ wakeId: wake.id, template: 'govern-notice' });
    expect(rendered[0]!.ctx).toBeUndefined();
  });

  test('empty-run recovery exempts Govern cue wakes: a completed notice turn is never re-waked', async () => {
    const wake = await createWake({ task_status: 'Todo', task_audit: 'Govern' });
    await createRoute({ actor: 'owner', task_type: null });
    const eventDir = createTempDir();
    const { worker } = makeWorker({}, eventDir);

    await worker.runOnce(); // the one notice turn
    const lease = (await leaseRepo.findOpenByWakeId(wake.id))!;
    await worker.handleAgentEvent({ runId: lease.id, stream: 'lifecycle', data: { phase: 'end' } });

    // Dispatched + no open lease + newest open wake — an empty run for any
    // other wake. The Govern exemption leaves it awaiting the Principal.
    expect(await worker.runOnce()).toBe(false);
    expect(await worker.runOnce()).toBe(false);

    expect(sent).toHaveLength(1);
    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('dispatched');
    expect(after?.wake_attempts).toBe(1);
    const events = readEvents(eventDir);
    expect(events.filter((e) => e.event_code === 2005)).toHaveLength(1);
    expect(events.filter((e) => e.event_code === 2016)).toHaveLength(0);
    expect(events.filter((e) => e.event_code === 2017)).toHaveLength(0);
  });
});

// ── Stage 4 — snooze hold deferral ──────────────────────────────────────────

describe('DispatchWorker snooze hold (admission deferral)', () => {
  function snoozeStub(holding: () => any[]) {
    return {
      consultSnoozes: async () => holding(),
      holdingTypeNames: (rows: any[]) => rows.map((r) => r.name ?? 'CI'),
      timeoutSweep: async () => 0,
      settledHolds: async () => []
    };
  }

  test('a holding consult defers admission: status kept, dispatch_attempts bumped, wake_attempts untouched, NO lease, 2019 emitted', async () => {
    const wake = await createWake({ task_branch: 'feature/x/build' });
    await createRoute();
    const eventDir = createTempDir();
    const { worker } = makeWorker({ snooze: snoozeStub(() => [{ name: 'CI' }]) }, eventDir);

    await worker.runOnce();

    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('queued');
    expect(after?.dispatch_attempts).toBe(1);
    expect(after?.wake_attempts).toBe(0);
    expect(await leaseRepo.listByWakeId(wake.id)).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const deferred = readEvents(eventDir).find((e) => e.event_code === 2019);
    expect(deferred).toMatchObject({ wake_id: wake.id, branch: 'feature/x/build', holding_types: ['CI'] });
  });

  test('an empty-run candidate under a hold stays dispatched and burns no re-wake attempt', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 1, dispatch_attempts: 1, task_branch: 'feature/x/build' });
    await createRoute();
    const { worker } = makeWorker({ snooze: snoozeStub(() => [{ name: 'PR' }]) });

    await worker.runOnce();

    const after = await wakeRepo.findById(wake.id);
    expect(after?.status).toBe('dispatched');
    expect(after?.wake_attempts).toBe(1);
    expect(after?.dispatch_attempts).toBe(2);
    expect(sent).toHaveLength(0);
  });

  test('when the hold clears, the standing empty-run re-wake re-engages with the settled-holds context', async () => {
    const wake = await createWake({ status: 'dispatched', wake_attempts: 1, task_branch: 'feature/x/build' });
    // A completed prior lease so the settled window has an anchor.
    await createRoute();
    await createOpenLease({ id: 'lease-prev', wake_id: wake.id, task_key: wake.task_key });
    await leaseRepo.complete('lease-prev');

    let holding: any[] = [{ name: 'CI' }];
    const settled = [{ typeName: 'CI', status: 'completed' as const, heldMinutes: 9 }];
    const { worker } = makeWorker({
      snooze: {
        consultSnoozes: async () => holding,
        holdingTypeNames: (rows: any[]) => rows.map(() => 'CI'),
        timeoutSweep: async () => 0,
        settledHolds: async () => settled
      }
    });

    await worker.runOnce(); // held
    expect(sent).toHaveLength(0);

    holding = [];
    await worker.runOnce(); // released → re-wake with settled context

    expect(sent).toHaveLength(1);
    expect(rendered[0]!.template).toBe('rewake');
    expect(rendered[0]!.ctx!.settledHolds).toEqual(settled);
  });

  test('the snooze timeout sweep rides every tick', async () => {
    let swept = 0;
    const { worker } = makeWorker({
      snooze: {
        consultSnoozes: async () => [],
        holdingTypeNames: () => [],
        timeoutSweep: async () => { swept += 1; return 0; },
        settledHolds: async () => []
      }
    });
    await worker.runOnce();
    await worker.runOnce();
    expect(swept).toBe(2);
  });
});
