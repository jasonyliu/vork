import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestPool, createTempDir, seedProject } from './helpers.js';
import { runMigrations } from '@vork/data';
import { buildServer } from '../src/ingress/app.js';
import { WakeRepository } from '../src/db/wake-repository.js';
import { RouteRepository } from '../src/db/route-repository.js';
import { LeaseRepository } from '../src/db/lease-repository.js';
import { GithubAgentRepository } from '../src/db/github-agent-repository.js';
import { DispatchWorker } from '../src/worker/dispatch-worker.js';
import { SnoozeModule } from '../src/snooze/module.js';
import { SnoozeIntakeModule } from '../src/snooze/intake.js';
import { SnoozeRepository } from '../src/db/snooze-repository.js';
import { SnoozeTaskTypeRepository } from '../src/db/snooze-task-type-repository.js';
import { seedSnoozeTaskTypes } from '@vork/data';
import { EventWriter } from '../src/events/writer.js';
import { OpenClawAdapter } from '../src/adapters/openclaw/adapter.js';
import type { RewakeRenderContext } from '../src/templates/renderer.js';

let pool: Pool;
let wakeRepo: WakeRepository;
let routeRepo: RouteRepository;
let leaseRepo: LeaseRepository;
let githubAgentRepo: GithubAgentRepository;
let eventWriter: EventWriter;
let eventDir: string;
let sent: Array<{ method: string; params: any }>;
let rewakeContexts: RewakeRenderContext[];
let adapter: OpenClawAdapter;

function readEvents(): Array<Record<string, unknown>> {
  const files = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl'));
  const lines: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const content = readFileSync(join(eventDir, f), 'utf8');
    for (const line of content.split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line));
    }
  }
  return lines;
}

async function seedGithubAgents() {
  const now = Date.now();
  await githubAgentRepo.create({ id: 'am-1', github_login: 'worker-login', github_node_id: 'U_worker', agent_id: 'agent-main', agent_name: 'Main Agent', role: 'agent', status: 'active', create_time: now, update_time: now });
  await githubAgentRepo.create({ id: 'am-2', github_login: 'owner-login', github_node_id: 'U_owner', agent_id: 'principal', agent_name: 'Principal', role: 'principal', status: 'active', create_time: now, update_time: now });
}

function makeWakeBody(overrides: Record<string, unknown> = {}) {
  return {
    request_id: 'req-1',
    source: 'github',
    project_id: 'proj-1',
    task_id: 'task-1',
    task_type: 'implementation',
    task_title: 'Build feature',
    task_priority: 5,
    task_status: 'Todo',
    task_audit: 'Approved',
    assignee_id: 'U_worker',
    assignee_name: 'worker-login',
    owner_id: 'U_owner',
    owner_name: 'owner-login',
    timestamp: Date.now(),
    ...overrides
  };
}

function makeWorker(extra: Record<string, unknown> = {}) {
  return new DispatchWorker({
    wakeRepo, routeRepo, leaseRepo, adapter, eventWriter, githubAgentRepo,
    ...extra
  } as any);
}

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  await seedProject(pool, 'proj-1');
  wakeRepo = new WakeRepository(pool);
  routeRepo = new RouteRepository(pool);
  leaseRepo = new LeaseRepository(pool);
  githubAgentRepo = new GithubAgentRepository(pool);
  eventDir = createTempDir();
  eventWriter = new EventWriter(eventDir);
  sent = [];
  rewakeContexts = [];
  // Real adapter over a mocked link boundary (no sockets in tests) plus a
  // stub renderer — the worker/adapter seam runs for real.
  adapter = new OpenClawAdapter(
    { call: async (method, params) => { sent.push({ method, params }); return { runId: params.idempotencyKey, status: 'accepted' }; } },
    eventWriter,
    {
      render: async () => 'INTEGRATION-RENDERED-WAKE-MESSAGE',
      renderRewake: async (_w, _r, ctx) => { rewakeContexts.push(ctx); return 'INTEGRATION-RENDERED-REWAKE-MESSAGE'; },
      renderGovernNotice: async () => 'INTEGRATION-RENDERED-GOVERN-NOTICE',
      renderCapAlert: async () => 'INTEGRATION-RENDERED-CAP-ALERT',
      renderStallNotice: async () => 'INTEGRATION-RENDERED-STALL-NOTICE'
    }
  );
  await seedGithubAgents();
});

