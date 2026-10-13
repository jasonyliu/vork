# Foundry Interface

How Foundry is invoked and what it accepts: the CLI surface, the input bundle, and the environment. Artifact shapes: `spec_foundry-data.md`. Mechanisms: `spec_foundry.md`.

## CLI

```text
foundry bootstrap [--bundle <path>] [--interactive] [--conducted] [--dry-run]
                  [--project-storage-path <path>] [--verbose|--quiet]
foundry verify --against <project-path> [--bundle <path>]
foundry kickoff --project <project_key> --milestone <slug> [--title <text>] [--note <text>] [--conducted]
```

- `--bundle` and `--interactive` are mutually exclusive; interactive prompts for the bundle fields and writes the bundle file beside the run for replay.
- `--dry-run` — preflight + render to a scratch path; no GitHub mutation, no registry write, no final tree.
- `verify --against` — structural check of an existing tree against the canonical skeleton subset; content beyond the skeleton is never flagged. Without `--bundle` it checks only the bundle-independent subset.
- `--conducted` decides whether a start act enters conduction. **Bootstrap:** with it, the Inception Stage Task is created (assigned to the AI Lead, with its creation comment and the inception lane); without it, no Stage Task exists — the rendered Charter is the founding record and the Principal proceeds in conversation. **Kickoff:** with it, the `project_draft` Stage Task is created on the project's repo under the project manager's token (the issue author is the task owner; he owns every milestone), assigned to the AI Lead, with its creation comment — an existing open `type:project_draft` issue is reported instead of duplicated; without it, the milestone record itself is opened: `docs/milestones/milestone_v<YYYY.MM.DD>_<slug>/milestone.md` instantiated from the canonical template on a `feature/milestone_v<YYYY.MM.DD>_<slug>/draft` lane off `dev` in the project's `main/` clone, index row added, committed as the AI Lead and pushed — an existing folder of that name is reported instead of duplicated. `--milestone` names the slug (`[a-z][a-z0-9-]*`); `--title` the human title (default: the slug); `--note` the settling pointer (Draft Task Scope, or the record's Scope placeholder).
- Re-runs always resume: existing artifacts are skipped and recorded, drift is recorded in the event trail, registry rows report existing, nothing is ever clobbered (`spec_foundry.md §Idempotency and resume`).
- Per-run flags override the environment; the environment overrides built-in defaults.

Exit codes:

| Code | Meaning |
|---:|---|
| 0 | success |
| 1 | generic runtime error |
| 2 | usage error (flag or missing/invalid bundle field, named in the error) |
| 3 | preflight failure (auth, identity, permissions, name collision, storage path) |
| 4 | GitHub API failure (bootstrap mid-pipeline, or `kickoff` task creation) |
| 5 | local-side failure (render, filesystem, git, registry, milestone record) |
| 7 | `verify` drift found (not a runtime failure; caller decides) |

## Crew

Every project is worked by the platform crew — three fixed agents, one per governing role — plus the specialists the bundle adds. The crew is a property of the gateway host, not of a project, so it is a constant of Foundry, not bundle input:

| Role | Agent | Duty on every project |
|---|---|---|
| AI Lead | `main` | assignee of every Stage Task by default; works in `main/` |
| Auditor | `heimdall` | the auditor lane, all task types |
| Project Manager | `sarge` | owner of every Task and milestone; `kickoff` creates under his identity |

Each crew agent and specialist resolves its token as `<FOUNDRY_AGENT_TOKEN_DIR>/<name>.token` — the platform keystore convention: the work accounts serve every bootstrapped project, so the token directory belongs to the platform, not the target project. `main`, `sarge`, and every specialist token authenticate as the shared work account; `heimdall` is a dedicated account so its review approvals are independent of the work identity under `protect-main`. Resolved logins dedupe for grants.

## Input bundle

JSON file carrying the Project's mission core (`PROJECT.md §Core`) and its specialists. No tokens, no GitHub coordinates — those are machine environment, not project input.

| Field | Type | Required | Notes |
|---|---|---|---|
| `project_name` | string | yes | human title; board title verbatim |
| `project_key` | string | yes | `[a-z][a-z0-9_]*`; repo + folder name + registry slug (`project.project`) |
| `mission` | string | yes | one-paragraph mission, rendered into the charter verbatim |
| `description` | string | yes | the goal the Project exists to achieve |
| `scope` | string | yes | the current boundary of work |
| `channel` | string | yes | the designated key sessions/intake paths, recorded in the charter |
| `specialists` | object[] | no | additional work agents beyond the crew; absent or empty means crew only. Each entry: `name` (agent name, token per §Crew) + `tasks` (non-empty list of task types the agent is assignee for — `spec_foundry-data.md §Registry writes`). A specialist may claim stage types; its exact route then replaces the AI Lead's default for that type |

Rules, each failure exiting 2 naming the field:

- Required fields reject empty strings.
- `specialists[].name` must not be a crew agent (`main`, `heimdall`, `sarge`) and must be unique in the list.
- `specialists[].tasks` is non-empty; every value is a canonical task type (`docs/conventions/constants.md`, the same set `@vork/data` seeds into `task_type_label`); no task type appears under two specialists.

