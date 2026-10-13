# Foundry provisioning

Foundry runs on the gateway host from the active deployment worktree — where the crew's OpenClaw agents, the keystore, and every project's `main/` + `team/<agent>/` clones live (`specs/apps/foundry/manual.md §Where it runs`). Its only machine-local material is `.env`.

## One-time install (per host)

1. Keystore present at `<keystore>/` with the tokens the crew resolves by name — `github/main.token`, `github/heimdall.token`, `github/sarge.token`, one `github/<name>.token` per specialist the bundles will name — plus the owner PAT `github/owner.token`, the webhook secret `github/webhook_wakery`, and `postgres/vork-app.password`. The keystore clone on the host needs a credential for its own remote to pull; without one, new files arrive by `scp`.
2. Write `.env` from the template below into the deployed worktree's `apps/foundry/` (the deploy manual carries it forward on every release, like wakery's).
3. `npm ci` in `apps/data/` then `apps/foundry/` (the `file:` dependency resolves through data's own `node_modules`).
4. Smoke: `bin/foundry verify --against <project-storage-path>/vork/main` exits 0 — Foundry's committed skeleton matches this project's tree; then `bin/foundry bootstrap --bundle <scratch bundle> --dry-run` prints `preflight passed` — the live GitHub client and every token in `.env` work (zero mutation; remove `var/dry-run/` afterwards). A scratch bundle is any valid bundle with an unused `project_key`.

## `.env` template

The contract is `specs/data/spec_config.md §Foundry`; `apps/foundry/.env.example` ships the same shape. Secrets are keystore paths, never values.

```dotenv
FOUNDRY_OWNER_TOKEN_PATH=<keystore>/github/owner.token
FOUNDRY_AGENT_TOKEN_DIR=<keystore>/github/
FOUNDRY_RULESET=standard
FOUNDRY_PROJECT_STORAGE_PATH=<project-storage-path>
FOUNDRY_WEBHOOK_URL=https://<ingress-host>/adapters/github/webhook
FOUNDRY_WEBHOOK_SECRET_PATH=<keystore>/github/webhook_wakery
VORK_DATABASE_HOST=<db-host>
VORK_DATABASE_PORT=5432
VORK_DATABASE_NAME=vork
VORK_DATABASE_USER=vork_app
VORK_DATABASE_PASSWORD_PATH=<keystore>/postgres/vork-app.password
```

Leave `VORK_DATABASE_HOST` unset to run standalone — bootstrap then skips the register stage with an event and writes no registry rows (no routes either: the project is scaffolded but not dispatchable until registered).

## Founding a project

`bin/foundry bootstrap --bundle <bundle.json>` from `apps/foundry/` in the deployed worktree; the bundle shape is `specs/apps/foundry/spec_foundry-interface.md §Input bundle`. The run event log path prints on completion. Then the post-bootstrap checklist in `specs/apps/foundry/manual.md §After bootstrap` (the project's channel and Sarge's channel row; the Principal drives Inception).
