import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { WakeRepository } from './db/wake-repository.js';
import { RouteRepository } from './db/route-repository.js';
import { LeaseRepository } from './db/lease-repository.js';
import { GithubRepoProjectRepository } from './db/github-repo-project-repository.js';
import { GithubAgentRepository } from './db/github-agent-repository.js';
import { TaskTypeLabelRepository } from './db/task-type-label-repository.js';
import { SnoozeRepository } from './db/snooze-repository.js';
import { SnoozeTaskTypeRepository } from './db/snooze-task-type-repository.js';
import { EventWriter } from './events/writer.js';
import { GatewayLink } from './adapters/openclaw/link.js';
import { FileGatewayDeviceIdentityStore } from './adapters/openclaw/device-auth.js';
import { OpenClawAdapter } from './adapters/openclaw/adapter.js';
import { GitHubFieldSyncReader } from './adapters/github/field-sync-reader.js';
import { GitHubTaskRelationsRefresher } from './adapters/github/task-relations-refresher.js';
import { fetchIssueState } from './adapters/github/adapter.js';
import { DispatchWorker, buildTerminalVerifier } from './worker/dispatch-worker.js';
import { BoardSweeper } from './worker/board-sweep.js';
import { SnoozeModule } from './snooze/module.js';
import { SnoozeIntakeModule } from './snooze/intake.js';
import { buildServer } from './ingress/app.js';
import { IngressService } from './ingress/service.js';
import { buildRendererAndStore } from './templates/build-renderer.js';
import { log } from './log.js';

// Process layout (spec_wakery-dispatch-worker.md): ingress + ONE worker — the
// dispatch worker, holding the gateway link for the life of the process. The
// probe and snooze worker processes are retired
// (milestone_wakery-turn-signal_v2026.07.29).

const config = loadConfig();
const pool = createPool(config);

// Startup performs no DDL (#35 ruling (b)): migrations run as a standalone act
// under the owner role (`npm run migrate`, vork_owner); the runtime connects
// DML-only as vork_app. This guard turns a missed migration into a named
// operator error instead of a runtime crash mid-dispatch.
const schemaProbe = await pool.query(
  `SELECT 1 FROM information_schema.tables WHERE table_name = 'wake' LIMIT 1`
);
if (schemaProbe.rowCount === 0) {
  throw new Error('database schema absent — run `npm run migrate` (as vork_owner) before starting wakery');
}

const eventWriter = new EventWriter(config.WAKERY_EVENT_LOG_DIR);
const identityStore = new FileGatewayDeviceIdentityStore(config.WAKERY_OPENCLAW_DEVICE_DIR);

const wakeRepo = new WakeRepository(pool);
const routeRepo = new RouteRepository(pool);
const leaseRepo = new LeaseRepository(pool);
const githubRepoProjectRepo = new GithubRepoProjectRepository(pool);
const githubAgentRepo = new GithubAgentRepository(pool);

// --- The gateway link: one persistent authenticated connection ---
const link = new GatewayLink(config.WAKERY_OPENCLAW_GATEWAY_URL, config.WAKERY_OPENCLAW_GATEWAY_TOKEN, {
  identityStore,
  eventWriter,
  reconnectBackoffMs: config.WAKERY_GATEWAY_RECONNECT_BACKOFF_MS,
  sessionKeysProvider: () => routeRepo.listActiveSessionKeys()
});

const { renderer } = await buildRendererAndStore(pool, config, eventWriter);
const adapter = new OpenClawAdapter(link, eventWriter, renderer);
const fieldSyncReader = new GitHubFieldSyncReader(config.WAKERY_GITHUB_TOKEN, githubRepoProjectRepo);
const taskRelationsRefresher = new GitHubTaskRelationsRefresher(
  config.WAKERY_GITHUB_TOKEN,
  githubRepoProjectRepo,
  wakeRepo,
  eventWriter
);

// --- Snooze: a module, not a worker (spec_wakery-snooze.md) ---
const snoozeRepo = new SnoozeRepository(pool);
const snoozeModule = new SnoozeModule({
  snoozeRepo,
  snoozeTaskTypeRepo: new SnoozeTaskTypeRepository(pool),
  eventWriter,
  timeoutMs: config.WAKERY_SNOOZE_TIMEOUT_MS
});
const snoozeIntake = new SnoozeIntakeModule({ snoozeRepo, githubRepoProjectRepo, eventWriter });

