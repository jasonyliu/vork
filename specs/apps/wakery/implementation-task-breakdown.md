# Wakery Initial Implementation Task Breakdown

## Purpose

This document breaks the Wakery MVP into bounded implementation tasks that map closely to the current modular spec set.

## Stack Assumption

Current assumed MVP stack:
- Node.js + TypeScript
- Postgres
- JSONL event logging
- GitHub webhook ingress
- OpenClaw downstream adapter

## Delivery Principle

Build in the same modular order as the architecture:
1. storage and contracts
2. Stage 1 ingress
3. Stage 2 worker
4. Stage 3 OpenClaw adapter
5. GitHub adapter
6. end-to-end verification

---

## Task 1 — Bootstrap runtime skeleton

### Objective
Create the basic project/app structure and dev scripts.

### Deliverables
- Node.js + TypeScript app skeleton
- code layout matching the spec modules
- lint/typecheck/test scripts
- separate API and worker entrypoints

### Verification
- app boots locally
- typecheck passes
- test runner executes

### Dependencies
- none

---

## Task 2 — Implement migrations and data entities

### Objective
Create the Postgres schema and migration baseline.

### Deliverables
- migrations for `wake`, `route`, `wake_route_lease`
- indexes and unique constraints
- `wake_route_lease.wake_id` uniqueness enforced
- repository/data-access layer for the three entities

### Verification
- migrations apply cleanly on empty DB
- schema matches contracts spec
- rollback/redo path works if supported

### Dependencies
- Task 1

---

## Task 3 — Implement event writer and event definitions

### Objective
Add JSONL event emission as a first-class utility.

### Deliverables
- event code registry/constants
- JSONL append writer
- helper to emit normalized event payloads
- naming aligned with current convention (`wake_route_lease_id`, etc.)

### Verification
- event file is written correctly
- emitted payload contains required ids and names

### Dependencies
- Task 1

---

## Task 4 — Implement Stage 1 ingress API

### Objective
Build `POST /wake`.

