# Wakery Stall Notice Message

## Introduction

The **stall-notice message** is the template behind the stall alarm's confession turn (`spec_wakery-board-sweep.md §Stall alarm`): when a project sits at a full stop — open non-terminal tasks, zero open wakes, zero open leases — past `WAKERY_STALL_THRESHOLD_MS`, the board sweep stores one synthetic owner-lane wake, and this template is what that turn receives. Its single instruction: send the stall notice to the Principal per `DELIVERY.md §Communication`, then end the turn. Artifacts: this spec + `apps/wakery/templates/stall-notice-message.json`.

## Purpose

The floor beneath the board-reconcile sweep: the sweep repairs absences it can act on, but a task the eligibility matrix cannot name, an ingress drop, or a GitHub read failure can leave a project where *nothing is scheduled to move and nothing will report it*. The alarm converts "full stop" from something the Principal discovers by watching into something the system confesses. It confesses only — the turn performs no repairs; the residual (an agent doing a *wrong* act rather than none) stays with the audit gates.

## The synthetic wake

The alarm's carrier is a wake row the sweep writes directly (no ingress, no GitHub task behind it): `task_id = wakery-stall-alarm` (one per project by `task_key` dedupe), label `wakery:stall_alarm`, `task_type = project_operation` (laneless), state `Pending:Approved` — the matrix's wildcard `Pending → owner` lane routes it through the project's owner fallback route, so the conductor's turn sends the notice. The stall facts ride `task_payload` (`open_task_count`, `stalled_minutes`). The wake is **exempt from empty-run re-wake** (one confession suffices) and is **completed by the sweep itself** when the stall condition clears (`2024 wake.stall.cleared`); while it stands, no second alarm can raise.

## Placeholders

Shared map per `spec_wakery-wake-message.md §Placeholders` (issue-bound placeholders like `{{issue_url}}` are not used — there is no issue), plus the payload-derived `{{open_task_count}}` and `{{stalled_minutes}}`. All required; a payload missing the stall facts aborts the render.

## Composition

```
[{{utc_timestamp}}] Wakery stall alarm — {{project_name}} is at a full stop

Hi {{agent_name}}, you are {{agent_role}} working under github account ({{agent_github_login}}).
Project: {{project_name}}  (board: {{project_url}}, repo: {{repo_full_name}})

The board shows {{open_task_count}} open task(s), but wakery has held zero open wakes and zero open leases for this project for {{stalled_minutes}} minutes. Nothing is scheduled to move: the event stream produced no wake and the board-reconcile sweep could not mint one. This is the system confessing a full stop, not asking you to fix it.

Your one duty this turn, per DELIVERY.md §Communication: send the stall notice to the Principal over the designated channel (your TOOLS.md §Channel) — the project, the open-task count, the stall duration, and a one-line survey of where the open tasks sit (read the board: {{project_url}}). Then end your turn. Do not transition tasks, do not attempt repairs — conduction resumes on the Principal's direction.

Wake context:
wake_id={{wake_id}}
project_id={{project_id}}
```

## Invariants

- Raised only by the board sweep's stall evaluation, after the pass's minting — a mint this pass already clears the condition.
- The stall counts exclude the synthetic wake and its own turn's lease — the confession never reads as activity.
- One standing stall wake per project; raised at `2023 wake.stall.alarmed` (warn), completed at `2024 wake.stall.cleared`.
- The turn confesses; it never transitions tasks or repairs state.
- Render aborts on any missing placeholder.

## References

`spec_wakery-board-sweep.md §Stall alarm`, `spec_wakery-dispatch-worker.md` (template selection, empty-run exemption), `specs/data/spec_event.md`, `DELIVERY.md §Communication`.
