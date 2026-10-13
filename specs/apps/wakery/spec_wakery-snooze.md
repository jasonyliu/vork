# Wakery Snooze

## Introduction

This spec defines the `snooze` facility: a pure, typed delay that keeps wakery from dispatching a task's next turn while an external asynchronous process runs against that task's branch. `wake` means act now; `snooze` means hold until an external condition finishes. Complementary primitives.

Snooze is a **module, not a worker**: a hold is a stateless predicate evaluated fresh at every dispatch admission — never a stored linkage to a wake or a lease. There is no snooze worker (no daemon, no poll loop, no pause/resume of leases, no parked adoption, no supersession, no resume sends); the whole facility is webhook intake in the ingress process, the consult predicate and a one-query timeout sweep in the dispatch worker, and a three-status row lifecycle.

Snooze remains a **general delay facility**: each snooze carries a type, and everything source-specific — which events start and end it, which branch it concerns, which task types it may hold — is the type's registry entry. `CI` and `PR` are the two shipped types; a future `DEPLOY` type needs no schema change.

## Purpose

The PR-based Integration flow makes agents wait on processes wakery cannot see from GitHub task state: an agent pushes (CI runs) or opens a PR and arms auto-merge, and its turn ends with the task legitimately parked mid-`Progress`. Under the turn-signal design that wake is an **empty run** — `dispatched`, no open lease, newest — which the dispatch worker would re-wake. The snooze's whole job is to make that re-wake *wait for the external work*: the hold defers admission while the process runs, and when it settles the standing empty-run re-wake re-engages the agent with the settled-holds context (`spec_wakery-rewake-message.md`). No resume send exists; re-engagement is the dispatch worker's normal machinery.

**The guarded line:** CI and PR holds guard **`Progress+Gated` only** — the one state where waiting is legitimate. Everything after the agent claims Done is agent judgment, audited: per `TASK.md §Enforcement`, `Progress → Done` requires any CI the work set in motion observed green, so a Done claimed beside running-or-red CI is an Assignee mistake the `Done+Gated` Review catches (`Revise`). Machinery guards the wait; intelligence owns the claim; audit punishes the bad claim.

## Scope

This spec covers:
- the `snooze` entity (simplified), its type registry, and its three-status lifecycle
- the hold predicate at dispatch admission
- the GitHub `pull_request` / `workflow_run` intake behind the `CI`/`PR` types
- the timeout sweep and the event-timing fail-safe properties

This spec does not cover:
- empty-run recovery and re-wake mechanics (`spec_wakery-dispatch-worker.md` Stage 5)
- the settled-holds message content (`spec_wakery-rewake-message.md`)
- outcome routing — a snooze never carries a result; the re-waked agent reads real external state and the verdicts stay with the audit gates

## Definitions

- **snooze** — a durable record that one external process instance is (believed) running against one branch: one type, one correlation value, one branch, one expected scope. Pure delay; carries no outcome and points at no wake or lease.
- **snooze type** — the unit of source-specific logic: intake events, claim guard, correlation value, payload shape, expected scope, allowed task types. Integer codes per `specs/data/spec_database.md §snooze_type semantics` (`1 = CI`, `2 = PR`).
- **correlation value** — the type-native token identifying the external process instance (`CI`: `ci_head_sha`; `PR`: `pr_number`), carried in `snooze_payload`.
- **`snooze_key`** — the upsert identity, one form only: `md5(type + correlation value)`. (The former wake-derived full form is retired with intake correlation.)
- **hold** — the *predicate*, not a state: a wake is held at admission iff an unexpired `active` snooze exists with the wake's branch, the type's expected scope matching the wake's state, and the wake's task type in the type's allowed set. A hold is never stored, attached, paused, or resumed — it is re-asked at every consult.

## Upstream / Downstream Context