describe('Integration: ingress -> worker -> adapter', () => {
  test('full session dispatch chain: ingress accepts, worker routes, adapter sends chat.send with runId = lease.id', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:main', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'session', max_run: 1, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const response = await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody() });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');

    const worker = makeWorker();
    expect(await worker.runOnce()).toBe(true);

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.status).toBe('dispatched');
    expect(wakes[0]!.wake_attempts).toBe(1);

    const lease = await leaseRepo.findOpenByWakeId(wakes[0]!.id);
    expect(lease).not.toBeNull();
    expect(lease!.route_id).toBe('route-1');
    expect(lease!.task_key).toBe(wakes[0]!.task_key);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('chat.send');
    expect(sent[0]!.params.idempotencyKey).toBe(lease!.id); // runId contract
  });

  test('full Govern cue chain: ingress stores the cue (1009 + 1020), worker routes it to the owner lane and dispatches the govern notice', async () => {
    const now = Date.now();
    // Only an owner-lane route — the Govern carve-out must reach it.
    await routeRepo.create({
      id: 'route-owner', project_id: 'proj-1', task_type: null, actor: 'owner',
      session_key: 'agent:main:proj:main', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'session', max_run: 1, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: makeWakeBody({ task_status: 'Todo', task_audit: 'Govern' })
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');

    const worker = makeWorker();
    expect(await worker.runOnce()).toBe(true);

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.status).toBe('dispatched');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params.message).toBe('INTEGRATION-RENDERED-GOVERN-NOTICE');

    const events = readEvents();
    expect(events.some((e) => e.event_code === 1009 && e.reason === 'state_based')).toBe(true);
    expect(events.some((e) => e.event_code === 1020 && e.gate === 'Todo:Govern')).toBe(true);
    expect(events.find((e) => e.event_code === 2002)).toMatchObject({ actor: 'owner' });
    expect(events.find((e) => e.event_code === 2005)).toMatchObject({ template: 'govern-notice' });

    // The notice turn ends without progression — the Govern exemption keeps
    // the wake parked on the Principal, never an empty-run re-wake.
    const lease = await leaseRepo.findOpenByWakeId(wakes[0]!.id);
    await worker.handleAgentEvent({ runId: lease!.id, stream: 'lifecycle', data: { phase: 'end' } });
    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  test('full run dispatch chain: the agent method into the lease-keyed run session', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:run:[wake_route_lease_id]', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'run', max_run: 2, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody() });
    await makeWorker().runOnce();

    const wakes = await wakeRepo.listAll();
    expect(wakes[0]!.status).toBe('dispatched');
    const lease = await leaseRepo.findOpenByWakeId(wakes[0]!.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('agent');
    expect(sent[0]!.params.sessionKey).toBe(`agent:main:proj:run:${lease!.id}`);
    expect(sent[0]!.params.idempotencyKey).toBe(lease!.id);
  });

  test('no route: ingress accepts, worker parks', async () => {
    const app = buildServer({ pool, eventWriter });
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody() });

    await makeWorker().runOnce();

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.status).toBe('parked');
    expect(sent).toHaveLength(0);
  });

  test('busy route: the wake stays queued with dispatch_attempts bumped', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:main', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'session', max_run: 1, status: 'active', create_time: now, update_time: now
    });
    // Occupy the route with an open lease of a different task.
    await leaseRepo.create({
      id: 'lease-existing', route_id: 'route-1', wake_id: 'other-wake',
      wake_task_status: 'Todo', task_key: 'tk-other', activity_time: now, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody() });

    await makeWorker().runOnce();

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.status).toBe('queued');
    expect(wakes[0]!.dispatch_attempts).toBe(1);
    expect(sent).toHaveLength(0);
  });
});

