# Foundry

The project-bootstrap CLI: one invocation turns a Principal-supplied input bundle into a fully `PROJECT.md`-compliant Project container — GitHub side (repo, board, labels, webhook, grants, rulesets), platform registry (project, mapping, agent rows, and the route set that makes the crew dispatchable), and local side (skeleton, record templates, `main/` + crew clones) — creates the Inception Stage Task that starts conduction, and streams everything into a run event log under `var/runs/`. `kickoff` opens milestones: under `--conducted`, direct Stage Task creation under the project manager's identity (assigned to the AI Lead, creation comment posted); otherwise the milestone record on a pushed draft lane. `--conducted` gates bootstrap's Inception Task the same way.

- **Specs:** `specs/apps/foundry/` — `spec_foundry.md` (Process), `spec_foundry-interface.md` (Interface), `spec_foundry-data.md` (Data), `manual.md` (operator manual)
- **Run:** `bin/foundry <bootstrap|verify|kickoff>` (Node 22 + tsx, no build step) on the gateway host, from the deployed worktree; environment in `.env` (`.env.example`, `provisions/foundry/`)
- **Test:** `npm test` (vitest; GitHub surface mocked, registry against pg-mem, `verify` fixtured against the platform's own tree)

## Layout

```text
src/
  main.ts          # CLI entry — commands, flags, exit codes
  config.ts        # .env environment (FOUNDRY_* + VORK_DATABASE_*), token-path resolution
  bundle.ts        # input-bundle validation (mission core + specialists)
  preflight.ts     # every check before any mutation — owner, crew, specialists, targets
  pipeline.ts      # the staged bootstrap pipeline
  registry.ts      # foundry's own DB layer — project, mapping, agents, routes (runtime DML)
  events.ts        # run event records, sanitization, the JSONL log
  milestones.ts    # unconducted kickoff — milestone record on a draft lane
  render.ts        # skeleton renderer (lint, substitution, write-with-skip)
  skeleton.ts      # skeleton inventory over assets/skeleton/
  variables.ts     # the closed template-variable set
  verify.ts        # structural drift check (exit 0/7)
  gitops.ts        # local git acts (askpass-injected credentials, per-clone identity)
  artifacts.ts     # committed GitHub-artifact shapes (labels, events, rulesets)
  github/
    api.ts         # the narrow GitHub seam the bootstrap consumes
    octokit.ts     # live implementation (@octokit/rest + graphql)
    bootstrap.ts   # GitHub bootstrap sub-steps, idempotent per the resume table
    startacts.ts   # conduction start acts (--conducted) — Inception Task, Draft Task, creation comment
assets/
  skeleton/        # the canonical skeleton (record templates byte-verbatim)
  rulesets/        # protect-main / protect-dev committed shapes
  labels.json      # the full label inventory with pinned colors
  webhook-events.json  # the canonical wakery subscription set
```

The crew (`main` AI Lead, `heimdall` Auditor, `sarge` Project Manager) and the route template come from `@vork/data`; `registry.ts` writes them. `src/github/startacts.ts` is deliberately separable from the closed-ended core (bootstrap, verify, render) — the extraction seam for post-milestone standalone tooling; so is the register stage, which stands down when the environment names no database.
