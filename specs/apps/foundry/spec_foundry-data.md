# Foundry Data

The identifier system and artifact inventory for project bootstrap: everything `foundry bootstrap` names and produces, in one place. Mechanisms live in `spec_foundry.md`; invocation contracts in `spec_foundry-interface.md`. `docs/milestones/milestone_v2026.08.18_foundry-v1/milestone.md` — governing milestone.

Foundry's durable outputs are GitHub artifacts, a rendered file tree, the platform registry rows its register stage writes (through foundry's own DB layer — the `project` table, its reference planes, and the route template are specced in `specs/data/spec_database.md`), and an append-only run event trail. Foundry runs no migrations — `@vork/data` is the schema-lifecycle facility.

## Identifier system

- `project_key` — `[a-z][a-z0-9_]*`; names the repo, the local project folder `<storage-path>/<project_key>/`, the registry slug (`project.project`), the project segment of every route session key, and the clone git email domain (`<login>@<project_key>.localhost`).
- `project_name` — human title, verbatim as the ProjectV2 board title (the wakery adapter resolves boards by title).
- Crew agent names `main`, `heimdall`, `sarge` and specialist names — `agent_id` in `github_agent` and `route`, the `team/<name>/` clone folder, the token file stem (`spec_foundry-interface.md §Crew`).
- Branch names, label families (`type:` `task:` `agent:` `risk:`), task types, milestone folder naming — owned by `PROJECT.md §Branching`, `docs/conventions/constants.md`; Foundry consumes, never redefines.
- Foundry var — `apps/foundry/var/` under the run surface (dev: `main/apps/foundry/var/`; deployed: the active deployment worktree), gitignored, same convention as wakery's `var/`. Run event log — `<foundry-var>/runs/<project_key>/run_<YYYYMMDDTHHMMSSZ>_<run_id first 8 hex>.jsonl`, unique by construction.
- `run_id` — UUID v4 per invocation, stamped on every run event.
- Template variables — `{{name}}`, closed set below; a template referencing any other name fails the startup lint with `TEMPLATE_UNKNOWN_VARIABLE`.

## Template variables

| Variable | Source | Notes |
|---|---|---|
| `project_name`, `project_key`, `mission`, `description`, `scope`, `channel` | bundle | verbatim |
| `owner_login` | owner PAT identity | the authenticated login of `FOUNDRY_OWNER_TOKEN_PATH` |
| `team` | crew ∪ specialists | agent-name list, crew first |
| `team_resolved` | derived, preflight | adds each name's authenticated `github_login` + `github_node_id` |
| `utc_now` / `utc_now_compact` | run start | ISO-8601 / `YYYYMMDDTHHMMSSZ` |
| `run_id` | run | run events only |
| `project_node_id`, `repo_node_id` | derived, GitHub bootstrap | |

The charter's Provision section renders as a placeholder — provisions come after the project exists; the charter's team table renders the crew with their platform roles and the specialists with roles left to Inception.

Substitution is verbatim, no escaping; a required variable resolving empty aborts render before any file is written.

## Skeleton inventory

Every file rendered under `<project-path>/main/`:

| Path | Content |
|---|---|
| `README.md` | repo index — `project_name`, `description` |
| `docs/README.md`, `docs/research/README.md`, `docs/milestones/README.md`, `docs/deployments/README.md`, `docs/operations/README.md`, `docs/conventions/README.md`, `specs/README.md`, `apps/README.md`, `provisions/README.md`, `releases/README.md` | static index stubs — one purpose sentence + placeholder list |
| `docs/charter.md` | instantiated from the canonical charter template: bundle fields fill the placeholders, guidance comments deleted (`PROJECT.md §Records`); Provision placeholder, specialist roles left to Inception |
| `docs/backlog.md` | static header + usage notes (`PROJECT.md §Backlog`) |
| `docs/conventions/templates/*` | the canonical record-template set, copied byte-verbatim from Foundry's committed copy |

Not created: `docs/conventions/constants.md`, any `milestone_*/` `research_*/` `deploy_<env>/` `work_<slug>/` `release_*/` folder, `products/`, `.github/workflows/` — each is later lifecycle work. `main/` and `team/<name>/` clones are produced by the pipeline but are not repo content.

Foundry's committed record-template copy must stay byte-identical to Vork's own `docs/conventions/templates/`; `foundry verify --against <project-storage-path>/vork/main` failing on a template mismatch is the drift alarm.