describe('Integration: the turn loop across task progression', () => {
  // The two-ledger flow (spec_wakery-queue-and-leases.md): progression closes
  // the WAKE mid-turn while the lease stays open; the task-turn gate holds the
  // successor until the gateway's turn-end signal completes the lease; then
  // the successor starts its own turn on a FRESH lease.
  test('successor wake waits for the true end of turn, then dispatches on a new lease', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:main', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'session', max_run: 1, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const worker = makeWorker();

    // Phase 1: Todo:Approved -> dispatched; turn 1 running.
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody({ request_id: 'req-1' }) });
    await worker.runOnce();
    const [wake1] = await wakeRepo.listAll();
    const lease1 = (await leaseRepo.findOpenByWakeId(wake1!.id))!;
    expect(sent).toHaveLength(1);

    // Phase 2: mid-turn progression (the agent posted its transition before
    // its turn ended). The prior wake closes; the lease does NOT.
    await app.inject({
      method: 'POST', url: '/wake',
      payload: makeWakeBody({ request_id: 'req-2', task_status: 'Progress', task_audit: 'Gated' })
    });
    const wakes = await wakeRepo.listAll();
    const oldWake = wakes.find((w) => w.task_status === 'Todo')!;
    const newWake = wakes.find((w) => w.task_status === 'Progress')!;
    expect(oldWake.status).toBe('completed');
    expect(newWake.status).toBe('queued');
    expect((await leaseRepo.findById(lease1.id))?.status).toBe('active');
    const progression = readEvents().find((e) => e.event_code === 1019);
    expect(progression).toMatchObject({ trigger: 'observed' });

    // Phase 3: the task-turn gate blocks the successor while turn 1 runs.
    expect(await worker.runOnce()).toBe(false);
    expect(sent).toHaveLength(1);

    // Phase 4: the gateway signals the true end of turn — the watcher
    // completes lease 1; the successor now starts turn 2 on a fresh lease.
    await worker.handleAgentEvent({ runId: lease1.id, stream: 'lifecycle', data: { phase: 'end' } });
    expect(await worker.runOnce()).toBe(true);

    const dispatched = await wakeRepo.findById(newWake.id);
    expect(dispatched!.status).toBe('dispatched');
    expect(dispatched!.wake_attempts).toBe(1); // its own first turn — the wake template
    const lease2 = (await leaseRepo.findOpenByWakeId(newWake.id))!;
    expect(lease2.id).not.toBe(lease1.id);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.params.idempotencyKey).toBe(lease2.id);
  });

  test('a wake accumulates one lease per turn: empty run re-wakes on a fresh lease with the re-wake template', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:main', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'session', max_run: 1, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const worker = makeWorker({ rewakeMaxAttempts: 5 });

    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody() });
    await worker.runOnce(); // turn 1
    const [wake] = await wakeRepo.listAll();
    const lease1 = (await leaseRepo.findOpenByWakeId(wake!.id))!;

    // Turn 1 ends with no observed progression → empty run → turn 2.
    await worker.handleAgentEvent({ runId: lease1.id, stream: 'lifecycle', data: { phase: 'end' } });
    expect(await worker.runOnce()).toBe(true);

    const after = await wakeRepo.findById(wake!.id);
    expect(after!.status).toBe('dispatched');
    expect(after!.wake_attempts).toBe(2);
    const leases = await leaseRepo.listByWakeId(wake!.id);
    expect(leases).toHaveLength(2);
    expect(leases.filter((l) => l.status === 'active')).toHaveLength(1);
    expect(rewakeContexts).toHaveLength(1);
    expect(rewakeContexts[0]).toMatchObject({ wakeAttempts: 2, rewakeCap: 5 });
    expect(sent[1]!.params.message).toBe('INTEGRATION-RENDERED-REWAKE-MESSAGE');

    const events = readEvents();
    expect(events.filter((e) => e.event_code === 2016)).toHaveLength(1);
  });
});

