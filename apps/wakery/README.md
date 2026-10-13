# Wakery

TypeScript Wakery implementing the three-stage flow from the spec set (`specs/apps/wakery/`), as rebuilt by `milestone_wakery-turn-signal_v2026.07.29`:

1. Stage 1 ingress (`POST /wake` + GitHub webhook adapter) — writes the **wake ledger** (task-state records) and the snooze intake
2. Stage 2 dispatch worker — the **turn machine**: task-turn-gate selection, lease creation (the **turn ledger**), the persistent gateway link with its lifecycle watcher and `agent.wait` reconcile, empty-run recovery, snooze hold consult + timeout sweep
3. Stage 3 OpenClaw adapter — the **gateway link** transport (`session` => existing session, `run` => one-shot run session)

One worker process total. The former probe and snooze workers are retired (their specs are retired drafts, not carried in this release); snooze is a module (intake in ingress, consult + timeout on the dispatch tick).

## Stack
- Node.js 22+ / TypeScript
- Fastify
- pg (PostgreSQL)
- zod
- vitest

## Capabilities
- validates and normalizes wake requests; drops ineligible requests before storage
- upserts same-state current wakes; creates new wake occurrences on state changes
- completes prior wakes on observed task progression — **wake ledger only** (two-ledger rule: wakes are written by ingress from GitHub; leases by the dispatch worker from gateway signals; neither completes the other)
- resolves exact route (`project_id + task_type + actor`) then project fallback; parks missing-route wakes
- **task-turn gate**: at most one open lease per task, system-wide; a wake dispatches only as its task's newest open wake
- one lease = one turn = one send; the lease id **is** the gateway runId (`idempotencyKey = lease.id`)
- completes leases on the run's lifecycle `end`/`error` events (the watcher), with `agent.wait` reconcile on reconnect and for quiet leases
- recovers **empty runs** (turn ended, no progression) by re-wake: outcome-blind self-heal template, `wake_attempts` capped, terminal-verifier guard for chain cues
- **snooze holds**: a stateless predicate at dispatch admission (branch + `Progress+Gated` + task-type, lazy expiry) — no pause/resume state exists
- writes append-only JSONL event logs; structured JSON stdout logging

## Setup
```bash
cp .env.example .env   # configure secrets
npm install
npm install --prefix ../data   # the data-layer module resolves its own deps
npm run migrate        # delegates to @vork/data (run as vork_owner)
npm run seed           # delegates to @vork/data
```

## Run

### Unified (production)
Runs API + dispatch worker (holding the gateway link) in a single process with graceful shutdown:
```bash
npm start
```

### Standalone (development)
```bash
npm run dev:api        # API only
npm run dev:worker     # dispatch worker only
```

## Deploy (launchd)
```bash
./deploy/install.sh
```
Renders `deploy/com.vork.wakery.plist` with this checkout's path and the `node` found on PATH, installs it as a launchd user agent (auto-start on login, auto-restart on crash), and loads it. macOS only. Migrations are a separate act (`npm run migrate` as `vork_owner`, before the first start); the process refuses to start on an unmigrated database.

Management:
```bash
launchctl print gui/$(id -u)/com.vork.wakery                                   # status
tail -f var/logs/wakery.stdout.log                                             # logs
launchctl bootout gui/$(id -u)/com.vork.wakery                                 # stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vork.wakery.plist  # start
```

## Test
```bash
npm test
npm run typecheck
npm run build
```

## Operator tooling
```bash
npm run inspect:recent -- 20
npm run inspect:run-session -- agent:main:<project_key>:run:<wake_route_lease_id>
npm run reconcile:run-lease -- <wakeId>
npm run reconcile:run-lease -- <wakeId> --apply
npm run cleanup:smoke
npm run cleanup:smoke -- wakery/smoke-dispatch-flow/ --apply
```

## Smoke helpers
```bash
npm run smoke:db
npm run smoke:openclaw -- session agent:main:main "wakery smoke"
npm run smoke:openclaw -- run main "wakery smoke"
npm run smoke:dispatch-flow -- session heimdall
npm run smoke:dispatch-flow -- run main
```
Each smoke run uses its own project namespace so older smoke data does not hijack route or wake selection.

## Env
See `.env.example`.

