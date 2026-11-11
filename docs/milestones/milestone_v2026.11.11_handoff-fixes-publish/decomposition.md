# Decomposition — Handoff, fixes, and foundry publish (`milestone_v2026.11.11_handoff-fixes-publish`)

## Current

The convention, the templates, the release skill and the `publish` spec are written on the draft lane. Next: the Principal's preview of the draft (#39), then the build of `foundry publish`.

## Plan

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Research record | — | done | `feature/milestone_v2026.11.11_handoff-fixes-publish/draft`, 3fe9e2d |
| 2 | `rules/PROJECT.md`: Fix, Fixes and Handoff records, fix lanes, Startup | D1 | done | draft lane, c2eede1 |
| 3 | Templates: `handoff.md`, `fix.md`, `release.md`, the index | D2 | done | draft lane, d2b270f, 99d2fac |
| 4 | Release skill: milestone and fix closes, Publish, Deploy | D3 | done | draft lane, 028673b |
| 5 | `publish` spec in the three Foundry specs; `spec_kit.md` | D4, D7 | done | draft lane, 8cb05d8, 6f3d43a, 4f4a072 |
| 6 | The Principal's preview of the draft; the draft PR merged | — | in progress | draft lane, #39 |
| 7 | Build `foundry publish` and its tests | D4 | pending | `feature/milestone_v2026.11.11_handoff-fixes-publish/publish` |
| 8 | README: Foundry's `publish` | D7 | pending | publish lane |
| 9 | Fix records for `v2026.10.18`, `v2026.10.23`, `v2026.10.24` | D5 | pending | `feature/milestone_v2026.11.11_handoff-fixes-publish/fix-records` |
| 10 | Review; release; GitHub Releases for `v2026.10.23` and `v2026.10.24` by `publish --version` | D6 | pending | release lane |

## Trail

- 2026-11-11 — plan laid down as building began: the convention, templates and release skill written on the draft lane on the Principal's word, ahead of the preview; the `publish` build waits for it.
