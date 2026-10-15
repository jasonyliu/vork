# Foundry

The start acts of the project convention. `bootstrap` turns a bundle (`project_name`, `project_key`, `mission`, `description`, `scope`, `visibility`) into a project that follows `rules/PROJECT.md`: GitHub side (the repository with `main` + `dev`, the `defect` label, `protect-main` / `protect-dev` rulesets, the work-account grant), local side (`<storage-root>/<key>/main/` skeleton clone + empty `team/`), one entry in the machine's project registry (`var/projects.json`), with every act streamed to a run event log under `var/runs/`. `kickoff` opens a milestone: the templated record pushed on its draft lane. `verify` checks a tree against the convention. `list` prints the registry.

- **Specs:** `specs/spec_foundry.md` (Process), `specs/spec_foundry-interface.md` (Interface), `specs/spec_foundry-data.md` (Data)
- **Run:** `bin/foundry <bootstrap|verify|kickoff|list>` (Node 22 + tsx, no build step) from the Vork clone; environment in `.env` (`.env.example`; `provisions/install` writes the storage root)
- **Test:** `npm test` (vitest; GitHub surface mocked; `verify` fixtured against the Vork tree itself)

## Layout

```text
src/            artifacts.ts, bundle.ts, config.ts, errors.ts, events.ts, gitops.ts, main.ts, milestones.ts, pipeline.ts, preflight.ts, registry.ts, render.ts, skeleton.ts, types.ts, variables.ts, verify.ts
src/github/     api.ts, bootstrap.ts, octokit.ts
assets/         labels.json, rulesets/, skeleton/ (the rendered README, charter and backlog)
```

The record templates the skeleton copies verbatim have one home, the Vork clone's `docs/conventions/templates/`; Foundry reads them from there at run time.