Required config (no secret values inline; secrets read from keystore files at `<keystore>/`):
- Database connection: `WAKERY_DATABASE_HOST`, `WAKERY_DATABASE_PORT`, `WAKERY_DATABASE_USER`, `WAKERY_DATABASE_NAME` (non-secret), plus `WAKERY_DATABASE_PASSWORD_PATH` pointing to a `0600` file with the password.
- `WAKERY_GITHUB_WEBHOOK_SECRET_PATH` — path to the shared HMAC secret file (default `<keystore>/github/webhook_wakery`).
- `WAKERY_GITHUB_TOKEN_PATH` — path to the system PAT file used by wakery for backend GitHub API calls (default `<keystore>/github/owner.token`).
- `WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH` — path to the OpenClaw gateway shared token file (default `<keystore>/openclaw/gateway-token`).
- `WAKERY_PROJECT_STORAGE_PATH` — the root under which project clones sit (`<project-storage-path>`); the renderer derives each agent's homespace from it. Required, no default.

Config:
- `WAKERY_HTTP_HOST` / `WAKERY_HTTP_PORT` — API bind (default `127.0.0.1:4311`)
- `WAKERY_CONFIG_FILE` — optional JSON config file (default `./config/wakery.json` when present)
- `WAKERY_WORKER_IDLE_POLL_MS` (config `worker.dispatchPollMs`) — dispatch tick when idle (default `10000`; legacy name for the spec table's `WAKERY_DISPATCH_POLL_MS`)
- `WAKERY_REWAKE_MAX_ATTEMPTS` (config `worker.rewakeMaxAttempts`) — agent turns per wake before the alert (default `5`)
- `WAKERY_LEASE_QUIET_THRESHOLD_MS` (config `worker.leaseQuietThresholdMs`) — run silence before an open lease is reconcile-checked (default `300000`)
- `WAKERY_LEASE_RECONCILE_INTERVAL_MS` (config `worker.leaseReconcileIntervalMs`) — quiet-lease reconcile cadence (default `60000`)
- `WAKERY_GATEWAY_RECONNECT_BACKOFF_MS` (config `worker.gatewayReconnectBackoffMs`) — link re-dial base backoff, doubling to 8× (default `5000`)
- `WAKERY_SNOOZE_TIMEOUT_MS` — snooze self-relief clock (default `1800000`)
- `WAKERY_OPENCLAW_DEVICE_DIR` — Wakery's own Gateway device identity (default `./var/openclaw-device`)
- `WAKERY_EVENT_LOG_DIR` — JSONL event output (default `./var/events`)

## OpenClaw integration
- Gateway URL defaults to `ws://127.0.0.1:18789`
- **Persistent link**: one authenticated WebSocket for the process lifetime — challenge-bound device auth (`client.id = "gateway-client"`, `client.mode = "backend"`), explicit subscriptions, health/tick liveness, backoff reconnect with a bulk `agent.wait` reconcile before events resume
- `session` dispatch: `chat.send` to `route.session_key`; `run` dispatch: `agent` to the rendered run-session key — both with `idempotencyKey = lease.id`, which the gateway adopts as the run's `runId` (verified at OpenClaw 2026.6.11)
- lease completion: `agent`-family lifecycle `end`/`error` events (the `finishing` phase is activity, not completion), the `agent` method's final same-request response as an auxiliary signal, and the reconcile verdict table for everything the stream missed
- no probe dispatch exists; wakery never messages an agent outside a turn-starting send

## Project layout
```text
src/
  main.ts              # unified entrypoint: ingress + the one worker
  log.ts               # structured JSON logger
  adapters/github/     # webhook signature + payload mapping
  adapters/openclaw/   # gateway link, device auth, run-session helpers
  config/              # env/config loader
  db/                  # repositories + migrations
  events/              # JSONL event writer + codes
  ingress/             # Fastify API (POST /wake, POST /adapters/github/webhook)
  shared/              # types, schema, id helpers
  snooze/              # snooze module: typed intake + hold predicate
  worker/              # the dispatch worker (turn machine)
  scripts/             # operator/smoke tooling
deploy/
  com.vork.wakery.plist     # launchd service definition (template, rendered by install.sh)
  install.sh                # deployment script (macOS launchd)
test/
```
