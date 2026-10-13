# Wakery

## Problem

Vork needs a utility that can accept upstream task-change requests, decide whether those changes are actually eligible for work release, store only the eligible ones as local wakes, and route them to the correct downstream agent without becoming a shadow task system.

Without that utility:
- every upstream source can invent its own wake logic
- ineligible work may be buffered too early and clutter the system
- repeated task-change requests may create ambiguous duplicate local work
- missing routes or busy agents can make work disappear into ad hoc behavior
- downstream agent dispatch remains hard to diagnose

## Goal

Build the Wakery as a practical three-stage service:
1. Stage 1 ingests requests, validates them, checks eligibility, and either drops them or stores/updates a local `wake`
2. Stage 2 graduates field-lagged `pending` wakes via a field-sync sweep, then reads `queued` wakes, resolves route and lease availability, and marks wakes as `parked`, capacity-rebound (still `queued`), or dispatched
3. Stage 3 dispatches a message to OpenClaw through already-existing downstream sessions in the MVP

## Scope

### In scope
- REST/webhook ingress
- local wake storage
- wake-route lease storage
- route storage
- async routing worker
- OpenClaw adapter
- JSONL event logging
- GitHub adapter as the primary upstream binding for v1

### Out of scope
- shadow task-state ownership
- durable mirrored task snapshots
- broad escalation framework in the MVP
- automatic downstream session creation authority in the MVP
- searchable event-log database in the MVP

## Constraints

- Stage 1 must end the web request and transfer ownership to local storage.
- The router should think in terms of local `wake` entities after Stage 1, not in terms of requests.
- `request_id` is for the inbound request, not the durable wake identity.
- Missing routes should park wakes rather than lose them.
- Events should be emitted as JSON records to text logs in the MVP.
- Persistent long-standing session creation should not be given to the router in the MVP.
- Short-lived one-shot run-session creation is allowed in the MVP.

## Success Conditions

The Wakery is worth building when it can demonstrate that:
- eligible task-change requests become stored wakes keyed by `project_id + task_id`
- ineligible requests are dropped before they enter the wake store
- missing routes produce parked wakes rather than silent loss
- busy routes leave wakes in `queued` with bumped `dispatch_attempts` and `update_time`, naturally rate-limiting re-dispatch
- upstream-field-lag at intake holds wakes in `pending` while a field-sync sweep waits for the upstream source to catch up, instead of routing on stale or comment-derived state
- downstream dispatch goes to existing OpenClaw sessions only in the MVP
- emitted events are enough to diagnose system behavior from logs alone
