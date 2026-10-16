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

- `--bundle` and `--interactive` are mutually exclusive; interactive prompts for the bundle fields on a terminal and writes the bundle file beside the run for replay; with stdin a pipe or a file it exits 2 and points at `--bundle`.
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

Two tokens, both file paths, plus one commit identity, the whole identity surface:

| Token | Role |
|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | the owner account's token: its authenticated login *is* the owner; creates the repo, pushes the scaffold, applies rulesets, sends the invite. The owner is the Principal, who approves pull requests. `GET /user` carries the plan the gate reads only when the token holds `read:user` (classic); otherwise the plan is `unknown` and a refused ruleset is named at its own stage. |
| `FOUNDRY_VORK_TOKEN_PATH` | the Vork account's token: accepts the invite and pushes kickoff's lane. Every agent session commits and pushes as this account. |
| `FOUNDRY_VORK_NAME`, `FOUNDRY_VORK_EMAIL` | the Vork account's commit identity, `user.name` and `user.email`, bound to every founded `main/`; what every commit from a founded clone carries unless the committer overrides it |

Two accounts, and the separation is the gate: an account cannot approve its own pull request, so `protect-main`'s one required review is satisfiable only by the owner reviewing the Vork account's lanes (`rules/PROJECT.md §Identity`). Each token is a file the operator creates and names; Foundry reads it by path and never from the environment's value. A classic token needs the `repo` scope, and `read:user` for the plan gate to act before any mutation; a fine-grained token needs repository administration, contents, issues and pull requests on the owner's repositories.

## Input bundle

JSON file carrying the project's mission core. Tokens and GitHub coordinates are machine environment and stay there.

| Field | Type | Required | Notes |
|---|---|---|---|
| `project_name` | string | yes | human title |
| `project_key` | string | yes | `[a-z][a-z0-9_]*`; repo name, folder name and registry key |
| `mission` | string | yes | one-paragraph mission, rendered into the charter verbatim |
| `description` | string | yes | the goal the project exists to achieve |
| `scope` | string | yes | the current boundary of work |
| `visibility` | `private` \| `public` | default `private` | the repository's visibility; with a free plan, `private` takes `ruleset: none` (`spec_foundry.md §Preflight`) |
| `ruleset` | `standard` \| `none` | default `standard` | `standard` seeds `protect-main` + `protect-dev` (`spec_foundry-data.md §GitHub artifacts`); `none` skips them |

Rules, each failure exiting 2 naming the field: required fields reject empty strings; a malformed `project_key`, an unknown `visibility` or an unknown `ruleset` value exits 2; a retired field (`channel`, `specialists`, `team`) exits 2 naming it. An unreadable token file exits 3 naming the path.

## Environment

`apps/foundry/.env` in the Vork clone, machine-local, gitignored; `.env.example` ships the shape and `provisions/install` writes every line (`spec_kit.md §Install`). Every variable is read from `.env` or the process environment; the process environment wins. Every variable below is required and carries no built-in default.

| Var | Required | Meaning |
|---|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | yes | §Identity |
| `FOUNDRY_VORK_TOKEN_PATH` | yes | §Identity |
| `FOUNDRY_VORK_NAME`, `FOUNDRY_VORK_EMAIL` | yes | §Identity |
| `FOUNDRY_PROJECT_STORAGE_PATH` | yes | the storage root: parent of every `<project_key>/` (`rules/PROJECT.md §Storage`); `~` expands to the home directory; `--project-storage-path` overrides it per run |
| `FOUNDRY_VAR` | optional, default `apps/foundry/var/` | Foundry's runtime output directory: run events, dry-run scratch, the registry (`spec_foundry-data.md §Identifier system`) |

Plan matrix, enforced at preflight:

| Owner plan | bundle `visibility` | bundle `ruleset` | Outcome |
|---|---|---|---|
| paid (`pro` and above) | any | any | proceeds |
| `free` | `public` | `standard` or `none` | proceeds |
| `free` | `private` | `none` | proceeds; the review gate holds by convention alone |
| `free` | `private` | `standard` | exit 3 before any mutation; with the plan `unknown`, the ruleset stage exits 4 naming the same two ways out, and a re-run with `none` resumes |

## Verification

- Bundle validation: each required-field omission, each malformed `project_key`, each unknown `visibility` and each unknown `ruleset` exits 2 naming the field; an unreadable token path exits 3 naming it; `--interactive` without a terminal exits 2 naming `--bundle`.
- A missing required env var exits 2 naming it, each of the five.
- Every row of the plan matrix behaves as stated against a mocked `GET /user`.
- `--dry-run` performs zero GitHub mutations (assert by API-call recording), zero writes under the storage path, and leaves the registry byte-identical.
- `kickoff` creates the milestone folder + `milestone.md` (template sections intact, title, status and date filled, `--note` in Scope) on the draft lane, pushed; a second call reports the existing folder, leaving it exactly as found; a malformed `--milestone` exits 2 naming it.
- `list` renders every registry entry once, in key order.
- Bootstrap's GitHub artifact set is exactly: repo, the `defect` label, the Vork account's grant, `main` + `dev`, the two rulesets (when `standard`); its local set is exactly the skeleton, `main/`, one empty `team/` directory, and one registry entry.
