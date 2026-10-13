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
import { DispatchWorker, type DispatchWorkerDeps } from '../src/worker/dispatch-worker.js';
import { EventWriter } from '../src/events/writer.js';
import type { RewakeRenderContext } from '../src/templates/renderer.js';
import type { Route, Wake } from '../src/shared/types.js';

// Cap-alert final wake (self-healing F2b, spec_wakery-cap-alert-message.md):
// exactly at the re-wake cap, one additional one-duty delivery turn reports the
// blockage to the Principal; the alert send consumes the wake past the cap and
// the wake then leaves the selection pool permanently. 2017 stays the machine
// record; 2022 marks the delivery.

const CAP = 2;

let pool: Pool;
let wakeRepo: WakeRepository;
let routeRepo: RouteRepository;
let leaseRepo: LeaseRepository;
let rendered: Array<{ wakeId: string; ctx?: RewakeRenderContext }>;
let sent: string[];

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  await seedProject(pool, 'proj-1');
  wakeRepo = new WakeRepository(pool);
  routeRepo = new RouteRepository(pool);
  leaseRepo = new LeaseRepository(pool);
  rendered = [];
  sent = [];
});

function makeWorker(overrides: Partial<DispatchWorkerDeps> = {}, eventDir = createTempDir()) {
  const worker = new DispatchWorker({
    wakeRepo,
    routeRepo,
    leaseRepo,
    githubAgentRepo: new GithubAgentRepository(pool),
    adapter: {
      renderTurn: async (wake: Wake, _route: Route, ctx?: RewakeRenderContext) => {
        rendered.push({ wakeId: wake.id, ctx });
        return 'MSG';
      },
      send: async (_routed, message: string) => { sent.push(message); }
    },
    eventWriter: new EventWriter(eventDir),
    rewakeMaxAttempts: CAP,
    dispatchReboundCooldownMs: 0,
    ...overrides
  });
  return { worker, eventDir };
}

function readEvents(dir: string) {
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  );
}

async function seedCappedWake(overrides: Partial<Wake> = {}): Promise<Wake> {
  const now = Date.now();
  await routeRepo.create({
    id: 'route-1', project_id: 'proj-1', task_type: 'coding', actor: 'assignee',
    session_key: 'sess-1', agent_id: 'agent-1', agent_name: 'Agent 1', delivery: 'session', max_run: 1, status: 'active',
    create_time: now, update_time: now
  });
  return wakeRepo.create({
    id: 'wake-capped', task_key: 'tk-capped', state_key: 'sk-capped',
    project_id: 'proj-1', project_name: null, task_id: '42', task_type: 'coding',
    task_title: 'Blocked task', task_priority: null,
    task_status: 'Progress', task_status_expected: null,
    task_audit: 'Gated', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: null, task_payload: null,
    assignee_id: 'agent-1', assignee_name: 'Agent 1', owner_id: null, owner_name: null,
    queue_attempts: 0, dispatch_attempts: 1, wake_attempts: CAP,
    status: 'dispatched',
    // update_time in the past so the rebound cooldown never interferes.
    create_time: now - 600_000, update_time: now - 600_000,
    ...overrides
  });
}

describe('dispatch worker — cap-alert final wake (F2b)', () => {
  test('exactly at the cap: one alert turn dispatches with the cap-alert template, then the pool closes', async () => {
    await seedCappedWake();
    const { worker, eventDir } = makeWorker();

    expect(await worker.runOnce()).toBe(true);
    // The alert turn rendered with the capAlert marker on the rewake context.
    expect(rendered).toHaveLength(1);
    expect(rendered[0].ctx?.capAlert).toBe(true);
    expect(sent).toHaveLength(1);

    const after = await wakeRepo.findById('wake-capped');
    expect(after?.wake_attempts).toBe(CAP + 1); // the alert consumed the one extra turn

    const events = readEvents(eventDir);
    expect(events.filter((e) => e.event_code === 2017)).toHaveLength(1); // machine record
    expect(events.filter((e) => e.event_code === 2022)).toHaveLength(1); // human delivery
    expect(events.find((e) => e.event_code === 2005)?.template).toBe('cap-alert');

    // Complete the alert turn's lease, then sweep again: past the cap, the
    // wake leaves the pool permanently — no second alert, no re-wake.
    const lease = await leaseRepo.findOpenByTaskKey('tk-capped');
    expect(lease).not.toBeNull();
    await pool.query(`UPDATE wake_route_lease SET status='completed' WHERE id=$1`, [lease!.id]);
    await pool.query(`UPDATE wake SET update_time=$1 WHERE id='wake-capped'`, [Date.now() - 600_000]);
    expect(await worker.runOnce()).toBe(false);
    expect(rendered).toHaveLength(1);
  });

  test('below the cap the normal re-wake path runs — no capAlert marker', async () => {
    await seedCappedWake({ wake_attempts: CAP - 1 });
    const { worker } = makeWorker();
    await worker.runOnce();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].ctx?.capAlert).toBeUndefined();
  });

  test('the alert turn bypasses the snooze consult — a hold must not defer the report', async () => {
    await seedCappedWake();
    const { worker } = makeWorker({
      snooze: {
        consultSnoozes: async () => [{ id: 'hold-1' } as never],
        holdingTypeNames: () => ['CI'],
        timeoutSweep: async () => 0,
        settledHolds: async () => []
      }
    });
    expect(await worker.runOnce()).toBe(true);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].ctx?.capAlert).toBe(true);
  });

  test('a failed alert send retries: attempts stay at the cap, the next sweep re-alerts', async () => {
    await seedCappedWake();
    let fail = true;
    const { worker, eventDir } = makeWorker({
      adapter: {
        renderTurn: async (wake: Wake, _route: Route, ctx?: RewakeRenderContext) => {
          rendered.push({ wakeId: wake.id, ctx });
          return 'MSG';
        },
        send: async () => { if (fail) { fail = false; throw new Error('gateway link down'); } sent.push('MSG'); }
      }
    });

    await worker.runOnce();
    expect((await wakeRepo.findById('wake-capped'))?.wake_attempts).toBe(CAP);
    await pool.query(`UPDATE wake SET update_time=$1 WHERE id='wake-capped'`, [Date.now() - 600_000]);
    await worker.runOnce();
    expect((await wakeRepo.findById('wake-capped'))?.wake_attempts).toBe(CAP + 1);
    expect(sent).toHaveLength(1);
    const events = readEvents(eventDir);
    expect(events.filter((e) => e.event_code === 2022)).toHaveLength(1);
  });
});
