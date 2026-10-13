# Decomposition: {milestone folder slug}

<!-- The Decomposition Stage Task authors this record as the task set's design; Sarge creates the Tasks from it on the Decomposition → Execution chain and records where the created Tasks live in the execution system (DELIVERY.md §Decomposition, PROJECT.md §Records). -->

## Approach

{the rationale of the split: how the milestone divides into its features and fixes, the structural decisions that shaped the division, and how each Task satisfies The One Rule — where the Anti-rule subdivided and why (`TASK.md §Granularity`). This is the thinking behind the split, kept for later optimization.}

## Features

<!-- The milestone's feature lanes: each feature, its branch, and the Tasks that build and land it, by key. -->

| Feature | Description | Branch | Tasks |
|---|---|---|---|
| {feature title} | {what this feature is about} | `feature/{full-milestone-name}/{slug}` | {E1, E2, I1} |

## Fixes

<!-- The milestone's fix work — the bugs, defects, and enhancements carried from Draft. Features and Fixes together form the integration set §Chaining reads. -->

| Fix | Description | Branch | Tasks |
|---|---|---|---|
| {fix title} | {what this fix addresses} | `fix/{full-milestone-name}/{slug}` | {E5, I3} |

## Dependencies

<!-- The overall execution sequence. Each relation is also detailed on its Task entry below for creation. -->

```text
{dependency graph: blockers → dependents, parallel lanes, the critical path}
```

## Tasks

<!-- One entry per Task to create — Execution Tasks and Integration Stage Tasks alike; the keys are what the tables and the graph reference.

Key convention — a CLOSED set; a decomposition introduces no other prefixes:
  E#    Execution Task — feature or fix work on its milestone branch (the Branch field tells which lane)
  E#.n  Child Task of Parent E# (TASK.md §Parent Task) — the Parent keeps the plain E#
  I#    Integration Stage Task — exactly one per Features/Fixes row
  OP#   Operational Task — live-system or platform-surface state; no branch

Keys are append-only: mid-milestone additions (boundary-control fixes, Review gaps) continue the numbering; keys are never renumbered or reused, so any key cited anywhere stays resolvable for the life of the milestone.

Each entry carries the Task core per TASK.md, one field per bullet — enough for Sarge to create the Task on any implementation surface. -->

### {key} — {title}

- **Type:** {a registered `type:<value>` from `docs/conventions/constants.md`}
- **Assignee:** {assignee}
- **Branch:** {branch}
- **Relations:** {Parent of / Child of / Blocked-by / Blocking, by key — or none}
- **Objective:** {the intended outcome the Task exists to achieve}
- **Scope:** {the work included within the Task boundary — files, surfaces, systems}
- **Constraints:** {the limits or conditions that shape execution — omit when none}
- **Primary Specification:** {the controlling spec or instruction source}
- **Deliverable:** {the concrete outcome expected from completion}
- **References:** {supporting materials required to understand or execute — omit when none}
- **Verification:** {the primary approach used to judge the deliverable}
- **Contingency:** {the planned response if the outcome must be reversed, corrected, or contained — omit when none}
