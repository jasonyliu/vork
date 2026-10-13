# Vork

Vork is a project kit for building software with an AI agent: one project shape, one lifecycle, and the tools that found projects, write specs and close milestones. Its first release preserves the multi-agent conduction framework it grew out of, with what works, what was never built and what broke stated plainly.

## Release 1

This release is the conduction framework: the autonomous multi-agent development crew I built and ran from February to August 2026, then retired. It is published whole, at its own tag, as a record of the attempt. The kit that replaced it follows in release 2.

**This release is a reading release, not a working build.** The tree is an extraction from a private project: every host name, account, credential path, project key and seeded row that belonged to that instance has been removed or replaced by a placeholder, and some of the services it ran against were never part of the repository. Nothing in it runs as published. `Before it runs` lists what you supply and change to bring it up, and the three lists after it say what you get when you do.

## Contents

```text
docs/policy/         the six governing documents: FRAMEWORK, PROJECT, TASK, SECURITY, DELIVERY, MEMORY
docs/conventions/    named values and the record templates every project shares
specs/               the design blueprints: the data layer, the git model, and one folder per app
apps/data/           @vork/data — schema migrations, the seed, the shared test surface
apps/wakery/         the dispatcher: GitHub webhook in, OpenClaw agent turns out
apps/resolver/       the risk-code resolver the auditor calls
apps/foundry/        the CLI that founds a project and opens a milestone
provisions/          GitHub rulesets, the OpenClaw policy hook, the techspec skill
```

The model in one paragraph. A task is a GitHub issue on a project board with two fields, `Status` and `Audit`. Agents move it by posting a transition comment. Wakery receives the webhook, works out which agent the new state belongs to, and sends that agent one turn through the OpenClaw gateway. An auditor gates every task before execution and reviews it after; the Principal is called in only at a `Govern` checkpoint. Foundry creates the whole surface for a new project in one run. The policy documents say who may do what; the specs say how each piece does it.

## Before it runs

Everything below is yours to supply or change. The order is the order you need it in.

**Hosts.** One host runs Wakery, Foundry and the OpenClaw gateway together; Wakery authenticates to the gateway as a same-host backend client. Postgres is reachable from that host. A public HTTPS endpoint, written as `<ingress-host>` throughout, forwards to Wakery's bind address `127.0.0.1:4311` for GitHub's webhook deliveries. Node.js 22 or later.

**Credentials.** A keystore directory, written as `<keystore>`, holding one `0600` file per secret; every app reads secrets by path and never from the environment. The files it expects:

| File | What it is |
|---|---|
| `github/owner.token` | a personal access token for the account that owns every project: repository admin, projects, webhooks |
| `github/main.token`, `github/heimdall.token`, `github/sarge.token`, `github/<specialist>.token` | one token per agent account; the framework ran every non-auditor agent under one shared account and the auditor under a second, separate one |
| `github/webhook_wakery` | the HMAC secret you generate; GitHub signs deliveries with it and Wakery verifies them |
| `postgres/vork-owner.password`, `postgres/vork-app.password` | the two database roles below |
| `openclaw/gateway-token` | the gateway's shared token |

**Database.** A Postgres database `vork` with two roles: `vork_owner` runs migrations and the seed, `vork_app` is the runtime role and holds no DDL. Run `npm ci` in `apps/data/`, then `npm run migrate` and `npm run seed` there as `vork_owner`. Before the seed, open `apps/data/src/seed.ts` and fill two arrays that ship empty because their rows were the original instance's accounts: `GITHUB_AGENT_SEED` with each agent account's login, node id, agent id and role, and `GITHUB_REPO_PROJECT_SEED` with the repository node id, owner, board node id and board number of each project you track. With both arrays empty the seed writes no agent and no mapping row, and Wakery drops every webhook as unmapped. The seed registers one project key, `vork`; Foundry registers each project it founds.

**Environment files.** `apps/wakery/.env`, `apps/foundry/.env` and `apps/resolver/.env`, each from its `.env.example`, with every `<...>` placeholder replaced: `<keystore>`, `<db-host>`, `<ingress-host>` and `<project-storage-path>`, the parent directory under which each project's clone lives. These carry no default and the app refuses to start without them: `WAKERY_PROJECT_STORAGE_PATH`, `FOUNDRY_PROJECT_STORAGE_PATH`, `FOUNDRY_AGENT_TOKEN_DIR`, `FOUNDRY_OWNER_TOKEN_PATH`, `FOUNDRY_WEBHOOK_URL`, `FOUNDRY_WEBHOOK_SECRET_PATH`. Wakery's example file still names a database `wakery` and a role `wakery` from an earlier era; point its `WAKERY_DATABASE_*` variables at the same `vork` database and `vork_app` role the other apps use, and its password path at `postgres/vork-app.password`.

**GitHub surface, per project.** A repository with standing branches `main` and `dev`. A ProjectV2 board with two single-select fields: `Status` with options Init, Todo, Pending, Progress, Done, Reviewed, Completed, Cancelled, and `Audit` with options Gated, Approved, Revise, Govern. The label set in `apps/foundry/assets/labels.json`. The rulesets in `provisions/github/rulesets/`, which require a status check named `CI`; the repository ships no workflow, so you write one with that name, and the snooze module holds a task while a workflow run of that name is in flight. A webhook to `https://<ingress-host>/adapters/github/webhook` subscribed to the events in `apps/foundry/assets/webhook-events.json` and signed with the secret above. Collaborator grants for the agent accounts. Foundry creates all of this for a new project once its `.env` and tokens are in place; an existing repository gets it by hand.

