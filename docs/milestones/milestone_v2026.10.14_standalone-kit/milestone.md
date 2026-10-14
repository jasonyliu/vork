# Milestone: Standalone kit (`milestone_v2026.10.14_standalone-kit`)

**Status:** `Active (started 2026-10-14)`

## Scope

Release 2 makes Vork the home of the kit the Principal uses on every project: Foundry, the convention `PROJECT.md`, the foundry, release and techspec skills, and the eleven record templates move out of the consumer project for good, untangled from the Principal's estate so that anyone with two GitHub accounts, Node and one harness clones Vork, follows the README, and founds a project. Each consumer of the kit is a deployment surface; this release ships two, Claude Code and Codex, each with its manual, landed by one installer. The framework tree of release 1 leaves `main` and stays readable at `v2026.10.13`. The consumer project becomes a consumer, pinning a Vork tag, in a milestone of its own afterwards.

Rulings at Draft (2026-10-14): the registry leaves Foundry whole; the storage root is a parameter with `~/Vork/projects/` as the suggested default; the two-account identity and both rulesets stay; OpenClaw as a third surface is backlog work. Handoff and trail: `docs/backlog.md`, "Release 2 — the standalone kit (handoff, 2026-10-14)".

## Deliverables

1. The tree per `specs/spec_kit.md §Layout`: `rules/PROJECT.md` rewritten to stand alone (the research's §Rule), `skills/`, `docs/conventions/templates/` holding the eleven with the three residue-bearing templates rewritten to the current rule's vocabulary, the framework tree gone from `main`.
2. `apps/foundry/` standalone per the three Foundry specs: registry removed, storage root required, templates read from the kit's one home, Vork's tree the verify fixture, fixtures generic, suite and typecheck green.
3. `provisions/install` per `specs/spec_kit.md §Install`, with its two surface sources, and the two deployment manuals `docs/deployments/deploy_claude-code/` and `deploy_codex/`.
4. The three skills in `skills/`: techspec verbatim, release with its deployment steps generalised, foundry rewritten to the run surface.
5. `README.md` with the kit as subject, leading with what an operator supplies, and the framework as history at its tag; `docs/releases/release_v<date>/agent-notes.md` with the placeholder legend; `CONTRIBUTING.md` revisited for a release that runs.
6. The charter refreshed to what Vork now is; the release record; the tag; the repository public.

## Verification

- The Principal founds a throwaway project from a clean account pair, on the README alone, and reaches the charter conversation in a harness session where the rule loaded on its own.
- `foundry verify --against <vork clone>` exits 0; the Foundry suite and typecheck pass; `install --check` is clean on both surfaces on the build machine.
- The retired-term search of release 1 is clean over the whole tree, `~/Vork/projects/` excepted as the stated default; `gitleaks` is clean; the strict placeholder check on `.ts` is empty.
- The consumer project re-points its workstation and production deployments to the Vork tag (its own milestone; this one is complete when the tag exists and the repository is public).

## Research

- `docs/research/research_20261014_estate-entanglement/`: every estate entanglement in the six pieces, the generic form of each, and the evidence for the open questions (storage root, registry, single account).

## Specs

- `specs/spec_kit.md`: the package layout, the surfaces, the installer, the run surface.
- `specs/spec_foundry.md`, `specs/spec_foundry-interface.md`, `specs/spec_foundry-data.md`: Foundry standalone.

### Trail

| Spec | Change | Note |
|---|---|---|
| `spec_kit.md` | created | layout, surfaces (Claude Code, Codex, operator), installer contract, run surface |
| `spec_foundry.md` | created | from the consumer project's spec: register stage removed, fixture is the Vork tree, run surface is the clone |
| `spec_foundry-interface.md` | created | registry env gone, `FOUNDRY_PROJECT_STORAGE_PATH` required, `FOUNDRY_VAR` documented, token names generic |
| `spec_foundry-data.md` | created | registry writes gone, templates' one home at `docs/conventions/templates/`, `branch` event listed |
