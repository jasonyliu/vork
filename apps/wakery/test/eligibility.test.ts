import { describe, expect, test } from 'vitest';
import { resolveResponsibleActor, resolveRouteActor } from '../src/shared/eligibility.js';
import { isLegalLifecycleTransition, isReachableOrSame } from '../src/shared/lifecycle.js';

// Two-gate eligibility matrix — spec_wakery-ingress-api.md Stage 4, derived from
// docs/policy/TASK.md §Transition. The table below IS the spec table; a drift
// between the two is a defect in whichever moved without the other.
describe('eligibility: two-gate matrix (spec_wakery-ingress-api.md Stage 4)', () => {
  const MATRIX: Array<[string, string, string]> = [
    ['Init', 'Gated', 'owner'],
    ['Todo', 'Gated', 'auditor'],       // first gate
    ['Todo', 'Approved', 'assignee'],   // acceptance
    ['Todo', 'Revise', 'owner'],
    ['Todo', 'Govern', 'principal'],
    ['Progress', 'Gated', 'assignee'],  // execution lane, re-gated on entry
    ['Done', 'Gated', 'auditor'],       // second gate
    ['Done', 'Approved', 'owner'],      // acceptance lane
    ['Done', 'Revise', 'assignee'],     // redo lane
    ['Done', 'Govern', 'principal'],
    ['Reviewed', 'Approved', 'assignee'],
    ['Completed', 'Approved', 'owner']  // chain cue — only arrival
  ];

  test.each(MATRIX)('%s:%s → %s', (lifecycle, audit, actor) => {
    expect(resolveResponsibleActor(lifecycle, audit)).toBe(actor);
  });

  test.each(['Gated', 'Approved', 'Revise', 'Govern'])(
    'Pending:%s → owner (wildcard audit — Pending carries the prior verdict)',
    (audit) => {
      expect(resolveResponsibleActor('Pending', audit)).toBe('owner');
    }
  );

  test.each(['Gated', 'Approved', 'Revise', 'Govern'])(
    'Cancelled:%s → owner (chain cue — Cancelled carries its source lane audit)',
    (audit) => {
      expect(resolveResponsibleActor('Cancelled', audit)).toBe('owner');
    }
  );

  test('Rework has no row in the two-gate machine — any audit resolves null', () => {
    for (const audit of ['Gated', 'Approved', 'Revise', 'Govern']) {
      expect(resolveResponsibleActor('Rework', audit)).toBeNull();
    }
  });

  test('pre-two-gate execution row Progress:Approved is gone (lane re-gates on entry)', () => {
    expect(resolveResponsibleActor('Progress', 'Approved')).toBeNull();
  });

  test('resolveRouteActor maps the Govern cue to the owner lane and drops unmapped states', () => {
    // Govern carve-out (milestone_govern-notice_v2026.08.05): the matrix says
    // "Principal (cue → Owner lane)" — the stored notification cue wake
    // derives actor 'owner' so it reaches Sarge's owner-lane route.
    expect(resolveRouteActor('Todo', 'Govern')).toBe('owner');
    expect(resolveRouteActor('Done', 'Govern')).toBe('owner');
    expect(resolveRouteActor('Rework', 'Approved')).toBeNull();
    expect(resolveRouteActor('Done', 'Gated')).toBe('auditor');
    expect(resolveRouteActor('Completed', 'Approved')).toBe('owner');
  });
});

describe('lifecycle: two-gate transition graph (TASK.md §Transition projection)', () => {
  test('redo pass Done→Progress is legal; Rework is gone entirely', () => {
    expect(isLegalLifecycleTransition('Done', 'Progress')).toBe(true);
    expect(isLegalLifecycleTransition('Done', 'Rework')).toBe(false);
    expect(isLegalLifecycleTransition('Rework', 'Progress')).toBe(false);
  });

  test('owner reclaim lanes: Todo→Init (Revise) and Pending→Init', () => {
    expect(isLegalLifecycleTransition('Todo', 'Init')).toBe(true);
    expect(isLegalLifecycleTransition('Pending', 'Init')).toBe(true);
  });

  test('terminal edges: Reviewed→Completed, Done→Cancelled, Cancelled→Init reopen', () => {
    expect(isLegalLifecycleTransition('Reviewed', 'Completed')).toBe(true);
    expect(isLegalLifecycleTransition('Done', 'Cancelled')).toBe(true);
    expect(isLegalLifecycleTransition('Cancelled', 'Init')).toBe(true);
    expect(isLegalLifecycleTransition('Completed', 'Init')).toBe(false);
  });

  test('stale-webhook gate semantics survive the rework removal', () => {
    // Backward redo transition stays reachable-from-current…
    expect(isReachableOrSame('Done', 'Progress')).toBe(true);
    // …while a state the task moved past does not.
    expect(isReachableOrSame('Reviewed', 'Progress')).toBe(false);
  });
});
