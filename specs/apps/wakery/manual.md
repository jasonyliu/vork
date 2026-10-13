# Wakery

## Purpose

The Wakery accepts webhook/API wake requests, validates them, stores eligible work as local `wake` records, routes stored wakes asynchronously, and dispatches messages to downstream OpenClaw existing sessions.

## Ingress endpoint

- `POST /wake`

## Quick mental model

- Stage 1 ends the web request and either drops or stores a `wake` (initial status `queued` or `pending` depending on whether upstream fields agree with any expected-state hint on the request)
- Stage 2 runs two sweeps: a field-sync sweep that graduates `pending` wakes to `queued`, and a dispatch sweep that pulls `queued` wakes for routing
- Stage 3 sends a message to OpenClaw

## Inputs

Minimum request fields:
- `request_id`
- `source`
- `project_id`
- `task_id`
- `task_type`
- `task_status`
- `task_audit`
- `assignee_id` or `assignee_name`
- `timestamp`

## Current MVP constraints

- web requests end at Stage 1
- local routing is done against stored `wake` entities
- current MVP may dispatch to already-existing OpenClaw sessions
- current MVP may also create short-lived one-shot run sessions
- current MVP must not create persistent long-standing sessions

## Wake identity

The local wake model separates three identities:
- `wake.id` = minted unique id for one wake occurrence
- `task_key = md5(project_id + task_id)` = stable grouping key for the logical task
- `state_key = md5(project_id + task_id + task_status + task_audit)` = lifecycle+audit state signature

`request_id` is for the request, not for the wake.

## Wake statuses

Current wake process statuses (full semantics in `specs/data/spec_database.md`):
- `pending` — waiting for upstream source-of-truth fields to catch up to a transition signal
- `queued` — eligible for dispatch (capacity-bound retries stay here, not in a separate `deferred`)
- `parked` — no route resolved at dispatch time
- `dispatched` — handed to an agent via an active `wake_route_lease`
- `completed` — terminal
- `deleted` — soft-deleted, administrative

Counters on each `wake`:
- `queue_attempts` — incremented while in `pending` by the field-sync sweep; reset to `0` by ingress on the same-state update path when a fresh request reports a fully-synced state (re-opens the budget for a frozen-pending row)
- `dispatch_attempts` — bumped while in `queued` by the dispatch sweep
- `wake_attempts` — agent turns actually started for the wake; the re-wake cap (`WAKERY_REWAKE_MAX_ATTEMPTS`) and template selection read it

## Route and lease notes

- routes are keyed by `(project_id, task_type, actor)` where `actor` is one of `owner`, `assignee`, `auditor`. Each actor lane is routed independently; one project may have a distinct route per actor + task_type combination.
- a `task_type IS NULL` row is the project-level wildcard within its actor lane, used as fallback when no exact `task_type` match exists.
- the dispatch worker derives the wake's responsible actor from (`task_status`, `task_audit`) via the eligibility matrix in `spec_wakery-ingress-api.md` Stage 4, then picks the route that matches that actor. There is no `agent_id`-based special case — Heimdall's audit route is the `actor=auditor` route, nothing more.
- missing route -> `parked`
- busy route -> stay `queued`, bump `dispatch_attempts` and `update_time`
- active route occupancy is tracked through `wake_route_lease`
- quiet leases are reconciled against gateway truth by the dispatch worker; empty runs re-wake up to `WAKERY_REWAKE_MAX_ATTEMPTS` (`spec_wakery-dispatch-worker.md`)
- a later state change may complete the previous wake occurrence (never its lease — two-ledger rule), then create a new wake occurrence under the same `task_key`
- leases do not auto-expire in MVP

## Event logging

Runtime events should be written as JSON objects to append-only text logs such as JSONL.
The MVP does not require searchable DB-backed event logs.

## Cross References

- `README.md`
- `spec_wakery.md`
- `spec_wakery-contracts.md`
- `spec_wakery-ingress-api.md`
- `spec_wakery-queue-and-leases.md`
- `spec_wakery-dispatch-worker.md`
- `spec_wakery-openclaw-adapter.md`
- `specs/data/spec_database.md`
- `specs/data/spec_event.md`
- `spec_wakery-github-adapter.md`
