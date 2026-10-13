# Integration: {branch-slug} → dev

<!-- Filename: integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md — timestamp is the merge time, UTC, second precision. -->

- **Branch:** `{feature|fix}/{full-milestone-name}/{slug}`
- **PR:** {#}
- **Merge:** `{merge-commit-sha}`
- **CI:** green

{one line for a clean merge}

## Feature

<!-- The integrated feature, matching its row in the milestone's decomposition.md §Features. Leave empty for a fix integration. -->

- **Feature:** {feature title}
- **Delivers:** {one line — the capability this branch puts on `dev`}

## Fix

<!-- The integrated fix, matching its decomposition.md §Fixes row — or its origin when minted mid-milestone (a Review gap, an unblock, a boundary correction). Leave empty for a feature integration. -->

- **Fix:** {fix title}
- **Addresses:** {one line — the bug, defect, or enhancement and where it surfaced}

## Tasks

<!-- Every Task this integration lands: the branch's Execution Tasks and this Integration Stage Task itself, by decomposition key. -->

| Key | Task | Reference | State |
|---|---|---|---|
| {E#} | {title} | {where it lives on the execution surface} | {Completed \| Cancelled} |
| {I#} | {this Integration Stage Task} | {reference} | — |

## Conflicts

<!-- Only when the merge required judgment: what collided, whose intent each side carried, how it was resolved, and why. Delete this section for a clean merge — the record is lean by default, verbose on conflict. -->
