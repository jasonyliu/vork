// Snooze type registry — the code half of the two-part registry
// (spec_wakery-snooze.md §Type registry). The value set (valid integers
// and their one-word names) is documented in spec_wakery-contracts.md
// §snooze_type semantics; this module carries each type's behavior: which
// source events start/end it, how an event correlates to a task, and what
// lands in snooze_payload. The task-type constraint is NOT here — it is the
// snooze_task_type table's rows, applied inside the consult predicate
// (contracts §10; intake performs no correlation).

export type SnoozeEventKind = 'start' | 'end';

export interface SnoozeSourceEvent {
  // The type this event belongs to, and whether it starts or ends a hold.
  type: SnoozeTypeDef;
  kind: SnoozeEventKind;
}

export interface SnoozeTypeDef {
  /** Integer code per contracts §snooze_type semantics. Stored on the row. */
  type: number;
  /** One-word registry name, rendered in events and messages. */
  name: string;
  /**
   * The state this type holds — stored on the row at arrival, known before
   * any wake is found. CI/PR hold the execution lane: `Progress+Gated` is the
   * two-gate machine's execution state (TASK.md §Transition re-gate rule —
   * entering Progress resets Audit to Gated; no `Progress+Approved` state
   * exists in the machine).
   */
  expectedState: { task_status: string; task_audit: string };
  /**
   * Classify a webhook (event name + action + raw payload): start, end, or
   * not ours. The payload participates because a claim can be payload-scoped —
   * the CI type claims only runs of the gate workflow (workflow_run.name),
   * since .github/workflows is a generic automation surface and unrelated
   * workflows (sync jobs, doc builders) must fall through unclaimed.
   */
  classify(event: string, action: string, payload: any): SnoozeEventKind | null;
  /** The branch this event concerns — the predicate's surface vs wake.task_branch. */
  branchOf(payload: any): string | null;
  /** The correlation value identifying the external process instance (feeds snooze_key). */
  correlationValueOf(payload: any): string | null;
  /** The same correlation value read back from a stored row's snooze_payload. */
  correlationValueFromRow(row: Record<string, unknown>): string | null;
  /** The type-native payload bag stored on the row (contracts §snooze_snooze_payload). */
  buildPayload(payload: any): Record<string, unknown>;
}

const EXECUTION_STATE = { task_status: 'Progress', task_audit: 'Gated' };

// The gate-workflow convention: a conducted repo's CI gate is the one workflow
// named `CI` — the same string its required status check carries
// (PROJECT.md §Environments; provisions/github/README.md). A convention
// constant, not a lookup table; promote to data only when a real second gate
// workflow exists.
export const CI_GATE_WORKFLOW_NAME = 'CI';

// CI is sourced from `workflow_run`, NOT `check_suite`: GitHub delivers
// check_suite requested/rerequested to GitHub Apps only — a repo webhook
// receives just `completed` (live-proven 2026-07-27, milestone scope #16).
// Re-runs fire NO `requested` — only in_progress + completed (same run id,
// run_attempt incremented) — so `in_progress` as a start action is mandatory:
// it is the only start signal a re-run emits, and it re-arms the settled row
// for the same head sha via the intake's re-arm path.
const CI: SnoozeTypeDef = {
  type: 1,
  name: 'CI',
  expectedState: EXECUTION_STATE,
  classify(event, action, payload) {
    if (event !== 'workflow_run') return null;
    if (payload?.workflow_run?.name !== CI_GATE_WORKFLOW_NAME) return null; // claim guard
    if (action === 'requested' || action === 'in_progress') return 'start';
    if (action === 'completed') return 'end'; // any conclusion — never read
    return null;
  },
  branchOf(payload) {
    const branch = payload?.workflow_run?.head_branch;
    return typeof branch === 'string' && branch.length > 0 ? branch : null;
  },
  correlationValueOf(payload) {
    const sha = payload?.workflow_run?.head_sha;
    return typeof sha === 'string' && sha.length > 0 ? sha : null;
  },
  correlationValueFromRow(row) {
    return row.ci_head_sha == null ? null : String(row.ci_head_sha);
  },
  buildPayload(payload) {
    return {
      branch: payload?.workflow_run?.head_branch ?? null,
      ci_head_sha: payload?.workflow_run?.head_sha ?? null,
      workflow_run_id: payload?.workflow_run?.id ?? null
    };
  }
};

const PR: SnoozeTypeDef = {
  type: 2,
  name: 'PR',
  expectedState: EXECUTION_STATE,
  classify(event, action, _payload) {
    if (event !== 'pull_request') return null;
    if (action === 'opened' || action === 'ready_for_review' || action === 'reopened') return 'start';
    if (action === 'closed') return 'end'; // merged or not — never read
    return null;
  },
  branchOf(payload) {
    const branch = payload?.pull_request?.head?.ref;
    return typeof branch === 'string' && branch.length > 0 ? branch : null;
  },
  correlationValueOf(payload) {
    const number = payload?.pull_request?.number;
    return typeof number === 'number' && Number.isFinite(number) ? String(number) : null;
  },
  correlationValueFromRow(row) {
    return row.pr_number == null ? null : String(row.pr_number);
  },
  buildPayload(payload) {
    return {
      branch: payload?.pull_request?.head?.ref ?? null,
      pr_number: payload?.pull_request?.number ?? null,
      base_ref: payload?.pull_request?.base?.ref ?? null
    };
  }
};

export const SNOOZE_TYPES: readonly SnoozeTypeDef[] = [CI, PR];

export function snoozeTypeByCode(type: number): SnoozeTypeDef | null {
  return SNOOZE_TYPES.find((t) => t.type === type) ?? null;
}

/**
 * Route a webhook to the type that claims it (Stage 1: "the event source
 * selects the type from the registry; an event no type claims is ignored").
 */
export function resolveSnoozeEvent(event: string, action: string, payload: any): SnoozeSourceEvent | null {
  for (const type of SNOOZE_TYPES) {
    const kind = type.classify(event, action, payload);
    if (kind) return { type, kind };
  }
  return null;
}

// Standing branches are expected noise: their events never concern a task
// lane and are dropped with snooze.event.unmatched, never stored
// (spec_wakery-snooze.md Stage 1).
export const STANDING_BRANCHES: ReadonlySet<string> = new Set(['dev', 'main']);
