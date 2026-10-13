# Decomposition — Conduction framework — the first release (`milestone_v2026.10.10_conduction-framework`)

## Current

Batches 1 to 4 are merged; batch 5 is on its lane. Next: batch 6, `specs/apps/foundry/`.

## Plan

Each batch is one lane and one pull request into `dev`. A batch is reviewed first where it is edited, by the Principal in person and by a second AI session; only when both are green is it copied verbatim onto its lane and pushed. Before every push: the copy matches the reviewed files byte for byte, the secret scanner is clean on the tree, the search for every retired term returns zero hits, and no `<...>` token remains in any `.ts` file.

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Batch 1 — `docs/policy/` (6 files) | D1, D2 | done | `…/batch-01-policy`, PR #2 |
| 2 | Batch 2 — `docs/conventions/` (11); the framework's nine templates replace the scaffold's | D1, D2 | done | `…/batch-02-conventions`, PR #3 |
| 3 | Batch 3 — `provisions/` (13); the original instance's cutover runbook not carried | D1, D2 | done | `…/batch-03-provisions`, PR #4 |
| 4 | Batch 4 — `specs/data/` + root specs (5) | D1, D2 | done | `…/batch-04-specs-data`, PR #5 |
| 5 | Batch 5 — `specs/apps/resolver/` (6) | D1, D2 | done | `…/batch-05-specs-resolver`, PR #6 |
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
- 2026-10-13 — Review moved to the editing tree: a batch is read and judged there, then copied verbatim onto its lane. Batch 2 lands with the framework's own record templates in place of the scaffold's; the current set returns with the next milestone.
- 2026-10-13 — Batch 3 lands without the original instance's database cutover runbook: a dated record of one migration, not a procedure; the mechanism ships in the database spec and the cutover CLI.
- 2026-10-13 — Batch 4: the specs keep their citations of the original project's tracker and records; the release note will say once that those do not resolve here.
