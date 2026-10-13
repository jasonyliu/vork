// Standalone dispatch-worker entry (dev tooling): the turn machine + gateway
// link without the ingress API. Production runs main.ts (ingress + the one
// worker in a single process).
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { WakeRepository } from '../db/wake-repository.js';
import { RouteRepository } from '../db/route-repository.js';
import { LeaseRepository } from '../db/lease-repository.js';
import { GithubAgentRepository } from '../db/github-agent-repository.js';
import { GithubRepoProjectRepository } from '../db/github-repo-project-repository.js';
import { SnoozeRepository } from '../db/snooze-repository.js';
import { SnoozeTaskTypeRepository } from '../db/snooze-task-type-repository.js';
import { EventWriter } from '../events/writer.js';
import { GatewayLink } from '../adapters/openclaw/link.js';
import { FileGatewayDeviceIdentityStore } from '../adapters/openclaw/device-auth.js';
import { OpenClawAdapter } from '../adapters/openclaw/adapter.js';
import { fetchIssueState } from '../adapters/github/adapter.js';
import { DispatchWorker, buildTerminalVerifier } from './dispatch-worker.js';
import { SnoozeModule } from '../snooze/module.js';
import { buildRendererAndStore } from '../templates/build-renderer.js';
import { log } from '../log.js';

const config = loadConfig();
const pool = createPool(config);
// no DDL at startup (#35 ruling (b)) — migrations are the data module's act
const schemaProbe = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'wake' LIMIT 1`);
if (schemaProbe.rowCount === 0) {
  throw new Error('database schema absent — run `npm run migrate` (as vork_owner) first');
}
const eventWriter = new EventWriter(config.WAKERY_EVENT_LOG_DIR);
const wakeRepo = new WakeRepository(pool);
const routeRepo = new RouteRepository(pool);
const leaseRepo = new LeaseRepository(pool);
const githubRepoProjectRepo = new GithubRepoProjectRepository(pool);

const link = new GatewayLink(config.WAKERY_OPENCLAW_GATEWAY_URL, config.WAKERY_OPENCLAW_GATEWAY_TOKEN, {
  identityStore: new FileGatewayDeviceIdentityStore(config.WAKERY_OPENCLAW_DEVICE_DIR),
  eventWriter,
  reconnectBackoffMs: config.WAKERY_GATEWAY_RECONNECT_BACKOFF_MS,
  sessionKeysProvider: () => routeRepo.listActiveSessionKeys()
});
const { renderer } = await buildRendererAndStore(pool, config, eventWriter);
const adapter = new OpenClawAdapter(link, eventWriter, renderer);
const snoozeModule = new SnoozeModule({
  snoozeRepo: new SnoozeRepository(pool),
  snoozeTaskTypeRepo: new SnoozeTaskTypeRepository(pool),
  eventWriter,
  timeoutMs: config.WAKERY_SNOOZE_TIMEOUT_MS
});
const worker = new DispatchWorker({
  wakeRepo, routeRepo, leaseRepo, adapter, eventWriter,
  githubAgentRepo: new GithubAgentRepository(pool),
  snooze: snoozeModule,
  agentWait: (runId, timeoutMs) => link.wait(runId, timeoutMs),
  terminalVerifier: buildTerminalVerifier({
    githubToken: config.WAKERY_GITHUB_TOKEN,
    githubRepoProjectRepo,
    fetchIssueState
  }),
  pendingRetryIntervalMs: config.WAKERY_PENDING_RETRY_INTERVAL_MS,
  pendingMaxAttempts: config.WAKERY_PENDING_MAX_ATTEMPTS,
  dispatchReboundCooldownMs: config.WAKERY_DISPATCH_REBOUND_COOLDOWN_MS,
  rewakeMaxAttempts: config.WAKERY_REWAKE_MAX_ATTEMPTS,
  leaseQuietThresholdMs: config.WAKERY_LEASE_QUIET_THRESHOLD_MS,
  leaseReconcileIntervalMs: config.WAKERY_LEASE_RECONCILE_INTERVAL_MS
});

link.onAgentEvent((evt) => { void worker.handleAgentEvent(evt).catch(() => {}); });
link.onAgentFinal(({ runId, status }) => { void worker.handleAgentFinal(runId, status).catch(() => {}); });
link.onConnected(() => worker.reconcileAllOpenLeases());
link.start();

log('dispatch-worker', `started (poll=${config.WAKERY_WORKER_IDLE_POLL_MS}ms)`);

while (true) {
  try {
    const processed = await worker.runOnce();
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, config.WAKERY_WORKER_IDLE_POLL_MS));
    }
  } catch (err) {
    log('dispatch-worker', 'error in dispatch cycle', { error: err instanceof Error ? err.message : String(err) });
    await new Promise((resolve) => setTimeout(resolve, config.WAKERY_WORKER_IDLE_POLL_MS));
  }
}
