export type Actor = 'owner' | 'assignee' | 'auditor';
export type ResponsibleActor = Actor | 'principal';

/**
 * Eligibility-and-actor matrix from spec_wakery-ingress-api.md Stage 4 — the
 * two-gate machine (docs/policy/TASK.md §Transition).
 *
 * Single source of truth for both ingress eligibility filtering and dispatch-time
 * route resolution. The dispatch worker re-derives the same value here rather
 * than storing it on the wake row so the matrix stays the only place that
 * encodes (lifecycle, audit) → actor.
 *
 * Wildcard-audit lanes: `Pending` and `Cancelled` carry the prior audit value
 * (`+*` in TASK.md §Transition) and resolve on lifecycle alone. Terminal states
 * (`Completed`, `Cancelled`) resolve to `owner` — the chain cues of
 * spec_wakery-conduction-chaining.md.
 *
 * Returns null for combinations not in the matrix (unknown states — `Rework`
 * does not exist in the two-gate machine). Returns 'principal' for states that
 * are not eligible for agent routing.
 */
export function resolveResponsibleActor(lifecycle: string, audit: string): ResponsibleActor | null {
  // Wildcard-audit lanes first (any audit value).
  if (lifecycle === 'Pending') return 'owner';
  if (lifecycle === 'Cancelled') return 'owner'; // chain cue

  switch (`${lifecycle}:${audit}`) {
    case 'Init:Gated': return 'owner';
    case 'Todo:Gated': return 'auditor';       // pre-execution queue (first gate)
    case 'Todo:Approved': return 'assignee';   // acceptance step
    case 'Todo:Revise': return 'owner';
    case 'Todo:Govern': return 'principal';
    case 'Progress:Gated': return 'assignee';  // execution lane, re-gated on entry
    case 'Done:Gated': return 'auditor';       // post-execution queue (second gate)
    case 'Done:Approved': return 'owner';      // acceptance lane
    case 'Done:Revise': return 'assignee';     // redo lane
    case 'Done:Govern': return 'principal';
    case 'Reviewed:Approved': return 'assignee';
    case 'Completed:Approved': return 'owner'; // chain cue — the only Completed arrival
    default: return null;
  }
}

/**
 * Route-actor derivation for dispatch (`spec_wakery-dispatch-worker.md`
 * Stage 2): the agent lane (`owner` | `assignee` | `auditor`) a wake's route
 * resolves through. Returns null for unmapped states.
 *
 * Govern carve-out (milestone_govern-notice_v2026.08.05): the matrix maps the
 * Govern states to `principal`, but a stored Govern wake is the notification
 * cue — "Principal (cue → Owner lane)" in the spec table — so it derives
 * actor 'owner' and reaches Sarge's owner-lane route, whose turn sends the
 * Principal's checkpoint notice (spec_wakery-govern-notice-message.md).
 */
export function resolveRouteActor(lifecycle: string, audit: string): Actor | null {
  const actor = resolveResponsibleActor(lifecycle, audit);
  if (actor === null) return null;
  if (actor === 'principal') return 'owner'; // the Govern cue rides the owner lane
  return actor;
}
