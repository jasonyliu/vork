# Release v2026.10.13 — notes for an AI agent

You are reading a tree that was extracted from a private project and does not run as published. This note tells you what the tree assumes exists around it, what every placeholder means, which inputs carry no default, what is absent and why, and the order in which to bring it up. The README's `Before it runs` is the operator's view of the same facts; this note is yours.

## Prerequisites

| Need | Detail |
|---|---|
| Host | One host for Wakery, Foundry and the OpenClaw gateway; Wakery connects to the gateway as a same-host backend client over `ws://127.0.0.1:18789`. Node.js 22 or later. macOS for the launchd installer; any OS with your own supervisor. |
| Postgres | A database `vork` reachable from the host; role `vork_owner` for migrations and the seed, role `vork_app` for runtime. |
| Ingress | A public HTTPS host forwarding to Wakery's `127.0.0.1:4311`; GitHub delivers webhooks there. |
| GitHub | One account that owns every project repository and board, with a personal access token covering repository administration, projects and webhooks. One account per agent with its own token; the framework ran every non-auditor agent under one shared account and the auditor under a separate one. |
| OpenClaw | A gateway speaking gateway protocol 4, verified against OpenClaw 2026.6.11, with agents `main`, `heimdall`, `sarge` and, for a coding specialist, `visor`. |
| Channel | A messaging channel per project where notices to the Principal land; the framework used Telegram topics. |

## Legend

Angle-bracket placeholders in prose and example configuration. No placeholder stands in code.

| Placeholder | Meaning |
|---|---|
| `<keystore>` | the directory of `0600` secret files every app reads by path |
| `<project-storage-path>` | the parent directory under which each project's clone lives as `<project_key>/main/` and `<project_key>/team/<agent>/`; the specs also write it as `<storage-path>`, `<storage_path>`, `<storage>` and, for one project, `<project-path>` |
| `<project_key>` | a project's compact lowercase key: the repository name, the local folder name, the registry slug, the segment in every session key |
| `<db-host>` | the Postgres host |
| `<ingress-host>` | the public HTTPS host in front of Wakery |
| `<gateway-host>` | the host that runs the OpenClaw gateway, Wakery and Foundry together |
| `<owner>`, `<owner_login>` | the GitHub login of the account that owns the projects, the Principal's |
| `<worker-login>` | the GitHub login of the shared account the non-auditor agents post under |
| `<auditor-login>` | the GitHub login of the auditor's account |
| `<github_login>` | any agent account's login where one is meant generically |
| `<agent_id>`, `<specialist>` | an OpenClaw agent id; a specialist is one beyond the crew of `main`, `heimdall` and `sarge` |
| `<wakery-source-root>` | the `apps/wakery/` directory of the checkout |
| `<foundry-var>` | `apps/foundry/var/`, Foundry's runtime output directory |

Other angle-bracket tokens in the policy documents, templates and specs, such as `<slug>`, `<name>`, `<int>`, `<environment>` and `<milestone-folder>`, are notation for a value a record or command takes at use; they name no configuration.

## Inputs

Secrets, one file each under `<keystore>`:

| File | Used by |
|---|---|
| `github/owner.token` | Foundry (owner acts), Wakery (backend GitHub reads) |
| `github/main.token`, `github/heimdall.token`, `github/sarge.token`, `github/<specialist>.token` | Foundry (crew and specialist acts, clones) |
| `github/webhook_wakery` | Wakery (signature verification), Foundry (webhook creation) |
| `postgres/vork-owner.password` | `@vork/data` migrate, seed, cutover |
| `postgres/vork-app.password` | Wakery, Resolver, Foundry's register stage |
| `openclaw/gateway-token` | Wakery's gateway link |

Environment, one `.env` per app from its `.env.example`; these carry no default and the app refuses to start without them:

| Variable | App | Value |
|---|---|---|
| `WAKERY_DATABASE_HOST`, `_USER`, `_NAME`, `_PASSWORD_PATH` | Wakery | `<db-host>`, `vork_app`, `vork`, `<keystore>/postgres/vork-app.password`; the example file still carries the names `wakery` and `wakery-app.password` from an earlier era, replace them |
| `WAKERY_PROJECT_STORAGE_PATH` | Wakery | `<project-storage-path>` |
| `FOUNDRY_OWNER_TOKEN_PATH` | Foundry | `<keystore>/github/owner.token` |
| `FOUNDRY_AGENT_TOKEN_DIR` | Foundry | `<keystore>/github/` |
| `FOUNDRY_PROJECT_STORAGE_PATH` | Foundry | `<project-storage-path>` |
| `FOUNDRY_WEBHOOK_URL` | Foundry | `https://<ingress-host>/adapters/github/webhook` |
| `FOUNDRY_WEBHOOK_SECRET_PATH` | Foundry | `<keystore>/github/webhook_wakery` |
| `RESOLVER_DATABASE_HOST`, `_USER`, `_NAME`, `_PASSWORD_PATH` | Resolver | `<db-host>`, `vork_app`, `vork`, the app password path |
| `VORK_DATABASE_*` | `@vork/data`, Foundry's register stage | the same connection; point `_USER` and `_PASSWORD_PATH` at `vork_owner` for migrate and seed |

