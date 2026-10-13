# Wakery Task Relations and Dispatch Gates

## Introduction

This spec defines the `wake.task_relations` JSON column — a structured capture of each Task's relationship to other Tasks (parent reference, children completion summary, blocked-by dependency summary, blocking dependency summary) — and the two dispatch-time gates that use it: the **Parent gate** and the **Blocked gate**.

Together these implement the routing-side enforcement of `docs/policy/TASK.md §Parent Task → Completion gate` and `§Dependency Tasks → Resolution gate` without putting the router in the business of audit, transition validation, or any other policy enforcement.

This augments the dispatch sweep behavior defined in `spec_wakery-dispatch-worker.md` and adds new ingress-side responsibilities in `spec_wakery-ingress-api.md` and `spec_wakery-github-adapter.md`.

## Purpose

Two related concerns are addressed by a single column:

1. **Visibility.** Capture each Task's relation structure on its wake row so any downstream consumer — dispatch worker, future Wake Radar, audit support tooling — can see the full picture without re-querying upstream.
2. **Gating.** Two independent gates apply at dispatch time:
   - **Parent gate:** A Parent Task (label `task:parent`) must not have its audit, execution, or downstream dispatch proceed until every Child Task has reached canonical Lifecycle = `Completed` or `Cancelled` (per `docs/policy/TASK.md §Parent Task → Completion gate`).
   - **Blocked gate:** A Blocked Task (label `task:blocked`) must not have its **pre-execution audit dispatch** (`Todo:Gated`) proceed until every Blocked-by Task has reached canonical Lifecycle = `Completed` or `Cancelled` (per `docs/policy/TASK.md §Dependency Tasks → Resolution gate` / `SECURITY.md §R995`). Owner-lane wakes on a Blocked Task flow — the gate holds the audit, not the Owner's ability to act.
   Both conditions can apply to the same Task; both must clear before dispatch.

TASK.md is the policy source of truth. This spec defines only the data capture and the routing-side dispatch suppression that implements the two gates.

## Scope

Covers:
- the `wake.task_relations` JSON column structure (parent / children / blocked_by / blocking entries)
- ingress-time population (GraphQL lookup for `parent` + `subIssuesSummary` + `issueDependenciesSummary` on every wake)
- webhook-driven refresh of `task_relations` on attach/detach/close/reopen events for both Parent/Child and Blocked-by/Blocking relations
- the dispatch filter applied to wakes labeled `task:parent` whose Children are not all terminal (Parent gate)
- the dispatch filter applied to wakes labeled `task:blocked` whose Blocked-by Tasks are not all terminal (Blocked gate)
- default behavior for label-only Parents/Blocked Tasks with no Children/Blockers yet declared

Does not cover:
- the Parent/Child or Blocked-by/Blocking semantic models (defined in `docs/policy/TASK.md §Parent Task` and `§Dependency Tasks`)
- audit decisions on Parent or Blocked Tasks (Heimdall audits the Task body normally per `docs/policy/SECURITY.md`)
- enforcement of creation/transition ordering protocols (Owner discipline; router does not police)
- enforcement of structure freeze / dependency freeze after `Todo+Gated` (Owner discipline)

## Rule

### Schema

The `wake.task_relations` column is defined canonically in `specs/data/spec_database.md §wake`. Summary:

- Type: `JSONB`, nullable.
- `NULL` for Tasks with no relations at intake (no parent, no children, no blocked-by, no blocking).
- Otherwise an object containing one or more of:
  - `parent` — `{ "task_id": "<upstream parent task id>" }` reflecting the upstream Task this one is a Child of. Present whenever the Task is labeled `task:child` at intake AND an upstream parent is attached. Informational only — Child wakes are not gated on parent state.
  - `children` — `{ "total": <int>, "completed": <int> }` reflecting the Task's Child completion summary from upstream. Present whenever the Task is labeled `task:parent` at intake, even if `total == 0` (the empty-children object is the signal for the label-only-no-children case). Drives the Parent gate.
  - `blocked_by` — `{ "total": <int>, "completed": <int> }` reflecting the Task's Blocked-by dependency completion summary from upstream. Present whenever the Task is labeled `task:blocked` at intake, even if `total == 0` (the empty-blocked_by object is the signal for the label-only-no-blockers case). Drives the Blocked gate.
  - `blocking` — `{ "total": <int>, "completed": <int> }` reflecting the Task's Blocking dependency completion summary from upstream. Present whenever the Task is labeled `task:blocking` at intake, even if `total == 0`. Informational only — `task:blocking` does not gate dispatch (the gate fires on the dependent side, not the blocker side).

