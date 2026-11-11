# Decomposition — Handoff, fixes, and foundry publish (`milestone_v2026.11.11_handoff-fixes-publish`)

## Current

Every build and record of the milestone is on `dev` or in #42: the draft (#39), `publish` (#40), `kickoff --fix` with the README (#41), the fix records (#42). Next: the Principal's review, then the release.

## Plan

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Research record | — | done | `feature/milestone_v2026.11.11_handoff-fixes-publish/draft`, 3fe9e2d |
| 2 | `rules/PROJECT.md`: Fix, Fixes and Handoff records, fix lanes, Startup | D1 | done | draft lane, c2eede1, c45c233, afc1b17 |
| 3 | Templates: `handoff.md`, `fix.md`, `release.md`, the index | D2 | done | draft lane, d2b270f, 99d2fac, c45c233, afc1b17 |
| 4 | Release skill: milestone and fix closes, Publish, Deploy | D3 | done | draft lane, 028673b, afc1b17 |
| 5 | Specs: `publish` and `kickoff --fix` in the three Foundry specs; `spec_kit.md`; the foundry skill | D4, D7, D9 | done | draft lane, 8cb05d8, 6f3d43a, 4f4a072, f47e8d3 |
| 6 | The Principal's go on the draft; the draft PR merged | — | done | #39, 43c0221 |
| 7 | Build `foundry publish` and its tests | D4 | done | `feature/milestone_v2026.11.11_handoff-fixes-publish/publish`, #40, 871add6 |
| 8 | Build `foundry kickoff --fix` and its tests | D9 | done | `feature/milestone_v2026.11.11_handoff-fixes-publish/kickoff-fix`, #41, 4a8331b |
| 9 | README: Foundry's `publish` and `kickoff --fix` | D7 | done | the lane of step 8 |
| 10 | Fix records for `v2026.10.18`, `v2026.10.23`, `v2026.10.24` | D5 | done | `feature/milestone_v2026.11.11_handoff-fixes-publish/fix-records`, #42 |
| 11 | Review; release; GitHub Releases for `v2026.10.23` and `v2026.10.24` by `publish --version` | D6 | pending | release lane |
| 12 | One-off adoption in every existing project that follows the convention: a fix off `dev` in each, templates copied, standing hotfix mentions retired | D8 | pending | `cutover.md` |

## Trail

- 2026-11-11 — plan laid down as building began: the convention, templates and release skill written on the draft lane on the Principal's word, ahead of the preview; the `publish` build waits for it.
- 2026-11-11 — step 11 added on the Principal's word: the template copy into every existing project is this milestone's one-off act; `rules/PROJECT.md` deploys as before.
- 2026-11-11 — preview answers (Principal): the handoff becomes one file of per-session entries, newest on top, the entry joining the working lane or the record's handoff lane off `dev`; a fix may ride the next release off `dev`, and every project's adoption does; `kickoff --fix` added as D9, step 8, the steps after it renumbered; projects outside the convention stay out.