describe('Integration: capacity accounting', () => {
  test('run route allows multiple concurrent turns up to max_run', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:run:[wake_route_lease_id]', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'run', max_run: 2, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const worker = makeWorker();

    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody({ request_id: 'req-1', task_id: 'task-1' }) });
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody({ request_id: 'req-2', task_id: 'task-2' }) });
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody({ request_id: 'req-3', task_id: 'task-3' }) });

    await worker.runOnce(); // task-1 dispatched
    await worker.runOnce(); // task-2 dispatched
    await worker.runOnce(); // task-3 capacity-rebound (max_run=2 reached); stays queued

    const wakes = await wakeRepo.listAll();
    expect(wakes.filter((w) => w.status === 'dispatched')).toHaveLength(2);
    expect(wakes.filter((w) => w.status === 'queued' && w.dispatch_attempts > 0)).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  test('occupancy is turn-scoped: completing the turn frees the lane for the next task', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:main', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'session', max_run: 1, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const worker = makeWorker();

    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody({ request_id: 'req-1', task_id: 'task-1' }) });
    await app.inject({ method: 'POST', url: '/wake', payload: makeWakeBody({ request_id: 'req-2', task_id: 'task-2' }) });

    await worker.runOnce(); // task-1 takes the lane
    await worker.runOnce(); // task-2 rebounds
    expect(sent).toHaveLength(1);

    const wake1 = (await wakeRepo.listAll()).find((w) => w.task_id === 'task-1')!;
    const lease1 = (await leaseRepo.findOpenByWakeId(wake1.id))!;
    await worker.handleAgentEvent({ runId: lease1.id, stream: 'lifecycle', data: { phase: 'end' } });

    // The lane is free the moment the turn truly ends. task-1 is itself an
    // empty-run candidate now, but task-2 (queued, never dispatched) also
    // becomes admissible; one of them starts — capacity stays 1.
    await worker.runOnce();
    expect(await leaseRepo.countOpenByRouteId('route-1')).toBe(1);
    expect(sent).toHaveLength(2);
  });
});