### Deliverables
- request validation
- request normalization
- eligibility check hooks
- create/update current wake occurrence logic (ingress never changes `wake.status` on an existing row; `pending → queued` is exclusively the dispatch worker's responsibility)
- same-state update path: when the existing open wake is `pending` and the new request reports a fully-synced state (no hint or hint agrees with observed), reset `queue_attempts` to `0` and emit `wake.pending.refreshed`; otherwise leave worker-owned counters and `status` untouched
- hint-driven state progression in Stage 3: when the open wake's `state_key` matches the newly observed `state_key` AND the request carries `task_status_expected` / `task_audit_expected` that disagree with the canonical values, close the open wake + active lease the same way as observed-state progression and emit the lease-completion event with `trigger: "hint"`. Stage 5 then takes the new-row pending path so the field-sync sweep can graduate the wake once canonical catches up. Applies even when the *expected* state is ineligible (closure must not be gated by eligibility, same rule as observed-state progression).
- changed-state -> create new wake occurrence logic
- completion of prior wake + lease when state changes
- `WakeResponse`
- ingress events (including `wake.pending.refreshed`)

### Verification
- invalid request rejected
- same-state request updates current wake occurrence
- same-state request against a `pending` wake with matching hint/observed resets `queue_attempts` to `0`, leaves `status = pending`, emits `wake.pending.refreshed`
- same-state request against a `pending` wake with still-mismatched hint/observed does not change `status`, `queue_attempts`, or expected fields
- changed-state request creates new wake occurrence
- hint-driven progression: same-observed-state request with disagreeing hints closes prior wake+lease (`trigger: "hint"`) and creates a new pending wake at the same observed `task_status`/`task_audit` with expected fields persisted
- hint-driven progression closure fires even when the expected state would be ineligible (e.g. hint `To: Cancelled`); only the new-wake-creation step is gated by eligibility
- ineligible request is dropped and logged

### Dependencies
- Task 2
- Task 3

---

## Task 5 — Implement Stage 2 dispatch worker

### Objective
Build the long-running daemon/service worker.

### Deliverables
- per-tick idle polling loop (default 10 seconds, env-configurable via `WAKERY_DISPATCH_POLL_MS`)
- field-sync sweep over `pending` wakes:
  - re-fetch upstream source-of-truth fields once `update_time` is older than `WAKERY_PENDING_RETRY_INTERVAL_MS`
  - graduate to `queued` when fresh values match `task_status_expected` / `task_audit_expected`; clear the expected fields
  - bump `queue_attempts` and `update_time` on mismatch with budget remaining
  - leave row in `pending` once `queue_attempts >= WAKERY_PENDING_MAX_ATTEMPTS`; emit `wake.field_sync.timeout` exactly once
- dispatch sweep over `queued` wakes:
  - selection ordering (priority, then `update_time` asc)
  - **actor-aware route resolution**: derive `actor` from (`wake.task_status`, `wake.task_audit`) via the eligibility matrix, then look up route by `(project_id, task_type, actor, status='active')` with `task_type IS NULL` fallback within the same actor lane; no `agent_id`-based special case
  - parked handling on no-route
  - capacity-rebound handling: stay `queued`, bump `dispatch_attempts` and `update_time` (no `deferred` status)
  - active `wake_route_lease` creation before Stage 3 handoff
- worker events: `wake.field_sync.resolved`/`retried`/`timeout`/`error`, `wake.parked`, `wake.dispatch.capacity_rebound`, `wake.dispatched` (dispatch-pipeline events should include `actor` in the payload)

### Verification
- pending wake graduates to queued on field-sync match
- pending wake stays pending and emits timeout when retry budget exhausted
- no-route wake becomes `parked`
- capacity-bound wake stays `queued` with bumped `dispatch_attempts` and `update_time`
- ready wake is handed to Stage 3 with active lease present

### Dependencies
- Task 2
- Task 3
- Task 4

---

## Task 6 — Implement Stage 3 OpenClaw adapter

### Objective
Dispatch routed wakes downstream.

### Deliverables
- existing-session dispatch path
- short-lived one-shot `run` dispatch path
- no persistent long-standing session creation
- bounded wake message formatter
- adapter events
- Gateway auth/connect path
- run-session template rendering using `[wake_route_lease_id]`
- idempotent dispatch keys derived from `wake_route_lease.id`

### Verification
- existing-session route dispatches correctly
- `run` route dispatches correctly
- persistent-session creation path is blocked
- rendered run session keys follow route template semantics
- dispatch attempts/outcomes are logged

### Dependencies
- Task 3
- Task 5

---

## Task 7 — Implement GitHub adapter

### Objective
Convert GitHub webhook input into `WakeRequest` and hand it to Stage 1.

### Deliverables
- webhook endpoint
- signature verification
- payload mapping
- optional narrow GitHub lookup when strictly needed
- adapter events

### Verification
- valid webhook becomes `WakeRequest`
- invalid signature rejected
- repeated webhook deliveries do not corrupt wake lineage

### Dependencies
- Task 4
- Task 3

---

## Task 8 — Integration tests across stages

### Objective
Verify the end-to-end module chain.

### Deliverables
- end-to-end test fixtures
- ingress -> wake store -> worker -> adapter path tests
- changed-state wake succession tests
- lease completion tests
- parked path tests
- pending → queued field-sync graduation tests
- pending field-sync timeout tests
- capacity-rebound (stay-queued) path tests

### Verification
- one logical task can accumulate multiple wake occurrences over time
- one wake has zero or one lease total
- route delivery behavior matches route config

### Dependencies
- Tasks 4-7

---

## Task 9 — Dev seed data and operator scripts

### Objective
Make local/dev operation practical.

### Deliverables
- route seed script with `actor` set on every row (one of `owner`, `assignee`, `auditor`); includes at minimum the auditor-lane Heimdall route, the assignee-lane spec route, and the owner-lane one-shot `run` route per project (e.g. `agent:main:<project_key>:task:run:[wake_route_lease_id]`, `max_run=1`)
- dev DB reset/bootstrap script
- sample webhook submission script
- worker/API local start commands

### Verification
- a developer can stand up the MVP locally without manual DB poking

### Dependencies
- Tasks 2-7

---

## Task 10 — Probe Worker MVP

### Objective
Implement stale-occupancy probe as a first-class Wakery capability.

### Deliverables
- probe candidate selection surface for occupied leases
- probe target resolution for `delivery = session` and `delivery = run`
- bounded probe message formatter
- per-lease attempt cap (`WAKERY_PROBE_MAX_ATTEMPTS`, default 5) using `wake_route_lease.probe_attempts`
- service-capable probe path (Probe Worker standing beside Dispatch Worker)
- operator/manual trigger surface on top of the same capability
- probe-specific JSONL event logging (4000 series codes), including `probe.lease.max_attempts_reached`

### Verification
- occupied leases can be selected as probe candidates without lease mutation
- session routes probe the concrete `route.session_key`
- run routes probe the rendered run-session key derived from `wake_route_lease.id`
- probe does not free or complete the lease
- probe events are recorded durably
- once `lease.probe_attempts` reaches the configured cap, probe worker stops sending nudges and the lease stays `active`
- `probe.lease.max_attempts_reached` is emitted exactly once per lease

### Dependencies
- Task 3
- Task 5
- Task 6
- Task 8

---

## Recommended Build Order

1. Task 1 — runtime skeleton
2. Task 2 — schema/migrations
3. Task 3 — event writer
4. Task 4 — Stage 1 ingress
5. Task 5 — Stage 2 worker
6. Task 6 — Stage 3 OpenClaw adapter
7. Task 7 — GitHub adapter
8. Task 8 — integration tests
9. Task 9 — dev scripts and seed data
10. Task 10 — Probe Worker

## TDD Guidance

Use the installed test-driven-development skill during implementation.
Suggested first red-green cycle order:
1. invalid `WakeRequest` rejected
2. same-state request updates current wake occurrence
3. changed-state request creates new wake occurrence and completes previous lease
4. missing route -> parked
5. busy route -> wake stays `queued`, `dispatch_attempts` and `update_time` bumped
6. field-lag at intake -> wake stored as `pending` with expected fields populated
7. field-sync sweep graduates `pending` to `queued` when upstream catches up
8. field-sync sweep exhausts retry budget -> wake stays `pending`, timeout event emitted once
9. session route dispatch works
10. run route dispatch works
11. probe targets stale occupied session lease without mutating lease
12. probe targets stale occupied run lease via rendered session key
13. probe-attempts cap reached -> probe worker stops nudging, lease stays `active`

## Notes

This task set is intentionally close to the module boundaries in the current spec.
The point is to make implementation map naturally to the design instead of forcing another translation layer.
