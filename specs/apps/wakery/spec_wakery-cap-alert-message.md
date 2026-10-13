# Wakery Cap Alert Message

## Introduction

The **cap-alert message** is the template behind the cap-alert final wake: when a wake's `wake_attempts` reaches `WAKERY_REWAKE_MAX_ATTEMPTS`, the dispatch worker starts **one additional one-duty turn** on the wake's own route, and this template is what that turn receives. Its single instruction: report the blockage and its cause to the Principal per `DELIVERY.md §Communication`, then end the turn. Artifacts: this spec + `apps/wakery/templates/cap-alert-message.json` (renderer per `spec_wakery-template-renderer.md`).

## Purpose

A capped wake holds a diagnosis nobody has heard: the re-wake turns end at the cap and the system goes correctly, deliberately silent — the machinery is not the gap, **the delivery of its conclusion is**. The `2017` event is the machine record of the cap; this turn is its human delivery — the agent who already holds the diagnosis hands it to the Principal instead of going quiet.

## Placeholders

Shared map per `spec_wakery-wake-message.md §Placeholders`, plus the re-wake counters (`spec_wakery-rewake-message.md`): `{{wake_attempts}}`, `{{rewake_cap}}`, `{{last_turn_minutes_ago}}`. All required. The settled-holds block is **not** carried — the alert delivers a conclusion; it does not resume work.

## Composition

```
[{{utc_timestamp}}] Wakery cap alert — re-wake budget exhausted, report required

Hi {{agent_name}}, you are {{agent_role}} working under github account ({{agent_github_login}}).
Project: {{project_name}}  (board: {{project_url}}, repo: {{repo_full_name}})
Issue: {{issue_url}}

Task #{{task_id}} ({{task_type}}, "{{task_title}}") is parked at {{task_status}}:{{task_audit}} and has consumed its re-wake budget: {{wake_attempts}} turns of {{rewake_cap}} started without the task progressing. The last turn ended {{last_turn_minutes_ago}} minutes ago. Wakery will not re-wake this task again — without intervention it stays exactly where it is.

Your one duty this turn, per DELIVERY.md §Communication: report the blockage to the Principal over the designated channel (your TOOLS.md §Channel) — the task reference, its current state, what has blocked progress (read your own prior turns' comments on the issue for the cause you already diagnosed), and what intervention would unblock it. Then end your turn. Do not retry the blocked work, do not transition the task — conduction resumes on external reconciliation (a progression, or the Principal's action).

Wake context:
wake_id={{wake_id}}
task_id={{task_id}}
task_type={{task_type}}
task_status={{task_status}}
task_audit={{task_audit}}
task_title={{task_title}}
```

## Invariants

- Dispatched exactly at the cap (`wake_attempts == WAKERY_REWAKE_MAX_ATTEMPTS`, empty-run path only); the alert send consumes the wake past the cap, after which it leaves the selection pool permanently. A failed alert send leaves the attempts at the cap and retries on the next sweep.
- The alert turn **bypasses the snooze consult**: a hold guards execution; it must never defer the report of the blockage.
- Emitted beside `wake.dispatched` as `2022 wake.cap_alert.dispatched`; `2017` stays the machine record.
- Govern cue wakes never reach this path (exempt from empty-run recovery upstream).
- Render aborts on any missing placeholder.

## References

`spec_wakery-dispatch-worker.md` (Stage 5 guards, template selection), `spec_wakery-rewake-message.md` (the counters), `specs/data/spec_event.md`, `DELIVERY.md §Communication`.
