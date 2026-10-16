# Release v2026.10.16

- **Tag:** `v2026.10.16`
- **Milestone:** `milestone_v2026.10.14_standalone-kit`
- **Review:** `docs/milestones/milestone_v2026.10.14_standalone-kit/review_2026.10.16.13.23.33.md`

## Features

- The kit as Vork's own: the convention `rules/PROJECT.md`, standing alone; the eleven record templates in `docs/conventions/templates/`, their one home; the `foundry`, `release` and `techspec` skills in `skills/`.
- Foundry standalone in `apps/foundry/`: `bootstrap`, `kickoff`, `verify` and the new `list`; the database registry replaced by `var/projects.json`; the project board dropped for the repository's issues; `visibility` and `ruleset` in the bundle with a preflight plan gate for GitHub Free; the storage root and the Vork account's commit identity from the environment; every request on GitHub REST API version 2026-03-10; the Vork tree itself the `verify` fixture.
- The installer `provisions/install`: one command deploys the kit to a surface, `claude` or `codex`, writes Foundry's environment on the first run from four flags, lands the rule and skills, and for Codex a pointer block in `~/.codex/AGENTS.md`; `--check` reports drift. Manuals for both surfaces under `docs/deployments/`.
- The README with the kit as subject: what an operator supplies, the install, the founding, works, limits, history. CONTRIBUTING for a release that runs.
- The framework tree leaves `main` and stays readable at `v2026.10.13`.

## Fixes

- `foundry bootstrap --interactive` on a pipe never settled; it exits 2 and points at `--bundle`.
- The run log path printed twice; once now.
- The Data spec enumerated GitHub's default labels; the set is GitHub's and the spec names `bug` and `enhancement` alone.
- npm's update notice leaked through the installer; silenced.
- GitHub's deprecation notices on the 2022-11-28 API version; every request names 2026-03-10.
