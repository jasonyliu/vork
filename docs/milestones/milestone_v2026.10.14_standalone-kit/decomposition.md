# Decomposition — Standalone kit (`milestone_v2026.10.14_standalone-kit`)

## Current

Execution opened 2026-10-15 on the Draft's merge (PR #17). Step 1, Foundry standalone, is in progress on its lane: the source Foundry and the eleven templates are imported as the base; the code changes follow the three Foundry specs. Next: the rule, templates and skills (step 2).

## Plan

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Foundry standalone: database registry out, JSON registry and `list` in, board out, `visibility` and the plan gate, root required, templates from the kit's one home, Vork's tree the verify fixture, fixtures generic, suite and typecheck green | D2 | in progress | `feature/milestone_v2026.10.14_standalone-kit/foundry-standalone` |
| 2 | The rule, the eleven templates and the three skills in their homes: `rules/PROJECT.md` rewritten to stand alone (§Storage, §Structure, §GitHub, §Identity per the research); `integration.md`, `deployment.md`, `review.md` rewritten to the current vocabulary; `skills/{foundry,release,techspec}/` with foundry rewritten to the run surface and release generalised | D1, D4 | pending | |
| 3 | The installer `provisions/install`, `provisions/{claude,codex}/`, the two manuals `docs/deployments/deploy_claude/`, `deploy_codex/`; the frontmatter glob form proven | D3 | pending | |
| 4 | README with the kit as subject, `CONTRIBUTING.md` revisited, the agent note, the framework tree leaving `main` (`docs/policy/`, `docs/conventions/constants.md`, `specs/` of release 1, `apps/{data,wakery,resolver}`, `provisions/{openclaw,github,skills,foundry}`) | D5, D1 | pending | |
| 5 | Review: the Principal's throwaway founding from a clean account pair on the README alone; the three checks (retired-term search, gitleaks, strict placeholder check) over the whole tree; fixes as `fix/` lanes | all | pending | |
| 6 | Release: release record, charter close-out, publishing PR, tag, lane sweep, repository public; the consumer project's re-pointing is its own milestone | D6 | pending | |

## Trail

- 2026-10-15 — plan laid down at the opening of Execution; order chosen so that every later record describes a Foundry that already behaves as specified.