Each entry's presence is driven by its corresponding label: `task:child` → `parent`, `task:parent` → `children`, `task:blocked` → `blocked_by`, `task:blocking` → `blocking`. Labels are the canonical identification signal across implementation surfaces. A Task carrying an upstream relation but no matching label is in a policy-invalid state — the router does not interpret it, and the corresponding entry is omitted. The two summary entries that drive a gate (`children`, `blocked_by`) carry an empty `{total: 0, completed: 0}` placeholder when the label is present but no relations are attached yet, so the gate can suspend on the label alone. The two informational entries (`parent`, `blocking`) omit the entry entirely when no upstream data exists, since there is no gate to feed.

Example shapes:

| Case | `task_labels` (relevant subset) | `task_relations` |
|---|---|---|
| Pure leaf | `[]` | `NULL` |
| Parent with 5 children, 2 completed | `["task:parent"]` | `{"children":{"total":5,"completed":2}}` |
| Child of issue #42 | `["task:child"]` | `{"parent":{"task_id":"42"}}` |
| Parent labeled, no children attached yet | `["task:parent"]` | `{"children":{"total":0,"completed":0}}` (gate suspends via the label-aware check) |
| Blocked by 3 tasks, 1 completed | `["task:blocked"]` | `{"blocked_by":{"total":3,"completed":1}}` |
| Blocking 2 tasks, neither done | `["task:blocking"]` | `{"blocking":{"total":2,"completed":0}}` |
| Blocked labeled, no blockers declared yet | `["task:blocked"]` | `{"blocked_by":{"total":0,"completed":0}}` (gate suspends via the label-aware check) |
| Both Parent and Blocked | `["task:parent","task:blocked"]` | `{"children":{"total":5,"completed":3},"blocked_by":{"total":2,"completed":2}}` (Parent gate still suspends; Blocked gate cleared) |
| Child and Blocking simultaneously | `["task:child","task:blocking"]` | `{"parent":{"task_id":"42"},"blocking":{"total":1,"completed":0}}` |

Per `docs/policy/TASK.md §Relations`, Parent/Child structure is exactly one level deep. A `task_relations` row carrying both `parent` and `children` entries is a policy-invalid state (it implies a nested Parent that is also a Child); the router will still populate it from upstream data if it appears, but the data should not occur in a well-formed Vork project. Dependency relations (blocked_by / blocking) have no depth restriction beyond §Relations' cycle prohibition, and may freely combine with Parent/Child relations on the same Task.

A single forward migration adds the column. No backfill: existing wake rows remain `NULL`.

### Ingress: population at wake create

The GitHub adapter (per `spec_wakery-github-adapter.md`) extends its existing issue GraphQL query with `parent { number }`, `subIssuesSummary { total completed }`, and `issueDependenciesSummary { blockedBy blocking totalBlockedBy totalBlocking }`. The query runs unconditionally for every wake — every relation present on the issue is captured regardless of the Task's role.

`IssueDependenciesSummary` returns four integer counts (not issue IDs). The semantics from the live GitHub schema:
- `totalBlockedBy` — total count of all Blocked-by relations (open + closed)
- `blockedBy` — count of *open* Blocked-by relations (the remaining unresolved subset)
- `totalBlocking` / `blocking` — same pair on the Blocking side

