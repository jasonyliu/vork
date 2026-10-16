# Decomposition — Standalone kit (`milestone_v2026.10.14_standalone-kit`)

## Current

Steps 1 to 4 merged (PRs #18 to #22). Step 5 ran on 2026-10-16 from a staging clone of `dev`: both surfaces installed into a scratch home, `test_vork` founded, kicked off, re-run, verified and listed, every error path exercised; the findings are on a fix lane awaiting approval, and the founded project stays in staging for the Principal's inspection. Next: the Principal's structural check of `test_vork`, then the release lane (step 6).

## Plan

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Foundry standalone: database registry out, JSON registry and `list` in, board out, `visibility` and the plan gate, root required, templates from the kit's one home, Vork's tree the verify fixture, fixtures generic, suite and typecheck green | D2 | done | `feature/milestone_v2026.10.14_standalone-kit/foundry-standalone`, PR #18 |
| 2 | The rule, the eleven templates and the three skills in their homes: `rules/PROJECT.md` rewritten to stand alone (§Storage, §Structure, §GitHub, §Identity per the research); `integration.md`, `deployment.md`, `review.md` rewritten to the current vocabulary; `skills/{foundry,release,techspec}/` with foundry rewritten to the run surface and release generalised | D1, D4 | done | `feature/milestone_v2026.10.14_standalone-kit/rule-templates-skills`, PR #19; review applied in `fix/milestone_v2026.10.14_standalone-kit/vork-account-and-ruleset`, PR #20 |
| 3 | The installer `provisions/install`, `provisions/codex/`, the two manuals `docs/deployments/deploy_claude/`, `deploy_codex/`, the installer's tests `provisions/install.test.sh` | D3 | done | `feature/milestone_v2026.10.14_standalone-kit/installer`, PR #21 |
| 4 | README with the kit as subject, `CONTRIBUTING.md` revisited, the framework tree leaving `main` (`docs/policy/`, `docs/conventions/{constants.md,README.md}`, `specs/` of release 1, `apps/{data,wakery,resolver}`, `provisions/{openclaw,github,skills,foundry,README.md}`) | D5, D1 | done | `feature/milestone_v2026.10.14_standalone-kit/readme-and-framework-exit`, PR #22 |
| 5 | Review: the throwaway founding `test_vork` from the README alone, run by the agent on the Principal's word with the Principal's account pair; the three checks over the whole tree; fixes as `fix/` lanes | all | in progress | staging clone `~/Vork/staging/vork-test/`; `fix/milestone_v2026.10.14_standalone-kit/test-findings` |
| 6 | Release: release record and the agent note, charter refreshed to the kit and closed out, publishing PR, tag, lane sweep, repository public; the consumer project's re-pointing is its own milestone | D5, D6 | pending | |

## Trail

- 2026-10-15 — plan laid down at the opening of Execution; order chosen so that every later record describes a Foundry that already behaves as specified.
- 2026-10-15 — two build-time probes: `GET /user` carries `plan` only under `read:user` (spec_foundry-interface edited); Claude Code path-scoped rules match paths relative to the session's project and never fire for files outside it, so the Claude surface's frontmatter design was dropped on the Principal's word the same day: the rule lands verbatim and loads at launch (spec_kit §Surfaces edited).
- 2026-10-16 — the Principal's review of step 2: the second account is the Vork account; its token path and commit identity are installer flags written into `.env` (required on the first install); `ruleset` moves from the environment into the bundle beside `visibility`. Applied to the rule and foundry skill on the step-2 lane and to the specs and Foundry on `fix/milestone_v2026.10.14_standalone-kit/vork-account-and-ruleset`.
- 2026-10-16 — the agent note and the charter refresh move from step 4 to the release lane (step 6): both name the release tag and the shipped state, which exist only there.
- 2026-10-16 — step 5 performed by the agent on the Principal's word instead of by the Principal; findings: `--interactive` on a pipe never settled (now exits 2), the run log path printed twice, GitHub's default label set differs from the one the spec enumerated, npm notices leaked through the installer, Foundry speaks the 2022-11-28 API version (backlog item). Fixed on the findings lane; the founding itself behaved as specified.
- 2026-10-16 — the API-version item left the backlog the same day: a trial bump in staging showed `@octokit/rest` 22 clean and the 2026-03-10 breaking changes touching nothing Foundry reads, so the header and the bump joined the findings lane.