**Agents.** An OpenClaw gateway on the host speaking gateway protocol 4; the framework was verified against OpenClaw 2026.6.11. Agents `main`, `heimdall` and `sarge`, plus `visor` if you route coding work to a specialist. Each agent's context documents are yours to write: the framework's were personal and are not published, and the message templates assume each agent's `TOOLS.md` names the channel where notices to the Principal go. The policy hook in `provisions/openclaw/hooks/vork-policy/` installs into the gateway and injects the policy documents into each agent at bootstrap; its `config.json` maps agent ids to documents. A messaging channel for checkpoint, stall and cap-alert notices; the framework used Telegram topics, one per project. Every session key a route names, such as `agent:main:<project_key>:spec`, exists on the gateway, or the route uses run delivery with the `[wake_route_lease_id]` template.

**Running.** `apps/wakery/deploy/install.sh` renders the launchd template and loads it on macOS; on another system run `npm start` in `apps/wakery/` under your own supervisor. `apps/foundry/bin/foundry` and `apps/resolver/bin/resolver` run from their directories after `npm ci`. Wakery starts only against a migrated database.

**Exposure.** Ingress verifies the webhook signature and nothing else: it reads no comment author and checks no collaborator status, so on a repository anyone can comment on, anyone can drive a turn. The collaborator boundary of a private repository is the only guard. Keep each conducted repository private and collaborator-only, or add an actor check to `apps/wakery/src/ingress/` before a public endpoint goes live.

**Routes.** A route is switched off by setting its status to `disabled`; a route that has ever held a lease is referenced by the lease table and cannot be deleted.

## Works

- The four suites pass as published: `apps/data` 38 tests, `apps/resolver` 53, `apps/foundry` 90 with one skipped by design, `apps/wakery` 336. Every app typechecks. Run `npm ci` then `npm test` in each directory, `apps/data` first.
- The conduction loop ran in production on the original instance for months: webhook in, eligibility, routing, dispatch, the turn ledger, empty-run recovery, the snooze holds, the board sweep and the stall alarm, the two audit gates and the `Govern` checkpoint.
- The policy corpus, the conventions and record templates, the specs for every app and the data layer, and the techspec skill are complete as documents.
- Foundry founds a project end to end: repository, board and fields, labels, webhook, grants, clones, the Inception task and the registry rows.
- The resolver maps an operation chain to risk codes against the seeded wildcard rows.

## Unbuilt

Specified in the documents and never built.

- The memory policy, `docs/policy/MEMORY.md`, and the Memory Keeper agent it names, Raven. The document is complete; no code or agent ever existed.
- The adversarial QA function the security policy calls the red team. Parked in June 2026 and never started.
- Hotfix conduction, the `hotfix/<slug>` lane as a conducted stage task. Designed, never exercised, retired in August 2026.
- The merge queue the branching policy names as the concurrency mechanism. Deferred for a GitHub plan that never came.

## Broken

Known broken at the tag, left as found.

- **The transition parser against its own grammar.** `apps/wakery/templates/transition-comment.md` tells agents to write a paired transition as `To: Done (Audit: Gated)`. `parseTransitionTargets` in `apps/wakery/src/adapters/github/adapter.ts` reads neither half of that line and returns nothing, so a paired comment carries no expected state. The consequence: a transition registers only once the board fields have already moved, and the field-lag protection the pending path exists for never engages for paired comments. The bare form `To: Done` and the audit-only form `To: Audit Approved` parse. Broken since the grammar was declared canonical in August 2026.
- **Two inspection scripts select columns that were renamed.** `apps/wakery/src/scripts/inspect-all.ts` and `dump-config-tables.ts` read `repo_id`, `owner_name`, `project_title` and their siblings from `github_repo_project`; the columns are `github_repo_id`, `github_owner_name`, `github_project_title`. Both fail on the current schema.
- **`foundry verify` fails against this repository.** It checks a tree against the skeleton Foundry scaffolds, and this tree is an extraction, not a founded project. The suite's standing-fixture test skips itself for the same reason. Verify works against a project Foundry founded.
- **Ingress authenticates deliveries, not authors.** Listed under `Exposure` above; it is a design gap, not a regression.

## Cost

Measured over the original instance's run: 86.8% of tokens and 79.9% of wall-clock time went to conduction itself, the audit turns, transitions, dispatches and re-wakes that make the work traceable, rather than to the work the tasks named. That is the price of a crew that documents every step whether or not anyone reads it, and it is why the crew was retired. The measurement is in the original project's records, which are private.

## Provenance

The framework was built from February to August 2026 under another name, as an attempt to rebuild an engineering team out of agents. It was retired when its cost became clear and the open-ended work moved back to one person and one agent in one session. What survived, the project shape, the lifecycle, the records and the founding tool, is the kit that release 2 publishes.

This repository starts at the extraction. The commit history, the milestone and research records, the incident trail and the tracker it references belong to the original project and are not published; where a spec or a comment cites one of them, the pointer stays as it was written. The former name is replaced by Vork throughout; the four agent personas, `main`, `heimdall`, `sarge` and `visor`, are kept. Placeholders in angle brackets stand where an operator's own value goes; the release note for an AI agent, `docs/releases/release_v2026.10.13/agent-notes.md`, lists every one of them.

Releases are tagged `v<YYYY.MM.DD>`. Release 1 stays at its tag; later releases replace the framework with the kit.

## License

MIT. See `LICENSE`. This release takes no contributions; take what you need and build further as you wish, as `CONTRIBUTING.md` says.