## GitHub artifacts

**Repository** — name `project_key`, private, auto-init off (all first commits are Foundry's), issues on, projects on (the repository's Projects setting is what surfaces the linked ProjectV2 board on the repository side; classic projects no longer exist), wiki/discussions off, merge-commit only (squash/rebase disabled — `PROJECT.md §Branching` merges are `--no-ff`). Standing branches `main` (the scaffold commit — the repository's first) and `dev` (created at it). No issue forms: every Stage Task is created by Foundry or by the conductor, never through GitHub's new-issue dialog.

**ProjectV2 board** — title `project_name`, private, linked to the repo. Two SingleSelect fields, options in order (per the reachable states of `TASK.md`; the wakery eligibility table is canonical). GitHub creates a default `Status` field on every new board; Foundry converges it to the canonical set rather than adding a second one:

| Field | Options (color) |
|---|---|
| `Status` | `Init` (RED), `Todo` (BLUE), `Pending` (PINK), `Progress` (ORANGE), `Done` (YELLOW), `Reviewed` (PURPLE), `Completed` (GREEN), `Cancelled` (GRAY) |
| `Audit` | `Gated` (BLUE), `Approved` (GREEN), `Revise` (YELLOW), `Govern` (RED) |

Views are not API-configurable: the board's default view will not show `Audit` until an operator adds the column (`manual.md §After bootstrap`) — the field and its values are complete regardless. Colors are the platform board's scheme (`ProjectV2SingleSelectFieldOptionColor`); an existing field whose names match but colors differ is converged like a differing option set — while the board holds no items. GraphQL option IDs are captured in the run events from a fresh read after any convergence (the update mutation's response carries placeholder ids); runtime consumers resolve fields and options live by name.

**Labels** — the full `docs/conventions/constants.md` inventory plus `risk:` codes, colors pinned here. Seeding the full set includes types a new project's `task_type_label` registry may not accept yet — label-ahead-of-registry is the intended state.

| Labels | Color |
|---|---|
| `type:project_inception`, `type:project_release` | `#0e8a16` |
| `type:project_draft` | `#fbca04` |
| `type:project_decomposition`, `type:project_integration` | `#1d76db` |
| `type:project_review` | `#b60205` |
| `type:project_deployment`, `type:project_operation`, `type:dbops` | `#006b75` |
| `type:project_hotfix` | `#d93f0b` |
| `type:spec`, `type:research`, `type:deliberation`, `type:coding` | `#5319e7` |
| `type:bug` | `#d73a4a` |
| `type:enhancement` | `#a2eeef` |
| `type:defect`, `task:blocking` | `#e99695` |
| `task:parent` | `#0e8a16` |
| `task:child` | `#bfd4f2` |
| `task:blocked` | `#fef2c0` |
| `agent:assignee`, `agent:owner`, `agent:auditor` | `#c5def5` |
| `risk:R100` `#0e8a16`, `risk:R200` `#fbca04`, `risk:R300` `#d93f0b`, `risk:R999` `#b60205` | per label |

New labels enter `constants.md` first, then get a color row here.

**Rulesets** — committed payload shapes modeled on `provisions/github/rulesets/`:

| Ruleset | Branch | Rules |
|---|---|---|
| `protect-main` | `refs/heads/main` | no deletion, no force-push, PR required with 1 approving review, merge method `merge` only, **no strict up-to-date** (by-record standing-branch sync forbids it — `PROJECT.md §Branching`) |
| `protect-dev` | `refs/heads/dev` | no deletion, no force-push, PR required with 0 reviews, merge method `merge` only, strict up-to-date on |

Both omit the `required_status_checks` rule — Foundry seeds no CI workflow, and a required check with no workflow deadlocks every PR; the project adds the check to both rulesets when its CI lands (the event trail records this follow-up).

**Webhook** — one repo webhook to `FOUNDRY_WEBHOOK_URL`, content-type json, HMAC secret from `FOUNDRY_WEBHOOK_SECRET_PATH` (read at configure time, never persisted), events = the canonical wakery subscription set — `spec_wakery-github-adapter.md` is authoritative; Foundry's committed event list is a copy of it and drift between them is a Foundry bug.

**Collaborator grants** — the deduped set of logins over crew ∪ specialists, on both surfaces per login: repo (`permission: push`, invite sent by the owner token, accepted in-run with a token of the invited account) and ProjectV2 (`WRITER`, owner-side). Account topology: one personal owner account, one shared work account behind `main`, `sarge`, and every specialist token — so their grants dedupe to a single work-account invitation — and one dedicated audit account behind `heimdall`, separate so its review approvals are independent of the work identity under `protect-main`. No out-of-band acceptance path exists.

## Registry writes

A `project` row IS the project's creation. The register stage writes the platform registry directly — foundry's own DB layer, runtime DML as the `vork_app` seeding act — right after the GitHub coordinates exist:

| Row | Content | Idempotency key |
|---|---|---|
| `project` | slug (`project_key`) + name (`project_name`), status `active` | slug (UNIQUE) — existing row reports `existing` |
| `github_repo_project` | platform `project_id` + the `github_`-prefixed coordinates and node IDs | `github_repo_id` |
| `github_agent` | one per crew agent and specialist: resolved login + node id, `agent_id` = the agent name, role `auditor` for `heimdall`, `agent` otherwise. The Principal's `principal` row is platform seed (`@vork/data`), never written here | `agent_id` — platform-global rows, so most pre-exist |
| `route` | the project's route set from the route template — `specs/data/spec_database.md §2 Route provisioning`: crew defaults (nine stage types + the assignee wildcard → `main`; auditor wildcard → `heimdall`; owner wildcard → `sarge`) and one exact assignee route per specialist task, all `run` delivery, session keys `agent:<agent>:<project_key>:<lane>:run:[wake_route_lease_id]` | `(project_id, task_type, actor)` among active rows — existing reports `existing`; a different `agent_id` there is drift, left untouched |

Connection from `VORK_DATABASE_*`; host absent → the stage is skipped with an event (standalone mode — the extraction seam). Later route changes (a specialist swap, a lane override) are ops acts on the config plane — Foundry provisions, never re-provisions.

## Run events

The audit trail of one bootstrap run — an execution by-product, the same genre as wakery's event log, so it lives in foundry's own runtime surface, never in the new project's repo: the JSONL file at the identifier system's run-event path. Each line: `{ ts, run_id, event, ...payload }`. Events: `run_started` (sanitized input bundle) · `resource` (one per artifact act, streamed as it completes — a failed run's trail already covers everything that ran) · `run_failed` (message + exit code) · `run_finished`.

Resource payloads, one per artifact touched: `repo` (name, node_id, created_or_skipped, settings_applied) · `project_v2` (title, node_id) · `project_field` (name, options[{name,id}]) · `project_repo_link` · `label` (repo, name, created_or_updated_or_skipped) · `webhook` (hook_id, url, events, active; never the secret) · `collaborator` (github_login, repo_invite_status: invited|accepted|already_collaborator|failed, project_grant_status: granted|failed — an upsert, re-granted every run, invitation_id?, accepted_at?, error?) · `ruleset` (name, enforcement, rules_applied, drift) · `inception_task` (issue_number, node_id, linked_branch, created|converged|skipped, assignee, creation_comment: posted|skipped; or skipped_reason `not conducted`) · `clone` (name, path, probe_result, drift? — a torn `main/` re-cloned) · `file` (path, created_or_skipped_or_drift) · `registry` (project_id, project: created|existing|skipped, mapping, agents_created, agents_existing, routes_created, routes_existing, routes_drift[{task_type, actor, agent_id}], skipped_reason?).

Sanitization: a field whose name, split into segments on `_`/`-`/case boundaries, carries one of `token|password|passwd|secret|key|pat|bearer|auth|authorization|credential(s)` (case-insensitive) is written as `"***"` — segments, not substrings: `path` is never redacted, `project_key` always is (the run file name carries the key).

## Verification

- Startup lint: every `{{variable}}` in the committed skeleton resolves against the variable table.
- A rendered tree contains exactly the skeleton inventory; `docs/conventions/templates/` byte-matches the committed copy; the charter follows the template's section contract.
- Board fields carry exactly the option sets above, in order, with option IDs in the run events.
- Seeded labels match this table by name and color; rulesets match the committed shapes with the status-check omission.
- Webhook event list equals the adapter spec's set.
- Registry: after a crew-only bootstrap the project holds exactly twelve active routes (nine stage + three wildcards); a specialist claiming a stage type replaces that type's `main` row; a re-run reports every registry row `existing` and writes none; an ops-changed route survives a re-run as drift.
- No secret-pattern value appears in any run event.
- Two runs, same bundle → byte-identical local output modulo `utc_now`, `run_id`, derived node IDs.