### Upstream
- GitHub webhook ingress: `pull_request` / `workflow_run` routing (the `CI`/`PR` sources; `check_suite` remains unusable for repo webhooks — live-proven, framework-autonomy #16)
- `wake.task_branch` — the branch surface the predicate compares against

### Downstream
- the dispatch worker's admission consult (`spec_wakery-dispatch-worker.md` Stage 4) and its tick-riding timeout sweep
- the re-wake template's settled-holds context block (`spec_wakery-rewake-message.md`)

## Interfaces / Shared Contracts

- `snooze` table (contract: `specs/data/spec_database.md §snooze`), simplified:

```sql
CREATE TABLE IF NOT EXISTS snooze (
  id TEXT PRIMARY KEY,
  snooze_key TEXT NOT NULL UNIQUE,   -- md5(type + correlation value); one form
  type INTEGER NOT NULL,             -- spec_database §snooze_type semantics (1 = CI, 2 = PR)
  snooze_payload JSONB NOT NULL,     -- type-native bag incl. branch + correlation value
  project_id TEXT,
  project_name TEXT,
  task_status TEXT NOT NULL,         -- expected scope this type holds (CI/PR: 'Progress')
  task_audit TEXT NOT NULL,          --                                (CI/PR: 'Gated')
  status TEXT NOT NULL,              -- 'active' | 'completed' | 'timeout'
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS snooze_status_type_idx ON snooze (status, type);
```

- `snooze_task_type` (unchanged; `specs/data/spec_database.md` §8): which task types a snooze type may hold — rows, not code, applied inside the **consult predicate** (no longer at intake; intake performs no correlation).
- Env: `WAKERY_SNOOZE_TIMEOUT_MS` (default `1800000` — 30 min, single clock for all types). `WAKERY_SNOOZE_POLL_INTERVAL_MS` is **retired** with the worker.
- Events (`specs/data/spec_event.md`): `snooze.created`, `snooze.completed`, `snooze.timeout` (warn), `snooze.event.unmatched` (debug); the dispatch worker emits the hold-deferral marker. `snooze.parked` / `snooze.adopted` / `snooze.revoked` / `snooze.resume.dispatched` are retired.

## Type registry

Each code entry declares:

| Field | `1 — CI` | `2 — PR` |
|---|---|---|
| start_events | `workflow_run: requested, in_progress` (`in_progress` mandatory — a re-run fires no `requested`, live-proven) | `pull_request: opened, ready_for_review, reopened` |
| end_events | `workflow_run: completed` (any conclusion — never read) | `pull_request: closed` (merged or not — never read) |
| claim guard | only runs of the gate workflow: `workflow_run.name = CI` (the required-status-check name); other workflows fall through unclaimed | — (every `pull_request` on a tracked repo is claimable) |
| correlation value | `ci_head_sha` (= `workflow_run.head_sha`; a force-push is a new instance) | `pr_number` |
| payload | `{ branch, ci_head_sha, workflow_run_id }` | `{ branch, pr_number, base_ref }` |
| expected scope | `Progress+Gated` | `Progress+Gated` |

Task types each type may hold: `snooze_task_type` rows (seeded with the repo-changing set; spec_database §8).

## Runtime model

No worker, no poll loop, no in-memory state. Three homes:

- **Intake** — module code invoked by ingress routing for `pull_request`/`workflow_run` webhooks (runs in the ingress process).
- **Consult** — `consultSnoozes(wake)`: a pure read the dispatch worker calls at admission (Stage 4). Returns the holding set (for the deferral event's payload); writes nothing.
- **Timeout sweep** — one query on the dispatch worker's tick: flip expired `active` rows to `timeout` and emit the warn event. **Bookkeeping only** — the consult predicate excludes expired rows by `update_time` age directly, so holding-correctness never depends on the sweep having run.

## Procedure

### Stage 1 — Intake

**Rules**
- The event source (webhook event + action) selects the type; an unclaimed event takes the existing ignore path. Standing-branch events (`dev`, `main`) are dropped with `snooze.event.unmatched` (debug) — expected noise, never stored.
- **Start event:** upsert on `snooze_key = md5(type + correlation value)` — create `active` (payload, branch, expected scope from the registry, project context from the source repo), or refresh `update_time` on a repeat/re-arm. **No wake lookup, no correlation query, no task-type check** — intake stores the fact that external work is running on a branch, nothing more.
- **End event:** the row matching `(type, correlation value)` with `status='active'` → `completed`. No matching row → `snooze.event.unmatched`, no-op.

### Stage 2 — The hold predicate (dispatch admission)

**Rules**
- At Stage 4 admission the dispatch worker consults: the candidate wake is **held** iff an `active` snooze exists where
  1. `snooze_payload->>'branch' = wake.task_branch`, and
  2. the snooze's expected scope equals the wake's (`task_status`, `task_audit`) — for CI/PR: the wake sits at `Progress+Gated`, and
  3. `wake.task_type` is in the snooze type's `snooze_task_type` rows, and
  4. the row is unexpired: `now - update_time <= WAKERY_SNOOZE_TIMEOUT_MS` (lazy expiry — correctness without the sweep).
- A held wake is deferred: stays in its status, `dispatch_attempts` bumped for pacing, **`wake_attempts` untouched** (held waits never consume the re-wake cap). The worker emits the hold-deferral marker naming the holding types, so a held branch reads as *held* in the log, not stalled.
- The predicate is evaluated fresh on every consult, per candidate wake. Nothing is attached, cached, paused, or resumed. All scope-matched wakes on the branch are held collectively (branch CI is branch-shared state) and released individually.

### Stage 3 — Settle and re-engage

**Rules**
- Settling **is** the predicate going false — by end event, or by expiry. No action fires.
- The held wake is (typically) an empty run; the dispatch worker's next sweep re-dispatches it through the standing re-wake path. The re-wake render includes the **settled-holds context**: this branch's snoozes of matching scope that reached `completed` or `timeout` since the wake's last turn ended (`spec_wakery-rewake-message.md`) — type-aware, outcome-blind, with `timeout` visible so the agent knows to verify the external process itself.

### Stage 4 — Timeout sweep (bookkeeping)

**Rules**
- On the dispatch worker's tick: `active` rows with `now - update_time > WAKERY_SNOOZE_TIMEOUT_MS` → `timeout`, `snooze.timeout` (warn) once per row. A restarted external process re-arms naturally via a fresh start event (new or same key).

## Event-timing fail-safety

The property that justifies the design: the old model's timing races corrupted stored lease state; under the predicate model **every misordering degrades to a hold missing its window or one polite wasted turn — never a jam**:

| Misordering | Outcome |
|---|---|
| CI event arrives after the task already progressed past `Progress+Gated` | snooze matches no open wake; holds nothing; dies by end event or timeout. Noise, not damage. |
| CI event arrives after the successor's turn already started | admission gating cannot undo a started turn; the hold misses. One review runs beside CI; the Reviewer reads real state (and a premature Done is the Assignee's audited mistake). |
| End event lost | lazy expiry + timeout flip clear the hold; the re-wake's settled-holds context shows `timeout`; the agent verifies the external process per the template. |
| Start event lost | no hold exists; the empty-run re-wake fires during CI; the agent checks, replies "waiting", ends its turn; held (or re-waked again) next round. One wasted turn, capped by `WAKERY_REWAKE_MAX_ATTEMPTS`, never stuck. |

## Invariants

- A snooze carries no outcome, ever; conclusions live with the external system and the audit gates.
- A hold is a predicate, never a state: no snooze row references a wake or a lease; no lease state exists to pause; no resume action exists to send or lose.
- One row per external process instance (`snooze_key` unique, single form).
- Statuses are exactly `active` / `completed` / `timeout`; every row self-clears within the timeout.
- Holding-correctness is sweep-independent (lazy expiry in the predicate); the sweep is observability.
- Held deferral never consumes `wake_attempts`.
- CI and PR hold `Progress+Gated` only; owner-lane, `Pending+*`, audit-queue, and terminal states are never held.

## Failure / Retry / Idempotency / Recovery

- Duplicate/repeat start events → key upsert, `update_time` refresh, one row.
- Lost end event → lazy expiry + timeout warn; the agent reads real state.
- Wakery restart → nothing to recompute: the predicate reads durable rows; no derived state exists.
- Branch force-push mid-CI (`CI` type) → new `ci_head_sha` = new key = new row; the stale suite's completion or timeout clears its own row.
- Event for a process wakery never stored → unmatched debug event, no-op.

## Observability / Debugging

- Event family: `snooze.created` / `completed` / `timeout` (warn) / `event.unmatched` (debug); the dispatch worker's hold-deferral marker carries the holding set.
- Health: `timeout` rate ≈ 0 (each is a lost signal or hung process); active population drains between settles.
- Debug: `SELECT * FROM snooze WHERE snooze_payload->>'branch' = :branch ORDER BY create_time` — a lane's hold history.

## Deliverables

- `migrate.ts`: snooze status set narrowed (`parked`/`revoked` retired), `snooze_key` single-form note; `snooze_task_type` unchanged.
- Intake handlers relocated into the ingress-side module (no `snooze-entry.ts`, no standalone process); consult predicate + timeout sweep in the dispatch worker.
- Deletion of the snooze worker: `snooze-worker.ts` poll loop, pause/resume, adoption (both directions), supersession, resume-send path, and the `resume-message.json` artifact (folded into the re-wake template).
- Tests: intake upsert/end/unclaimed/standing-branch; predicate (branch + scope + task-type + lazy expiry); held-deferral does not consume `wake_attempts`; timeout sweep; the four fail-safe misorderings as integration cases; settled-holds context rendering on re-wake.

## Verification

- Happy path (Shape A, Integration): PR opened + CI running → `Progress+Gated` empty run held, no re-wake fires → CI completes, PR merges → next sweep re-wakes with settled-holds context → agent verifies the merge and transitions.
- Common path (Shape B, execution): agent pushes and claims Done in one turn → `Done+Gated` arrives and completes the Progress wake → the snooze holds nothing (scope), audit dispatches; a premature claim beside red CI is the Review's `Revise`.
- Timing: each of the four misorderings above produces its table outcome, no manual repair.
- Restart mid-hold: kill wakery → post-restart consults hold correctly from rows alone.

## References

- the 2026-07-29 conduction defect-harvest research record §F2 — the orphan class this design makes unrepresentable.
- `docs/research/research_20260729_openclaw-turn-signal-verification/research.md` — the turn-end signal that turned resume into re-wake.
- `spec_wakery-dispatch-worker.md` (admission consult, empty-run recovery, timeout sweep home), `spec_wakery-rewake-message.md` (settled-holds context), `spec_wakery-queue-and-leases.md`, `specs/data/spec_database.md` §7/§8, `spec_wakery-conduction-chaining.md` (branch binding).
- `TASK.md §Enforcement` — the Progress → Done CI-green duty (the policy line this design leans on).
- Superseded by this revision: the snooze-worker model (pause/resume, parked adoption, supersession, resume sends) recorded in this file's git history, and `spec_wakery-resume-message.md` (now `superseded/`, folded into the re-wake template).