Every other variable has a default; `specs/data/spec_config.md` lists them all.

Seed arrays in `apps/data/src/seed.ts`, empty as published because their rows were the original instance's:

| Array | Fill with |
|---|---|
| `GITHUB_AGENT_SEED` | one row per agent account: `github_login`, `github_node_id`, `agent_id`, `agent_name`, `role` in `principal`, `auditor`, `agent` |
| `GITHUB_REPO_PROJECT_SEED` | one row per tracked project: registry slug, repository node id, owner node id and login, repository name, board node id, number and title |
| `LEGACY_BOARDS` in `cutover-platform-keying.ts` | retired boards to re-key, or nothing |

With the first two empty, the seed writes no agent and no mapping row, and Wakery drops every delivery as unmapped. Foundry writes both rows for each project it founds; the arrays matter for projects that exist before Foundry.

Per project on GitHub, created by Foundry for a new project or by hand for an existing one: branches `main` and `dev`; a ProjectV2 board with single-select `Status` (Init, Todo, Pending, Progress, Done, Reviewed, Completed, Cancelled) and `Audit` (Gated, Approved, Revise, Govern); the labels in `apps/foundry/assets/labels.json`; the rulesets in `provisions/github/rulesets/`; a webhook to the ingress URL subscribed to the events in `apps/foundry/assets/webhook-events.json`, signed with the shared secret; collaborator grants for the agent accounts; a workflow named `CI`, which the rulesets require as a status check and the snooze module holds tasks for.

## Missing

Absent from the tree on purpose. Author or supply these; nothing in the tree stands in for them.

| Absent | Why | What you do |
|---|---|---|
| The agents' context documents (identity, soul, tools, memory, heartbeat for `main`, `heimdall`, `sarge`, `visor`) | They described a person, a household and a machine estate | Write your own. The message templates assume each agent's `TOOLS.md` names its channel to the Principal; the policy hook assumes the agent ids in `provisions/openclaw/hooks/vork-policy/config.json`. |
| A CI workflow | The original repository's workflow belonged to it | Write a workflow named `CI` for each conducted repository. |
| The original project's milestones, research, releases, incident trail and issue tracker | They are the original project's records | Where a spec, a code comment or a template cites one of them, by date, by title or by issue number such as `#35`, the pointer stays as written and resolves nowhere here. Read the sentence for its claim; the evidence is private. |
| The measurement behind the conduction cost | A record of the original project | The figures in the README are the result; the record stays private. |
| Deployment manuals | Deployment records are estate documents | `apps/wakery/deploy/install.sh` is the one deployment act that ships. |
| Record templates beyond the nine in `docs/conventions/templates/` | The two the kit added later arrive with release 2 | Nothing; Foundry's scaffold ships the same nine. |
| A commit history | The tree is an extraction | Nothing. |

## Works

Verified at the tag, in a clean checkout, `npm ci` then `npm test` per app with `apps/data` first:

| App | Typecheck | Tests |
|---|---|---|
| `apps/data` | clean | 38 pass |
| `apps/resolver` | clean | 53 pass |
| `apps/foundry` | clean | 90 pass, 1 skipped by design (the standing-fixture test runs only on a Foundry-founded tree) |
| `apps/wakery` | clean | 336 pass |

The policy corpus, conventions, templates, specs, rulesets, hook and techspec skill are complete as documents. The conduction loop they describe ran in production on the original instance.

## Broken

Left as found; the README's `Broken` list is the reference. In brief: `parseTransitionTargets` reads nothing from the paired form `To: Done (Audit: Gated)` that `transition-comment.md` prescribes, so paired comments carry no expected state and the pending path never engages for them; `inspect-all.ts` and `dump-config-tables.ts` select renamed columns; `foundry verify` fails against this repository; ingress verifies the webhook signature and no comment author. Keep conducted repositories private and collaborator-only.

## Order

1. Postgres: create the database and the two roles. `npm ci` in `apps/data/`; fill the seed arrays; `npm run migrate` then `npm run seed` as `vork_owner`.
2. Keystore: write every secret file above with mode `0600`.
3. OpenClaw: the gateway and the agents with their context documents; install the policy hook from `provisions/openclaw/hooks/vork-policy/`.
4. Wakery: `.env`, `npm ci`, then `deploy/install.sh` on macOS or `npm start` under a supervisor. It starts only against a migrated database. `npm run smoke:db` and `npm run smoke:openclaw -- session <sessionKey> <message>` confirm the two connections.
5. Ingress: expose `127.0.0.1:4311` at `https://<ingress-host>`.
6. Foundry: `.env`, `npm ci`, then `bin/foundry bootstrap --bundle <bundle> --dry-run` against a scratch bundle; `preflight passed` proves every token and the GitHub client.
7. A project: `bin/foundry bootstrap --bundle <bundle>` founds it with its full GitHub surface and registry rows; an existing repository gets the surface by hand and its rows through the seed arrays. Add the `CI` workflow.
8. Resolver: `.env`, `npm ci`; the auditor calls `bin/resolver` on its own.

## Records

`README.md` for the operator's view; `specs/data/spec_config.md` for every variable; `specs/apps/<app>/manual.md` for each service; `docs/policy/` for who may do what.
