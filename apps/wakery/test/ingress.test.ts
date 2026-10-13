import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestPool, createTempDir, seedProject } from './helpers.js';
import { runMigrations } from '@vork/data';
import { buildServer } from '../src/ingress/app.js';
import { EventWriter } from '../src/events/writer.js';
import { WakeRepository } from '../src/db/wake-repository.js';
import { LeaseRepository } from '../src/db/lease-repository.js';
import { RouteRepository } from '../src/db/route-repository.js';
import { GithubAgentRepository } from '../src/db/github-agent-repository.js';
import { makeStateKey, makeTaskKey } from '../src/shared/ids.js';

let pool: Pool;
let wakeRepo: WakeRepository;
let leaseRepo: LeaseRepository;
let routeRepo: RouteRepository;
let githubAgentRepo: GithubAgentRepository;

const validBody = {
  request_id: 'req-1',
  source: 'github',
  project_id: 'proj-1',
  task_id: 'task-1',
  task_type: 'implementation',
  task_title: 'Build thing',
  task_priority: 5,
  task_status: 'Todo',
  task_audit: 'Approved',
  assignee_id: 'U_worker',
  assignee_name: 'worker-login',
  owner_id: 'U_owner',
  owner_name: 'owner-login',
  timestamp: Date.now()
};

async function seedGithubAgents(repo: GithubAgentRepository) {
  const now = Date.now();
  await repo.create({ id: 'am-1', github_login: 'worker-login', github_node_id: 'U_worker', agent_id: 'agent-main', agent_name: 'Main Agent', role: 'agent', status: 'active', create_time: now, update_time: now });
  await repo.create({ id: 'am-2', github_login: 'owner-login', github_node_id: 'U_owner', agent_id: 'principal', agent_name: 'Principal', role: 'principal', status: 'active', create_time: now, update_time: now });
  await repo.create({ id: 'am-3', github_login: 'auditor-login', github_node_id: 'U_auditor', agent_id: 'agent-heimdall', agent_name: 'Heimdall', role: 'auditor', status: 'active', create_time: now, update_time: now });
}

