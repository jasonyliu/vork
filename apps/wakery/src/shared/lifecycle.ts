// Canonical Task lifecycle transition graph, per docs/policy/TASK.md §Transition
// (two-gate machine). The single source of truth for "is this state change legal?"
// used by the ingress stale-webhook gate and the field-sync phantom-pending
// backstop (E10, #76) to tell a real (delayed) transition from a stale one.
//
// Lifecycle-only projection of the (Lifecycle, Audit) pair transitions — audit
// transitions are a separate graph and are not modelled here (the stale gate is
// lifecycle-only; the #69 incident was a lifecycle Todo→Progress).
const LIFECYCLE_TRANSITIONS: Record<string, readonly string[]> = {
  Init: ['Todo', 'Cancelled'],
  // Todo+Approved → Progress|Pending (assignee); Todo+Revise → Init|Cancelled (owner)
  Todo: ['Progress', 'Pending', 'Init', 'Cancelled'],
  Progress: ['Done', 'Pending'],
  // Done+Approved → Reviewed|Cancelled (owner); Done+Revise → Progress|Pending (assignee redo)
  Done: ['Reviewed', 'Cancelled', 'Progress', 'Pending'],
  Reviewed: ['Completed'],
  Pending: ['Init', 'Cancelled'],
  Cancelled: ['Init'],
  Completed: []
};

/** True iff `from -> to` is an allowed one-step lifecycle transition. */
export function isLegalLifecycleTransition(from: string, to: string): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * True iff `target` is the observed state itself or one legal step ahead of it
 * — i.e. a transition *to* `target` is still consistent with where the task is
 * now. A real transition (even a backward one like the Done→Progress redo pass
 * or a still-lagging forward one) satisfies this; a stale/delayed delivery for
 * a state the task has already moved past (e.g. To=Progress while
 * observed=Reviewed) does not.
 */
export function isReachableOrSame(observed: string, target: string): boolean {
  return observed === target || isLegalLifecycleTransition(observed, target);
}
