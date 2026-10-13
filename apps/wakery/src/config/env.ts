import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const DEFAULT_CONFIG_FILE = './config/wakery.json';

const envSchema = z.object({
  WAKERY_CONFIG_FILE: z.string().default(DEFAULT_CONFIG_FILE),
  WAKERY_HTTP_HOST: z.string().default('127.0.0.1'),
  WAKERY_HTTP_PORT: z.coerce.number().int().default(4311),
  WAKERY_DATABASE_HOST: z.string(),
  WAKERY_DATABASE_PORT: z.coerce.number().int().default(5432),
  WAKERY_DATABASE_USER: z.string(),
  WAKERY_DATABASE_NAME: z.string(),
  WAKERY_DATABASE_PASSWORD_PATH: z.string(),
  WAKERY_GITHUB_WEBHOOK_SECRET_PATH: z.string().default(''),
  WAKERY_GITHUB_TOKEN_PATH: z.string().default(''),
  WAKERY_OPENCLAW_GATEWAY_URL: z.string().default('ws://127.0.0.1:18789'),
  WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH: z.string().default(''),
  WAKERY_OPENCLAW_DEVICE_DIR: z.string().default('./var/openclaw-device'),
  WAKERY_EVENT_LOG_DIR: z.string().default('./var/events'),
  WAKERY_WORKER_IDLE_POLL_MS: z.coerce.number().int().default(10000),
  WAKERY_PENDING_RETRY_INTERVAL_MS: z.coerce.number().int().default(60000),
  WAKERY_PENDING_MAX_ATTEMPTS: z.coerce.number().int().default(3),
  WAKERY_DISPATCH_REBOUND_COOLDOWN_MS: z.coerce.number().int().default(10000),
  // Turn-signal knobs (spec_wakery-dispatch-worker.md §Worker Runtime Model).
  // Retired with the milestone: WAKERY_PROBE_* (probe worker),
  // WAKERY_GRACE_WINDOW_MS (superseded by the task-turn gate), and
  // WAKERY_SNOOZE_POLL_INTERVAL_MS (the snooze worker's poll loop).
  WAKERY_REWAKE_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  WAKERY_LEASE_QUIET_THRESHOLD_MS: z.coerce.number().int().default(300000),
  WAKERY_LEASE_RECONCILE_INTERVAL_MS: z.coerce.number().int().default(60000),
  WAKERY_GATEWAY_RECONNECT_BACKOFF_MS: z.coerce.number().int().default(5000),
  // Snooze (spec_wakery-snooze.md): single timeout clock for all types until a
  // real case needs two. The predicate applies it lazily; the dispatch tick's
  // sweep flips expired rows for bookkeeping.
  WAKERY_SNOOZE_TIMEOUT_MS: z.coerce.number().int().default(1800000),
  WAKERY_PARENT_RELATIONS_REFRESH_INTERVAL_MS: z.coerce.number().int().default(300000),
  // Board-reconcile sweep (self-healing F1, spec_wakery-board-sweep.md):
  // cadence of the per-project board read (0 disables the sweep entirely) and
  // the minimum idle age before a wakeless actionable task is minted for.
  WAKERY_BOARD_SWEEP_INTERVAL_MS: z.coerce.number().int().default(300000),
  WAKERY_BOARD_SWEEP_QUIET_MS: z.coerce.number().int().default(180000),
  // Stall alarm (self-healing F2): persistence of the project full-stop
  // condition (open tasks, zero wakes, zero leases) before the confession
  // turn is stored.
  WAKERY_STALL_THRESHOLD_MS: z.coerce.number().int().default(1800000),
  // Templates: directory holding the *.json artifacts loaded by TemplateStore at boot.
  // Default mirrors the in-repo layout; override via env for tests or relocated installs.
  WAKERY_TEMPLATE_DIR: z.string().default('./templates'),
  // Root where each project's local clone sits. Used by the renderer to compute
  // {{agent_homespace}}. Tilde expansion happens at env-load time. An
  // operator input with no default.
  WAKERY_PROJECT_STORAGE_PATH: z.string().min(1)
});

export type AppConfig = z.infer<typeof envSchema> & {
  WAKERY_DATABASE_PASSWORD: string;
  WAKERY_GITHUB_WEBHOOK_SECRET: string;
  WAKERY_GITHUB_TOKEN: string;
  WAKERY_OPENCLAW_GATEWAY_TOKEN: string;
};

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function loadSecretFile(path: string, required: boolean): string {
  if (!path) {
    if (required) throw new Error('Required secret path is empty');
    return '';
  }
  const expanded = expandHome(path);
  if (!existsSync(expanded)) {
    throw new Error(`Secret file not found: ${expanded}`);
  }
  return readFileSync(expanded, 'utf8').trim();
}

