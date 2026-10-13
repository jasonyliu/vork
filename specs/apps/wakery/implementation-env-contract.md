# Wakery Implementation Environment Contract

## Purpose

This document locks the initial implementation environment contract for Wakery so repo setup and coding can begin without configuration drift.

This is the **implementation-start contract**, not the final production deployment design.

---

## Locked decisions

### 1) Runtime

Wakery will use **Node.js + TypeScript for both ingress and worker** in MVP.

Reason:
- the router is control-plane / async I/O work, not CPU-heavy worker computation
- keeping ingress and dispatch in one runtime avoids unnecessary multi-language drift
- OpenClaw integration is easier to keep consistent from a single TypeScript codebase

### 2) Host topology for implementation start

For implementation start, run the Wakery processes on the **gateway host**.

- **ingress API host:** the gateway host
- **dispatch worker host:** the gateway host
- **database host:** `<db-host>`

Reason:
- the current OpenClaw Gateway is bound to loopback on the gateway host: `ws://127.0.0.1:18789`
- the worker must be able to call OpenClaw directly through the Gateway control plane for `chat.send` / `agent`

### 3) Database contract

The Wakery database is provisioned on `<db-host>` Postgres.

- **host:** `<db-host>`
- **port:** `5432`
- **database:** `wakery`
- **app role:** `wakery`

The password is an operational secret and must **not** be committed into repo docs or source.

### 4) OpenClaw dispatch contract

Wakery dispatches downstream through the local OpenClaw Gateway.

- **gateway URL:** `ws://127.0.0.1:18789`
- **local deployment auth model:** same-host backend Gateway integration via `client.id = "gateway-client"`, `client.mode = "backend"`
- **runtime secret:** shared gateway token provided at runtime through env / secret injection
- **local device material:** Wakery keeps its own local device identity/signing state in a dedicated runtime directory

Dispatch mapping for MVP:
- `delivery = session` -> existing-session dispatch via Gateway `chat.send`, using the concrete session key stored in `route.session_key`
- `delivery = run` -> short-lived one-shot run dispatch via Gateway `agent`, using the session-key template stored in `route.session_key` with `[wake_route_lease_id]` substituted at dispatch time

Session-key doctrine for current MVP:
- project main long-standing route -> `agent:<agent_id>:<project_key>:main`
- project topic long-standing route -> `agent:<agent_id>:<project_key>:<topic_key>`
- project one-shot run route -> `agent:<agent_id>:<project_key>:run:[wake_route_lease_id]`
- `task_type = null` in route means project-level wildcard/fallback route

For current same-host deployment, Wakery should use the intended local backend Gateway path instead of borrowing the operator's human CLI device.
Managed listed-device enrollment remains a future/off-host hardening option rather than a blocker for local deployment.

### 5) Event log contract

Wakery event logs remain local append-only JSONL files on the runtime host.

Initial contract:
- event logs live on the same host as the running API/worker
- path is configured explicitly by env var
- event log files are not stored in Postgres

### 6) Worker polling contract

Worker polling intervals are runtime configuration values owned by the Wakery config file when present:

```text
config/wakery.json
```

Default config-file values:
- **dispatch worker idle poll:** `10000 ms`
- **probe worker idle poll:** `60000 ms`
- **probe stale age:** `600000 ms` / `10 min`

Environment variables may still override these values for deployment-specific experiments, but normal local tuning should use the config file rather than editing code.

---

## Required env surface

These names are now the implementation baseline.

### HTTP / ingress
- `WAKERY_HTTP_HOST`
- `WAKERY_HTTP_PORT`

### Database
Non-secret connection params (inline in env):
- `WAKERY_DATABASE_HOST`
- `WAKERY_DATABASE_PORT`
- `WAKERY_DATABASE_USER`
- `WAKERY_DATABASE_NAME`

Secret (path-based):
- `WAKERY_DATABASE_PASSWORD_PATH` — filesystem path to a `0600` file containing the role's password. Default convention: `<keystore>/postgres/wakery-app.password`.

### GitHub adapter
- `WAKERY_GITHUB_WEBHOOK_SECRET_PATH` — filesystem path to a `0600` file holding the shared HMAC secret. Default convention: `<keystore>/github/webhook_wakery`.
- `WAKERY_GITHUB_TOKEN_PATH` — filesystem path to a `0600` file holding the system PAT used for backend GitHub API calls (issue state lookups, project field reads). Default convention: `<keystore>/github/owner.token`.

### OpenClaw adapter
- `WAKERY_OPENCLAW_GATEWAY_URL`
- `WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH` — filesystem path to a `0600` file holding the gateway shared token. Default convention: `<keystore>/openclaw/gateway-token`.
- `WAKERY_OPENCLAW_DEVICE_DIR`

### Event logs
- `WAKERY_EVENT_LOG_DIR`

### Config file
- `WAKERY_CONFIG_FILE`

### Worker override env vars
- `WAKERY_WORKER_IDLE_POLL_MS`
- `WAKERY_PROBE_IDLE_POLL_MS`
- `WAKERY_PROBE_STALE_AGE_MS`

---

## Initial development defaults

These are acceptable local implementation defaults unless later work forces change.

```text
WAKERY_HTTP_HOST=127.0.0.1
WAKERY_HTTP_PORT=4311
WAKERY_OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
WAKERY_OPENCLAW_DEVICE_DIR=./var/openclaw-device
WAKERY_CONFIG_FILE=./config/wakery.json
```

All secret values live in operator-pre-created `0600` files inside the keystore project (`<keystore>/`). The env contract carries `_PATH` references only; no secret value is ever inlined in env. The required path env vars are: `WAKERY_DATABASE_PASSWORD_PATH`, `WAKERY_GITHUB_WEBHOOK_SECRET_PATH`, `WAKERY_GITHUB_TOKEN_PATH`, and `WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH`.

For current same-host deployment, the `openclaw/gateway-token` keystore file holds the shared local gateway token used by the intended backend integration path.
`WAKERY_OPENCLAW_DEVICE_DIR` stores Wakery's own local device-signing material and must remain isolated from the operator's human CLI state.

---

## Explicit non-goals for this contract

This document does **not** yet lock:
- final public webhook exposure path for GitHub deliveries
- reverse proxy / tunnel choice
- process supervisor choice
- containerization strategy
- production multi-host split between ingress and worker

Those can be decided after repo bootstrap and initial local integration are working.

---

## Notes

The important thing here is to stop wasting cycles on avoidable ambiguity.

The build can now assume:
- one TypeScript codebase
- local OpenClaw access on the gateway host
- Postgres on <db-host>
- dedicated Wakery DB + role already provisioned
