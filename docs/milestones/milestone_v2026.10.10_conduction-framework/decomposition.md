# Decomposition — Conduction framework — the first release (`milestone_v2026.10.10_conduction-framework`)

## Current

Batches 1 to 10 are merged; batch 11, the last code batch, is on its lane (PR #12). Next: step 12, the authored material — README, LICENSE, contribution stance.

## Plan

Each batch is one lane and one pull request into `dev`. A batch is reviewed first where it is edited, by the Principal in person and by a second AI session; only when both are green is it copied verbatim onto its lane and pushed. Before every push: the copy matches the reviewed files byte for byte, the secret scanner is clean on the tree, the search for every retired term returns zero hits, and no `<...>` token remains in any `.ts` file.

| # | Step | Deliverable | Status | Pointers |
|---|---|---|---|---|
| 1 | Batch 1 — `docs/policy/` (6 files) | D1, D2 | done | `…/batch-01-policy`, PR #2 |
| 2 | Batch 2 — `docs/conventions/` (11); the framework's nine templates replace the scaffold's | D1, D2 | done | `…/batch-02-conventions`, PR #3 |
| 3 | Batch 3 — `provisions/` (13); the original instance's cutover runbook not carried | D1, D2 | done | `…/batch-03-provisions`, PR #4 |
| 4 | Batch 4 — `specs/data/` + root specs (5) | D1, D2 | done | `…/batch-04-specs-data`, PR #5 |
| 5 | Batch 5 — `specs/apps/resolver/` (6) | D1, D2 | done | `…/batch-05-specs-resolver`, PR #6 |
| 6 | Batch 6 — `specs/apps/foundry/` (4) | D1, D2 | done | `…/batch-06-specs-foundry`, PR #7 |
| 7 | Batch 7 — `specs/apps/wakery/` (26) | D1, D2 | done | `…/batch-07-specs-wakery`, PR #8 |
| 8 | Batch 8 — `apps/data/` (24); seeded registry rows become operator inputs | D1, D2 | done | `…/batch-08-apps-data`, PR #9 |
| 9 | Batch 9 — `apps/resolver/` (24) | D1, D2 | done | `…/batch-09-apps-resolver`, PR #10 |
| 10 | Batch 10 — `apps/foundry/` (65); placeholder defaults become required inputs | D1, D2 | done | `…/batch-10-apps-foundry`, PR #11 |
| 11 | Batch 11 — `apps/wakery/` (116); generic plist and installer in place of the originals | D1, D2, D3 | done | `…/batch-11-apps-wakery`, PR #12 |
| 12 | Authored material — README, LICENSE, contribution stance | D3 | pending | |
| 13 | Release note for an AI agent, written last | D4 | pending | |
| 14 | Review, release record, `dev → main`, tag | D5 | pending | |

## Trail

- 2026-10-10 — Plan laid down: eleven review batches shallow to deep, then the authored material, then the agent release note, then the release.
- 2026-10-13 — Review moved to the editing tree: a batch is read and judged there, then copied verbatim onto its lane. Batch 2 lands with the framework's own record templates in place of the scaffold's; the current set returns with the next milestone.
- 2026-10-13 — Batch 3 lands without the original instance's database cutover runbook: a dated record of one migration, not a procedure; the mechanism ships in the database spec and the cutover CLI.
- 2026-10-13 — Batch 4: the specs keep their citations of the original project's tracker and records; the release note will say once that those do not resolve here.
- 2026-10-13 — Batch 7 keeps the Principal's original review note on the first Wakery draft as technical history. Hardware is estate detail: no file describes the machines the framework ran on.
- 2026-10-13 — Batch 8 sets the code stance in practice: a value the original instance seeded (its accounts, its repo mapping, its retired board) is an empty array marked as environment input, never a placeholder; the suite is kept green on the generalised seed.
- 2026-10-13 — Batch 10: Foundry's two estate defaults (keystore token directory, project storage path) become required inputs. Foundry's standing-fixture test assumes a Foundry-founded tree; the published tree is an extraction, so that one test skips itself when the skeleton is absent.
- 2026-10-13 — Batch 11: Wakery's project storage path becomes a required input, as Foundry's did. The one-off bootstrap and smoke scripts stop carrying the original instance's project key, GitHub ids and issue numbers and take them as arguments. The launchd plist ships as a template with two path tokens; the installer renders it and runs no migration, which stays the owner role's separate act.