describe('POST /wake', () => {
  beforeEach(async () => {
    pool = await createTestPool();
    await runMigrations(pool);
    await seedProject(pool, 'proj-1');
  await seedProject(pool, 'proj-1');
    wakeRepo = new WakeRepository(pool);
    leaseRepo = new LeaseRepository(pool);
    routeRepo = new RouteRepository(pool);
    githubAgentRepo = new GithubAgentRepository(pool);
    await seedGithubAgents(githubAgentRepo);
  });

  test('rejects invalid WakeRequest', async () => {
    const app = buildServer({
      pool,
      eventWriter: new EventWriter(createTempDir())
    });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { request_id: 'bad' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('rejected');
  });

  test('same-state request updates current wake occurrence', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    const first = await app.inject({ method: 'POST', url: '/wake', payload: validBody });
    expect(first.statusCode).toBe(202);
    expect(first.json().status).toBe('accepted');

    const second = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-2', task_title: 'Build thing v2' }
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('updated');

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.task_title).toBe('Build thing v2');
  });

  test('changed-state request creates new wake occurrence, completes the previous WAKE, and leaves its lease untouched (two-ledger)', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    await app.inject({ method: 'POST', url: '/wake', payload: validBody });
    const [firstWake] = await wakeRepo.listAll();
    expect(firstWake).toBeTruthy();
    await routeRepo.create({
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: null, agent_id: 'agent-main', agent_name: 'Main Agent', delivery: 'run', max_run: 1, status: 'active',
      create_time: Date.now(), update_time: Date.now()
    });
    await leaseRepo.create({
      id: 'lease-1',
      route_id: 'route-1',
      wake_id: firstWake!.id,
      wake_task_status: firstWake!.task_status,
      task_key: firstWake!.task_key,
      activity_time: Date.now(),
      status: 'active',
      create_time: Date.now(),
      update_time: Date.now()
    });

    const second = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-3', task_status: 'Progress', task_audit: 'Gated' }
    });

    expect(second.statusCode).toBe(202);
    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(2);
    const completed = wakes.find((wake: any) => wake.id === firstWake!.id);
    const current = wakes.find((wake: any) => wake.id !== firstWake!.id);
    expect(completed?.status).toBe('completed');
    expect(current?.status).toBe('queued');

    // Two-ledger rule: progression closes the wake only; the turn's lease
    // completes at the gateway's turn end, never here.
    const lease = await leaseRepo.findLatestByWakeId(firstWake!.id);
    expect(lease?.status).toBe('active');
  });

  test('hint-driven progression closes prior dispatched wake and creates a pending wake at the expected state', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    // Bootstrap directly via the repository: a dispatched Done+Approved wake
    // representing the post-execution owner-review state. We bypass ingress
    // here because Owner=owner-login (principal in the test seed) makes the
    // owner-lane ingress path drop the request as ineligible — but the wake
    // existing in the DB is the realistic precondition for this test.
    // Use worker-login as Owner (resolves to agent role in the seed) so the
    // post-closure Stage 4 eligibility on observed Done+Approved -> Owner
    // passes and Stage 5 creates the new pending wake. In production Owner
    // would also need to resolve to an agent for the owner-lane route to fire.
    const ownerOverrides = { owner_id: 'U_worker', owner_name: 'worker-login' };
    const now = Date.now();
    const priorTaskKey = makeTaskKey(validBody.project_id, validBody.task_id);
    const priorStateKey = makeStateKey(validBody.project_id, validBody.task_id, 'Done', 'Approved');
    const priorWake = {
      id: 'wake-prior-done',
      task_key: priorTaskKey,
      state_key: priorStateKey,
      project_id: validBody.project_id,
      project_name: null,
      task_id: validBody.task_id,
      task_type: validBody.task_type,
      task_title: validBody.task_title,
      task_priority: validBody.task_priority,
      task_status: 'Done',
      task_status_expected: null,
      task_audit: 'Approved',
      task_audit_expected: null,
      task_labels: null,
      task_relations: null, task_branch: null,
      task_payload: null,
      assignee_id: validBody.assignee_id,
      assignee_name: validBody.assignee_name,
      owner_id: ownerOverrides.owner_id,
      owner_name: ownerOverrides.owner_name,
      queue_attempts: 0,
      dispatch_attempts: 1,
      wake_attempts: 1,
      status: 'dispatched' as const,
      create_time: now,
      update_time: now
    };
    await wakeRepo.create(priorWake);

    // Simulate the wake having been dispatched with an active lease.
    await routeRepo.create({
      id: 'route-owner', project_id: 'proj-1', task_type: null, actor: 'owner',
      session_key: 'agent:main:proj:task:run:[wake_route_lease_id]',
      agent_id: 'main', agent_name: 'Main', delivery: 'run', max_run: 1, status: 'active',
      create_time: Date.now(), update_time: Date.now()
    });
    await leaseRepo.create({
      id: 'lease-owner', route_id: 'route-owner', wake_id: priorWake.id, wake_task_status: priorWake.task_status, task_key: priorWake.task_key,
      activity_time: Date.now(), status: 'active', create_time: Date.now(), update_time: Date.now()
    });

    // Hint-driven progression request: same canonical observed state (Done+Approved,
    // because the ProjectV2 read path lagged the agent's Status field update), but
    // the source adapter parsed `To: Reviewed` from the transition comment.
    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: {
        ...validBody,
        ...ownerOverrides,
        request_id: 'req-hint-driven',
        task_status: 'Done',
        task_audit: 'Approved',
        task_status_expected: 'Reviewed'
      }
    });
    expect(response.statusCode).toBe(202);

    // The prior WAKE closes by progression; its lease is untouched (two-ledger).
    const closedPrior = await wakeRepo.findById(priorWake.id);
    expect(closedPrior?.status).toBe('completed');
    const priorLease = await leaseRepo.findLatestByWakeId(priorWake.id);
    expect(priorLease?.status).toBe('active');

    // A fresh pending wake must have been created at observed Done+Approved
    // with task_status_expected=Reviewed for the field-sync sweep to graduate.
    const allWakes = await wakeRepo.listAll();
    const fresh = allWakes.find((w: any) => w.id !== priorWake.id);
    expect(fresh).toBeTruthy();
    expect(fresh?.status).toBe('pending');
    expect(fresh?.task_status).toBe('Done');
    expect(fresh?.task_audit).toBe('Approved');
    expect(fresh?.task_status_expected).toBe('Reviewed');
    expect(fresh?.task_audit_expected).toBeNull();

    // The wake-progression event (1019) must carry trigger=hint so operators
    // can distinguish it from observed-state progression in the JSONL log.
    await new Promise((r) => setTimeout(r, 10));
    const files = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl'));
    const lines: Array<Record<string, unknown>> = [];
    for (const f of files) {
      for (const line of readFileSync(join(eventDir, f), 'utf8').split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
    }
    const progressionEvents = lines.filter((l) => l.event_name === 'wake.completed_by_task_progression');
    expect(progressionEvents).toHaveLength(1);
    expect(progressionEvents[0]).toMatchObject({
      trigger: 'hint',
      wake_id: priorWake.id,
      task_status_expected: 'Reviewed'
    });
  });

  test('observed-state progression event carries trigger=observed (regression check on existing path)', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    await app.inject({ method: 'POST', url: '/wake', payload: validBody });
    const [firstWake] = await wakeRepo.listAll();

    const second = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-observed-progression', task_status: 'Progress', task_audit: 'Gated' }
    });
    expect(second.statusCode).toBe(202);

    await new Promise((r) => setTimeout(r, 10));
    const files = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl'));
    const lines: Array<Record<string, unknown>> = [];
    for (const f of files) {
      for (const line of readFileSync(join(eventDir, f), 'utf8').split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
    }
    const progressionEvents = lines.filter((l) => l.event_name === 'wake.completed_by_task_progression');
    expect(progressionEvents).toHaveLength(1);
    expect(progressionEvents[0]).toMatchObject({
      trigger: 'observed',
      wake_id: firstWake!.id
    });
  });

  test('hint-driven closure fires even when expected state is terminal (To: Cancelled)', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    await app.inject({ method: 'POST', url: '/wake', payload: validBody });
    const [priorWake] = await wakeRepo.listAll();
    expect(priorWake?.status).toBe('queued');

    // Agent posts From: Todo / To: Cancelled. Canonical still says Todo+Approved.
    // Stage 3 must close the prior wake even though Cancelled is terminal and
    // the new request would otherwise be dropped at Stage 4.
    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: {
        ...validBody,
        request_id: 'req-hint-to-cancelled',
        task_status: 'Todo',
        task_audit: 'Approved',
        task_status_expected: 'Cancelled'
      }
    });
    // The request itself may be dropped at Stage 4 (eligibility on observed
    // Todo+Approved passes, so a new pending wake gets created with expected=Cancelled).
    // The point is the prior wake's lease/closure happens regardless.
    expect([200, 202]).toContain(response.statusCode);

    const closedPrior = await wakeRepo.findById(priorWake!.id);
    expect(closedPrior?.status).toBe('completed');

    await new Promise((r) => setTimeout(r, 10));
    const files = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl'));
    const lines: Array<Record<string, unknown>> = [];
    for (const f of files) {
      for (const line of readFileSync(join(eventDir, f), 'utf8').split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
    }
    const progressionEvents = lines.filter((l) => l.event_name === 'wake.completed_by_task_progression');
    expect(progressionEvents.some((e) => e.trigger === 'hint' && e.wake_id === priorWake!.id)).toBe(true);
  });

  test('ineligible request is dropped before storage', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-4', task_status: 'Completed', task_audit: 'Approved' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('dropped');
    expect(await wakeRepo.listAll()).toHaveLength(0);
  });

  test('progress request stores a new wake occurrence after accepting an approved task', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    await app.inject({ method: 'POST', url: '/wake', payload: validBody });
    const [todoWake] = await wakeRepo.listAll();
    expect(todoWake).toBeTruthy();

    await routeRepo.create({
      id: 'route-progress', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'sess-progress', agent_id: 'agent-main', agent_name: 'Main Agent', delivery: 'session', max_run: 1, status: 'active',
      create_time: Date.now(), update_time: Date.now()
    });
    await leaseRepo.create({
      id: 'lease-progress-acceptance',
      route_id: 'route-progress',
      wake_id: todoWake!.id,
      wake_task_status: todoWake!.task_status,
      task_key: todoWake!.task_key,
      activity_time: Date.now(),
      status: 'active',
      create_time: Date.now(),
      update_time: Date.now()
    });

    const progress = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-progress-accepted', task_status: 'Progress', task_audit: 'Gated' }
    });

    expect(progress.statusCode).toBe(202);
    expect(progress.json().status).toBe('accepted');

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(2);
    const completed = wakes.find((wake: any) => wake.id === todoWake!.id);
    const current = wakes.find((wake: any) => wake.id !== todoWake!.id);
    expect(completed?.status).toBe('completed');
    expect(current?.status).toBe('queued');
    expect(current?.task_status).toBe('Progress');
    expect(current?.task_audit).toBe('Gated'); // execution lane re-gates on entry (two-gate)

    // Two-ledger rule: the acceptance turn's lease is untouched by the
    // progression — it completes at its own turn end via the dispatch worker.
    // The task-turn gate is what holds the successor wake until then.
    const lease = await leaseRepo.findLatestByWakeId(todoWake!.id);
    expect(lease?.status).toBe('active');
  });

  // Two-ledger rule: even an OBSERVED terminal state never completes a lease
  // at ingress — lease completion belongs exclusively to the dispatch worker.
  test('observed terminal state closes the wake but leaves the lease to the dispatch worker', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    await app.inject({ method: 'POST', url: '/wake', payload: validBody });
    const [todoWake] = await wakeRepo.listAll();
    await routeRepo.create({
      id: 'route-term', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'sess-term', agent_id: 'agent-main', agent_name: 'Main Agent', delivery: 'session', max_run: 1, status: 'active',
      create_time: Date.now(), update_time: Date.now()
    });
    await leaseRepo.create({
      id: 'lease-term', route_id: 'route-term', wake_id: todoWake!.id, wake_task_status: todoWake!.task_status,
      task_key: todoWake!.task_key, activity_time: Date.now(), status: 'active', create_time: Date.now(), update_time: Date.now()
    });

    // Task reaches Completed. The owner here is the Principal, so the cue-wake
    // path resolves principal_handled (dropped, no cue stored) — Stage 3
    // observed-progression closes the prior WAKE, and only the wake.
    const done = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-terminal', task_status: 'Completed', task_audit: 'Approved' }
    });
    expect(done.json().status).toBe('dropped');

    expect((await wakeRepo.findById(todoWake!.id))?.status).toBe('completed');
    const lease = await leaseRepo.findLatestByWakeId(todoWake!.id);
    expect(lease?.status).toBe('active');
  });

  test('state progression closes the previous wake even when new state is ineligible (principal owner); lease untouched', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    // First wake: Todo+Gated, routable to auditor
    const first = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-progress-1', task_status: 'Todo', task_audit: 'Gated' }
    });
    expect(first.json().status).toBe('accepted');
    const [firstWake] = await wakeRepo.listAll();
    expect(firstWake).toBeTruthy();

    // Seed a route + active lease for the first wake
    await routeRepo.create({
      id: 'route-audit', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'sess-audit', agent_id: 'agent-heimdall', agent_name: 'Heimdall', delivery: 'run', max_run: 1, status: 'active',
      create_time: Date.now(), update_time: Date.now()
    });
    await leaseRepo.create({
      id: 'lease-progress',
      route_id: 'route-audit',
      wake_id: firstWake!.id,
      wake_task_status: firstWake!.task_status,
      task_key: firstWake!.task_key,
      activity_time: Date.now(),
      status: 'active',
      create_time: Date.now(),
      update_time: Date.now()
    });

    // Second wake: state progressed to Todo+Revise. Responsible actor = owner = owner-login (principal) → ineligible.
    const second = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-progress-2', task_status: 'Todo', task_audit: 'Revise' }
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('dropped');

    // Despite the drop, the previous wake must be closed because state
    // progressed; its lease belongs to the dispatch worker and stays open.
    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.status).toBe('completed');

    const lease = await leaseRepo.findLatestByWakeId(firstWake!.id);
    expect(lease?.status).toBe('active');
  });

  test('request with disagreeing task_status_expected stores wake in pending', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-pending', task_status: 'Todo', task_status_expected: 'Progress' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');

    const [wake] = await wakeRepo.listAll();
    expect(wake?.status).toBe('pending');
    expect(wake?.task_status).toBe('Todo');
    expect(wake?.task_status_expected).toBe('Progress');
    expect(wake?.task_audit_expected).toBeNull();
    expect(wake?.queue_attempts).toBe(0);
  });

  test('request with disagreeing task_audit_expected stores wake in pending', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-pending-audit', task_audit: 'Gated', task_audit_expected: 'Approved' }
    });

    expect(response.statusCode).toBe(202);

    const [wake] = await wakeRepo.listAll();
    expect(wake?.status).toBe('pending');
    expect(wake?.task_audit).toBe('Gated');
    expect(wake?.task_audit_expected).toBe('Approved');
    expect(wake?.task_status_expected).toBeNull();
  });

  test('request whose expected hint matches observed values stays queued (no field-lag)', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-no-lag', task_status: 'Todo', task_status_expected: 'Todo', task_audit: 'Approved', task_audit_expected: 'Approved' }
    });

    expect(response.statusCode).toBe(202);

    const [wake] = await wakeRepo.listAll();
    expect(wake?.status).toBe('queued');
    expect(wake?.task_status_expected).toBeNull();
    expect(wake?.task_audit_expected).toBeNull();
  });

  test('same-state request against pending wake with matching hint/observed resets queue_attempts and keeps pending', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    // Bootstrap: pending wake with task_status='Todo' but expected='Progress'
    const first = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-lag', task_status: 'Todo', task_status_expected: 'Progress' }
    });
    expect(first.statusCode).toBe(202);

    const [pending] = await wakeRepo.listAll();
    expect(pending?.status).toBe('pending');
    expect(pending?.queue_attempts).toBe(0);

    // Simulate the field-sync sweep exhausting its budget.
    await wakeRepo.bumpQueueAttempts(pending!.id);
    await wakeRepo.bumpQueueAttempts(pending!.id);
    await wakeRepo.bumpQueueAttempts(pending!.id);
    const frozen = await wakeRepo.findById(pending!.id);
    expect(frozen?.queue_attempts).toBe(3);
    expect(frozen?.status).toBe('pending');

    // Same-state request with no field-lag (no hints, or hints agreeing with observed).
    // state_key derives from observed task_status/task_audit, so this must match the
    // pending row's state_key — observed values stay 'Todo'/'Approved'.
    const refresh = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-refresh' }
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().status).toBe('updated');

    const refreshed = await wakeRepo.findById(pending!.id);
    expect(refreshed?.status).toBe('pending'); // ingress never graduates
    expect(refreshed?.queue_attempts).toBe(0);
    expect(refreshed?.task_status_expected).toBe('Progress'); // worker-owned, untouched
    await new Promise((r) => setTimeout(r, 10));

    const files = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl'));
    const lines: Array<Record<string, unknown>> = [];
    for (const f of files) {
      for (const line of readFileSync(join(eventDir, f), 'utf8').split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
    }
    const refreshedEvents = lines.filter((l) => l.event_name === 'wake.pending.refreshed');
    expect(refreshedEvents).toHaveLength(1);
    expect(refreshedEvents[0]).toMatchObject({ prior_queue_attempts: 3, wake_id: pending!.id });
  });

  test('same-state request against pending wake with still-mismatched hints leaves queue_attempts untouched', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-lag-1', task_status: 'Todo', task_status_expected: 'Progress' }
    });
    const [pending] = await wakeRepo.listAll();
    await wakeRepo.bumpQueueAttempts(pending!.id);
    await wakeRepo.bumpQueueAttempts(pending!.id);
    const before = await wakeRepo.findById(pending!.id);
    expect(before?.queue_attempts).toBe(2);

    // Second request also carries a still-disagreeing hint; observed unchanged so state_key matches.
    const second = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-lag-2', task_status: 'Todo', task_status_expected: 'Progress' }
    });
    expect(second.statusCode).toBe(200);

    const after = await wakeRepo.findById(pending!.id);
    expect(after?.status).toBe('pending');
    expect(after?.queue_attempts).toBe(2); // unchanged
    expect(after?.task_status_expected).toBe('Progress');
  });

  test('request without any expected hints stays queued (existing path unchanged)', async () => {
    const app = buildServer({ pool, eventWriter: new EventWriter(createTempDir()) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: validBody
    });

    expect(response.statusCode).toBe(202);
    const [wake] = await wakeRepo.listAll();
    expect(wake?.status).toBe('queued');
  });

  // The Govern carve-out (milestone_govern-notice_v2026.08.05,
  // spec_wakery-ingress-api.md Stage 4 "State-based"): a state-based Govern
  // arrival keeps its 1009 but stores a notification cue wake beside it and
  // emits 1020 — the Principal's checkpoint is no longer silent.
  test.each([
    ['Todo', 'Todo:Govern'],
    ['Done', 'Done:Govern']
  ])('%s:Govern state-based — emits 1009 (state_based) AND 1020, stores the notification cue wake', async (lifecycle, gate) => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-state-based', task_status: lifecycle, task_audit: 'Govern' }
    });

    // The cue wake stores through the normal path (owner = owner-login, the
    // Principal — the state-based test runs before identity resolution, so a
    // Govern on a Principal-owned task still cues).
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');
    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.task_status).toBe(lifecycle);
    expect(wakes[0]?.task_audit).toBe('Govern');
    expect(wakes[0]?.status).toBe('queued');

    const events = readEventLog(eventDir);
    const principal = events.find((e) => e.event_code === 1009);
    expect(principal).toBeDefined();
    expect(principal?.event_name).toBe('wake.request.principal_handled');
    expect(principal?.reason).toBe('state_based');
    expect(principal?.task_status).toBe(lifecycle);
    expect(principal?.task_audit).toBe('Govern');
    expect(principal?.responsible_actor).toBe('principal');
    const cue = events.find((e) => e.event_code === 1020);
    expect(cue).toBeDefined();
    expect(cue?.event_name).toBe('wake.govern.cue');
    expect(cue?.gate).toBe(gate);
    expect(cue?.task_id).toBe('task-1');
    // Legacy event must NOT fire for principal-handled cases.
    expect(events.find((e) => e.event_code === 1003)).toBeUndefined();
  });

  test('a repeated Govern webhook updates the cue wake (same-state dedup) — no duplicate rows; each arrival pairs one 1009 with one 1020', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });
    const governBody = { ...validBody, task_status: 'Todo', task_audit: 'Govern' };

    const first = await app.inject({ method: 'POST', url: '/wake', payload: { ...governBody, request_id: 'req-govern-1' } });
    expect(first.statusCode).toBe(202);
    expect(first.json().status).toBe('accepted');

    const second = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...governBody, request_id: 'req-govern-2', task_title: 'Build thing v2' }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('updated');

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.task_title).toBe('Build thing v2');
    expect(wakes[0]?.task_audit).toBe('Govern');

    const events = readEventLog(eventDir);
    expect(events.filter((e) => e.event_code === 1009)).toHaveLength(2);
    expect(events.filter((e) => e.event_code === 1020)).toHaveLength(2);
    expect(events.filter((e) => e.event_code === 1004)).toHaveLength(1); // one wake.created
  });

  test('a Govern cue wake completes by ordinary progression closure when the verdict transitions the task', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-govern-cue', task_status: 'Todo', task_audit: 'Govern' }
    });
    const [cueWake] = await wakeRepo.listAll();
    expect(cueWake?.task_audit).toBe('Govern');

    // The Principal's verdict: Todo:Govern -> Todo:Approved.
    const verdict = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-verdict', task_status: 'Todo', task_audit: 'Approved' }
    });
    expect(verdict.statusCode).toBe(202);

    const after = await wakeRepo.findById(cueWake!.id);
    expect(after?.status).toBe('completed');
    const events = readEventLog(eventDir);
    expect(events.some((e) => e.event_code === 1019 && e.wake_id === cueWake!.id)).toBe(true);
  });

  test('Pending:Approved with owner=the Principal identity-based principal-handled — emits wake.request.principal_handled with reason=identity_based and resolved identity', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: {
        ...validBody,
        request_id: 'req-identity-based',
        task_status: 'Pending',
        task_audit: 'Approved'
        // owner_id / owner_name from validBody resolve to owner-login (role=principal in seed).
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('dropped');
    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(0);

    const events = readEventLog(eventDir);
    const principal = events.find((e) => e.event_code === 1009);
    expect(principal).toBeDefined();
    expect(principal?.event_name).toBe('wake.request.principal_handled');
    expect(principal?.reason).toBe('identity_based');
    expect(principal?.task_status).toBe('Pending');
    expect(principal?.task_audit).toBe('Approved');
    expect(principal?.responsible_actor).toBe('owner');
    expect(principal?.resolved_agent_id).toBe('principal');
    expect(principal?.resolved_github_login).toBe('owner-login');
    // Legacy event must NOT fire for principal-handled cases.
    expect(events.find((e) => e.event_code === 1003)).toBeUndefined();
  });

  test('Heimdall fast-pass path unchanged — Todo:Gated with owner=the Principal still emits eligibility-pass via the auditor lane (no principal_handled drop)', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-fastpass', task_status: 'Todo', task_audit: 'Gated' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');
    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    // No principal-handled drop on the auditor lane; the fast-pass is Heimdall's
    // job downstream, not the ingress's. See spec_wakery-ingress-api.md §Stage 4
    // "Heimdall's Principal Fast-Pass is scoped to Todo:Gated ... the fast-pass
    // is Heimdall's behavior, not wakery's."
    const events = readEventLog(eventDir);
    expect(events.find((e) => e.event_code === 1009)).toBeUndefined();
  });

  // Conduction chaining (spec_wakery-conduction-chaining.md Stage 2): observed
  // terminal transitions store owner-lane chain-cue wakes instead of dropping.
  test('terminal transition with an agent owner stores an owner chain-cue wake and emits 1016', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: {
        ...validBody,
        request_id: 'req-cue',
        task_status: 'Completed',
        task_audit: 'Approved',
        task_branch: 'feature/wake-radar',
        owner_id: 'U_worker',
        owner_name: 'worker-login'
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('accepted');

    const wakes = await wakeRepo.listAll();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.status).toBe('queued');
    expect(wakes[0]?.task_status).toBe('Completed');
    expect(wakes[0]?.task_branch).toBe('feature/wake-radar');

    const events = readEventLog(eventDir);
    const cue = events.find((e) => e.event_code === 1016);
    expect(cue).toBeDefined();
    expect(cue?.event_name).toBe('wake.chain.terminal_cue');
    expect(cue?.task_type).toBe('implementation');
    expect(cue?.task_status).toBe('Completed');
    expect(cue?.task_branch).toBe('feature/wake-radar');
  });

  test('Cancelled cues the owner regardless of carried audit value (wildcard lane)', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: {
        ...validBody,
        request_id: 'req-cue-cancelled',
        task_status: 'Cancelled',
        task_audit: 'Revise',
        owner_id: 'U_worker',
        owner_name: 'worker-login'
      }
    });

    expect(response.json().status).toBe('accepted');
    const events = readEventLog(eventDir);
    const cue = events.find((e) => e.event_code === 1016);
    expect(cue?.task_status).toBe('Cancelled');
    expect(cue?.task_audit).toBe('Revise');
  });

  test('duplicate terminal request updates the same cue occurrence — exactly one 1016', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });
    const cueBody = {
      ...validBody,
      task_status: 'Completed',
      task_audit: 'Approved',
      owner_id: 'U_worker',
      owner_name: 'worker-login'
    };

    const first = await app.inject({ method: 'POST', url: '/wake', payload: { ...cueBody, request_id: 'req-cue-1' } });
    expect(first.json().status).toBe('accepted');
    const second = await app.inject({ method: 'POST', url: '/wake', payload: { ...cueBody, request_id: 'req-cue-2' } });
    expect(second.json().status).toBe('updated');

    expect(await wakeRepo.listAll()).toHaveLength(1);
    const cues = readEventLog(eventDir).filter((e) => e.event_code === 1016);
    expect(cues).toHaveLength(1);
  });

  test('principal-owned terminal transition takes principal_handled (1009) — no cue stored', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    // validBody's owner is owner-login → role principal: Principal-owned
    // checkpoints chain on the Principal's own direction, not on a cue.
    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-cue-principal', task_status: 'Completed', task_audit: 'Approved' }
    });

    expect(response.json().status).toBe('dropped');
    expect(await wakeRepo.listAll()).toHaveLength(0);
    const events = readEventLog(eventDir);
    expect(events.find((e) => e.event_code === 1009)).toBeDefined();
    expect(events.find((e) => e.event_code === 1016)).toBeUndefined();
  });

  test('non-principal dropped paths still use wake.request.dropped_ineligible (1003), not 1009', async () => {
    const eventDir = createTempDir();
    const app = buildServer({ pool, eventWriter: new EventWriter(eventDir) });

    // Unknown state — `Rework` does not exist in the two-gate machine, so the
    // matrix has no row for it: dropped path, NOT principal. (Terminal states
    // are no longer drops — they are owner-lane chain cues, and with a
    // principal owner they take the 1009 path; see the chain-cue tests.)
    const response = await app.inject({
      method: 'POST',
      url: '/wake',
      payload: { ...validBody, request_id: 'req-unknown-state', task_status: 'Rework', task_audit: 'Approved' }
    });

    expect(response.json().status).toBe('dropped');
    const events = readEventLog(eventDir);
    expect(events.find((e) => e.event_code === 1003)).toBeDefined();
    expect(events.find((e) => e.event_code === 1009)).toBeUndefined();
  });
});

function readEventLog(eventDir: string): Array<Record<string, unknown>> {
  const files = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl'));
  return files.flatMap((f) =>
    readFileSync(join(eventDir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  );
}
