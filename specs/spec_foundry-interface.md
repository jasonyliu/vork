# Foundry Interface

How Foundry is invoked and what it accepts: the CLI surface, the input bundle, and the environment. Artifact shapes: `spec_foundry-data.md`. Mechanisms: `spec_foundry.md`.

## CLI

```text
foundry bootstrap [--bundle <path>] [--interactive] [--dry-run]
                  [--project-storage-path <path>] [--verbose|--quiet]
foundry verify --against <project-path> [--bundle <path>]
foundry kickoff --project <project_key> --milestone <slug> [--title <text>] [--note <text>]
foundry list
```

- `--bundle` and `--interactive` are mutually exclusive; interactive prompts for the bundle fields and writes the bundle file beside the run for replay.
- `--dry-run`: preflight + render to a scratch path under Foundry's var; GitHub, the storage path and the registry stay untouched.
- `verify --against`: structural check of an existing tree against the canonical skeleton subset; content beyond the skeleton passes free. Without `--bundle` it checks only the bundle-independent subset.
- `kickoff` opens the milestone record on its draft lane (`spec_foundry.md §Kickoff`). `--milestone` names the slug (`[a-z][a-z0-9-]*`); `--title` the human title (default: the slug); `--note` the settling pointer, seeded into the record's Scope. An existing folder of that name is reported instead of duplicated.
- `list` prints the machine's project registry (`spec_foundry.md §List`).
- Re-runs always resume: existing artifacts are skipped and recorded, drift is recorded in the event trail, existing state stands (`spec_foundry.md §Idempotency and resume`).
- Per-run flags override the environment.

Exit codes:

| Code | Meaning |
|---:|---|
| 0 | success |
| 1 | generic runtime error |
| 2 | usage error (flag, missing or invalid bundle field, missing environment variable; named in the error) |
| 3 | preflight failure (auth, identity, permissions, plan gate, name collision, storage path) |
| 4 | GitHub API failure |
| 5 | local-side failure (render, filesystem, git, registry file, milestone record) |
| 7 | `verify` drift found (a finding, distinct from runtime failure; the caller decides) |

## Identity

Two tokens, both file paths, the whole auth surface:

| Token | Role |
|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | the owner account's token: its authenticated login *is* the owner and its plan the plan gate reads; creates the repo, pushes the scaffold, applies rulesets, sends the invite. The owner is the Principal, who approves pull requests. |
| `FOUNDRY_WORK_TOKEN_PATH` | the work account's token: accepts the invite, holds `main/`'s bound identity, and commits kickoff's lane. Every agent session commits and pushes as this account. |

Two accounts, and the separation is the gate: an account cannot approve its own pull request, so `protect-main`'s one required review is satisfiable only by the owner reviewing the work account's lanes (`rules/PROJECT.md §Identity`). Each token is a file the operator creates and names; Foundry reads it by path and never from the environment's value. A classic token needs the `repo` scope; a fine-grained token needs repository administration, contents, issues and pull requests on the owner's repositories.

## Input bundle

JSON file carrying the project's mission core. Tokens and GitHub coordinates are machine environment and stay there.

| Field | Type | Required | Notes |
|---|---|---|---|
| `project_name` | string | yes | human title |
| `project_key` | string | yes | `[a-z][a-z0-9_]*`; repo name, folder name and registry key |
| `mission` | string | yes | one-paragraph mission, rendered into the charter verbatim |
| `description` | string | yes | the goal the project exists to achieve |
| `scope` | string | yes | the current boundary of work |
| `visibility` | `private` \| `public` | default `private` | the repository's visibility; with a free plan, `private` takes `FOUNDRY_RULESET=none` (`spec_foundry.md §Preflight`) |

Rules, each failure exiting 2 naming the field: required fields reject empty strings; a malformed `project_key` or an unknown `visibility` value exits 2; a retired field (`channel`, `specialists`, `team`) exits 2 naming it. An unreadable token file exits 3 naming the path.

## Environment

`apps/foundry/.env` in the Vork clone, machine-local, gitignored; `.env.example` ships the shape and `provisions/install` writes the storage root into it (`spec_kit.md §Install`). Every variable is read from `.env` or the process environment; the process environment wins.

| Var | Required | Meaning |
|---|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | yes | §Identity |
| `FOUNDRY_WORK_TOKEN_PATH` | yes | §Identity |
| `FOUNDRY_PROJECT_STORAGE_PATH` | yes | the storage root: parent of every `<project_key>/` (`rules/PROJECT.md §Storage`); `~` expands to the home directory; `--project-storage-path` overrides it per run |
| `FOUNDRY_RULESET` | default `standard` | `standard` seeds `protect-main` + `protect-dev` (`spec_foundry-data.md §GitHub artifacts`); `none` skips |
| `FOUNDRY_VAR` | default `apps/foundry/var/` | Foundry's runtime output directory: run events, dry-run scratch, the registry (`spec_foundry-data.md §Identifier system`) |

Plan matrix, enforced at preflight:

| Owner plan | `visibility` | `FOUNDRY_RULESET` | Outcome |
|---|---|---|---|
| paid (`pro` and above) | any | any | proceeds |
| `free` | `public` | `standard` or `none` | proceeds |
| `free` | `private` | `none` | proceeds; the review gate holds by convention alone |
| `free` | `private` | `standard` | exit 3 before any mutation |

## Verification

- Bundle validation: each required-field omission, each malformed `project_key` and each unknown `visibility` exits 2 naming the field; an unreadable token path exits 3 naming it.
- A missing required env var exits 2 naming it; `FOUNDRY_PROJECT_STORAGE_PATH` absent exits 2 (the root carries no built-in default).
- Every row of the plan matrix behaves as stated against a mocked `GET /user`.
- `--dry-run` performs zero GitHub mutations (assert by API-call recording), zero writes under the storage path, and leaves the registry byte-identical.
- `kickoff` creates the milestone folder + `milestone.md` (template sections intact, title, status and date filled, `--note` in Scope) on the draft lane, pushed; a second call reports the existing folder, leaving it exactly as found; a malformed `--milestone` exits 2 naming it.
- `list` renders every registry entry once, in key order.
- Bootstrap's GitHub artifact set is exactly: repo, the `defect` label, the work-account grant, `main` + `dev`, the two rulesets (when `standard`); its local set is exactly the skeleton, `main/`, one empty `team/` directory, and one registry entry.
