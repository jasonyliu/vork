# Vork Constants

Canonical named values used across the Vork system. This file is the authoritative source for label names and related cross-cutting named constants. **For the runtime task-type set, the authority is the `task_type_label` DB table** (see §Task types); this file reflects it. Implementations and specs consume from here.

This file does not duplicate values that other policy documents own. Lifecycle and Audit state enums live in `docs/policy/TASK.md`. Risk codes live in `docs/policy/SECURITY.md`. Wakery event names live in `specs/apps/wakery/spec_wakery-events.md`.

## Task types

The `type:<value>` label on a GitHub Issue is the canonical Task type signal per `docs/policy/TASK.md §GitHub.Mapping`. Foundry creates a label for every value below on each repo it bootstraps.

**Runtime authority: the `task_type_label` DB table.** Wakery's Stage-6 validation reads the valid task-type set from the `task_type_label` table (per `specs/apps/wakery/spec_wakery-task-type-registry.md`), not from this file or from code. The two tables below are a **human-readable reflection** of that registry — they document the convention and what each type means; the table is the source of truth. **To add a task type, add it to the canonical seed `apps/data/src/seed.ts` (`TASK_TYPE_LABEL_SEED`)**, upsert it live via `apps/wakery/src/scripts/add-task-type.ts`, create the matching `type:<value>` GitHub label, and update this reflection. Do not add a type by editing this file or code alone — that recreates the two-places-to-edit drift that once silently dropped four transitions.

> **Four-surface sync:** the canonical task-type set must stay consistent across **four** surfaces — `seed.ts` (`TASK_TYPE_LABEL_SEED`), the live `task_type_label` table, the GitHub `type:*` labels, and this reflection.

### Stage Task types

Defined by `docs/policy/DELIVERY.md §Stages`. Stage Tasks coordinate the per-Stage work of a Milestone; `project_deployment`, `project_operation`, and `project_hotfix` are conducted beyond the milestone loop (`DELIVERY.md §Stages`).

| Value | Label | Purpose |
|---|---|---|
| `project_inception` | `type:project_inception` | Inception Stage Task |
| `project_draft` | `type:project_draft` | Draft Stage Task |
| `project_decomposition` | `type:project_decomposition` | Decomposition Stage Task |
| `project_integration` | `type:project_integration` | Integration Stage Task |
| `project_review` | `type:project_review` | Review Stage Task |
| `project_release` | `type:project_release` | Release Stage Task |
| `project_deployment` | `type:project_deployment` | Deployment Stage Task (`DELIVERY.md §Deployment`) |
| `project_operation` | `type:project_operation` | Operation Stage Task |
| `project_hotfix` | `type:project_hotfix` | Hotfix Stage Task (`DELIVERY.md §Hotfix`) |

> **`project_hotfix` and `project_deployment` — known gap:** this reflection and the GitHub labels are in place; the `TASK_TYPE_LABEL_SEED` entries and the live `task_type_label` rows were never added. Wakery's Stage-6 validation does not accept either type until they are seeded.

### Execution Task types

| Value | Label | Purpose |
|---|---|---|
| `spec` | `type:spec` | Produces a spec |
| `research` | `type:research` | Produces a research record |
| `deliberation` | `type:deliberation` | Documentation or policy writing with governing effect, per `docs/policy/FRAMEWORK.md §Amendment` |
| `coding` | `type:coding` | Produces implementation work (Visor's domain) |
| `bug` | `type:bug` | Bug |
| `enhancement` | `type:enhancement` | Enhancement |
| `dbops` | `type:dbops` | Live-database operation (data/role reconciliation), not a repo commit |
| `defect` | `type:defect` | A defect — wrong/inconsistent but not a feature; small fix to circle back to |

## Task relation labels

Mark a Task's structural relation to other Tasks per `docs/policy/TASK.md §Parent Task` and `§Dependency Tasks`. Foundry creates these labels on each repo it bootstraps.

| Label | Marks |
|---|---|
| `task:parent` | Task is a Parent of one or more Child Tasks |
| `task:child` | Task is a Child of a Parent Task |
| `task:blocking` | Task is Blocking one or more dependent Tasks |
| `task:blocked` | Task is Blocked-by one or more blocker Tasks |

## Routing-hint labels

Optional informational labels naming the routing lane a Task is in per the wakery eligibility matrix. Foundry creates these labels on each repo it bootstraps.

| Label | Lane |
|---|---|
| `agent:assignee` | Assignee lane |
| `agent:owner` | Owner lane |
| `agent:auditor` | Auditor (Heimdall) lane |

## Risk labels

The `risk:<code>` label carries a Task's effective Preview Risk Code forward to Review per `docs/policy/SECURITY.md` and `docs/policy/TASK.md §GitHub.Mapping` — set by the Auditor at Preview, overwritten with the most recent verdict, read by Review for Depth. Codes are defined in `docs/policy/SECURITY.md §Risk Codes`. Foundry creates the label set on each repo it bootstraps.

## Git branch names

Defined by `docs/policy/PROJECT.md §Branching` (slash naming: the `<full-milestone-name>` segment is the machine key; branch-protection and CI globs must use `**`).

| Pattern | Role |
|---|---|
| `main` | Release-truth standing branch |
| `dev` | Standing integration branch |
| `feature/<full-milestone-name>/<slug>` | Feature lane off `dev` |
| `fix/<full-milestone-name>/<slug>` | Milestone-scoped corrective lane off `dev` |
| `hotfix/<slug>` | Live-production fix off `main` |

## Integration artifact names

Defined by `docs/policy/PROJECT.md §Integration`/`§Releases`.

| Pattern | Record |
|---|---|
| `integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md` | milestone-branch → `dev` integration, in the milestone folder |
| `integration.md` | `dev -> main` integration, in the release folder |
