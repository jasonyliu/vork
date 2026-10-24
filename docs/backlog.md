# Vork Backlog

Standing list of unscheduled improvements, fixes, and observations worth tracking before they are promoted into a Milestone.

## Items

### OpenClaw as a deployment surface (2026-10-14)

Release 2 treats every consumer of the kit as a deployment surface and ships two, Claude Code and Codex. OpenClaw is the third the Principal runs: its agents receive context through a bootstrap hook that renders configured sources into a managed block in each agent's workspace documents, and the kit's rule and skills would reach an OpenClaw agent the same way. Bringing that hook into Vork is a milestone of its own: the hook, its configuration contract, and a `deploy_openclaw` manual. Deferred from release 2 by the Principal's word on 2026-10-14 ("too big to squeeze into this milestone").

**Trail:**

- 2026-10-14 — added at the Draft of `milestone_v2026.10.14_standalone-kit`.

## Skipped

## Done

| Date | Item |
|---|---|
| 2026-10-24 | Identity per actor and the vault's readers and apps — `rules/PROJECT.md §Identity` and `§Storage` (#36), released as `v2026.10.24` |
| 2026-10-23 | The vault in the convention — `rules/PROJECT.md §Storage` names the vault (one git repository per project for its locally managed resources, checked out per actor) and the actor naming for `team/` and `vault/`; landed from the backlog (#33), released as `v2026.10.23` |
| 2026-10-16 | Release 2 — the standalone kit (handoff, 2026-10-14) — shipped by `milestone_v2026.10.14_standalone-kit` as `v2026.10.16`: the kit is Vork's own, deployed to Claude and Codex by one installer; the framework tree left `main` for `v2026.10.13` |
| 2026-10-16 | Foundry on the GitHub REST API version of 2022-11-28 — every request now names `2026-03-10`, `@octokit/rest` 22; shipped by `milestone_v2026.10.14_standalone-kit` the day it was added |
