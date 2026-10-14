# Vork Backlog

Standing list of unscheduled improvements, fixes, and observations worth tracking before they are promoted into a Milestone.

## Items

### Release 2 — the standalone kit (handoff, 2026-10-14)

The next milestone, to be opened by Foundry kickoff from a fresh session on the Principal's word. Proposed slug `milestone_v2026.10.14_standalone-kit`; one milestone.

**Ruling (Principal, 2026-10-13/14).** Vork becomes the home of the kit the Principal uses on every project — bootstrap new, kick off milestones: Foundry, the PROJECT rule, the foundry, release and techspec skills, and the current record templates. They move out of the project that built them for good; that project becomes a consumer, pinning a Vork tag and deploying from it in a milestone of its own afterwards. The goal is a working release: someone with a GitHub account, Node and one harness clones Vork, follows the README, and founds a project. Whatever is entangled with the Principal's estate in the scripts, the text and the skills is untangled so the kit serves as a generic tool. Nothing too big; a start of contributing to the community, and something to write about.

**Scope the Principal called close to what he wants.**
- Foundry: repository, board, labels, rulesets, skeleton, templates, kickoff. Standalone is the only path; the registry, routes, crew tokens and webhook leave with the framework.
- The framework tree — `docs/policy/`, `specs/`, `apps/wakery`, `apps/resolver`, `apps/data` — leaves `main` and stays readable at `v2026.10.13`; the README points there.
- PROJECT.md stands alone: no dependence on the Principal's own context documents; the storage layout as defaults an operator can change.
- Installers for Claude Code (rules and skills folders) and Codex (`AGENTS.md` and rules folder) are part of the product, generalised from the consumer project's Codex deploy script.
- The README and the agent note rewritten with the kit as the subject and the framework as history.
- Proof before the tag: the Principal founds a throwaway project from a clean account on the README alone, and the consumer project re-points to the tag. Then the repository goes public, the tag lands, and the Principal's post follows.

**Open, to settle at Draft with evidence.** Whether the registry stays as an option for the Principal's own use. Whether the storage root `~/Vork/projects/` stays a literal default in the rule or becomes a variable throughout.

**Sources, on the consumer project's `dev` at tag `v2026.10.12.r2`:** `docs/agents/rules/PROJECT.md`; `docs/agents/skills/{foundry,release,techspec}/`; `apps/foundry/` (the version that founded this repository, 2026-10-10); `docs/conventions/templates/` (eleven); `provisions/codex/deploy`.

**First act after kickoff.** A research record inventorying every estate entanglement in those five pieces — where it lives, what the generic form is — written against the sources above; the specs follow from it; the Principal's preview before any lane is cut. The extraction discipline of release 1 applies: estate out, placeholders in prose only, required inputs in code, secret scan and retired-term search before every push.

### OpenClaw as a deployment surface (2026-10-14)

Release 2 treats every consumer of the kit as a deployment surface and ships two, Claude Code and Codex. OpenClaw is the third the Principal runs: its agents receive context through a bootstrap hook that renders configured sources into a managed block in each agent's workspace documents, and the kit's rule and skills would reach an OpenClaw agent the same way. Bringing that hook into Vork is a milestone of its own: the hook, its configuration contract, and a `deploy_openclaw` manual. Deferred from release 2 by the Principal's word on 2026-10-14 ("too big to squeeze into this milestone").

**Trail:**

- 2026-10-14 — added at the Draft of `milestone_v2026.10.14_standalone-kit`.

## Skipped

## Done

| Date | Item |
|---|---|
