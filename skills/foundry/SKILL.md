---
name: foundry
description: Found a new project or open a milestone with Foundry — preflight, dry-run, the act, verification. Use when the Principal directs a founding or a new milestone.
---

# Foundry — start acts

Foundry performs the two start acts of the project convention: `bootstrap` founds a project (repository, skeleton, local clone, registry entry), `kickoff` opens a milestone. It runs from the Vork clone at the release tag the machine was installed from:

```
cd <vork clone>/apps/foundry
```

`apps/foundry/.env` sits beside it (shape: `.env.example`; contract: `specs/spec_foundry-interface.md §Environment`): the two token files, the ruleset mode, the storage root the installer wrote. Every act runs through `./bin/foundry`; `foundry list` prints the projects founded from this clone.

## Bootstrap — found a project

1. **Bundle** — write a JSON file carrying the mission core: `project_name`, `project_key` (`[a-z][a-z0-9_]*`, colliding with no existing project folder or repository), `mission`, `description`, `scope`, and `visibility` (`private`, the default, or `public`). A free GitHub plan applies rulesets to public repositories alone: on a free plan choose `public`, or set `FOUNDRY_RULESET=none` in `.env`. Any other field exits 2.
2. **Dry-run first, always** — `./bin/foundry bootstrap --bundle <path> --dry-run`: zero mutation, prints `preflight passed` (owner and work account resolved, plan named) and renders the skeleton to scratch under `var/dry-run/`. A preflight failure names its cause — fix, re-run.
3. **The act** — same command without `--dry-run`. One run founds everything; ends `run_finished`, exit 0, and prints the run event log's path. A killed or failed run is resumable: re-run, it completes idempotently and records prior work as skipped.
4. **Verify** — `./bin/foundry verify --against <storage-root>/<key>/main` exits 0; `gh api repos/<owner>/<key>` shows the repository with `main` and `dev`; `./bin/foundry list` shows the entry; the machine holds the project folder per the storage convention.

## Kickoff — open a milestone

1. `./bin/foundry kickoff --project <key> --milestone <slug> [--title "<Title>"] [--note "<settling pointer>"]` — slug `[a-z][a-z0-9-]*`; the folder becomes `milestone_v<YYYY.MM.DD>_<slug>` (date = today UTC); `--note` seeds the record's Scope.
2. It prints the lane and record path: `feature/milestone_v<date>_<slug>/draft` pushed with the templated `milestone.md`, the charter left for the Draft to mark Active. An existing folder of that name is reported, never duplicated.
3. **Then the Draft is authored**: fetch the lane in the working clone, write `milestone.md` with the Principal, open the pull request to `dev` — the Draft is settled in conversation, and its merge makes the milestone Active.

## Failure

Exit 2 = malformed input (fix the flag, the bundle or the environment). Exit 3 = preflight (a token, a name collision, the storage path, the plan gate). Exit 4 = GitHub failure, exit 5 = git or filesystem — read the printed act, resolve, re-run; both acts are idempotent and converge.
