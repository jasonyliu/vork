---
name: release
description: Close a milestone or a fix with a release — records, close-out, publishing merge, tag and GitHub Release, sweep, deployments. Use when the Principal's review calls a milestone complete and deployable, or when a fix's change is ready to ship.
---

# Release — close a milestone or a fix

Project-agnostic: this is the convention's closing procedure (`rules/PROJECT.md §Records — Releases`, `§Branches`). A milestone closes by §Milestone, a fix by §Fix; both end with §Publish and §Deploy.

## Milestone

Precondition: the Principal's review has called the milestone complete and deployable, and every lane in its integration set is merged to `dev`.

1. **Version** — `v<YYYY.MM.DD>` (today UTC); append `.r2`, `.r3` … when the day already shipped.
2. **Release lane** — `feature/<milestone-folder>/release` off current `dev`.
3. **Release record** — `docs/releases/release_v<version>/release.md` from the template: the heading's title naming what shipped, the Record line naming the milestone folder, two lists only, **Features** and **Fixes**.
4. **Close-out, same lane** — the charter: milestone row Active → Past with a short shipped-summary, Path and Products refreshed to what the project now is; `milestone.md` status → `Completed (<date>)` naming the release; the decomposition's Current rewritten to its final state; `docs/backlog.md`: every item the milestone took in leaves **Items** — shipped → a **Done** row naming the release, dropped along the way → a **Skipped** line with the reason; `handoff.md`: the Brief rewritten to its final state and this session's Trail row appended.
5. **Release PR** — lane → `dev`; the Principal approves; merge.
6. **Publishing PR** — `dev → main`; CI green on the merge result; the Principal approves; merge.
7. **Publish** — §Publish.
8. **Sweep** — delete every working branch fully merged into `dev`; surface any lane holding unmerged work and leave it standing. Only `dev` and `main` persist beyond a close.
9. **Deploy** — §Deploy.

## Fix

Precondition: the fix's change is complete on `fix/<fix-folder>/<slug>` off `main`, its `fix.md` carrying Problem, Change and Verification.

1. **Version** — as §Milestone step 1.
2. **Release record, same lane** — as §Milestone step 3, the Record line naming the fix folder; `fix.md` status → `Completed (<date>)` naming the release; the charter's Path and Products refreshed where the fix changed them; the backlog item the fix answers → a **Done** row naming the release.
3. **Publishing PR** — the fix lane → `main`, its body closing the issue the fix answers (`Closes #<n>`); CI green; the Principal approves; merge. This merge is the publishing merge.
4. **Publish** — §Publish.
5. **Sync** — `fix/<fix-folder>/sync` off `dev`; merge `main` into it; resolve the conflicts and judge what `dev`'s newer work keeps, adapts or supersedes from the fix; on this lane write `fix.md`'s Sync section and this session's handoff wrap-up; pull request → `dev` on green CI; the Principal approves; merge. `git branch -r --contains v<version>` then lists `origin/main` and `origin/dev`.
6. **Sweep** — delete the fix's own lanes, `fix/<fix-folder>/*`, on the remote and in the clone.
7. **Deploy** — §Deploy.

## Publish

The Principal's approval of the publishing PR covers this act, the GitHub Release included.

1. `foundry publish --project <key> --dry-run` from the Vork clone (Vork's `specs/spec_foundry.md §Publish`): prints the version, the commit to tag, the Release's name, and whether it becomes Latest. A refusal (exit 6) names its cause; resolve it and re-run.
2. The same without `--dry-run`: tags the publishing merge `v<version>`, pushes the tag, and creates the GitHub Release from `release.md`. A re-run converges.

Where Foundry is not installed, the same three acts by hand, `<name>` being `release.md`'s heading with `# Release ` dropped: `git tag -a v<version> <publishing-merge> -m "<name>"`; `git push origin v<version>`; `gh release create v<version> --verify-tag --latest --title "<name>" --notes-file <release.md below its heading>`.

## Deploy

1. **Deployment preview** — list, per environment the project's manuals define, every act they call for at this release (any one-time migration a manual flags included), with what each act touches on a live machine; **stop and wait for the Principal's confirmation** of the list.
2. **Deployments** — on the confirmed list, perform each Deployment exactly per its manual, in the order the manuals state; a record per invocation; anything the manuals did not foresee stops and returns to the Principal.
