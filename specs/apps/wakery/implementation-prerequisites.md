# Wakery Implementation Prerequisites

## Purpose

This checklist defines what should exist before Wakery implementation begins in earnest.

It assumes the current MVP stack and scope already chosen in the spec set:
- **runtime:** Node.js + TypeScript
- **database:** Postgres
- **event logging:** JSONL append-only logs
- **upstream binding:** GitHub webhook adapter
- **downstream binding:** OpenClaw adapter
- **worker model:** long-running daemon/service with 10-second idle polling
- **dispatch authority in MVP:** existing-session dispatch + short-lived one-shot `run` creation; no persistent long-standing session creation

---

## 1) Repo and runtime baseline

- [ ] Create the wakery implementation repo/workspace path
- [ ] Lock Node.js version
- [ ] Lock TypeScript version
- [ ] Choose and lock package manager
- [ ] Define the high-level code layout:
  - [ ] `src/ingress/`
  - [ ] `src/worker/`
  - [ ] `src/adapters/openclaw/`
  - [ ] `src/adapters/github/`
  - [ ] `src/db/`
  - [ ] `src/events/`
  - [ ] `src/config/`
  - [ ] `src/shared/`
- [ ] Add lint/format/typecheck scripts
- [ ] Add local dev run scripts for:
  - [ ] API service
  - [ ] worker daemon
  - [ ] tests

## 2) Configuration baseline

- [x] Define environment/config surface for:
  - [x] HTTP bind host/port
  - [x] Postgres connection
  - [x] GitHub webhook secret
  - [x] OpenClaw gateway/session access config
  - [x] event log directory/path
  - [x] worker idle polling interval (`10s` MVP default)
- [ ] Decide config loading strategy
- [x] Document required env vars

## 3) Database and migration baseline

- [x] Provision dedicated Wakery database + app role on <db-host>
- [ ] Choose migration mechanism
- [ ] Create initial migration set for:
  - [ ] `wake`
  - [ ] `route`
  - [ ] `wake_route_lease`
- [ ] Encode key constraints from the spec:
  - [ ] `wake.id` unique minted primary key
  - [ ] `wake.task_key` indexed
  - [ ] `wake.state_key` indexed
  - [ ] `wake_route_lease.id` primary key
  - [ ] `wake_route_lease.wake_id` unique
  - [ ] FK/link integrity for `wake_route_lease.route_id`
  - [ ] FK/link integrity for `wake_route_lease.wake_id`
- [ ] Add route lookup indexes (including `(project_id, task_type, actor, status)` for actor-aware route resolution)
- [ ] Migration adds `route.actor` (`owner` | `assignee` | `auditor`, NOT NULL, CHECK constraint) and backfills existing rows with the correct lane: Heimdall route → `auditor`, all other seeded routes → `assignee`. The owner-lane route is a new row.
- [ ] Add wake selection indexes for Stage 2 ordering
- [ ] Add local dev database bootstrap command

## 4) Event log baseline

- [ ] Define JSONL log file location(s)
- [ ] Define rotation/retention approach for MVP
- [ ] Implement append-only event writer utility
- [ ] Ensure event payload field naming follows current convention:
  - [ ] full entity name + `_id`
- [ ] Seed the current wakery event code list from the spec

## 5) OpenClaw integration prerequisites

- [x] Confirm exact OpenClaw call path for existing-session dispatch
- [x] Confirm exact OpenClaw call path for short-lived one-shot `run` dispatch
- [x] Confirm how route `session_key` and `agent_id` map into real OpenClaw calls
- [ ] Define bounded wake message format
- [x] Verify local environment can reach the OpenClaw runtime/gateway
- [ ] Define the dedicated Wakery Gateway device bootstrap flow
- [ ] Ensure Wakery uses its own paired operator device instead of the human CLI device

## 6) GitHub integration prerequisites

- [ ] Confirm the exact GitHub webhook event types needed for MVP
- [ ] Confirm webhook endpoint path and secret handling
- [ ] Confirm how GitHub task fields map into `WakeRequest`
- [ ] Confirm whether any narrow GitHub lookup is still needed at ingress
- [ ] Create a test webhook payload fixture set

## 7) Worker runtime prerequisites

- [ ] Define worker daemon entrypoint
- [ ] Define single-process vs split-process local run model
- [ ] Implement `10s` idle polling config default
- [ ] Define wake ordering and selection rule for Stage 2
- [ ] Define route availability rule for:
  - [ ] `delivery = session`
  - [ ] `delivery = run`
- [ ] Define how active `wake_route_lease` creation is persisted before Stage 3 handoff

## 8) Test baseline

- [ ] Choose test runner
- [ ] Prepare DB test harness
- [ ] Prepare migration test flow
- [ ] Prepare fixtures for:
  - [ ] valid `WakeRequest`
  - [ ] invalid `WakeRequest`
  - [ ] repeated same-state request
  - [ ] changed-state request
  - [ ] missing-route wake (parked path)
  - [ ] capacity-rebound wake (stays `queued`, `dispatch_attempts` bumped)
  - [ ] field-lag wake (initial status `pending`, then graduates via field-sync sweep)
  - [ ] field-sync timeout wake (`queue_attempts` reaches max, stays `pending`)
  - [ ] pending-refresh wake (frozen `pending` wake unsticks when ingress sees a same-state request whose hint/observed values agree; `queue_attempts` reset to `0`; status unchanged)
  - [ ] hint-driven state progression (open wake at observed state_key still exists; new request carries `task_status_expected` / `task_audit_expected` disagreeing with canonical; prior wake and lease close with `trigger: "hint"`; new wake created at `status='pending'` with expected fields persisted; field-sync sweep graduates it to `queued` once canonical catches up)
  - [ ] probe-attempts cap reached on a stuck `active` lease
  - [ ] existing-session route
  - [ ] `run` route
  - [ ] owner-lane wake routes to `actor=owner` `run` route, not to the assignee session route; wake message carries `actor=owner`
  - [ ] assignee-lane wake routes to `actor=assignee` route; wake message carries `actor=assignee`
  - [ ] auditor-lane wake (`Todo + Gated`) routes to `actor=auditor` route (formerly the Heimdall special-case); wake message carries `actor=auditor`
  - [ ] dispatch worker re-derives `actor` from the wake's (`task_status`, `task_audit`) using the eligibility matrix, not from any stored field on the wake row
- [ ] Confirm TDD workflow will be used during implementation

## 9) Seed data / operator prerequisites

- [ ] Seed at least one `route` for MVP testing
- [ ] Decide sample `project_id`, `task_type`, and assignee identities for dev
- [ ] Prepare at least one known-good downstream existing session target
- [ ] Prepare at least one known-good downstream `run` route target

## 10) Exit criteria before implementation proper

Implementation should not start until:
- [ ] runtime baseline exists
- [ ] config surface exists
- [ ] migrations run successfully
- [ ] JSONL event writer works
- [ ] at least one route can be seeded
- [ ] OpenClaw connectivity is verified
- [ ] GitHub webhook fixtures exist
- [ ] test harness exists

## Notes

The point of this checklist is not ceremony.
It is to prevent “start coding first, discover missing foundations later” stupidity.