describe('Integration: eligibility filtering', () => {
  test('ineligible request never reaches worker', async () => {
    const app = buildServer({ pool, eventWriter });
    const worker = makeWorker();

    const response = await app.inject({
      method: 'POST', url: '/wake',
      payload: makeWakeBody({ task_status: 'Rework', task_audit: 'Approved' })
    });
    expect(response.json().status).toBe('dropped');

    expect(await worker.runOnce()).toBe(false);
    expect(await wakeRepo.listAll()).toHaveLength(0);
  });

  test('identity-based principal handling stays silent: no wake stored, no dispatch', async () => {
    // The state-based Govern carve-out (milestone_govern-notice_v2026.08.05)
    // now stores a cue wake — covered above. Identity-based principal
    // handling (owner resolves to the Principal on an agent-routable state)
    // is untouched: silent by design.
    const app = buildServer({ pool, eventWriter });

    const response = await app.inject({
      method: 'POST', url: '/wake',
      payload: makeWakeBody({ task_status: 'Pending', task_audit: 'Approved' })
    });
    expect(response.json().status).toBe('dropped');
    expect(await wakeRepo.listAll()).toHaveLength(0);
    const events = readEvents();
    expect(events.some((e) => e.event_code === 1009 && e.reason === 'identity_based')).toBe(true);
    expect(events.some((e) => e.event_code === 1020)).toBe(false);
  });

  // Conduction chaining end-to-end (spec_wakery-conduction-chaining.md): a
  // terminal transition with an agent owner stores a cue wake that rides the
  // owner-lane wildcard route out to the adapter.
  test('terminal chain cue dispatches on the owner wildcard route', async () => {
    const now = Date.now();
    await routeRepo.create({
      id: 'route-owner', project_id: 'proj-1', task_type: null, actor: 'owner',
      session_key: 'agent:sarge:proj:run:[wake_route_lease_id]', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'run', max_run: 1, status: 'active', create_time: now, update_time: now
    });

    const app = buildServer({ pool, eventWriter });
    const response = await app.inject({
      method: 'POST', url: '/wake',
      payload: makeWakeBody({
        task_status: 'Completed',
        task_audit: 'Approved',
        task_branch: 'feature/wake-radar',
        owner_id: 'U_worker',
        owner_name: 'worker-login'
      })
    });
    expect(response.json().status).toBe('accepted');

    const worker = makeWorker();
    expect(await worker.runOnce()).toBe(true);

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    // Terminal-ack protocol: the dispatched cue stays open until the chain
    // consumer acknowledges by closing the issue; its turn's lease completes
    // at the turn's own end like any other.
    expect(wakes[0]!.status).toBe('dispatched');
    expect(wakes[0]!.task_branch).toBe('feature/wake-radar');
    expect((await leaseRepo.findOpenByWakeId(wakes[0]!.id))?.status).toBe('active');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('agent');

    const events = readEvents();
    expect(events.find((e) => e.event_code === 1016)).toBeDefined();
  });

  test('pull_request and workflow_run webhooks route to the snooze intake stub, never the wake path', async () => {
    const secret = 'test-webhook-secret';
    const app = buildServer({ pool, eventWriter, githubSecret: secret });

    for (const event of ['pull_request', 'workflow_run']) {
      const payload = { action: 'opened', repository: { full_name: 'owner-login/sample_project' } };
      const signature = `sha256=${createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')}`;
      const response = await app.inject({
        method: 'POST', url: '/adapters/github/webhook',
        headers: { 'x-github-event': event, 'x-hub-signature-256': signature },
        payload
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().message).toContain('snooze intake not wired');
    }
    expect(await wakeRepo.listAll()).toHaveLength(0);
  });
});

// The snooze end-to-end (spec_wakery-snooze.md §Verification): a hold defers
// the empty-run re-wake while the external work runs; settling re-engages
// through the standing re-wake path with the settled-holds context. No resume
// send, no lease pause — admission gating only.
describe('Integration: snooze hold across the turn loop', () => {
  const SECRET = 'test-webhook-secret';
  const BRANCH = 'feature/wake-radar';

  function signed(payload: unknown) {
    return `sha256=${createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex')}`;
  }

  function makeSnoozeModule() {
    return new SnoozeModule({
      snoozeRepo: new SnoozeRepository(pool),
      snoozeTaskTypeRepo: new SnoozeTaskTypeRepository(pool),
      eventWriter
    });
  }

  function makeSnoozeIntake() {
    return new SnoozeIntakeModule({
      snoozeRepo: new SnoozeRepository(pool),
      githubRepoProjectRepo: { findByRepoId: async () => null },
      eventWriter
    });
  }

  async function seedExecutionRoute() {
    await routeRepo.create({
      id: 'route-exec', project_id: 'proj-1', task_type: 'coding', actor: 'assignee',
      session_key: 'agent:main:proj:run:[wake_route_lease_id]', agent_id: 'agent-main', agent_name: 'Main Agent',
      delivery: 'run', max_run: 1, status: 'active', create_time: Date.now(), update_time: Date.now()
    });
  }

  function executionWakeBody() {
    return makeWakeBody({
      task_type: 'coding',
      task_status: 'Progress',
      task_audit: 'Gated',
      task_branch: BRANCH
    });
  }

  function workflowRun(action: string) {
    return {
      action,
      workflow_run: { name: 'CI', head_branch: BRANCH, head_sha: 'sha-e2e', id: 424242, run_attempt: 1 },
      repository: { node_id: 'REPO_NODE', full_name: 'owner-login/sample_project' }
    };
  }

  async function postWebhook(app: ReturnType<typeof buildServer>, payload: unknown) {
    return app.inject({
      method: 'POST', url: '/adapters/github/webhook',
      headers: { 'x-github-event': 'workflow_run', 'x-hub-signature-256': signed(payload) },
      payload: payload as object
    });
  }

  test('Shape A: the empty run holds while CI runs, then re-wakes with the settled-holds context', async () => {
    await seedSnoozeTaskTypes(pool);
    await seedExecutionRoute();
    const snooze = makeSnoozeModule();
    const app = buildServer({ pool, eventWriter, githubSecret: SECRET, snoozeIntake: makeSnoozeIntake() });
    const worker = makeWorker({ snooze });

    // Execution wake dispatches; the agent pushes (CI starts) and its turn ends.
    await app.inject({ method: 'POST', url: '/wake', payload: executionWakeBody() });
    expect(await worker.runOnce()).toBe(true);
    const [wake] = await wakeRepo.listAll();
    expect(wake!.status).toBe('dispatched');
    const lease1 = (await leaseRepo.findOpenByWakeId(wake!.id))!;
    expect(sent).toHaveLength(1);

    expect((await postWebhook(app, workflowRun('requested'))).statusCode).toBe(200);
    await worker.handleAgentEvent({ runId: lease1.id, stream: 'lifecycle', data: { phase: 'end' } });

    // Empty run + active hold → deferred, not re-waked. No lease touched.
    expect(await worker.runOnce()).toBe(true);
    expect(sent).toHaveLength(1);
    const held = await wakeRepo.findById(wake!.id);
    expect(held!.status).toBe('dispatched');
    expect(held!.wake_attempts).toBe(1); // held waits never consume the cap
    const deferral = readEvents().find((e) => e.event_code === 2019);
    expect(deferral).toMatchObject({ wake_id: wake!.id, branch: BRANCH, holding_types: ['CI'] });

    // CI completes (conclusion never read) → the predicate goes false; the
    // standing re-wake re-engages with the settled-holds context.
    expect((await postWebhook(app, workflowRun('completed'))).statusCode).toBe(200);
    expect(await worker.runOnce()).toBe(true);

    const rewaked = await wakeRepo.findById(wake!.id);
    expect(rewaked!.wake_attempts).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.params.message).toBe('INTEGRATION-RENDERED-REWAKE-MESSAGE');
    expect(rewakeContexts).toHaveLength(1);
    expect(rewakeContexts[0]!.settledHolds).toEqual([
      expect.objectContaining({ typeName: 'CI', status: 'completed' })
    ]);
    // A fresh lease for the re-wake turn.
    const leases = await leaseRepo.listByWakeId(wake!.id);
    expect(leases).toHaveLength(2);

    const events = readEvents();
    expect(events.find((e) => e.event_code === 6001)).toBeDefined();
    expect(events.find((e) => e.event_code === 6004)).toBeDefined();
  });

  test('start event lost: the re-wake fires during CI (one polite turn), never a jam', async () => {
    await seedSnoozeTaskTypes(pool);
    await seedExecutionRoute();
    const snooze = makeSnoozeModule();
    const app = buildServer({ pool, eventWriter, githubSecret: SECRET, snoozeIntake: makeSnoozeIntake() });
    const worker = makeWorker({ snooze });

    await app.inject({ method: 'POST', url: '/wake', payload: executionWakeBody() });
    await worker.runOnce();
    const [wake] = await wakeRepo.listAll();
    const lease1 = (await leaseRepo.findOpenByWakeId(wake!.id))!;
    await worker.handleAgentEvent({ runId: lease1.id, stream: 'lifecycle', data: { phase: 'end' } });

    // No start event ever arrived — no hold exists; the empty-run re-wake
    // fires while CI runs. The agent checks, replies "waiting", ends its turn.
    expect(await worker.runOnce()).toBe(true);
    expect(sent).toHaveLength(2);
    expect((await wakeRepo.findById(wake!.id))?.wake_attempts).toBe(2);
  });
});
