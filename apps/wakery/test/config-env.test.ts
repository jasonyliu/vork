import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config/env.js';

// Required env vars for the schema to parse — set per-test, restored after.
// Test-secret files are tmp paths so we don't touch the real keystore.

type Snapshot = Record<string, string | undefined>;

const TRACKED_VARS = [
  'WAKERY_CONFIG_FILE',
  'WAKERY_DATABASE_HOST',
  'WAKERY_DATABASE_PORT',
  'WAKERY_DATABASE_USER',
  'WAKERY_DATABASE_NAME',
  'WAKERY_DATABASE_PASSWORD_PATH',
  'WAKERY_WORKER_IDLE_POLL_MS',
  'WAKERY_REWAKE_MAX_ATTEMPTS',
  'WAKERY_LEASE_QUIET_THRESHOLD_MS',
  'WAKERY_LEASE_RECONCILE_INTERVAL_MS',
  'WAKERY_GATEWAY_RECONNECT_BACKOFF_MS',
  'WAKERY_SNOOZE_TIMEOUT_MS',
  'WAKERY_OPENCLAW_DEVICE_DIR',
  'WAKERY_PROJECT_STORAGE_PATH'
];

function snapshot(): Snapshot {
  return Object.fromEntries(TRACKED_VARS.map((k) => [k, process.env[k]]));
}

function restore(snap: Snapshot) {
  for (const k of TRACKED_VARS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

let tmpDir: string;
let pwPath: string;
let envSnap: Snapshot;

beforeEach(() => {
  envSnap = snapshot();
  tmpDir = mkdtempSync(join(tmpdir(), 'wakery-config-'));
  pwPath = join(tmpDir, 'db.password');
  writeFileSync(pwPath, 'test-password');
  process.env.WAKERY_DATABASE_HOST = '127.0.0.1';
  process.env.WAKERY_DATABASE_PORT = '5432';
  process.env.WAKERY_DATABASE_USER = 'wakery';
  process.env.WAKERY_DATABASE_NAME = 'wakery';
  process.env.WAKERY_DATABASE_PASSWORD_PATH = pwPath;
  process.env.WAKERY_PROJECT_STORAGE_PATH = join(tmpDir, 'projects');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  restore(envSnap);
});

describe('loadConfig', () => {
  test('loads worker knobs from config file', () => {
    const file = join(tmpDir, 'wakery.json');
    writeFileSync(file, JSON.stringify({
      worker: {
        dispatchPollMs: 1234,
        rewakeMaxAttempts: 7,
        leaseQuietThresholdMs: 111_000,
        leaseReconcileIntervalMs: 22_000,
        gatewayReconnectBackoffMs: 3_300
      }
    }));
    process.env.WAKERY_CONFIG_FILE = file;
    delete process.env.WAKERY_WORKER_IDLE_POLL_MS;
    delete process.env.WAKERY_REWAKE_MAX_ATTEMPTS;
    delete process.env.WAKERY_LEASE_QUIET_THRESHOLD_MS;
    delete process.env.WAKERY_LEASE_RECONCILE_INTERVAL_MS;
    delete process.env.WAKERY_GATEWAY_RECONNECT_BACKOFF_MS;

    const config = loadConfig();
    expect(config.WAKERY_WORKER_IDLE_POLL_MS).toBe(1234);
    expect(config.WAKERY_REWAKE_MAX_ATTEMPTS).toBe(7);
    expect(config.WAKERY_LEASE_QUIET_THRESHOLD_MS).toBe(111_000);
    expect(config.WAKERY_LEASE_RECONCILE_INTERVAL_MS).toBe(22_000);
    expect(config.WAKERY_GATEWAY_RECONNECT_BACKOFF_MS).toBe(3_300);
  });

  test('environment worker polling intervals override config file', () => {
    const file = join(tmpDir, 'wakery.json');
    writeFileSync(file, JSON.stringify({ worker: { dispatchPollMs: 1234 } }));
    process.env.WAKERY_CONFIG_FILE = file;
    process.env.WAKERY_WORKER_IDLE_POLL_MS = '2222';

    const config = loadConfig();
    expect(config.WAKERY_WORKER_IDLE_POLL_MS).toBe(2222);
  });

  test('turn-signal knob defaults per spec_wakery-dispatch-worker.md', () => {
    for (const key of ['WAKERY_REWAKE_MAX_ATTEMPTS', 'WAKERY_LEASE_QUIET_THRESHOLD_MS', 'WAKERY_LEASE_RECONCILE_INTERVAL_MS', 'WAKERY_GATEWAY_RECONNECT_BACKOFF_MS', 'WAKERY_SNOOZE_TIMEOUT_MS']) {
      delete process.env[key];
    }
    const config = loadConfig();
    expect(config.WAKERY_REWAKE_MAX_ATTEMPTS).toBe(5);
    expect(config.WAKERY_LEASE_QUIET_THRESHOLD_MS).toBe(300000);
    expect(config.WAKERY_LEASE_RECONCILE_INTERVAL_MS).toBe(60000);
    expect(config.WAKERY_GATEWAY_RECONNECT_BACKOFF_MS).toBe(5000);
    expect(config.WAKERY_SNOOZE_TIMEOUT_MS).toBe(1800000);
  });

  test('retired knobs are gone from the config surface', () => {
    const config = loadConfig() as Record<string, unknown>;
    for (const retired of ['WAKERY_PROBE_IDLE_POLL_MS', 'WAKERY_PROBE_STALE_AGE_MS', 'WAKERY_PROBE_MAX_ATTEMPTS', 'WAKERY_GRACE_WINDOW_MS', 'WAKERY_SNOOZE_POLL_INTERVAL_MS']) {
      expect(config[retired], retired).toBeUndefined();
    }
  });

  test('provides a default Wakery OpenClaw device dir', () => {
    delete process.env.WAKERY_OPENCLAW_DEVICE_DIR;
    const config = loadConfig();
    expect(config.WAKERY_OPENCLAW_DEVICE_DIR).toBe('./var/openclaw-device');
  });

  test('WAKERY_PROJECT_STORAGE_PATH is a required input — no default', () => {
    delete process.env.WAKERY_PROJECT_STORAGE_PATH;
    expect(() => loadConfig()).toThrow();
  });

  test('loads DB password from file', () => {
    const config = loadConfig();
    expect(config.WAKERY_DATABASE_PASSWORD).toBe('test-password');
  });
});
