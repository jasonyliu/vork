# Wakery Board-Reconcile Sweep

## Introduction

This spec defines the board-reconcile sweep : a periodic pass that reads each tracked project's GitHub board and mints a wake for any open task in an actionable state that has **no open wake and no open lease** past a quiet threshold — exactly as if the missing webhook had arrived.

The governing principle (`docs/research/research_20260806_conduction-self-healing/research.md` §Conclusion): **an obligation is discharged when its outcome is observable in durable truth — never when an agent's turn ends.** The GitHub board is the obligation ledger; every open task's `(Status, Audit)` pair names a responsible actor via the eligibility matrix wakery already implements. The event-driven ingress stays primary; the sweep makes *absence observable*. It subsumes as backstop: lost webhooks, deleted-comment phantoms, forgotten closeouts/acceptances, and create-without-transition (the #56/#57 stall class on a sibling project — a reclaim-created task left at `Init+Gated` with no ordered `Init → Todo`, invisible to every event-driven path).

Safety is inherited, not new: a minted request rides the full ingress path (eligibility, same-state dedup, hint-free storage, the Govern notification-cue carve-out), and the stored wake rides every dispatch gate (task-turn, Blocked, Parent, snooze admission). The sweep is idempotent by the same construction as everything else — it holds no state of its own and re-derives every pass from durable truth.

## Purpose

Between wakery's event-driven ingress and the audit gates lies one uncovered class: a task that *should* have a wake and has none. Nothing re-examines the board for tasks nobody is acting on — the stall class lives exactly where obligations have no watcher. The sweep is that watcher. The residual after sweep + alarm — an agent doing a *wrong* act rather than none — remains the audit gates' job by design.

## Scope

This spec covers:
- the sweep's candidacy rule (actionable + quiet + absent from both ledgers)
- the board read (one paginated GraphQL query per project per pass)
- request synthesis and its relationship to the webhook build path
- the tick placement, cadence knobs, and events

This spec does not cover:
- the eligibility matrix itself (`spec_wakery-ingress-api.md` Stage 4 / `src/shared/eligibility.ts`)
- ingress storage semantics (`spec_wakery-ingress-api.md` Stages 3–5)
- dispatch gating of the minted wake (`spec_wakery-dispatch-worker.md`, `spec_wakery-task-relations.md`)
- the stall-notice message content (`spec_wakery-stall-notice-message.md`)

## Definitions

- **Actionable state:** a `(Status, Audit)` pair for which `resolveResponsibleActor` returns non-null — including `principal` (a wakeless Govern state still owes its notification cue) and the terminal chain-cue arrivals.
- **Parked issue** (amended 2026-08-18, Principal-directed after the first live pass swept four intentionally parked backlog issues): an open issue with **no assignee** (`TASK.md §Mapping`) — a note that work exists for a future milestone, not a scheduled Task. Parked issues are invisible to the sweep's candidacy **and** to the stall accounting; assigning the issue is the act of scheduling.
- **Quiet:** `now − lastActivity ≥ WAKERY_BOARD_SWEEP_QUIET_MS`, where `lastActivity` is the later of the project item's `updatedAt` and the issue's `updatedAt`. The threshold absorbs webhook-in-flight races: a task that just transitioned gets its event-driven wake long before it qualifies.
- **Absent:** `wake.findCurrentByTaskKey` returns no open row (`pending`/`queued`/`parked`/`dispatched`) AND `lease.findOpenByTaskKey` returns no open lease. A task with an open lease has a turn believed running — the turn-end machinery owns what happens next.

## Procedure

### Stage 1 — Board read

One paginated GraphQL query per active `github_repo_project` row per pass (`items(first: 100)`, up to 5 pages): issue number, native issue state, repository coordinates, the `Status`/`Audit` single-select values, and both `updatedAt` clocks. Non-issue items (drafts, PRs) are ignored. A failed query emits `2021 wake.board_sweep.error` for that project and the pass continues with the others — the sweep holds no per-project state, so the next pass retries from scratch.

### Stage 2 — Candidacy

For each item, in order, skip unless: native state `OPEN`; both fields present; **the issue has an assignee** (a parked issue is never rescued); the state is actionable; the item is quiet; and the task is absent from both ledgers. The checks are ordered cheapest-first — the two ledger lookups run only for items that pass the stateless filters. The assignee check re-derives on the Stage 3 fresh read like every other candidacy input.

### Stage 3 — Synthesis and mint

A candidate gets a fresh canonical fetch (`fetchIssueState` — the same read the webhook path uses) and candidacy is re-derived from it: the board snapshot may have raced a real webhook, and any disqualification on the fresh read is a silent skip. The `type:*` label is validated against the live registry (`task_type_label`); non-ok outcomes skip **silently** — a board item without a valid type is either not a task issue or already warned about at transition time (1010–1012), and a 5-minute cadence must not turn a standing condition into a warn stream.

The synthesized `WakeRequest` carries `source: 'board_sweep'`, a `sweep_`-prefixed `request_id`, observed state only (**no transition hints** — a sweep mint is never `pending`), and the same field derivations as the webhook build: type from the label, relations from the label-gated summaries, branch from the resolution hops, owner from the issue author, assignee from the primary assignee. It is handed to the ordinary `IngressService.handleWakeRequest`.

Outcomes: `accepted` → the absence is repaired; emit `2020 wake.board_sweep.minted`. `updated` → a wake appeared in the race window; the ledger is whole, nothing recorded. `dropped` → ingress already emitted its own outcome event (1003/1009); the sweep stays silent.

### Stage 4 — Stall alarm (the floor beneath the sweep)

Evaluated per project on the same board snapshot, after the pass's minting (so a mint this pass already clears the condition). The full-stop predicate: **open non-terminal scheduled tasks > 0 AND zero open wakes AND zero open leases** — parked (assignee-less) issues excluded from the task count (a board holding only parked notes is idle by design, never a stall), and the synthetic stall wake and its own turn's lease excluded from the ledger counts, so the confession never reads as activity. The condition must persist for `WAKERY_STALL_THRESHOLD_MS` (an in-memory episode clock; a restart merely restarts it) before the alarm raises.

Raising the alarm stores one synthetic owner-lane wake (`spec_wakery-stall-notice-message.md §The synthetic wake`) and emits `2023 wake.stall.alarmed` (warn). While that wake stands, no second alarm can raise (task_key dedupe). When the condition clears — a real wake or lease appears, or the open tasks drain — the sweep completes the standing stall wake and emits `2024 wake.stall.cleared`. The stall class this catches is exactly what the sweep cannot repair: states the matrix cannot name, ingress drops, GitHub read failures. The residual — an agent doing a *wrong* act rather than none — stays with the audit gates by design.

### Stage 5 — Tick placement

The sweep is a module on the dispatch worker's tick (the stale-relations-sweep pattern): interval-gated by `WAKERY_BOARD_SWEEP_INTERVAL_MS`, run **before** the dispatch sweep so a repaired absence dispatches on the same tick, and a pass that minted counts as work for the idle-sleep decision. A non-positive interval (or an absent module) disables the sweep.

## Configuration

| Knob | Default | Meaning |
|---|---|---|
| `WAKERY_BOARD_SWEEP_INTERVAL_MS` | `300000` | Cadence of the per-project board read; `0` disables the sweep |
| `WAKERY_BOARD_SWEEP_QUIET_MS` | `180000` | Minimum idle age before a wakeless actionable task is minted for |
| `WAKERY_STALL_THRESHOLD_MS` | `1800000` | Persistence of the full-stop condition before the stall alarm raises |

All knobs ride the standard config surface (env + `wakery.json` `worker.boardSweepIntervalMs` / `worker.boardSweepQuietMs` / `worker.stallThresholdMs`).

## Events

| Code | Name | Severity | When |
|---|---|---|---|
| 2020 | `wake.board_sweep.minted` | info | A sweep-synthesized request was accepted — one per repaired absence |
| 2021 | `wake.board_sweep.error` | error | A project's pass failed (board query failure or unexpected throw) |
| 2023 | `wake.stall.alarmed` | warn | The full-stop condition persisted past the threshold — a stall-notice wake was stored |
| 2024 | `wake.stall.cleared` | info | The stall condition cleared — the standing stall wake completed |

The sweep is otherwise silent: skips carry no events, and drops are ingress's own 1003/1009.

## Invariants

1. The sweep never stores, mutates, or completes a wake or lease directly — its only write path is the ordinary ingress service.
2. A minted request is indistinguishable from a webhook-built one downstream except by `source` and `request_id` prefix.
3. A task with an open wake or an open lease is never minted for, regardless of state or quiet age.
4. Sweep mints carry no expected-state hints and therefore never create `pending` wakes.
5. The sweep holds no cross-pass state; every pass re-derives from GitHub and the two ledgers.

## Failure / Retry / Idempotency / Recovery

A pass is crash-safe by statelessness: nothing is marked, so a re-run re-evaluates everything. Double-mint races (sweep vs. webhook) collapse in ingress — same-state dedup returns `updated` for the loser. GitHub read failures degrade to a skipped project and a `2021`; the ledger stays untouched. The sweep needs no recovery procedure of its own.

## Verification

- Replay of the sibling project's #57 incident: a task idle at `Init+Gated` past the quiet threshold with no wake and no lease → an owner-lane wake is minted, Sarge is cued, and the ordered re-queue is performed (milestone `§Verification`).
- Suite coverage: candidacy filters (open wake, open lease, non-actionable, not quiet, closed, missing fields), fresh-read re-derivation, silent type skips, ingress race to `updated`, per-project failure isolation, disabled projects, and the tick's interval gate (`test/board-sweep.test.ts`).
