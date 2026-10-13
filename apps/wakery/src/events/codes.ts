export const EVENT_CODES = {
  REQUEST_RECEIVED: { code: 1001, name: 'wake.request.received', severity: 'info' },
  REQUEST_REJECTED: { code: 1002, name: 'wake.request.rejected', severity: 'warn' },
  REQUEST_DROPPED_INELIGIBLE: { code: 1003, name: 'wake.request.dropped_ineligible', severity: 'info' },
  WAKE_CREATED: { code: 1004, name: 'wake.created', severity: 'info' },
  WAKE_UPDATED: { code: 1005, name: 'wake.updated', severity: 'info' },
  // 1006 wake.lease.completed_by_task_progression is RETIRED
  // (milestone_wakery-turn-signal_v2026.07.29): task progression no longer
  // completes leases (two-ledger rule). 1019 carries the wake side; lease
  // completion is 2007 with its gateway-derived cause. Code stays reserved.
  WAKE_CREATED_PENDING: { code: 1007, name: 'wake.created.pending', severity: 'info' },
  WAKE_PENDING_REFRESHED: { code: 1008, name: 'wake.pending.refreshed', severity: 'info' },
  // Codes 1009-1012 are spec-reserved (spec_wakery-events.md):
  //   1009 = wake.request.principal_handled (T8)
  //   1010 = wake.request.dropped_not_a_task_issue (T9)
  //   1011 = wake.request.dropped_unknown_task_type (T9)
  //   1012 = wake.request.dropped_ambiguous_task_type (T9)
  // The task_relations.* codes were assigned 1009/1010 in pre-spec code; bumped
  // to 1013/1014 to free the spec range. Spec needs a new entry for these two.
  REQUEST_PRINCIPAL_HANDLED: { code: 1009, name: 'wake.request.principal_handled', severity: 'info' },
  // Task-type drops are `warn`, not `info` (E3, #54, spec_wakery-task-type-registry §R4):
  // each silently stalls a dispatch (the issue never moves), so it must surface above
  // the high-volume info stream. `warn` matches the sibling "refused to proceed" events
  // (1002 rejected, 2003 parked, 3002 blocked); these are correct rejections, not system
  // faults, so they are not `error`.
  REQUEST_DROPPED_NOT_A_TASK_ISSUE: { code: 1010, name: 'wake.request.dropped_not_a_task_issue', severity: 'warn' },
  REQUEST_DROPPED_UNKNOWN_TASK_TYPE: { code: 1011, name: 'wake.request.dropped_unknown_task_type', severity: 'warn' },
  REQUEST_DROPPED_AMBIGUOUS_TASK_TYPE: { code: 1012, name: 'wake.request.dropped_ambiguous_task_type', severity: 'warn' },
  WAKE_TASK_RELATIONS_REFRESHED: { code: 1013, name: 'wake.task_relations.refreshed', severity: 'info' },
  WAKE_TASK_RELATIONS_REFRESH_ERROR: { code: 1014, name: 'wake.task_relations.refresh_error', severity: 'error' },
  // E10 (#76): a delayed/stale webhook delivery whose transition `To:` is not legal
  // from the current observed state AND whose comment predates the current-state wake
  // is dropped at ingress so it cannot resurrect an already-superseded state (the #69
  // late-webhook stuck-pending class). `warn` — a dropped delivery worth surfacing.
  REQUEST_DROPPED_STALE_WEBHOOK: { code: 1015, name: 'wake.request.dropped_stale_webhook', severity: 'warn' },
  // Conduction chaining (spec_wakery-conduction-chaining.md Stage 2): a terminal
  // transition (Completed/Cancelled) stored an owner-lane chain-cue wake. The
  // chain audit trail — every top-level terminal transition on a conducted
  // project pairs with one of these (or a principal_handled).
  WAKE_CHAIN_TERMINAL_CUE: { code: 1016, name: 'wake.chain.terminal_cue', severity: 'info' },
  // Wake build could not resolve task_branch (own linkedBranches, parent hop,
  // Blocked-by hop all empty — spec_wakery-conduction-chaining.md Stage 3).
  // Payload reason: no_link | ambiguous | query_failed. Suppressed for the
  // laneless task types (LANELESS_TASK_TYPES), whose NULL branch is by design.
  WAKE_BRANCH_UNRESOLVED: { code: 1017, name: 'wake.branch.unresolved', severity: 'warn' },
  // Terminal-ack completion: `issues.closed` is the chain consumer's final act,
  // performed after the chained work is done — it completes the closed task's
  // open wake and lease. kind=chain_ack for a dispatched terminal cue (the
  // normal ack), kind=straggler for a non-terminal wake whose transition
  // comment was lost. A pre-dispatch terminal cue survives to dispatch; the
  // probe worker's terminal net completes it against the closed issue.
  WAKE_TERMINAL_CLEANUP_ON_CLOSE: { code: 1018, name: 'wake.terminal.cleanup_on_close', severity: 'info' },
  // Two-ledger progression closure (spec_wakery-ingress-api.md Stage 3): prior
  // open wake(s) for a task_key completed because a later request showed
  // progression. Carries trigger: "observed" (canonical moved) or "hint"
  // (transition-comment hints disagreed with lagging canonical). Wake ledger
  // only — the successor of retired 1006, with every lease semantic removed.
  WAKE_COMPLETED_BY_TASK_PROGRESSION: { code: 1019, name: 'wake.completed_by_task_progression', severity: 'info' },
  // Govern notice (milestone_govern-notice_v2026.08.05, spec_wakery-events.md):
  // a state-based Govern arrival (Todo:Govern | Done:Govern) stored its
  // notification cue wake — emitted beside 1009's `state_based` entry. Payload:
  // task, gate. The checkpoint-notice audit trail: every Govern arrival pairs
  // one 1009 with one 1020.
  WAKE_GOVERN_CUE: { code: 1020, name: 'wake.govern.cue', severity: 'info' },
  WAKE_SELECTED: { code: 2001, name: 'wake.selected', severity: 'debug' },
  WAKE_ROUTE_RESOLVED: { code: 2002, name: 'wake.route.resolved', severity: 'info' },
  WAKE_PARKED: { code: 2003, name: 'wake.parked', severity: 'warn' },
  WAKE_DISPATCH_CAPACITY_REBOUND: { code: 2004, name: 'wake.dispatch.capacity_rebound', severity: 'info' },
  WAKE_DISPATCHED: { code: 2005, name: 'wake.dispatched', severity: 'info' },
  LEASE_CREATED: { code: 2006, name: 'wake_route_lease.created', severity: 'info' },
  LEASE_COMPLETED: { code: 2007, name: 'wake_route_lease.completed', severity: 'info' },
  WAKE_FIELD_SYNC_RESOLVED: { code: 2010, name: 'wake.field_sync.resolved', severity: 'info' },
  WAKE_FIELD_SYNC_RETRIED: { code: 2011, name: 'wake.field_sync.retried', severity: 'info' },
  WAKE_FIELD_SYNC_TIMEOUT: { code: 2012, name: 'wake.field_sync.timeout', severity: 'warn' },
  WAKE_FIELD_SYNC_ERROR: { code: 2013, name: 'wake.field_sync.error', severity: 'error' },
  // E7 (#73): a wake whose dispatch attempt threw (canonically a render failure —
  // e.g. `unresolved [github_agent]`) is parked so one bad wake cannot abort the
  // whole dispatch cycle. `error` — the wake is stuck until the underlying data is
  // fixed; this failure mode caused the 2026-06-09 total dispatch halt.
  WAKE_DISPATCH_PARKED_ON_ERROR: { code: 2014, name: 'wake.dispatch.parked_on_error', severity: 'error' },
  // E10 (#76) backstop: a `pending` wake whose expected lifecycle position is already
  // behind the observed current state (the task moved past what it was waiting for) is
  // self-terminated instead of retried to timeout. `warn` — surfaces a phantom wake the
  // ingress stale gate did not prevent. (2014 is reserved by E7's
  // `wake.dispatch.parked_on_error` on the feature_dispatch-resilience lane; using 2015
  // here avoids a code collision at integration.)
  WAKE_FIELD_SYNC_PHANTOM_TERMINATED: { code: 2015, name: 'wake.field_sync.phantom_terminated', severity: 'warn' },
  // Empty-run re-dispatch marker (spec_wakery-dispatch-worker.md Stage 5),
  // emitted beside 2005 when wake_attempts > 1 — grep-able by name per the
  // event-vocabulary convention. Payload mirrors 2005 plus last_turn_minutes_ago.
  WAKE_REWAKE_DISPATCHED: { code: 2016, name: 'wake.rewake.dispatched', severity: 'info' },
  // wake_attempts reached WAKERY_REWAKE_MAX_ATTEMPTS; the wake leaves the
  // selection pool permanently and only external reconciliation moves it.
  // Emitted once per wake — the surfacing/alert hook for the escalation path.
  WAKE_REWAKE_MAX_ATTEMPTS: { code: 2017, name: 'wake.rewake.max_attempts', severity: 'warn' },
  // The terminal verifier completed a cue wake locally: the live issue is
  // closed but the issues.closed event was lost (Stage 5 terminal guard).
  // The relocated 4008 — same meaning, new emitter; 4008 stays reserved.
  WAKE_CHAIN_TERMINAL_VERIFIED: { code: 2018, name: 'wake.chain.terminal_verified', severity: 'info' },
  // Admission deferred by the snooze hold predicate (spec_wakery-snooze.md
  // Stage 2): payload carries the holding types, branch, and the wake's state —
  // so a held branch reads as held in the log, not stalled. dispatch_attempts
  // bumped, wake_attempts untouched.
  WAKE_DISPATCH_HOLD_DEFERRED: { code: 2019, name: 'wake.dispatch.hold_deferred', severity: 'info' },
  // Board-reconcile sweep (self-healing F1, spec_wakery-board-sweep.md): an
  // open task in an actionable state sat past the quiet threshold with no open
  // wake and no open lease — a wake was minted as if the missing webhook had
  // arrived (source: board_sweep). One per repaired absence; the sweep is
  // otherwise silent (skips carry no events, drops are ingress's own 1003/1009).
  WAKE_BOARD_SWEEP_MINTED: { code: 2020, name: 'wake.board_sweep.minted', severity: 'info' },
  // A sweep pass failed for one project (board query failure or an unexpected
  // throw); other projects in the same pass still sweep. The next pass retries
  // from scratch — the sweep holds no per-project state.
  WAKE_BOARD_SWEEP_ERROR: { code: 2021, name: 'wake.board_sweep.error', severity: 'error' },
  // Cap-alert final wake (self-healing F2b, spec_wakery-cap-alert-message.md):
  // the one-duty delivery turn dispatched when a wake reached the re-wake cap —
  // emitted beside 2005/2016. The 2017 event remains the machine record; this
  // turn is its human delivery (the outage incident's gap was delivery alone).
  WAKE_CAP_ALERT_DISPATCHED: { code: 2022, name: 'wake.cap_alert.dispatched', severity: 'info' },
  // Stall alarm (self-healing F2, spec_wakery-board-sweep.md §Stall alarm): a
  // project with open non-terminal tasks held zero open wakes and zero open
  // leases past the stall threshold — a stall-notice wake was stored. The
  // system confesses a full stop instead of the Principal discovering it.
  WAKE_STALL_ALARMED: { code: 2023, name: 'wake.stall.alarmed', severity: 'warn' },
  // The stall condition cleared (a real wake or lease appeared, or the open
  // tasks drained) — the standing stall-notice wake is completed.
  WAKE_STALL_CLEARED: { code: 2024, name: 'wake.stall.cleared', severity: 'info' },
  DISPATCH_ATTEMPTED: { code: 3001, name: 'openclaw.dispatch.attempted', severity: 'info' },
  DISPATCH_BLOCKED: { code: 3002, name: 'openclaw.dispatch.blocked_unauthorized_delivery', severity: 'warn' },
  DISPATCH_SENT: { code: 3003, name: 'openclaw.dispatch.sent', severity: 'info' },
  DISPATCH_FAILED: { code: 3004, name: 'openclaw.dispatch.failed', severity: 'error' },
  // Gateway link lifecycle (spec_wakery-openclaw-adapter.md Stage 1): one
  // persistent authenticated WebSocket per wakery process.
  LINK_CONNECTED: { code: 3005, name: 'link.connected', severity: 'info' },
  LINK_DISCONNECTED: { code: 3006, name: 'link.disconnected', severity: 'warn' },
  LINK_RECONNECT_ATTEMPT: { code: 3007, name: 'link.reconnect.attempt', severity: 'debug' },
  // Bulk reconcile after (re)connect completed — payload: open leases checked,
  // completed per verdict, left running. Also emitted by the quiet-lease
  // reconcile pass when it acted.
  LINK_RECONCILED: { code: 3008, name: 'link.reconciled', severity: 'info' },
  // The 4000 probe.* series is RETIRED with the probe worker
  // (milestone_wakery-turn-signal_v2026.07.29); codes 4001-4008 stay reserved.
  // Turn supervision is the dispatch worker's fact-based reconcile (3008); the
  // terminal verifier's completion relocated to 2018.
  //
  // Snooze lifecycle (spec_wakery-events.md 6000 series): intake events from
  // the ingress process, the timeout flip from the dispatch worker's tick.
  // Retired codes 6002 (parked), 6003 (adopted), 6005 (revoked), 6007
  // (resume.dispatched) stay reserved — intake no longer correlates, and
  // re-engagement is the empty-run re-wake.
  SNOOZE_CREATED: { code: 6001, name: 'snooze.created', severity: 'info' },
  SNOOZE_COMPLETED: { code: 6004, name: 'snooze.completed', severity: 'info' },
  SNOOZE_TIMEOUT: { code: 6006, name: 'snooze.timeout', severity: 'warn' },
  SNOOZE_EVENT_UNMATCHED: { code: 6008, name: 'snooze.event.unmatched', severity: 'debug' },
  TEMPLATE_LOADED: { code: 5001, name: 'wakery.template.loaded', severity: 'info' },
  TEMPLATE_LOAD_FAILED: { code: 5002, name: 'wakery.template.load_failed', severity: 'error' },
  TEMPLATE_RELOAD_FAILED: { code: 5003, name: 'wakery.template.reload_failed', severity: 'warn' },
  TEMPLATE_RENDER_FAILED: { code: 5004, name: 'wakery.template.render_failed', severity: 'error' },
  TEMPLATE_STATE_FALLBACK_USED: { code: 5005, name: 'wakery.template.state_fallback_used', severity: 'info' }
} as const;

// Task types with no repo lane by design (spec_wakery-conduction-chaining.md
// Stage 3 / spec_wakery-events.md code 1017): their NULL task_branch is
// expected, so the wake.branch.unresolved warn is suppressed for them.
export const LANELESS_TASK_TYPES: ReadonlySet<string> = new Set([
  'project_operation',
  'project_deployment',
  'dbops'
]);

// Stall-alarm identity (self-healing F2, spec_wakery-board-sweep.md §Stall
// alarm): the synthetic stall wake's task_id and marker label. The label
// selects the stall-notice template at render and exempts the wake from
// empty-run re-wake (one confession turn suffices); the task_id keys the
// per-project dedupe task_key and excludes the wake from the stall counts.
export const STALL_ALARM_TASK_ID = 'wakery-stall-alarm';
export const STALL_ALARM_LABEL = 'wakery:stall_alarm';
