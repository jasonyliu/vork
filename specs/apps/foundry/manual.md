# Foundry

Foundry turns a project idea into a `PROJECT.md`-compliant Project container in one invocation: the repo with the canonical skeleton and record templates, the board with the wakery-contract fields, the full label set, `main`/`dev` under rulesets, collaborator grants on both surfaces, the crew's clones, the Inception Stage Task, the platform registry rows — project, mapping, agents, and the routes that let the crew be dispatched on it — and a run event trail of everything created under foundry's `var/`. It is not an application starter — it produces governance scaffolding, not a running app.

## Where it runs

On the gateway host (`<gateway-host>`), from the active deployment worktree: that is where the crew's OpenClaw agents, the keystore, and every project's `main/` + `team/<agent>/` clones live. The deployment manual carries its install (`docs/deployments/deploy_production/production.md`); `apps/foundry/.env` is deployment-local and carried into each release worktree like wakery's. Harness sessions on other machines (Claude Code, Codex) work a project's repo through their own checkout under the shared work account's identity (`<worker-login>`) and never run Foundry.

## Commands

```text
foundry bootstrap --bundle <bundle.json> [--conducted]   # or --interactive; --dry-run to preview
foundry verify --against <project-path>                  # structural drift check, exit 0/7
foundry kickoff --project <key> --milestone <slug> [--title <text>] [--note <pointer>] [--conducted]
```

Full flags, bundle fields, environment, and exit codes: `spec_foundry-interface.md`.

## Mental model

`--conducted` is the choice between conduction and conversation: with it, bootstrap creates the Inception Stage Task (assigned to the AI Lead, creation comment posted, lane linked) and kickoff creates the Draft Stage Task the same way, so Sarge's owner lane takes over; without it, bootstrap ends at the rendered Charter and kickoff opens the milestone record on a draft lane — the Principal and the AI Lead work it directly. The registry, routes included, is written either way.

Preflight verifies everything (identities, scopes, names, paths) before any mutation. GitHub bootstrap creates repo → board+fields → labels → webhook → grants. Right after the GitHub coordinates exist, the register stage writes the platform registry — project + mapping + agent rows and the project's route set: the crew's default lanes (AI Lead `main` assignee on every stage type, `heimdall` auditor, `sarge` owner) plus a route per specialist task from the bundle (skipped in standalone mode when no database is configured). Local render clones to `<storage>/<project_key>/main/`, renders the skeleton, pushes the scaffold under the owner's identity, creates `dev`, then hands `main/` to the AI Lead. Rulesets apply once both branches exist; the Inception Stage Task is created under the Principal's token with its lane linked through it; `team/<name>/` clones land for `heimdall`, `sarge`, and each specialist. Every act streams into the run event log under foundry's own `var/runs/` — runtime output, never repo content — and its path prints on completion.

Done means: the Inception Task is live on the board, wakery resolves the project at ingress, and the crew is dispatchable on it with no seeding act and no manual configuration — bootstrap already wrote the registry.

## After bootstrap

Not Foundry's to do, and needed before the crew can work the project:

- A Telegram topic for the project in the crew's group, and its row in Sarge's `TOOLS.md §Channel` table (one topic per project; Sarge's checkpoint notices land there).
- The `Audit` column on the board's view: a new board's default view shows only GitHub's built-in columns, and the API exposes no mutation for views — open the board, `+` at the column header, show `Audit` (and `Labels` if wanted). The field and every item's value exist from bootstrap; only the view hides them.
- The Principal drives Inception: the Charter on `feature/inception/charter`, roles for any specialists filled into the team table.

## Re-runs and recovery

- A failed run's event trail names the completed steps; re-running the same bundle resumes state-based — existing artifacts are skipped, registry rows report existing, drift is recorded, nothing is clobbered. `foundry verify` is the validation surface.
- No auto-rollback — the event trail is the cleanup target list.
- `verify --against <project-storage-path>/vork/main` failing means Foundry's committed skeleton is stale: fix Foundry before bootstrapping a real project.
- Routes are provisioned once; later changes (a specialist swap, a lane override) are ops acts on the route table, and a re-run leaves them standing as recorded drift.

## Kicking off a milestone

Once the next milestone is settled in the project's channel: `foundry kickoff --project <key> --milestone <slug> --conducted --note <pointer>` creates the Draft Stage Task under Sarge's identity — the project manager owns every milestone — assigned to the AI Lead, with its creation comment; ingress mints the owner-lane wake and Sarge's turn takes over. An already-open Draft task is reported, never duplicated. Without `--conducted`, the same command opens `docs/milestones/milestone_v<date>_<slug>/milestone.md` on a pushed draft lane instead — pull the lane and draft in conversation.
