import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { runMigrations } from '@vork/data';
import { RouteRepository } from '../db/route-repository.js';
import { WakeRepository } from '../db/wake-repository.js';
import { LeaseRepository } from '../db/lease-repository.js';
import { GithubAgentRepository } from '../db/github-agent-repository.js';
import { GatewayLink } from '../adapters/openclaw/link.js';
import { FileGatewayDeviceIdentityStore } from '../adapters/openclaw/device-auth.js';
import { renderWakeryRunSessionKey } from '../adapters/openclaw/run-session.js';
import { OpenClawAdapter } from '../adapters/openclaw/adapter.js';
import { EventWriter } from '../events/writer.js';
import { DispatchWorker } from '../worker/dispatch-worker.js';
import { mintId } from '../shared/ids.js';
import type { Route, Wake } from '../shared/types.js';

function usage(): never {
  console.error('Usage:');
  console.error('  npm run smoke:dispatch-flow -- session <agentId>');
  console.error('  npm run smoke:dispatch-flow -- run <agentId>');
  process.exit(1);
}

function parseDelivery(value: string | undefined): 'session' | 'run' {
  if (value === 'session' || value === 'run') return value;
  usage();
}

function routeAgentId(target: string) {
  return target;
}

const [deliveryArg, target] = process.argv.slice(2);
if (!target) usage();
const delivery = parseDelivery(deliveryArg);

const config = loadConfig();
const pool = createPool(config);
const now = Date.now();
const smokeProjectId = `wakery/smoke-dispatch-flow/${now}`;
const smokeProjectKey = 'wakery_smoke';
const smokeTaskType = 'smoke_dispatch_flow';
const wakeId = mintId('wake');
const routeId = mintId('route');
const taskId = `task_${now}`;
const taskKey = `taskkey_${now}`;
const stateKey = `state_${now}`;

try {
  await runMigrations(pool);

  const routeRepo = new RouteRepository(pool);
  const wakeRepo = new WakeRepository(pool);
  const leaseRepo = new LeaseRepository(pool);

  const route: Route = {
    id: routeId,
    project_id: smokeProjectId,
    task_type: smokeTaskType,
    actor: target === 'heimdall' ? 'auditor' : 'assignee',
    session_key: delivery === 'session'
      ? `agent:${routeAgentId(target)}:${smokeProjectKey}:main`
      : `agent:${routeAgentId(target)}:${smokeProjectKey}:run:[wake_route_lease_id]`,
    agent_id: target,
    agent_name: null,
    delivery,
    max_run: 1,
    status: 'active',
    create_time: now,
    update_time: now
  };
  await routeRepo.create(route);

  const wake: Wake = {
    id: wakeId,
    task_key: taskKey,
    state_key: stateKey,
    project_id: smokeProjectId,
    project_name: null,
    task_id: taskId,
    task_type: smokeTaskType,
    task_title: `Wakery smoke dispatch flow ${delivery}`,
    task_priority: Math.floor(now / 1000),
    task_status: 'Todo',
    task_status_expected: null,
    task_audit: 'Approved',
    task_audit_expected: null,
    task_labels: null,
    task_relations: null, task_branch: null,
    task_payload: {
      source: 'smoke-dispatch-flow',
      delivery,
      target
    },
    assignee_id: target,
    assignee_name: null,
    owner_id: null,
    owner_name: null,
    queue_attempts: 0,
    dispatch_attempts: 0,
    wake_attempts: 0,
    status: 'queued',
    create_time: now,
    update_time: now
  };
  await wakeRepo.create(wake);

  const eventWriter = new EventWriter(config.WAKERY_EVENT_LOG_DIR);
  const link = new GatewayLink(config.WAKERY_OPENCLAW_GATEWAY_URL, config.WAKERY_OPENCLAW_GATEWAY_TOKEN, {
    identityStore: new FileGatewayDeviceIdentityStore(config.WAKERY_OPENCLAW_DEVICE_DIR),
    eventWriter
  });
  const connected = new Promise<void>((resolve) => link.onConnected(() => resolve()));
  link.start();
  await connected;
  const { buildRendererAndStore } = await import('../templates/build-renderer.js');
  const { renderer } = await buildRendererAndStore(pool, config, eventWriter);
  const adapter = new OpenClawAdapter(link, eventWriter, renderer);
  const worker = new DispatchWorker({ wakeRepo, routeRepo, leaseRepo, adapter, eventWriter, githubAgentRepo: new GithubAgentRepository(pool) });

  const processed = await worker.runOnce();
  link.stop();
  const wakeAfter = await wakeRepo.findById(wakeId);
  const leaseAfter = await leaseRepo.findLatestByWakeId(wakeId);

  console.log(JSON.stringify({
    ok: true,
    processed,
    delivery,
    target,
    project_id: smokeProjectId,
    route_id: routeId,
    wake_id: wakeId,
    run_session_key: delivery === 'run' && leaseAfter?.id ? renderWakeryRunSessionKey(route.session_key!, leaseAfter.id) : null,
    wake_status: wakeAfter?.status ?? null,
    queue_attempts: wakeAfter?.queue_attempts ?? null,
    dispatch_attempts: wakeAfter?.dispatch_attempts ?? null,
    lease_id: leaseAfter?.id ?? null,
    lease_status: leaseAfter?.status ?? null
  }, null, 2));
} finally {
  await pool.end();
}
