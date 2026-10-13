# Vork Events

The analytical event system — the project's observability and traceability layer. Runtime events are append-only JSONL records, never DB rows — Wakery's home: `<deployment surface>/apps/wakery/var/events/wakery-YYYY-MM-DD.jsonl` (per-release worktree partitioning; pre-cutover history under `main/apps/wakery/var/events/`). Foundry's manifests: `<foundry-var>/runs/<project_key>/run_<ts>/manifest.json` (`specs/apps/foundry/spec_foundry-data.md §Manifest`). Resolver emits no events in v1. The `event` entity (`specs/data/spec_database.md` §6) is the definition registry. Code series are allocated per emitting mechanism; a code, once assigned, is never renumbered — retired codes stay reserved.

## Emitted runtime event record

Each emitted runtime event is a JSON object.

Top-level fields currently supported:
- `event_id`
- `event_code`
- `event_name`
- `event_type`
- `severity`
- `timestamp`
- `request_id`
- `project_id`
- `task_id`
- `task_key`
- `state_key`
- `wake_id`
- `actor` — one of `owner`, `assignee`, `auditor`. Optional; populated on dispatch-pipeline events (`wake.route.resolved`, `wake.parked`, `wake.dispatch.capacity_rebound`, `wake.dispatched`, `openclaw.dispatch.*`) and on any other event where the actor is relevant for diagnosis. Matches the `route.actor` DB column and the `actor` field on the dispatched wake message. Source of truth is the eligibility matrix in `spec_wakery-ingress-api.md` Stage 4.
- `route_id`
- `wake_route_lease_id`
- `message`
- `payload`

### Payload rules
- keep payload flat
- use stable names consistently
- include only diagnostic/supporting fields that are useful for later debugging

## Event code appendix

### Ingress lifecycle (1000 series)