// --- Board-reconcile sweep (self-healing F1): a module on the worker tick,
// minting through the same ingress service the webhook path uses ---
const boardSweeper = new BoardSweeper({
  githubToken: config.WAKERY_GITHUB_TOKEN,
  githubRepoProjectRepo,
  wakeRepo,
  leaseRepo,
  taskTypeLabelRepo: new TaskTypeLabelRepository(pool),
  githubAgentRepo,
  ingress: new IngressService(wakeRepo, githubAgentRepo, eventWriter),
  eventWriter,
  quietMs: config.WAKERY_BOARD_SWEEP_QUIET_MS,
  stallThresholdMs: config.WAKERY_STALL_THRESHOLD_MS
});

const dispatchWorker = new DispatchWorker({
  wakeRepo, routeRepo, leaseRepo, adapter, eventWriter,
  githubAgentRepo,
  snooze: snoozeModule,
  agentWait: (runId, timeoutMs) => link.wait(runId, timeoutMs),
  terminalVerifier: buildTerminalVerifier({
    githubToken: config.WAKERY_GITHUB_TOKEN,
    githubRepoProjectRepo,
    fetchIssueState
  }),
  fieldSyncReader,
  taskRelationsRefresher,
  pendingRetryIntervalMs: config.WAKERY_PENDING_RETRY_INTERVAL_MS,
  pendingMaxAttempts: config.WAKERY_PENDING_MAX_ATTEMPTS,
  dispatchReboundCooldownMs: config.WAKERY_DISPATCH_REBOUND_COOLDOWN_MS,
  rewakeMaxAttempts: config.WAKERY_REWAKE_MAX_ATTEMPTS,
  leaseQuietThresholdMs: config.WAKERY_LEASE_QUIET_THRESHOLD_MS,
  leaseReconcileIntervalMs: config.WAKERY_LEASE_RECONCILE_INTERVAL_MS,
  parentRelationsRefreshIntervalMs: config.WAKERY_PARENT_RELATIONS_REFRESH_INTERVAL_MS,
  boardSweeper,
  boardSweepIntervalMs: config.WAKERY_BOARD_SWEEP_INTERVAL_MS
});

// Link → worker wiring: the watcher hears every agent event; the auxiliary
// final frame completes idempotently; every (re)connect bulk-reconciles all
// open leases BEFORE event delivery resumes.
link.onAgentEvent((evt) => {
  void dispatchWorker.handleAgentEvent(evt).catch((err) => {
    log('gateway-link', 'watcher error', { error: err instanceof Error ? err.message : String(err) });
  });
});
link.onAgentFinal(({ runId, status }) => {
  void dispatchWorker.handleAgentFinal(runId, status).catch((err) => {
    log('gateway-link', 'agent-final error', { error: err instanceof Error ? err.message : String(err) });
  });
});
link.onConnected(async () => {
  try {
    await dispatchWorker.reconcileAllOpenLeases();
  } catch (err) {
    log('gateway-link', 'bulk reconcile error', { error: err instanceof Error ? err.message : String(err) });
  }
});
link.start();

// --- API server (ingress + snooze intake) ---
const app = buildServer({
  pool, eventWriter,
  githubSecret: config.WAKERY_GITHUB_WEBHOOK_SECRET,
  githubToken: config.WAKERY_GITHUB_TOKEN,
  snoozeIntake
});

// --- Shutdown ---
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('main', `${signal} received, shutting down`);
  link.stop();
  await app.close();
  await pool.end();
  log('main', 'shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Start API ---
await app.listen({ host: config.WAKERY_HTTP_HOST, port: config.WAKERY_HTTP_PORT });
log('main', `api listening on ${config.WAKERY_HTTP_HOST}:${config.WAKERY_HTTP_PORT}`);

// --- Dispatch worker loop (the one worker; the link runs event-driven beside it) ---
async function runDispatchLoop() {
  log('dispatch-worker', `started (poll=${config.WAKERY_WORKER_IDLE_POLL_MS}ms)`);
  while (!stopping) {
    try {
      const processed = await dispatchWorker.runOnce();
      if (!processed) {
        await sleep(config.WAKERY_WORKER_IDLE_POLL_MS);
      }
    } catch (err) {
      log('dispatch-worker', 'error in dispatch cycle', { error: err instanceof Error ? err.message : String(err) });
      await sleep(config.WAKERY_WORKER_IDLE_POLL_MS);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runDispatchLoop();
