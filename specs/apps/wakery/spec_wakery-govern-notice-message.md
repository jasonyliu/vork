# Wakery Govern Notice Message

## Introduction

The **govern-notice message** is the template behind the notification cue wake: when a task arrives in a Govern audit state, ingress stores a cue wake routed to Sarge's owner lane, and this template is what his turn receives. Its single instruction: send the Principal's checkpoint notice per `DELIVERY.md §Communication`, then end the turn. Artifacts: this spec + `apps/wakery/templates/govern-notice-message.json` (renderer per `spec_wakery-template-renderer.md`).

## Purpose

Every `*:Govern` arrival — both gates, the four unconditional checkpoint classes (`SECURITY.md §Outcome`), and the R300/R994/R998/R999 escalations — is a decision reserved for the Principal that previously landed silently (a sibling project's #35). The cue turn converts the arrival into the mandated notice: task reference, which gate, the decision required, and a one-line brief from the Auditor's verdict comment. Outcome-blind toward the decision itself: the notice summons the Principal; it never argues a verdict.

## Placeholders

Shared map per `spec_wakery-wake-message.md §Placeholders`, plus: `{{gate}}` (derived: `Todo:Govern` → "pre-execution (Preview)", `Done:Govern` → "post-execution (Review)"); `{{decision_required}}` (derived from gate per `TASK.md §Transition`: the Principal's `Approved | Revise` in place of the Auditor). All required.

## Composition

```
[{{utc_timestamp}}] Wakery govern notice — Principal checkpoint reached

Hi {{agent_name}}, you are {{agent_role}} working under github account ({{agent_github_login}}).
Project: {{project_name}}  (board: {{project_url}}, repo: {{repo_full_name}})
Issue: {{issue_url}}

Task #{{task_id}} ({{task_type}}, "{{task_title}}") is parked at {{task_status}}:{{task_audit}} — the {{gate}} gate has escalated to the Principal.
Decision required: {{decision_required}}, performed by the Principal on the issue per TASK.md §Transition.

Your one duty this turn, per DELIVERY.md §Communication: send the checkpoint notice to the Principal over the designated channel (your TOOLS.md §Channel) — task reference, the gate, the decision required, and a one-line summary of the Auditor's verdict comment (read it from the issue). Then end your turn. Do not transition the task, do not argue the verdict, do not wait for the reply — conduction resumes on the Principal's own transition.

Wake context:
wake_id={{wake_id}}
task_id={{task_id}}
task_type={{task_type}}
task_status={{task_status}}
task_audit={{task_audit}}
task_title={{task_title}}
```

## Invariants

- Sent only for state-based Govern cue wakes; selected by the dispatch worker when the wake's `task_audit = 'Govern'` (takes precedence over wake/re-wake selection).
- One notice turn per Govern arrival: Govern-state wakes are **exempt from empty-run re-wake recovery** (`spec_wakery-dispatch-worker.md` Stage 5) — the wake legitimately awaits the Principal, not an agent, and completes by progression when the verdict lands.
- The notice carries no verdict recommendation; outcome-blind toward the decision.
- Render aborts on any missing placeholder.

## References

`spec_wakery-ingress-api.md` (the Govern carve-out), `spec_wakery-dispatch-worker.md` (template selection, empty-run exemption), `specs/data/spec_event.md`, `DELIVERY.md §Communication`, `SECURITY.md §Outcome`.