A specialist name with no token file exits 3 naming the path.

## Environment

`apps/foundry/.env` in the run surface (dev: `main/apps/foundry/.env`; deployed: the active deployment worktree) — deployment-local, gitignored, carried into each release worktree like wakery's and resolver's; `.env.example` ships the shape. `specs/data/spec_config.md §Foundry` holds the contract; summary:

| Var | Required | Meaning |
|---|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | yes | the Principal's personal-account PAT; its authenticated login *is* the owner. All scaffolding runs under it: repo, board, labels, forms, webhook, rulesets, the Inception Task (scopes `repo`, `project`) |
| `FOUNDRY_AGENT_TOKEN_DIR` | default `<keystore>/github/` | directory crew and specialist names resolve against (§Crew) |
| `FOUNDRY_RULESET` | default `standard` | `standard` seeds `protect-main` + `protect-dev` (`spec_foundry-data.md §GitHub artifacts`); `none` skips |
| `FOUNDRY_PROJECT_STORAGE_PATH` | default `<project-storage-path>` | parent of `<project_key>/` |
| `FOUNDRY_WEBHOOK_URL` | yes | the repo webhook target — Foundry's only wakery relationship: it configures GitHub to deliver there; it never calls wakery |
| `FOUNDRY_WEBHOOK_SECRET_PATH` | yes | keystore path of the HMAC shared secret (read at use, never persisted) |
| `VORK_DATABASE_HOST/PORT/NAME/USER/PASSWORD_PATH` | no | the platform registry connection for the register stage, as `vork_app` (the seeding-act role). `HOST` absent → bootstrap runs standalone and skips registration with an event (the extraction seam) |

## Task body

The canonical body contract for Stage Task issues — every creator follows it: Foundry (the Inception Task at bootstrap, the Draft Stage Task at `kickoff`) and the conductor's turns for every later Stage Task. Four markdown sections, in order:

```markdown
## Type
<task_type value, matching the type: label>

## Scope
<what this Task is to do, with pointers — not prose duplicated from records>

## Primary Specification
<the spec/policy path(s) governing the work>

## Definitive Deliverable
<the concrete artifact path(s) that close the Task>
```

This is the shape the wake-message packet builder and the auditor read. The Inception Stage Task instantiates it with Type `project_inception`, Scope pointing at the founding bundle/channel/registry row/run events, Primary Specification `PROJECT.md`, Definitive Deliverable `main/docs/charter.md`. The Draft Stage Task instantiates it with Type `project_draft`, Scope carrying the `--note` settling pointer, Primary Specification the current Charter and `PROJECT.md`, Definitive Deliverable the active `milestone.md`.

## Stage Task creation

Every Stage Task Foundry creates (`--conducted`) is born the way conduction can see it:

- **Assignee = the AI Lead** (`main`'s login). Wakery's sweep treats an unassigned issue as parked — a note, not a scheduled Task — so an unassigned start act is invisible to conduction; assignment is the act of scheduling (`spec_wakery-board-sweep.md §Definitions`). The Owner stays the issue author (the Principal at bootstrap, the project manager at kickoff).
- **Creation comment**, posted under the creating token right after board placement, in the canonical paired form with both sides the creation state — the delivery that makes ingress mint the `Init/Gated` owner-lane wake at once instead of at the next sweep (the adapter accepts a `To:` equal to the observed state):

  ```markdown
  Transition
  From: Init (Audit: Gated)
  To: Init (Audit: Gated)
  Actor: <Principal (<owner_login>) | Owner (Sarge)>
  Reason: Stage Task created by foundry <bootstrap|kickoff>.
  ```

  The Principal-authored Inception Task resolves principal-handled (no dispatch); the project-manager-authored Draft Task cues the owner lane.

## Verification

- Bundle validation: each required-field omission, each malformed `project_key`, a crew name or duplicate under `specialists`, an empty `tasks`, an unknown task type, and a task type claimed twice exit 2 naming the field; a crew or specialist name with no token file at `<FOUNDRY_AGENT_TOKEN_DIR>/<name>.token`, or an unreadable `FOUNDRY_OWNER_TOKEN_PATH`, exits 3 naming it.
- A missing required env var exits 2 naming it; `VORK_DATABASE_HOST` absent makes bootstrap emit the standalone-skip registry event and complete.
- `--dry-run` performs zero GitHub mutations (assert by API-call recording), writes no registry row, and writes nothing under the storage path.
- `kickoff --conducted` creates the Draft task authored by the project manager's token with the Task-body shape, assigned to the AI Lead, followed by its creation comment; a second call while it stays open reports the existing issue number and creates nothing.
- `kickoff` without `--conducted` creates the milestone folder + `milestone.md` (template sections intact, title/status/date filled, `--note` in Scope) and the index row on the draft lane, pushed; a second call reports the existing folder and creates nothing; a malformed `--milestone` exits 2 naming it.
- `bootstrap` without `--conducted` creates no issue and no inception lane; with it, the Inception Task carries the AI Lead as assignee and its creation comment.
- The Inception and Draft Task bodies parse back into the four Task-body sections.
