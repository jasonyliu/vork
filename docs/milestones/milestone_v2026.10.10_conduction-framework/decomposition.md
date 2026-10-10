# Decomposition — Conduction framework — the first release (`milestone_v2026.10.10_conduction-framework`)

## Current

Batch 1 (`docs/policy/`) passed review 2026-10-10 and is on its lane awaiting merge. Next: batch 2, `docs/conventions/`.

## Plan

Each batch is one lane and one pull request into `dev`. A batch lands on the lane as a local commit first; it is pushed only after the Principal's own review and a second AI session's review are both green. Before every push: the secret scanner is clean on the tree, the search for every retired term returns zero hits, and no `<...>` token remains in any `.ts` file.

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Batch 1 — `docs/policy/` (6 files) | D1, D2 | done | `…/batch-01-policy`, PR #2 |
| 2 | Batch 2 — `docs/conventions/` (11) | D1, D2 | pending | |
| 3 | Batch 3 — `provisions/` (14) | D1, D2 | pending | |
| 4 | Batch 4 — `specs/data/` + root specs (5) | D1, D2 | pending | |
| 5 | Batch 5 — `specs/apps/resolver/` (6) | D1, D2 | pending | |
| 6 | Batch 6 — `specs/apps/foundry/` (4) | D1, D2 | pending | |
| 7 | Batch 7 — `specs/apps/wakery/` (26) | D1, D2 | pending | |
| 8 | Batch 8 — `apps/data/` (24) | D1, D2 | pending | |
| 9 | Batch 9 — `apps/resolver/` (24) | D1, D2 | pending | |
| 10 | Batch 10 — `apps/foundry/` (65); placeholder defaults become required inputs | D1, D2 | pending | |
| 11 | Batch 11 — `apps/wakery/` (116); generic plist and installer in place of the originals | D1, D2, D3 | pending | |
| 12 | Authored material — README, LICENSE, contribution stance | D3 | pending | |
| 13 | Release note for an AI agent, written last | D4 | pending | |
| 14 | Review, release record, `dev → main`, tag | D5 | pending | |

## Trail

- 2026-10-10 — Plan laid down: eleven review batches shallow to deep, then the authored material, then the agent release note, then the release.
