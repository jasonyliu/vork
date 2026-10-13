# Spec: Wakery Dynamic Task-Type Registry

## Introduction

This spec is the design blueprint for moving wakery's canonical task-type set out of a code-pinned constant into an operator-editable database table, and for making task-type drops observable.  The design source is `docs/research/research_20260607_wakery-routing-and-identity/research.md §2`.

## Purpose

Today the task-type set is the hardcoded `TASK_TYPE_LABELS` set in `apps/wakery/src/shared/types.ts`, which Stage 6 of the GitHub adapter validates each `type:*` label against. Adding a task type requires a code edit + redeploy, and the canonical list lives in two places (the code set and `constants.md`) that drift. On 2026-06-04 that drift dropped four transitions silently (`type:deliberation` was in GitHub + `constants.md` but not the code set), because the drop events are `info`-severity and unsurfaced.

This spec exists to make the task-type set **operator-editable at runtime** with a single source of truth, while keeping Stage-6 validation strict, and to make a stalled-by-drop dispatch **visible**.

## Scope

In scope — the design of:

- A **`task_type_label` DB table** as the runtime source of truth for the valid task-type set.
- **Stage-6 validation** sourcing its set from the table instead of the code constant.
- A **management surface** for adding/retiring task types (v1: script / row insert; no UI).
- **Drop observability** for the task-type drop events.
- The **demotion of `constants.md §Task types`** to a human-readable reflection of the table.

Out of scope: the routing model and identity reconciliation (WS-A); the GitHub-Milestone grouping convention (WS-C); the least-privilege DB role (WS-D, though the migration rides this work); any change to the `type:*`-exactly-one labelling rule itself.

## Requirements

### R1 — `task_type_label` table is the runtime authority

A `task_type_label` table holds the valid task-type set (at minimum: the `type:` value, a human label/purpose, and active/retired state). Wakery reads it to build the valid set used by Stage-6 validation. The table — not `TASK_TYPE_LABELS` in code, not `constants.md` — is the runtime source of truth. The code constant is removed or reduced to a migration seed for the table's initial rows (the current set: the six `project_*` Stage types, plus `spec`/`research`/`deliberation`/`coding`/`bug`/`enhancement`).

### R2 — Stage 6 validates against the table, strictly

Stage 6 of the GitHub adapter validates each issue's `type:*` label against the set loaded from `task_type_label`. Validation stays **strict**: an unknown type still drops (`1011`), an ambiguous/multiple-type issue still drops (`1012`), a non-task issue still drops (`1010`). The only change is the *source* of the valid set. The set is loaded such that a newly inserted row takes effect **without a wakery redeploy** (load per-evaluation or via a cache with a bounded refresh; the design must state which).

### R3 — Management surface (v1)

Adding or retiring a task type is an operator action against the table: a script (e.g. `apps/wakery/src/scripts/add-task-type.ts`) or a direct row insert. No management UI in v1. Adding `type:defect` (#27) and confirming `type:deliberation` are the first inserts and serve as the validation cases.

### R4 — Drop observability

The task-type drop events (`1010`/`1011`/`1012`, currently all `severity: 'info'` in `apps/wakery/src/events/codes.ts`) must become **noticeable**. The design raises the severity of the task-type drops and/or adds a surfacing path (alert/log channel) so a dispatch stalled by a drop produces a visible signal rather than silence. This is defense-in-depth: the registry makes drift-drops rare, observability makes the remaining ones loud.

### R5 — `constants.md` demoted to reflection

`docs/conventions/constants.md §Task types` stops being a parallel authority and becomes a human-readable reflection of `task_type_label`: it documents the convention and how to add a type (via the management surface), and notes that the DB table is authoritative. This removes the two-places-to-edit trap that caused the incident.

## Constraints

- **Single source of truth.** The redesign must not recreate the drift it fixes — exactly one runtime authority (the table); every other mention (code, `constants.md`) is seed or reflection.
- **Strict validation preserved.** The change is the *source* of the valid set, not its strictness; all three drop outcomes remain.
- **No redeploy to add a type.** A row insert must take effect for subsequent Stage-6 evaluations without restarting wakery.
- **Migration rides WS-D's DB role work.** The `task_type_label` migration and the least-privilege `vork_app` role (#35) are coordinated so the app role has exactly the privileges the new table needs.

## Deliverables

This spec governs the WS-B Execution outputs, derived into Tasks by Decomposition:

1. `task_type_label` table + migration (seeded with the current task-type set).
2. Stage-6 validation reads the table (replacing/relegating `TASK_TYPE_LABELS`), with the no-redeploy load behavior.
3. Management script (`add-task-type.ts`) or documented row-insert procedure.
4. Drop-event observability change (severity and/or surfacing) for `1010`/`1011`/`1012`, reconciled with `specs/data/spec_event.md`.
5. `constants.md §Task types` demoted to a reflection of the table.
6. First registry inserts: `type:defect` (#27) and `type:deliberation`.

## Verification

- A task type added via the management surface (no wakery redeploy) passes Stage-6 validation and its issue dispatches.
- An unknown `type:*` still drops with `1011` **and** produces a visible signal (not silent `info`).
- A non-task issue drops `1010`; a multi-`type:*` issue drops `1012` — unchanged.
- The initial table seed matches the prior `TASK_TYPE_LABELS` set plus `deliberation`; `constants.md` lists the same set and names the table as authoritative.
- `type:defect` (#27) is present in the table and validates.

## References

- `docs/research/research_20260607_wakery-routing-and-identity/research.md §2` — the incident and the design source.
- `apps/wakery/src/shared/types.ts` (`TASK_TYPE_LABELS`), `apps/wakery/src/adapters/github/adapter.ts` (Stage 6), `apps/wakery/src/events/codes.ts` (`1010`/`1011`/`1012` severities) — the current implementation this spec changes.
- `specs/apps/wakery/spec_wakery-github-adapter.md` (Stage 6), `specs/data/spec_event.md` (drop-event definitions), `specs/data/spec_database.md` (data-entity contracts).
- `docs/conventions/constants.md §Task types`; issues #54, #27.
