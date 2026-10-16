---
name: release
description: Close a milestone with a release — records, charter close-out, publishing merge, tag, lane sweep, deployments. Use when the Principal's review calls the milestone complete.
---

# Release — close a milestone

Project-agnostic: this is the convention's closing procedure (`rules/PROJECT.md §Records — Releases`, `§Branches`). Precondition: the Principal's review has called the milestone complete and deployable, and every lane in its integration set is merged to `dev`.

1. **Version** — `v<YYYY.MM.DD>` (today UTC); append `.r2`, `.r3` … when the day already shipped.
2. **Release lane** — `feature/<milestone-folder>/release` off current `dev`.
3. **Release record** — `docs/releases/release_v<version>/release.md` from the template: two lists only, **Features** and **Fixes**.
4. **Close-out, same lane** — the charter: milestone row Active → Past with a short shipped-summary, Path and Products refreshed to what the project now is; `milestone.md` status → `Completed (<date>)` naming the release; the decomposition's Current rewritten to its final state; `docs/backlog.md`: every item the milestone took in leaves **Items** — shipped → a **Done** row naming the release, dropped along the way → a **Skipped** line with the reason.
5. **Release PR** — lane → `dev`; the Principal approves; merge.
6. **Publishing PR** — `dev → main`; CI green on the merge result; the Principal approves; merge.
7. **Tag** — annotated `v<version>` on the publishing merge commit; push the tag. The tag is the release's canonical pointer.
8. **Sweep** — delete every working branch fully merged into `dev`; surface any lane holding unmerged work and leave it standing. Only `dev` and `main` persist beyond a close.
9. **Deployment preview** — list, per environment the project's manuals define, every act they call for at this release (any one-time migration a manual flags included), with what each act touches on a live machine; **stop and wait for the Principal's confirmation** of the list.
10. **Deployments** — on the confirmed list, perform each Deployment exactly per its manual, in the order the manuals state; a record per invocation; anything the manuals did not foresee stops and returns to the Principal.

A hotfix follows its own compressed form (`rules/PROJECT.md §Branches`); this skill is for the milestone loop's close.
