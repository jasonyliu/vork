# Vork Config

The operational data layer — the configuration and runtime surfaces that keep the apps running, distinct from the transactional store (`specs/data/spec_database.md`) and the event system (`specs/data/spec_event.md`).

**Surfaces.** env-var contracts (§Environment contracts), template files at `apps/wakery/templates/<name>.json` (+ `transition-comment.md`), the wakery config file (`config/wakery.json`), per-app `.env` files (deployment-local, gitignored, carried into each release worktree), and the keystore: all secrets live as `0600` files under `<keystore>/`, referenced by `_PATH` env vars — no secret value is ever inlined in env, config, or docs.

## Environment contracts

Env surfaces per app; `_PATH` vars point into the keystore. Names are the implementation baseline; retired names stay listed until their last consumer is gone.

### Wakery

| Var | Default | Meaning (consumer spec) |
|---|---|---|
| `WAKERY_HTTP_HOST` / `WAKERY_HTTP_PORT` | `127.0.0.1` / `4311` | ingress bind |
| `WAKERY_DATABASE_HOST/PORT/USER/NAME` | <db-host> / `5432` / `vork_app` / `vork` | Postgres connection |
| `WAKERY_DATABASE_PASSWORD_PATH` | `keystore/postgres/vork-app.password` | DB secret |
| `WAKERY_GITHUB_WEBHOOK_SECRET_PATH` | `keystore/github/webhook_wakery` | webhook HMAC |
| `WAKERY_GITHUB_TOKEN_PATH` | `keystore/github/owner.token` | backend GitHub reads |
| `WAKERY_OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | gateway (`spec_wakery-openclaw-adapter.md`) |
| `WAKERY_OPENCLAW_GATEWAY_TOKEN_PATH` | `keystore/openclaw/gateway-token` | gateway auth |
| `WAKERY_OPENCLAW_DEVICE_DIR` | `./var/openclaw-device` | wakery's own device identity |
| `WAKERY_EVENT_LOG_DIR` | — | JSONL home (`specs/data/spec_event.md`) |
| `WAKERY_CONFIG_FILE` | `./config/wakery.json` | config file |
| `WAKERY_WORKER_IDLE_POLL_MS` | `10000` | dispatch tick (`spec_wakery-dispatch-worker.md`) |
| `WAKERY_DISPATCH_REBOUND_COOLDOWN_MS` | `10000` | capacity rebound cooldown |
| `WAKERY_PENDING_RETRY_INTERVAL_MS` / `WAKERY_PENDING_MAX_ATTEMPTS` | `60000` / `3` | field-sync sweep |
| `WAKERY_REWAKE_MAX_ATTEMPTS` | `5` | empty-run re-wake cap (`spec_wakery-rewake-message.md`) |
| `WAKERY_LEASE_QUIET_THRESHOLD_MS` / `WAKERY_LEASE_RECONCILE_INTERVAL_MS` | `300000` / `60000` | quiet-lease reconcile |
| `WAKERY_GATEWAY_RECONNECT_BACKOFF_MS` | `5000` | gateway link |
| `WAKERY_BOARD_SWEEP_INTERVAL_MS` / `WAKERY_BOARD_SWEEP_QUIET_MS` | `300000` / `180000` | board sweep (`spec_wakery-board-sweep.md`) |
| `WAKERY_STALL_THRESHOLD_MS` | `1800000` | stall alarm |
| `WAKERY_SNOOZE_TIMEOUT_MS` | `1800000` | snooze lazy expiry (`spec_wakery-snooze.md`) |
| `WAKERY_TEMPLATE_DIR` / `WAKERY_PROJECT_STORAGE_PATH` | `<source>/templates` / `<project-storage-path>` | renderer (`spec_wakery-template-renderer.md`) |
| `WAKERY_PARENT_RELATIONS_REFRESH_INTERVAL_MS` | `300000` | relations refresh |

Retired: `WAKERY_PROBE_IDLE_POLL_MS`, `WAKERY_PROBE_STALE_AGE_MS`, `WAKERY_PROBE_MAX_ATTEMPTS` (probe worker retired), `WAKERY_WAKE_MESSAGE_TEMPLATE_PATH` (superseded by `WAKERY_TEMPLATE_DIR`), `WAKERY_SNOOZE_POLL_INTERVAL_MS` (snooze worker retired to module).

### Resolver

| Var | Default | Meaning |
|---|---|---|
| `RESOLVER_DATABASE_HOST` / `RESOLVER_DATABASE_PORT` | — / `5432` | same Postgres instance |
| `RESOLVER_DATABASE_USER` / `RESOLVER_DATABASE_NAME` | — / `vork` | connection |
| `RESOLVER_DATABASE_PASSWORD_PATH` | keystore path | secret, mirrors the `WAKERY_DATABASE_*` shape |

### Data module

The schema-lifecycle CLIs (`apps/data/`: `migrate`, `seed`, `cutover`) read the canonical `VORK_DATABASE_*` surface, each var falling back to its `WAKERY_DATABASE_*` twin so a deployed wakery `.env` drives them unchanged. Lifecycle acts run as `vork_owner` — point `_USER`/`_PASSWORD_PATH` at the owner credentials for those invocations (#35).

| Var | Default | Meaning |
|---|---|---|
| `VORK_DATABASE_HOST/PORT/USER/NAME` | falls back to `WAKERY_DATABASE_*` / `5432` | Postgres connection for lifecycle acts |
| `VORK_DATABASE_PASSWORD_PATH` | falls back to `WAKERY_DATABASE_PASSWORD_PATH` | keystore path (`vork-owner.password` for lifecycle acts) |

### Foundry

`apps/foundry/.env` on the gateway host, the same deployment-local shape as wakery's and resolver's (`.env.example` ships it). The register stage reuses the platform `VORK_DATABASE_*` surface with the runtime role — no fallback to `WAKERY_*` here; foundry's `.env` is its own.

| Var | Default | Meaning |
|---|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | — (required) | the Principal's personal-account PAT — the owner of every bootstrapped project (`keystore/github/owner.token`) |
| `FOUNDRY_AGENT_TOKEN_DIR` | `<keystore>/github/` | crew + specialist tokens resolve here as `<name>.token` |
| `FOUNDRY_RULESET` | `standard` | `standard` or `none` |
| `FOUNDRY_PROJECT_STORAGE_PATH` | `<project-storage-path>` | parent of `<project_key>/` — the same tree wakery's `WAKERY_PROJECT_STORAGE_PATH` names |
| `FOUNDRY_WEBHOOK_URL` | — (required) | wakery's public webhook endpoint |
| `FOUNDRY_WEBHOOK_SECRET_PATH` | — (required) | `keystore/github/webhook_wakery` — the same secret wakery verifies with |
| `VORK_DATABASE_HOST/PORT/NAME/USER` | — / `5432` / `vork` / `vork_app` | registry connection for the register stage; `HOST` absent → standalone (no registry write) |
| `VORK_DATABASE_PASSWORD_PATH` | `keystore/postgres/vork-app.password` | runtime-role secret |

## References

- `specs/data/spec_database.md` — the transactional store these connections serve
- `specs/apps/foundry/spec_foundry-interface.md §Environment` — how foundry consumes its `.env`
- `specs/apps/wakery/spec_wakery-template-renderer.md` — template consumption