type ConfigFile = {
  worker?: {
    dispatchPollMs?: number;
    pendingRetryIntervalMs?: number;
    pendingMaxAttempts?: number;
    dispatchReboundCooldownMs?: number;
    rewakeMaxAttempts?: number;
    leaseQuietThresholdMs?: number;
    leaseReconcileIntervalMs?: number;
    gatewayReconnectBackoffMs?: number;
    boardSweepIntervalMs?: number;
    boardSweepQuietMs?: number;
    stallThresholdMs?: number;
  };
  WAKERY_WORKER_IDLE_POLL_MS?: number;
  WAKERY_PENDING_RETRY_INTERVAL_MS?: number;
  WAKERY_PENDING_MAX_ATTEMPTS?: number;
  WAKERY_DISPATCH_REBOUND_COOLDOWN_MS?: number;
  WAKERY_REWAKE_MAX_ATTEMPTS?: number;
  WAKERY_LEASE_QUIET_THRESHOLD_MS?: number;
  WAKERY_LEASE_RECONCILE_INTERVAL_MS?: number;
  WAKERY_GATEWAY_RECONNECT_BACKOFF_MS?: number;
  WAKERY_BOARD_SWEEP_INTERVAL_MS?: number;
  WAKERY_BOARD_SWEEP_QUIET_MS?: number;
  WAKERY_STALL_THRESHOLD_MS?: number;
};

function readConfigFile(path: string | undefined): Record<string, string | number> {
  const configPath = path || DEFAULT_CONFIG_FILE;
  if (!existsSync(configPath)) {
    if (path && path !== DEFAULT_CONFIG_FILE) {
      throw new Error(`Wakery config file not found: ${configPath}`);
    }
    return {};
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
  const result: Record<string, string | number> = {};

  const workerMappings: Array<[keyof NonNullable<ConfigFile['worker']>, string]> = [
    ['dispatchPollMs', 'WAKERY_WORKER_IDLE_POLL_MS'],
    ['pendingRetryIntervalMs', 'WAKERY_PENDING_RETRY_INTERVAL_MS'],
    ['pendingMaxAttempts', 'WAKERY_PENDING_MAX_ATTEMPTS'],
    ['dispatchReboundCooldownMs', 'WAKERY_DISPATCH_REBOUND_COOLDOWN_MS'],
    ['rewakeMaxAttempts', 'WAKERY_REWAKE_MAX_ATTEMPTS'],
    ['leaseQuietThresholdMs', 'WAKERY_LEASE_QUIET_THRESHOLD_MS'],
    ['leaseReconcileIntervalMs', 'WAKERY_LEASE_RECONCILE_INTERVAL_MS'],
    ['gatewayReconnectBackoffMs', 'WAKERY_GATEWAY_RECONNECT_BACKOFF_MS'],
    ['boardSweepIntervalMs', 'WAKERY_BOARD_SWEEP_INTERVAL_MS'],
    ['boardSweepQuietMs', 'WAKERY_BOARD_SWEEP_QUIET_MS'],
    ['stallThresholdMs', 'WAKERY_STALL_THRESHOLD_MS']
  ];
  for (const [fileKey, envKey] of workerMappings) {
    const value = parsed.worker?.[fileKey];
    if (value !== undefined) result[envKey] = value;
  }

  const flatKeys = [
    'WAKERY_WORKER_IDLE_POLL_MS',
    'WAKERY_PENDING_RETRY_INTERVAL_MS',
    'WAKERY_PENDING_MAX_ATTEMPTS',
    'WAKERY_DISPATCH_REBOUND_COOLDOWN_MS',
    'WAKERY_REWAKE_MAX_ATTEMPTS',
    'WAKERY_LEASE_QUIET_THRESHOLD_MS',
    'WAKERY_LEASE_RECONCILE_INTERVAL_MS',
    'WAKERY_GATEWAY_RECONNECT_BACKOFF_MS',
    'WAKERY_BOARD_SWEEP_INTERVAL_MS',
    'WAKERY_BOARD_SWEEP_QUIET_MS',
    'WAKERY_STALL_THRESHOLD_MS'
  ] as const;
  for (const key of flatKeys) {
    if (parsed[key] !== undefined) result[key] = parsed[key]!;
  }

  return result;
}

export function loadConfig(): AppConfig {
  const configFilePath = process.env.WAKERY_CONFIG_FILE || DEFAULT_CONFIG_FILE;
  const fileConfig = readConfigFile(configFilePath);
  const parsed = envSchema.parse({ ...fileConfig, ...process.env, WAKERY_CONFIG_FILE: configFilePath });
  return {
    ...parsed,
    WAKERY_PROJECT_STORAGE_PATH: expandHome(parsed.WAKERY_PROJECT_STORAGE_PATH),
    WAKERY_DATABASE_PASSWORD: loadSecretFile(parsed.WAKERY_DATABASE_PASSWORD_PATH, true),
    WAKERY_GITHUB_WEBHOOK_SECRET: loadSecretFile(parsed.WAKERY_GITHUB_WEBHOOK_SECRET_PATH, false),
    WAKERY_GITHUB_TOKEN: loadSecretFile(parsed.WAKERY_GITHUB_TOKEN_PATH, false),
    WAKERY_OPENCLAW_GATEWAY_TOKEN: loadSecretFile(parsed.WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH, false)
  };
}
