# Foundry

The start acts of the project convention. `bootstrap` turns a bundle (`project_name`, `project_key`, `mission`, `description`, `scope`) into a convention-compliant project: GitHub side (private repo with `main` + `dev`, ProjectV2 board on default fields, the `defect` label, `protect-main` / `protect-dev` rulesets, work-account grants), platform registry (one `project` row), local side (`<storage>/<key>/main/` skeleton clone + empty `team/`), with every act streamed to a run event log under `var/runs/`. `kickoff` opens a milestone: the templated record pushed on its draft lane. `verify` checks a tree against the convention.

- **Specs:** `specs/apps/foundry/` — `spec_foundry.md` (Process), `spec_foundry-interface.md` (Interface), `spec_foundry-data.md` (Data), `manual.md` (operator manual)
- **Run:** `bin/foundry <bootstrap|verify|kickoff>` (Node 22 + tsx, no build step) from the machine's production clone — `docs/agents/skills/foundry/`; environment in `.env` (`.env.example`, contract `specs/data/spec_config.md §Foundry`)
- **Test:** `npm test` (vitest; GitHub surface mocked, registry against pg-mem, `verify` fixtured against the psyphix tree)

## Layout

```text
src/            artifacts.ts, bundle.ts, config.ts, errors.ts, events.ts, gitops.ts, main.ts, milestones.ts, pipeline.ts, preflight.ts, registry.ts, render.ts, skeleton.ts, types.ts, variables.ts, verify.ts
src/github/     api.ts, bootstrap.ts, octokit.ts
assets/         labels.json, rulesets, skeleton
```

`assets/skeleton/docs/conventions/templates/` stays byte-identical to psyphix's `docs/conventions/templates/`; `foundry verify --against <psyphix main clone>` is the drift alarm.