| Code | Name | Severity | Notes |
|---:|---|---|---|
| 1001 | `wake.request.received` | info | Stage 1 received a request. |
| 1002 | `wake.request.rejected` | warn | Request shape/required field validation failed. |
| 1003 | `wake.request.dropped_ineligible` | info | Request failed eligibility and was dropped before storage. Also carries the PR-origin `issue_comment` guard's drop (`spec_wakery-github-adapter.md` — payload `reason: pull_request_comment`): every pull request is an issue, and transition-shaped comments on PRs must never mint wakes. |
| 1004 | `wake.created` | info | New wake entity created with initial status `queued`. |
| 1005 | `wake.updated` | info | Existing wake entity updated. |
| 1006 | `wake.lease.completed_by_task_progression` | info | **Retired**: task progression never completes leases (two-ledger rule). Replaced by 1019 for the wake side; lease completion is 2007 with its gateway-derived `cause`. Code stays reserved. |
| 1007 | `wake.created.pending` | info | New wake entity created with initial status `pending` because the request carried `task_status_expected` / `task_audit_expected` hints that disagreed with the observed upstream values. |
| 1008 | `wake.pending.refreshed` | info | Ingress same-state update path: a fresh request for the same `task_key` and `state_key` reported a fully-synced state (no hint or hint agrees with observed) while the existing open wake was `pending`. `queue_attempts` reset to `0`; `status` left unchanged. Re-opens the dispatch worker's field-sync attempt budget for a wake that may have been frozen by `WAKERY_PENDING_MAX_ATTEMPTS`. The `pending → queued` transition remains exclusively the dispatch worker's responsibility. |
| 1009 | `wake.request.principal_handled` | info | A state whose responsible actor (state-based or identity-resolved) is the principal was handled without dispatch. Primary emitter is ingress (no wake stored); the field-sync sweep also emits it (`trigger: field_sync`) when a hint-lagged terminal graduation resolves the owner to the principal — the row is completed instead of queued so a Principal-owned chain cue never dispatches (`spec_wakery-dispatch-worker.md` Stage 0). Records lifecycle, audit, resolved actor identity, and the disambiguating `reason` (`state_based` for cases like `Todo:Govern`, `identity_based` for identity-resolved cases). Distinct from `wake.request.dropped_ineligible` so principal-handled work is greppable as its own audit-trail entry. |
| 1010 | `wake.request.dropped_not_a_task_issue` | warn | GitHub adapter Stage 6 observed an `issue_comment` event for an issue with **zero** `type:*` labels. The issue is not a Task; no `WakeRequest` is built. Payload includes the issue URL and the full set of labels observed for operator audit. Expected behavior on a project repository holding non-Task issues alongside Task issues. Severity is `warn` (E3, `spec_wakery-task-type-registry.md §R4`): a drop silently stalls a dispatch, so it must surface above the high-volume `info` stream. |
| 1011 | `wake.request.dropped_unknown_task_type` | warn | GitHub adapter Stage 6 observed an issue with **exactly one** `type:*` label whose value is not in the canonical Task-type set (the `task_type_label` table — the runtime authority per `spec_wakery-task-type-registry.md §R2`; `docs/conventions/constants.md §Task types` is its human-readable reflection). Payload includes the offending label and the issue URL. Severity is `warn` (E3, §R4) — a valid-but-unregistered type dropped silently is the silent-stall failure mode; `warn` makes the remaining drift-drops loud. |
| 1012 | `wake.request.dropped_ambiguous_task_type` | warn | GitHub adapter Stage 6 observed an issue with **more than one** `type:*` label (any combination of canonical and non-canonical). Wakery refuses to infer intent from ambiguous input. Payload includes the full set of `type:*` labels observed and the issue URL; operator must remove duplicates from the issue. Severity is `warn` (E3, §R4) so the stalled dispatch is visible. |
| 1013 | `wake.task_relations.refreshed` | info | The task-relations refresher rebuilt a wake's `task_relations` summary from live GitHub state (`spec_wakery-task-relations.md`). |
| 1014 | `wake.task_relations.refresh_error` | error | The task-relations refresh failed; the wake keeps its prior summary. |
| 1015 | `wake.request.dropped_stale_webhook` | warn | GitHub adapter Stage 6a (#76) dropped a delayed/stale webhook delivery: the comment's lifecycle `To:` is not consistent with the current observed state (not the state itself nor one legal step ahead — see `isReachableOrSame`) **and** the comment predates the current-state wake. Drops the #69 late-webhook class that could resurrect a superseded state. Legitimate backward transitions (the redo pass `Done+Revise→Progress+Gated`, reclaim `Pending→Init`) stay reachable-from-current and are not dropped. Payload: `issue_url`, `intended_to`, `observed_state`, `comment_created_at`, `current_wake_create_time`. |
| 1016 | `wake.chain.terminal_cue` | info | A terminal transition (`Completed`/`Cancelled`) materialized an owner-lane chain-cue wake (`spec_wakery-conduction-chaining.md` Stage 2). Two emission points, disambiguated by `trigger`: ingress at cue storage (`observed`), and the field-sync sweep at hint-lagged terminal graduation (`field_sync` — `spec_wakery-dispatch-worker.md` Stage 0 terminal-graduation gate). Payload: `task_type`, terminal state, `task_branch`, `trigger`. The chain audit trail: every top-level terminal transition on a conducted project pairs with one of these (or a `principal_handled`/`dropped_ineligible` suppression) regardless of field lag. |
| 1018 | `wake.terminal.cleanup_on_close` | info | `issues.closed` handler completed the open wake for a closed Task issue. Payload `kind`: `chain_ack` — a dispatched terminal cue acknowledged by its conduction consumer (the close is Sarge's ack; under the two-ledger rule this completes the **wake** only — the cue turn's lease completes at its own turn end); `straggler` — a leftover non-terminal open wake completed on the same close. A pre-dispatch cue is left to reach its consumer. |
| 1020 | `wake.govern.cue` | info | A state-based Govern arrival stored its notification cue wake — emitted beside 1009's `state_based` entry. Payload: task, gate (`Todo:Govern` \| `Done:Govern`). The checkpoint-notice audit trail: every Govern arrival pairs one 1009 with one 1020. |
| 1019 | `wake.completed_by_task_progression` | info | Prior open wake(s) for a `task_key` completed because a later request showed progression (`spec_wakery-ingress-api.md` Stage 3). Carries `trigger`: `"observed"` (canonical moved) or `"hint"` (transition-comment hints disagreed with lagging canonical). Wake ledger only — the successor of retired 1006; carries no lease semantics. |
| 1017 | `wake.branch.unresolved` | warn | Wake build could not resolve `task_branch` (own `linkedBranches`, parent hop, Blocked-by hop all empty — `spec_wakery-conduction-chaining.md` Stage 3). Payload: `reason` (`no_link` \| `ambiguous` \| `query_failed`). Suppressed for laneless task types (`project_operation`, `project_deployment`, `dbops`), whose NULL branch is by design. |

### Dispatch worker lifecycle (2000 series)

| Code | Name | Severity | Notes |
|---:|---|---|---|
| 2001 | `wake.selected` | debug | Worker selected a wake for Stage 2 processing (either sweep). |
| 2002 | `wake.route.resolved` | info | Route found for wake. |
| 2003 | `wake.parked` | warn | No valid route found; wake stored in parked state. |
| 2004 | `wake.dispatch.capacity_rebound` | info | Route resolved but capacity was exhausted; wake stays `queued`, `dispatch_attempts` and `update_time` bumped.  |
| 2005 | `wake.dispatched` | info | A turn was started: lease created, send accepted by the gateway. Payload carries `wake_attempts` and `template` (`wake` \| `rewake`), plus the lease id (= runId). |
| 2006 | `wake_route_lease.created` | info | Active lease created. |
| 2007 | `wake_route_lease.completed` | info | Lease completed. Payload carries the gateway-derived `cause`: `lifecycle_end` \| `lifecycle_error` (the watcher), `reconcile_ok` \| `reconcile_error` \| `reconcile_never_started` (`agent.wait` verdicts), or `send_failed`. The only completion causes that exist — wake arrivals never complete leases. |
| 2010 | `wake.field_sync.resolved` | info | Field-sync sweep observed upstream catch up to the expected hint values; wake graduated from `pending` to `queued`. |
| 2011 | `wake.field_sync.retried` | info | Field-sync sweep re-checked a `pending` wake and the upstream values still did not match the expected hint; `queue_attempts` incremented, wake stayed `pending`. |
| 2012 | `wake.field_sync.timeout` | warn | Field-sync sweep exhausted the per-wake retry budget; wake stays `pending` indefinitely until external reconciliation. Emitted exactly once per wake. |
| 2013 | `wake.field_sync.error` | error | Upstream source-of-truth read failed during field-sync (network/auth/etc). `queue_attempts` not incremented; sweep retries on the next interval. |
| 2014 | `wake.dispatch.parked_on_error` | error | The dispatch attempt threw a **render failure** (e.g. routed to an agent with no `github_agent` row → `render failed … unresolved [github_agent]`). The wake is **parked** so one un-renderable wake cannot abort the whole dispatch cycle. Lease released; payload carries `route_id`, `actor`, and the `error` message. Only render failures park here — a downstream/send failure leaves the wake `queued` per Stage 3 recovery. |
| 2016 | `wake.rewake.dispatched` | info | Empty-run re-dispatch marker, emitted beside 2005 when `wake_attempts > 1` — grep-able by name per the event-vocabulary convention. Payload mirrors 2005 plus `last_turn_minutes_ago`. |
| 2017 | `wake.rewake.max_attempts` | warn | `wake_attempts` reached `WAKERY_REWAKE_MAX_ATTEMPTS`; the wake leaves the selection pool permanently and only external reconciliation moves it. Emitted exactly once per wake — the surfacing/alert hook for the escalation path. |
| 2018 | `wake.chain.terminal_verified` | info | The terminal verifier completed a cue wake locally: the live issue is closed but the `issues.closed` event was lost (`spec_wakery-dispatch-worker.md` Stage 5). The relocated 4008 — same meaning, new emitter; 4008 stays reserved. |
| 2019 | `wake.dispatch.hold_deferred` | info | Admission deferred by the snooze hold predicate (`spec_wakery-snooze.md` Stage 2): payload carries the holding types, branch, and the wake's state — so a held branch reads as *held* in the log, not stalled. `dispatch_attempts` bumped, `wake_attempts` untouched. |
| 2020 | `wake.board_sweep.minted` | info | Board-reconcile sweep minted a wake for an actionable task with no open wake/lease (`spec_wakery-board-sweep.md`). |
| 2021 | `wake.board_sweep.error` | error | A sweep pass failed for a project; next tick retries. |
| 2022 | `wake.cap_alert.dispatched` | info | Cap-alert final wake dispatched at the re-wake cap (`spec_wakery-cap-alert-message.md`); the wake then exits the pool. |
| 2023 | `wake.stall.alarmed` | warn | Full-stop stall detected; synthetic confession wake stored (`spec_wakery-stall-notice-message.md`). |
| 2024 | `wake.stall.cleared` | info | Stall condition cleared; the standing stall wake completed by the sweep. |
| 2015 | `wake.field_sync.phantom_terminated` | warn | Field-sync backstop (#76): a `pending` wake whose expected lifecycle position is already behind the observed current state (the task moved past what it was waiting for) is self-terminated (`status = completed`) instead of retried to timeout. Payload: `task_status_expected`, `observed_task_status`. (2014 is reserved by `wake.dispatch.parked_on_error`; 2015 avoids a code collision.) |

### OpenClaw dispatch lifecycle (3000 series)

| Code | Name | Severity | Notes |
|---:|---|---|---|
| 3001 | `openclaw.dispatch.attempted` | info | Stage 3 attempting downstream dispatch. |
| 3002 | `openclaw.dispatch.blocked_unauthorized_delivery` | warn | Route delivery type modeled but not authorized in MVP. |
| 3003 | `openclaw.dispatch.sent` | info | Message sent to existing downstream session. |
| 3004 | `openclaw.dispatch.failed` | error | Downstream dispatch failed. Payload `reason`: `send_failed` \| `timeout` \| `link_down`. The worker completes the lease `send_failed` and the wake retries with a fresh lease. |
| 3005 | `link.connected` | info | Gateway link established and authenticated (`hello-ok`); subscriptions issued. Payload: server version, protocol. |
| 3006 | `link.disconnected` | warn | Gateway link dropped. Payload: cause. Reconnect with backoff follows. |
| 3007 | `link.reconnect.attempt` | debug | Re-dial attempt. Payload: attempt number, current backoff. |
| 3008 | `link.reconciled` | info | Bulk reconcile after (re)connect completed. Payload: open leases checked, completed per verdict, left running. Also emitted by the quiet-lease reconcile pass when it acted. |

### Probe worker lifecycle (4000 series) — RETIRED

The probe worker and its blind-nudge model are retired; the entire series is reserved and no longer emitted. Turn supervision is the dispatch worker's fact-based reconcile (3008 carries its outcomes); ended-empty turns take the re-wake path (2016/2017); the terminal verifier's completion relocated to 2018.

| Code | Name | Status |
|---:|---|---|
| 4001–4007 | `probe.*` | retired, codes reserved |
| 4008 | `probe.lease.terminal_completed` | retired; relocated to 2018 |

### Snooze lifecycle (6000 series)

Emitted by the snooze module (`spec_wakery-snooze.md`): intake events from the ingress process, the timeout flip from the dispatch worker's tick. The consult predicate itself emits nothing — the dispatch worker's `wake.dispatch.hold_deferred` (2019) is the hold's observable.

| Code | Name | Severity | Notes |
|---:|---|---|---|
| 6001 | `snooze.created` | info | Claimed start event upserted an `active` row on `snooze_key` (create or re-arm). No correlation happens at intake. Payload: `type` (registry name), `snooze_key`, branch, correlation value. |
| 6002 | `snooze.parked` | info | **Retired**: intake does not correlate, so no event waits for a wake. Code reserved. |
| 6003 | `snooze.adopted` | info | **Retired**: adoption retired with the parked state. Code reserved. |
| 6004 | `snooze.completed` | info | The type's end event settled the hold. Outcome never read. |
| 6005 | `snooze.revoked` | info | **Retired**: supersession retired — a predicate that matches nothing already holds nothing. Code reserved. |
| 6006 | `snooze.timeout` | warn | Self-relief past `WAKERY_SNOOZE_TIMEOUT_MS` — a lost signal or hung external process. Flipped by the dispatch worker's tick sweep (bookkeeping; the predicate expires rows lazily). Emitted exactly once per row. |
| 6007 | `snooze.resume.dispatched` | info | **Retired**: no resume send exists — re-engagement is the empty-run re-wake (2005/2016), whose settled-holds context carries what this event used to. Code reserved. |
| 6008 | `snooze.event.unmatched` | debug | A registered type's event matched nothing actionable: end event with no matching row, or standing-branch noise (`dev`/`main`). Expected in steady state at low volume. |

### Template lifecycle (5000 series)

| Code | Name | Severity | Notes |
|---:|---|---|---|
| 5001 | `wakery.template.loaded` | info | Template artifact loaded and validated. Payload carries `template_name`, `path`, and `phase` (`startup` or `reload`). |
| 5002 | `wakery.template.load_failed` | fatal | Startup load of a template artifact failed (file missing, malformed JSON, or schema validation rejected). Wakery process exits non-zero. Emitted exactly once per failing file at startup. |
| 5003 | `wakery.template.reload_failed` | error | Hot-reload of a template artifact failed (malformed JSON or schema rejection). Last-good template stays in service; dispatch unaffected. Operator must save a valid version to recover. |
| 5004 | `wakery.template.render_failed` | error | Per-render failure: a required placeholder was null, or an un-substituted `{{...}}` token survived substitution. Payload carries `wake_id`, the missing placeholder name (or surviving token), and the full render context. The renderer throws to the caller; the OpenClaw adapter handles lease release and wake-state per `spec_wakery-openclaw-adapter.md §Stage 3a`. |
| 5005 | `wakery.template.state_fallback_used` | info | No exact `(actor, task_status, task_audit)` state block matched; the default block was used. Payload carries the unmatched tuple so operators can decide whether to add an explicit block. |

## Notes

- a system needing searchable event storage designs it as a separate subsystem — never silently overloaded onto the JSONL surface



## References

- `specs/data/spec_database.md` — the `event` definition entity, constants ownership
- Emitting mechanisms: `specs/apps/wakery/spec_wakery-ingress-api.md` (1000), `spec_wakery-dispatch-worker.md` (2000), `spec_wakery-openclaw-adapter.md` (3000), `spec_wakery-template-renderer.md` (5000), `spec_wakery-snooze.md` (6000), `spec_wakery-board-sweep.md` + `spec_wakery-cap-alert-message.md` (2020–2024), `spec_wakery-conduction-chaining.md` (1016–1018)