The wakery derives the `{total, completed}` shape as: `total = totalBlockedBy`, `completed = totalBlockedBy - blockedBy`. Same derivation for `blocking`. "Closed" is GitHub-side state — both `state_reason=COMPLETED` and `state_reason=NOT_PLANNED` (≈ Cancelled) count toward the closed subset, which aligns with our policy that Cancelled blockers count as terminal.

Population logic — each entry is gated on its corresponding label:

1. Build the `task_relations` object.
2. If the Task carries the `task:child` label at intake (i.e. `wake.task_labels ? 'task:child'` is true) AND the GraphQL `parent` field is non-null, include `parent: { task_id: <parent number as string> }`. If the label is present but the GraphQL parent is null, omit the entry entirely (no gate-driven placeholder needed — `parent` is informational).
3. If the Task carries the `task:parent` label at intake (i.e. `wake.task_labels ? 'task:parent'` is true), include `children: { total: <subIssuesSummary.total>, completed: <subIssuesSummary.completed> }`. The `children` entry is included even if `total == 0` — the empty-children object is the signal for the label-only case, and the gate uses it together with the label.
4. If the Task carries the `task:blocked` label at intake, include `blocked_by: { total: <totalBlockedBy>, completed: <totalBlockedBy - blockedBy> }`. Same label-aware semantics as `children`: the entry is included even when `total == 0` (drives the Blocked gate's label-only suspension).
5. If the Task carries the `task:blocking` label at intake, include `blocking: { total: <totalBlocking>, completed: <totalBlocking - blocking> }`. Informational; not consulted by any gate.
6. If none of `parent` / `children` / `blocked_by` / `blocking` applies, store `NULL`.

For Tasks without the relevant label, the corresponding entry is omitted regardless of any actual relations present in upstream data, because policy contract is that the labels are the canonical identification signal. A Task with relations but no matching label is in a policy-invalid state — the router does not interpret it.

**Note on "closed" vs canonical Lifecycle:** `IssueDependenciesSummary.blockedBy` counts open GitHub Issues, so `completed` here means "GitHub-closed", not "canonical Lifecycle = Completed or Cancelled". A blocker GitHub-closed without the corresponding canonical lifecycle transition would clear the wakery Blocked gate but Heimdall (at audit time) would still refuse per `TASK.md §Dependency Tasks → Resolution gate`. This is the same defense-in-depth pattern as the Parent gate — wakery does a cheap fast-filter; Heimdall does the strict canonical check.

### Webhook-driven refresh

The GitHub adapter subscribes to (or already receives) the following webhook actions and triggers a `task_relations` refresh on each:

| event | action | refresh target(s) |
|---|---|---|
| `issues` | `closed` | (1) if the closed Task has a `parent`, refresh `task_relations.children` on all open wakes of that parent; (2) for each Task in the closed Task's `blocking` list (issues this one blocks), refresh `task_relations.blocked_by` on all open wakes of that blockee |
| `issues` | `reopened` | same as above (parent's `children.completed` ticks down; each blockee's `blocked_by.completed` ticks down) |
| `sub_issues` | `sub_issue_added` | refresh `task_relations.children` on all open wakes of the affected parent; refresh `task_relations.parent` on all open wakes of the newly-attached child |
| `sub_issues` | `sub_issue_removed` | refresh `task_relations.children` on all open wakes of the affected parent; clear `task_relations.parent` on all open wakes of the detached child |
| `sub_issues` | `parent_issue_added` | refresh `task_relations.parent` on all open wakes of the child; refresh `task_relations.children` on all open wakes of the newly-set parent |
| `sub_issues` | `parent_issue_removed` | refresh `task_relations.parent` on all open wakes of the child; refresh `task_relations.children` on all open wakes of the previously-set parent |
| `issue_dependencies` | `blocked_by_added` | refresh `task_relations.blocked_by` on all open wakes of the dependent; refresh `task_relations.blocking` on all open wakes of the newly-added blocker |
| `issue_dependencies` | `blocked_by_removed` | refresh `task_relations.blocked_by` on all open wakes of the dependent; refresh `task_relations.blocking` on all open wakes of the formerly-attached blocker |
| `issue_dependencies` | `blocking_added` | symmetric — refresh both sides |
| `issue_dependencies` | `blocking_removed` | symmetric — refresh both sides |

Note that `issue_dependencies` events fire on relation add/remove, not on terminal-state transitions of the blocker. A Blocked-by Task reaching `Completed` or `Cancelled` (which closes its GitHub Issue) fires `issues.closed` on the blocker; the handler then enumerates the blocker's `blocking` list and refreshes each blockee. This is the analog of the `issues.closed` parent-children path.

Refresh logic per affected wake:

1. Re-query the affected Task's `parent`, `subIssuesSummary`, and `issueDependenciesSummary` via GraphQL.
2. Rebuild the `task_relations` object per the ingress-time logic.
3. `UPDATE wake SET task_relations = <new>, update_time = now() WHERE task_id = <affected> AND status IN ('queued', 'parked')`.
4. Emit a `wake.task_relations.refreshed` event (see §Observability).

The refresh is idempotent — concurrent refresh attempts converge on the same value.

### Periodic refresh (last-resort)

Webhook delivery from GitHub to our ingress is best-effort, not guaranteed. A lost `issues.closed` event on the last incomplete Child / Blocker would leave the dependent wake suspended indefinitely with no other path to unblock.

To bound this risk, the dispatch worker performs a periodic stale-relations sweep alongside its main dispatch sweep:

- On a configurable interval (`WAKERY_PARENT_RELATIONS_REFRESH_INTERVAL_MS`, default 300000 = 5 minutes), select all wakes where:
  - `wake.status = 'queued'`
  - `wake.task_labels` contains either `task:parent` or `task:blocked` (either label gates dispatch and benefits from periodic catch-up). `task:blocking` is excluded — that label is informational and does not gate dispatch, so stale `blocking` data does not cause a stuck wake.
- For each selected wake, re-query the Task's `parent`, `subIssuesSummary`, and `issueDependenciesSummary` via GraphQL and apply the same refresh logic as the webhook-driven path.
- Emit a `wake.task_relations.refreshed` event with `trigger_event = 'periodic.stale_refresh'` and no `trigger_task_id`.

The periodic sweep is **refresh-only**. It does not evaluate the dispatch filter, resolve routes, check leases, or attempt dispatch. Its sole job is to keep `wake.task_relations` accurate as a fallback against missed webhooks. Dispatch evaluation continues to run on its independent 10-second cadence (see `spec_wakery-dispatch-worker.md`); whenever the next dispatch tick fires after a refresh updates a Parent's `children` or a Blocked Task's `blocked_by` such that `total == completed`, the relevant gate will pass and the wake will dispatch normally.

The env var name is preserved (`WAKERY_PARENT_RELATIONS_REFRESH_INTERVAL_MS`) for continuity even though the sweep now covers Blocked Tasks too — the interval semantics are unchanged.

The sweep targets only gating wakes (Parent and Blocked) — those are the only ones whose dispatch eligibility depends on `task_relations` data. Child wakes' `task_relations.parent` and Blocking wakes' `task_relations.blocking` are informational; staleness there does not block any work and does not justify the API call cost.

The sweep does not consult per-wake refresh timestamps. The cost is one GraphQL call per suspended gating wake per interval, bounded by the count of in-flight Parents + Blocked Tasks at any time. At default 5-minute cadence with even a few dozen suspended gating wakes, this stays well under the authenticated rate limit per token.

The periodic sweep covers four webhook-loss scenarios:
- Lost `issues.closed` on the last incomplete Child → next periodic sweep observes Parent `children.completed == total`, unblocks the Parent.
- Lost `sub_issue_added` for late-attached Children on a label-only Parent → next periodic sweep observes the new `total > 0`, refreshes accordingly (and the Parent gate then applies to the real incomplete count).
- Lost `issues.closed` on the last incomplete Blocker → next periodic sweep observes Blocked Task's `blocked_by.completed == total`, unblocks the dependent.
- Lost `blocked_by_added` for late-declared blockers on a label-only Blocked Task → next periodic sweep observes the new `total > 0`, refreshes accordingly (and the Blocked gate then applies to the real incomplete count).

### Dispatch filter

The dispatch sweep applies **two independent gates** as the first filters in candidate-wake evaluation, before route resolution (`spec_wakery-dispatch-worker.md` Stage 1). Both gates must clear for a wake to be dispatch-eligible.

**Parent gate** (label `task:parent` → `children` summary):

For each candidate `queued` wake:

- If `wake.task_labels ? 'task:parent'` is **false**: Parent gate is N/A; pass.
- Else (wake is on a Parent Task):
  - Let `c = wake.task_relations -> 'children'`.
  - If `c IS NULL`: **suspend** (label says Parent but `children` entry missing — should not happen if ingress populated correctly; treat conservatively).
  - Else if `(c ->> 'total')::int == 0`: **suspend** (label-only Parent with no Children attached yet).
  - Else if `(c ->> 'total')::int > (c ->> 'completed')::int`: **suspend** (some Children still incomplete).
  - Else: Parent gate passes.

**Blocked gate** (label `task:blocked` → `blocked_by` summary), **audit-dispatch-scoped**:

For each candidate `queued` wake:

- If the wake is not in `Todo:Gated` (the auditor's pre-execution queue): Blocked gate is N/A; pass. `SECURITY.md §R995` / `TASK.md §Dependency Tasks → Resolution gate` suspend **the audit** until blockers reach terminal — owner-lane wakes (the `Init:Gated` cue of a reclaim-created dependency, `Pending` reclaims) must flow, or the Owner is never cued to perform the ordered re-queue (the #56/#57 stall on a sibling project).
- If `wake.task_labels ? 'task:blocked'` is **false**: Blocked gate is N/A; pass.
- Else (wake is on a Blocked Task in `Todo:Gated`):
  - Let `b = wake.task_relations -> 'blocked_by'`.
  - If `b IS NULL`: **suspend** (label says Blocked but `blocked_by` entry missing — should not happen if ingress populated correctly; treat conservatively).
  - Else if `(b ->> 'total')::int == 0`: **suspend** (label-only Blocked with no Blockers declared yet).
  - Else if `(b ->> 'total')::int > (b ->> 'completed')::int`: **suspend** (some Blockers still active).
  - Else: Blocked gate passes.

**Composite**: a wake is dispatch-eligible iff **both** the Parent gate AND the Blocked gate pass. A Task labeled with both `task:parent` and `task:blocked` is gated by both summaries; either incomplete summary keeps the wake suspended. A Task labeled with neither passes both gates trivially.

When suspended by either gate, the wake remains `queued`. No status change, no counter increment, no event log on the suspended tick.

The **Blocked gate is state-scoped to `Todo:Gated`** — it suspends only the auditor's pre-execution dispatch, per `SECURITY.md §R995` (re-scoped: the original any-state form ate the owner-lane cue a reclaim-created dependency needs). The **Parent gate is not state-scoped** — any wake on an incomplete Parent stays suspended regardless of lane or state. The `task:blocking` and `task:child` labels are informational; neither produces a gate.

## Configuration

| env | default | meaning |
|---|---|---|
| `WAKERY_PARENT_RELATIONS_REFRESH_INTERVAL_MS` | `300000` | Cadence of the periodic last-resort stale-relations sweep performed by the dispatch worker over gating-labeled (`task:parent` or `task:blocked`) `queued` wakes. Sized for 5 minutes by default — small enough that a lost webhook doesn't strand a gated wake for long, large enough that the API-call cost stays bounded. Env-overridable for tuning without code change. Name is preserved from the Parent-only era; semantics are unchanged. |

## Status updates

Neither gate transitions the wake's status. A gate-suspended wake remains `queued`. When refresh updates `task_relations.children` or `task_relations.blocked_by` such that `completed == total` (and `total > 0`), the wake becomes dispatch-eligible on the next sweep tick — provided the other gate also passes.

## Edge cases

- **Parent label added after wake create.** Not supported. Per TASK.md `§Parent Task → Leaf-to-Parent conversion`, retroactive Parent identification is policy-invalid. If a Task gains the `task:parent` label after its wake row was created, `task_relations.children` stays absent until the next webhook-triggered refresh on that Task (which will only run if Children are then attached). Operators must Cancel the Task and re-create per policy.
- **Parent label removed.** Symmetric: not a supported in-flight change. Any cached `children` entry becomes stale; subsequent refreshes will continue to populate it as long as upstream `subIssuesSummary.total > 0`, but the gate's label-aware check skips the wake. Net effect: the wake dispatches normally despite stale `children` data.
- **Child detached mid-flow (`sub_issue_removed`).** Refresh recomputes from surviving Children. If detachment drops `total - completed` to `0` while the Parent's structure should have been frozen, the gate lets the wake through — policy violation is upstream of the router's responsibility (see TASK.md `§Parent Task → Structure freeze`).
- **Child reopened from `Completed` or `Cancelled`.** Refresh recomputes; if the count of incomplete Children ticks back above `0` while the Parent has already passed `Todo+Gated`, the wake that already left `queued` is not retro-suspended; only new wakes on the Parent see the elevated count.
- **Race between wake create and first child attach.** Wake is created with `children: { total: 0, completed: 0 }` (label present, no Children visible at create time). Within milliseconds, `sub_issue_added` webhooks fire and refresh updates the counts. Eventually consistent.
- **Multiple open wakes on one Parent.** All are refreshed together on each event (the `UPDATE … WHERE task_id = <parent>` clause covers them).
- **`subIssuesSummary` or `parent` GraphQL query failure.** Log error; leave `task_relations` at its previous value (or `NULL` if there was no previous value). Refresh is best-effort; staleness on a Parent errs toward suspension because the previous `children` value remains and the gate continues to apply.
- **Nested Parent (Parent that is itself a Child).** Forbidden by `docs/policy/TASK.md §Relations` — Parent/Child structure is exactly one level deep. If the router observes a `task_relations` row carrying both `parent` and `children` entries, it has been handed a policy-invalid upstream state. The router does not enforce the depth rule; it will still populate both entries from upstream and apply the gate using the `children` entry, but the situation is an Owner-side violation to be corrected upstream.
- **Wake on a Child Task whose Parent is incomplete.** No effect. Child wakes are not gated on Parent state; Children flow normally regardless of where the Parent sits in its own lifecycle.
- **Blocked label added after wake create.** Not supported (symmetric to Parent label added after create). Per TASK.md `§Dependency Tasks → Dependency freeze`, the Blocked-by set is frozen at `Todo+Gated`; retroactive identification is policy-invalid. Operators must Cancel the Task and re-create per policy.
- **Blocked label removed.** Symmetric to Parent label removed: not a supported in-flight change. Any cached `blocked_by` entry becomes stale; the gate's label-aware check skips the wake, and dispatch proceeds despite stale data.
- **Blocker detached mid-flow (`blocked_by_removed`).** Refresh recomputes from surviving blockers. If detachment drops `total - completed` to `0` while the Blocked Task's dependency set should have been frozen, the gate lets the wake through — policy violation upstream of the router (see TASK.md `§Dependency Tasks → Dependency freeze`).
- **Blocker reopened from `Completed` or `Cancelled`.** Refresh recomputes; if the count of active blockers ticks back above `0` while the dependent has already passed `Todo+Gated`, the wake that already left `queued` is not retro-suspended; only new wakes on the dependent see the elevated count.
- **Race between dependent wake create and first blocker declaration.** Wake is created with `blocked_by: { total: 0, completed: 0 }` (label present, no blockers visible at create time). Within milliseconds, `blocked_by_added` webhooks fire and refresh updates the counts. Eventually consistent.
- **`issueDependenciesSummary` GraphQL query failure.** Log error; leave `task_relations` at its previous value. Refresh is best-effort; staleness on a Blocked Task errs toward suspension.
- **Self-blocking / dependency cycles.** Per TASK.md `§Relations` cycle prohibition, cycles must not occur. The router does not detect cycles. If the upstream graph contains one, both/all participating wakes stay suspended indefinitely (each waits on the other); operator must break the cycle via the upstream relation removal.
- **Cross-relation interaction (Task is both Parent and Blocked).** Both gates apply independently. The wake stays suspended until both `children.completed == total` AND `blocked_by.completed == total`. Either summary remaining incomplete keeps the wake suspended.

## Observability

Extend existing wake events:
- `wake.created` payload: add `task_relations=<json|null>`, `parent_label=<bool>` (computed from `task_labels ? 'task:parent'`), and `blocked_label=<bool>` (computed from `task_labels ? 'task:blocked'`).
- `wake.selected` payload: add `task_relations=<json|null>` so operators can see the gate inputs at sweep time.

New event:
- `wake.task_relations.refreshed` — fired on each refresh. Payload: `wake_id`, `task_id`, `old_task_relations`, `new_task_relations`, `trigger_event` (one of `issues.closed`, `issues.reopened`, `sub_issues.sub_issue_added`, `sub_issues.sub_issue_removed`, `sub_issues.parent_issue_added`, `sub_issues.parent_issue_removed`, `issue_dependencies.blocked_by_added`, `issue_dependencies.blocked_by_removed`, `issue_dependencies.blocking_added`, `issue_dependencies.blocking_removed`, `periodic.stale_refresh`), `trigger_task_id` (the Task whose webhook caused the refresh; absent for `periodic.stale_refresh`).

No new metric required for v1.

## Implementation notes

- The `parent` and `subIssuesSummary` GraphQL surfaces are GA in 2026 per GitHub's roadmap. Preview-era code required a `GraphQL-Features: sub_issues` header; verify whether the header is still needed at implementation time and include it if so.
- The `issueDependenciesSummary` GraphQL surface is confirmed against the live schema with fields `blockedBy: Int`, `blocking: Int`, `totalBlockedBy: Int`, `totalBlocking: Int`. The non-`total` field returns the *open* subset (remaining unresolved). The corresponding REST surface returns `issue_dependencies_summary: { blocked_by, blocking, total_blocked_by, total_blocking }` — same semantics, snake-case.
- All gating-relevant webhook actions (4 `sub_issues.*`, 4 `issue_dependencies.*`, plus `issues.closed`/`reopened`) are repository-level and immediate — no Projects v2 sync lag.
- Migration: no schema change. The `wake.task_relations JSONB` column already exists from the earlier Parent gate work; adding `blocked_by` and `blocking` keys is a JSON shape extension only.

## References

- `docs/policy/TASK.md §Parent Task` — policy source of truth for Parent/Child semantics, ordering, structure freeze, completion gate.
- `docs/policy/TASK.md §Dependency Tasks` — policy source of truth for Blocked-by/Blocking semantics, dependency freeze, resolution gate.
- `specs/data/spec_database.md §wake` — canonical schema definition for `task_relations` and `task_labels`.
- `spec_wakery-ingress-api.md` — ingress wake creation; updated by this spec to include the `parent` / `subIssuesSummary` / `issueDependenciesSummary` GraphQL fragments and `task_relations` population.
- `spec_wakery-github-adapter.md` — GitHub webhook adapter; updated by this spec to include the 4 `sub_issues` actions, the 4 `issue_dependencies` actions, and the `issues` close/reopen handlers (which now refresh both parents and blockees).
- `spec_wakery-dispatch-worker.md` — dispatch sweep; updated by this spec to add the Parent and Blocked gates as the first filters in candidate-wake evaluation.
- `specs/data/spec_event.md` — event payload contracts; updated by this spec.
