# Decomposition — Standalone kit (`milestone_v2026.10.14_standalone-kit`)

## Current

Execution opened 2026-10-15 on the Draft's merge (PR #17). Step 1, Foundry standalone, is built and green on its lane, PR #18 awaiting the Principal's approval. The Claude surface is settled: the rule lands verbatim and loads at launch. Next: the rule, templates and skills (step 2).

## Plan

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Foundry standalone: database registry out, JSON registry and `list` in, board out, `visibility` and the plan gate, root required, templates from the kit's one home, Vork's tree the verify fixture, fixtures generic, suite and typecheck green | D2 | in progress | `feature/milestone_v2026.10.14_standalone-kit/foundry-standalone`, PR #18 |
| 2 | The rule, the eleven templates and the three skills in their homes: `rules/PROJECT.md` rewritten to stand alone (§Storage, §Structure, §GitHub, §Identity per the research); `integration.md`, `deployment.md`, `review.md` rewritten to the current vocabulary; `skills/{foundry,release,techspec}/` with foundry rewritten to the run surface and release generalised | D1, D4 | pending | |
| 3 | The installer `provisions/install`, `provisions/codex/`, the two manuals `docs/deployments/deploy_claude/`, `deploy_codex/` | D3 | pending | |
| 4 | README with the kit as subject, `CONTRIBUTING.md` revisited, the agent note, the framework tree leaving `main` (`docs/policy/`, `docs/conventions/constants.md`, `specs/` of release 1, `apps/{data,wakery,resolver}`, `provisions/{openclaw,github,skills,foundry}`) | D5, D1 | pending | |
| 5 | Review: the Principal's throwaway founding from a clean account pair on the README alone; the three checks (retired-term search, gitleaks, strict placeholder check) over the whole tree; fixes as `fix/` lanes | all | pending | |
| 6 | Release: release record, charter close-out, publishing PR, tag, lane sweep, repository public; the consumer project's re-pointing is its own milestone | D6 | pending | |

## Trail

- 2026-10-15 — plan laid down at the opening of Execution; order chosen so that every later record describes a Foundry that already behaves as specified.
- 2026-10-15 — two build-time probes: `GET /user` carries `plan` only under `read:user` (spec_foundry-interface edited); Claude Code path-scoped rules match paths relative to the session's project and never fire for files outside it, so the Claude surface's frontmatter design was dropped on the Principal's word the same day: the rule lands verbatim and loads at launch (spec_kit §Surfaces edited).
- 2026-10-16 — the Principal's review of step 2: the second account is the Vork account; its token path and commit identity are installer flags written into `.env` (required on the first install); `ruleset` moves from the environment into the bundle beside `visibility`. Applied to the rule and foundry skill on the step-2 lane and to the specs and Foundry on `fix/milestone_v2026.10.14_standalone-kit/vork-account-and-ruleset`.
