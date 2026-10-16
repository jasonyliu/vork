# Decomposition — Standalone kit (`milestone_v2026.10.14_standalone-kit`)

## Current

Steps 1 to 3 merged (PRs #18, #19, #20, #21). Step 4, the README with the kit as subject, CONTRIBUTING revisited and the framework tree gone from `main`, is on its lane awaiting approval; the agent note and the charter refresh ride the release lane. Next: the Principal's throwaway founding (step 5).

## Plan

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Foundry standalone: database registry out, JSON registry and `list` in, board out, `visibility` and the plan gate, root required, templates from the kit's one home, Vork's tree the verify fixture, fixtures generic, suite and typecheck green | D2 | done | `feature/milestone_v2026.10.14_standalone-kit/foundry-standalone`, PR #18 |
| 2 | The rule, the eleven templates and the three skills in their homes: `rules/PROJECT.md` rewritten to stand alone (§Storage, §Structure, §GitHub, §Identity per the research); `integration.md`, `deployment.md`, `review.md` rewritten to the current vocabulary; `skills/{foundry,release,techspec}/` with foundry rewritten to the run surface and release generalised | D1, D4 | done | `feature/milestone_v2026.10.14_standalone-kit/rule-templates-skills`, PR #19; review applied in `fix/milestone_v2026.10.14_standalone-kit/vork-account-and-ruleset`, PR #20 |
| 3 | The installer `provisions/install`, `provisions/codex/`, the two manuals `docs/deployments/deploy_claude/`, `deploy_codex/`, the installer's tests `provisions/install.test.sh` | D3 | done | `feature/milestone_v2026.10.14_standalone-kit/installer`, PR #21 |
| 4 | README with the kit as subject, `CONTRIBUTING.md` revisited, the framework tree leaving `main` (`docs/policy/`, `docs/conventions/{constants.md,README.md}`, `specs/` of release 1, `apps/{data,wakery,resolver}`, `provisions/{openclaw,github,skills,foundry,README.md}`) | D5, D1 | in progress | `feature/milestone_v2026.10.14_standalone-kit/readme-and-framework-exit` |
| 5 | Review: the Principal's throwaway founding from a clean account pair on the README alone; the three checks (retired-term search, gitleaks, strict placeholder check) over the whole tree; fixes as `fix/` lanes | all | pending | |
| 6 | Release: release record and the agent note, charter refreshed to the kit and closed out, publishing PR, tag, lane sweep, repository public; the consumer project's re-pointing is its own milestone | D5, D6 | pending | |

## Trail

- 2026-10-15 — plan laid down at the opening of Execution; order chosen so that every later record describes a Foundry that already behaves as specified.
- 2026-10-15 — two build-time probes: `GET /user` carries `plan` only under `read:user` (spec_foundry-interface edited); Claude Code path-scoped rules match paths relative to the session's project and never fire for files outside it, so the Claude surface's frontmatter design was dropped on the Principal's word the same day: the rule lands verbatim and loads at launch (spec_kit §Surfaces edited).
- 2026-10-16 — the Principal's review of step 2: the second account is the Vork account; its token path and commit identity are installer flags written into `.env` (required on the first install); `ruleset` moves from the environment into the bundle beside `visibility`. Applied to the rule and foundry skill on the step-2 lane and to the specs and Foundry on `fix/milestone_v2026.10.14_standalone-kit/vork-account-and-ruleset`.
- 2026-10-16 — the agent note and the charter refresh move from step 4 to the release lane (step 6): both name the release tag and the shipped state, which exist only there.
