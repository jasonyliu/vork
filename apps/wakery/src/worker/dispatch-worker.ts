import { EVENT_CODES, STALL_ALARM_LABEL } from '../events/codes.js';
import { RenderError } from '../templates/renderer.js';
import { isReachableOrSame } from '../shared/lifecycle.js';
import { mintId } from '../shared/ids.js';
import type { EventWriter } from '../events/writer.js';
import { LeaseRepository } from '../db/lease-repository.js';
import { RouteRepository } from '../db/route-repository.js';
import { WakeRepository } from '../db/wake-repository.js';
import type { GithubAgentRepository } from '../db/github-agent-repository.js';
import type { OpenClawAdapter } from '../adapters/openclaw/adapter.js';
import type { AgentEvent, AgentWaitVerdict } from '../adapters/openclaw/link.js';
import type { TaskRelationsRefresher } from '../adapters/github/task-relations-refresher.js';
import type { SettledHold } from '../snooze/module.js';
import type { Snooze, Wake, Route, WakeRouteLease } from '../shared/types.js';

// Stage 2 of the Wakery (spec_wakery-dispatch-worker.md): the turn machine.
// The worker owns the lease ledger end to end — it is the ONLY writer of
// lease rows (two-ledger rule) — and is the gateway's standing peer: the
// lifecycle watcher completes leases on the true end of turn, reconcile
// restores lease truth from `agent.wait`, and empty runs self-heal by
// re-wake. Its narrow wake writes are the parked/dispatched status moves it
// already owns plus the terminal-verifier local completion; wakes are
// otherwise closed by ingress progression and the issues.closed handlers,
// never by this worker's lease events.

export interface FieldSyncSnapshot {
  task_status: string;
  task_audit: string;
}

export interface FieldSyncReader {
  /**
   * Read the current observed source-of-truth fields for a wake.
   * Returns null when the upstream is unreachable or the wake's source is unknown
   * (treated as a transient error; sweep retries on the next interval without
   * burning an attempt).
   */
  readCurrentFields(wake: Wake): Promise<FieldSyncSnapshot | null>;
}

// The snooze module's dispatch-worker surfaces (spec_wakery-snooze.md):
// consult predicate (pure read), tick-riding timeout sweep, settled-holds set.
export interface SnoozeSurfaces {
  consultSnoozes(wake: Wake): Promise<Snooze[]>;
  holdingTypeNames(holding: Snooze[]): string[];
  timeoutSweep(): Promise<number>;
  settledHolds(wake: Wake, sinceMs: number): Promise<SettledHold[]>;
}

/**
 * Terminal verifier (the F1 routine relocated from the retired probe worker):
 * answers "is this wake's issue really closed on GitHub?" for an empty-run
 * cue wake whose task_status is terminal. Returns true (closed — the ack
 * happened, event lost), false (open — re-wake eligible), or null (lookup
 * failed — conservative, leave for the next sweep).
 */
export type TerminalVerifier = (wake: Wake) => Promise<boolean | null>;

/** Production TerminalVerifier: resolve the wake's repo binding and read the live issue state. */
export function buildTerminalVerifier(deps: {
  githubToken: string;
  githubRepoProjectRepo: { findByProjectId(projectId: string): Promise<{ github_repo_id: string; github_project_id: string } | null> };
  fetchIssueState: (token: string, repoNodeId: string, issueNumber: number, githubProjectId: string) => Promise<{ issueState: string } | null>;
}): TerminalVerifier {
  return async (wake: Wake) => {
    const binding = await deps.githubRepoProjectRepo.findByProjectId(wake.project_id);
    if (!binding) return null;
    const issueNumber = Number(wake.task_id);
    if (!Number.isFinite(issueNumber)) return null;
    const state = await deps.fetchIssueState(deps.githubToken, binding.github_repo_id, issueNumber, binding.github_project_id).catch(() => null);
    if (!state) return null;
    return state.issueState === 'CLOSED';
  };
}

/** Lease completion causes — the only ones that exist (contracts §5). */
export type LeaseCompletionCause =
  | 'lifecycle_end'
  | 'lifecycle_error'
  | 'reconcile_ok'
  | 'reconcile_error'
  | 'reconcile_never_started'
  | 'send_failed';

export interface DispatchWorkerDeps {
  wakeRepo: WakeRepository;
  routeRepo: RouteRepository;
  leaseRepo: LeaseRepository;
  adapter: Pick<OpenClawAdapter, 'renderTurn' | 'send'>;
  eventWriter: EventWriter;
  /**
   * Terminal-graduation gate (spec_wakery-dispatch-worker.md Stage 0): when a
   * hint-lagged terminal graduates, the row becomes a chain cue whose owner
   * identity the ingress rules never examined (eligibility ran against the
   * pre-terminal observed state). The sweep re-runs the owner check here so a
   * Principal-owned chain cue never dispatches on ANY path. Required — an
   * unchecked graduation would silently reopen the hole.
   */
  githubAgentRepo: Pick<GithubAgentRepository, 'resolveByGitHub' | 'findByGitHubLogin'>;
  /**
   * Snooze surfaces (Stage 4 admission consult + the tick's timeout sweep +
   * the re-wake settled-holds context). Optional: absent means no holding is
   * possible (tests, tooling) — production wiring always provides the module.
   */
  snooze?: SnoozeSurfaces;
  /**
   * The link's `agent.wait` oracle for the reconcile paths. Optional: absent
   * disables reconcile (tests without a link).
   */
  agentWait?: (runId: string, timeoutMs?: number) => Promise<AgentWaitVerdict>;
  /** Stage 5's terminal guard. Optional: absent skips the verifier and re-wakes terminal cues directly. */
  terminalVerifier?: TerminalVerifier;
  fieldSyncReader?: FieldSyncReader;
  pendingRetryIntervalMs?: number;
  pendingMaxAttempts?: number;
  /**
   * Minimum age of `update_time` before a rebounded wake
   * (`dispatch_attempts > 0`) becomes eligible for re-selection. Also paces
   * successive re-wakes of an empty-run wake. First-time queued wakes are not
   * gated.
   */
  dispatchReboundCooldownMs?: number;
  /** WAKERY_REWAKE_MAX_ATTEMPTS: maximum agent turns started per wake. */
  rewakeMaxAttempts?: number;
  /** WAKERY_LEASE_QUIET_THRESHOLD_MS: run silence (activity_time age) before an open lease is reconcile-checked. */
  leaseQuietThresholdMs?: number;
  /** WAKERY_LEASE_RECONCILE_INTERVAL_MS: cadence of the quiet-lease reconcile check. */
  leaseReconcileIntervalMs?: number;
  /**
   * Periodic stale-relations sweep that re-queries the GitHub API for the
   * task_relations of every open Parent wake. Acts as a last-resort fallback
   * against missed `sub_issues` and `issues.closed`/`reopened` webhooks.
   * See `spec_wakery-task-relations.md` §Periodic refresh.
   */
  taskRelationsRefresher?: TaskRelationsRefresher;
  parentRelationsRefreshIntervalMs?: number;
  /**
   * Board-reconcile sweep (self-healing F1, spec_wakery-board-sweep.md):
   * interval-gated on the tick like the stale-relations sweep. Optional —
   * absent (or a non-positive interval) disables the sweep.
   */
  boardSweeper?: { runOnce(): Promise<number> };
  boardSweepIntervalMs?: number;
}

const TERMINAL_STATUSES = new Set(['Completed', 'Cancelled']);

export class DispatchWorker {
  private lastStaleRelationsSweepTime = 0;
  private lastLeaseReconcileTime = 0;
  private lastBoardSweepTime = 0;
  // Emit-once bookkeeping for the re-wake cap surfacing event (2017): the
  // wake has left the selection pool permanently, so process-lifetime dedupe
  // is exact in steady state; a restart re-emits at most once per wake.
  private readonly rewakeCapSurfaced = new Set<string>();

  constructor(private readonly deps: DispatchWorkerDeps) {}

  private get rewakeMaxAttempts(): number {
    return this.deps.rewakeMaxAttempts ?? 5;
  }

  async runOnce(): Promise<boolean> {
    // The stale-relations sweep is refresh-only and does not contribute to
    // "did some work" (a periodic refresh must not suppress the idle sleep).
    await this.maybeRunStaleRelationsSweep();
    // The board sweep runs before the dispatch sweep so a repaired absence
    // dispatches on the same tick; a mint counts as work.
    const boardMinted = await this.maybeRunBoardSweep();
    const fieldSyncDidWork = await this.runFieldSyncSweep();
    const dispatchDidWork = await this.runDispatchSweep();
    await this.maybeReconcileQuietLeases();
    // Snooze timeout flip (spec_wakery-snooze.md Stage 4) — bookkeeping only;
    // holding-correctness is the predicate's lazy expiry.
    if (this.deps.snooze) await this.deps.snooze.timeoutSweep();
    return boardMinted > 0 || fieldSyncDidWork || dispatchDidWork;
  }

  /** Board-reconcile sweep, interval-gated on the tick (self-healing F1). */
  private async maybeRunBoardSweep(): Promise<number> {
    if (!this.deps.boardSweeper) return 0;
    const interval = this.deps.boardSweepIntervalMs ?? 300_000;
    if (interval <= 0) return 0;
    const now = Date.now();
    if (now - this.lastBoardSweepTime < interval) return 0;
    this.lastBoardSweepTime = now;
    // Per-project failures are the sweeper's own events (2021); a top-level
    // throw is left to runOnce's caller like any other tick error.
    return this.deps.boardSweeper.runOnce();
  }

  // ── Gateway link surfaces (Stage 6) ───────────────────────────────────────

  /**
   * The lifecycle watcher: on an `agent` event whose runId matches an OPEN
   * lease — lifecycle end/error completes the lease (ONLY end/error: a
   * `finishing` phase is activity, and a run may broadcast no `start` at all,
   * research T8); anything else refreshes activity_time. Unknown runIds fall
   * out silently (foreign runs in shared sessions, late duplicates).
   */
  async handleAgentEvent(evt: Pick<AgentEvent, 'runId' | 'stream' | 'data'>): Promise<void> {
    if (!evt?.runId) return;
    const lease = await this.deps.leaseRepo.findOpenById(evt.runId);
    if (!lease) return;
    if (evt.stream === 'lifecycle' && (evt.data?.phase === 'end' || evt.data?.phase === 'error')) {
      await this.completeLease(lease, evt.data.phase === 'end' ? 'lifecycle_end' : 'lifecycle_error', {
        signal: 'lifecycle_event'
      });
      return;
    }
    await this.deps.leaseRepo.touchActivity(lease.id);
  }

  /**
   * The `agent` method's terminal same-request response — the auxiliary
   * completion signal, handled identically and idempotently to a lifecycle
   * end/error event.
   */
  async handleAgentFinal(runId: string, status: 'ok' | 'error'): Promise<void> {
    const lease = await this.deps.leaseRepo.findOpenById(runId);
    if (!lease) return;
    await this.completeLease(lease, status === 'ok' ? 'lifecycle_end' : 'lifecycle_error', {
      signal: 'agent_final'
    });
  }

  /**
   * Reconnect reconcile: agent.wait over ALL open leases, run before the
   * event stream is trusted after every (re)connect — events fired while
   * disconnected are gone.
   */
  async reconcileAllOpenLeases(): Promise<void> {
    const open = await this.deps.leaseRepo.findAllOpen();
    await this.reconcileLeases(open, 'reconnect');
  }

  /** Quiet-lease reconcile (the absorbed probe duty), interval-gated on the tick. */
  private async maybeReconcileQuietLeases(): Promise<void> {
    if (!this.deps.agentWait) return;
    const interval = this.deps.leaseReconcileIntervalMs ?? 60_000;
    const now = Date.now();
    if (now - this.lastLeaseReconcileTime < interval) return;
    this.lastLeaseReconcileTime = now;
    const threshold = this.deps.leaseQuietThresholdMs ?? 300_000;
    const quiet = await this.deps.leaseRepo.findQuietOpen(now - threshold);
    if (quiet.length === 0) return;
    await this.reconcileLeases(quiet, 'quiet');
  }

  /**
   * The reconcile verdict table (spec Stage 6): ok / error / never-started
   * complete the lease; gateway_draining means alive — leave it; anything
   * else (unavailable, ambiguous timeout) skips the lease until the next
   * pass. The only write is "complete the lease" — the empty-run predicate
   * reacts on the next sweep; reconcile never messages an agent.
   */
  private async reconcileLeases(leases: WakeRouteLease[], trigger: 'reconnect' | 'quiet'): Promise<void> {
    if (!this.deps.agentWait) return;
    let completedOk = 0;
    let completedError = 0;
    let completedNeverStarted = 0;
    let leftRunning = 0;
    let skipped = 0;

    for (const lease of leases) {
      const verdict = await this.deps.agentWait(lease.id, 2000);
      if (verdict.status === 'ok') {
        await this.completeLease(lease, 'reconcile_ok', { trigger });
        completedOk += 1;
      } else if (verdict.status === 'error') {
        await this.completeLease(lease, 'reconcile_error', { trigger });
        completedError += 1;
      } else if (verdict.status === 'timeout' && verdict.timeoutPhase === 'gateway_draining') {
        // Run alive and working — long turns are legal.
        leftRunning += 1;
      } else if (verdict.status === 'timeout' && verdict.timeoutPhase === 'queue' && verdict.providerStarted === false) {
        // The gateway does not know the run — never started, or ended past
        // the short retention window. Safe: the empty-run re-wake is
        // idempotent by content.
        await this.completeLease(lease, 'reconcile_never_started', { trigger });
        completedNeverStarted += 1;
      } else {
        // unavailable / ambiguous — skip until the next reconcile pass.
        skipped += 1;
      }
    }

    const acted = completedOk + completedError + completedNeverStarted > 0;
    if (trigger === 'reconnect' || acted) {
      this.deps.eventWriter.emit(EVENT_CODES.LINK_RECONCILED, {
        trigger,
        checked: leases.length,
        completed_ok: completedOk,
        completed_error: completedError,
        completed_never_started: completedNeverStarted,
        left_running: leftRunning,
        skipped
      });
    }
  }

  /**
   * Idempotent lease completion — watcher, reconcile, and send-failure
   * converge here; the 2007 event fires only on the real transition. Never
   * touches a wake (two-ledger rule).
   */
  private async completeLease(lease: WakeRouteLease, cause: LeaseCompletionCause, extra: Record<string, unknown> = {}): Promise<void> {
    const transitioned = await this.deps.leaseRepo.complete(lease.id);
    if (!transitioned) return;
    this.deps.eventWriter.emit(EVENT_CODES.LEASE_COMPLETED, {
      wake_route_lease_id: lease.id,
      wake_id: lease.wake_id,
      task_key: lease.task_key,
      route_id: lease.route_id,
      cause,
      ...extra
    });
  }

  // ── Periodic sweeps ───────────────────────────────────────────────────────

  /**
   * Periodic last-resort refresh of task_relations on every open Parent wake.
   * See `spec_wakery-task-relations.md` §Periodic refresh.
   */
  async maybeRunStaleRelationsSweep(): Promise<boolean> {
    const refresher = this.deps.taskRelationsRefresher;
    if (!refresher) return false;
    const interval = this.deps.parentRelationsRefreshIntervalMs ?? 300_000;
    const now = Date.now();
    if (now - this.lastStaleRelationsSweepTime < interval) return false;
    this.lastStaleRelationsSweepTime = now;

    const gated = await this.deps.wakeRepo.findOpenGated();
    if (gated.length === 0) return false;
    for (const wake of gated) {
      try {
        await refresher.refreshTask(wake.project_id, wake.task_id, 'periodic.stale_refresh', null);
      } catch (err) {
        // Best-effort; one failed parent must not block the rest of the sweep.
        this.deps.eventWriter.emit(EVENT_CODES.WAKE_TASK_RELATIONS_REFRESH_ERROR, {
          wake_id: wake.id,
          task_id: wake.task_id,
          project_id: wake.project_id,
          error: err instanceof Error ? err.message : String(err),
          trigger_event: 'periodic.stale_refresh'
        });
      }
    }
    return true;
  }

  // ── Stage 0 — field-sync sweep (unchanged from the pre-turn-signal design) ─

  async runFieldSyncSweep(): Promise<boolean> {
    const reader = this.deps.fieldSyncReader;
    if (!reader) return false;

    const interval = this.deps.pendingRetryIntervalMs ?? 60_000;
    const maxAttempts = this.deps.pendingMaxAttempts ?? 3;

    const candidates = await this.deps.wakeRepo.findPendingDueForSync(interval, maxAttempts);
    if (candidates.length === 0) return false;

    let didWork = false;
    for (const wake of candidates) {
      didWork = (await this.processPendingCandidate(wake, reader, maxAttempts)) || didWork;
    }
    return didWork;
  }

  private async processPendingCandidate(wake: Wake, reader: FieldSyncReader, maxAttempts: number): Promise<boolean> {
    let snapshot: FieldSyncSnapshot | null;
    try {
      snapshot = await reader.readCurrentFields(wake);
    } catch (err) {
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_FIELD_SYNC_ERROR, {
        wake_id: wake.id, task_key: wake.task_key, error: err instanceof Error ? err.message : String(err)
      });
      // Bump update_time so we don't re-hit immediately, but don't burn an attempt on operational failure.
      await this.deps.wakeRepo.update({ ...wake, update_time: Date.now() });
      return true;
    }

    if (!snapshot) {
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_FIELD_SYNC_ERROR, {
        wake_id: wake.id, task_key: wake.task_key, error: 'reader returned null'
      });
      await this.deps.wakeRepo.update({ ...wake, update_time: Date.now() });
      return true;
    }

    const expectedStatus = wake.task_status_expected;
    const expectedAudit = wake.task_audit_expected;
    const statusMatches = expectedStatus === null || snapshot.task_status === expectedStatus;
    const auditMatches = expectedAudit === null || snapshot.task_audit === expectedAudit;

    if (statusMatches && auditMatches) {
      // Terminal-graduation gate (spec_wakery-dispatch-worker.md Stage 0;
      // spec_wakery-conduction-chaining.md Stage 2): a hint-lagged terminal
      // materializes its chain cue HERE, not at ingress — ingress checked
      // eligibility/identity against the pre-terminal observed state. Re-run
      // the owner identity rules before the row can reach the queued pool: a
      // Principal-owned (or unmapped-owner) cue completes instead of queueing,
      // an agent-owned cue graduates and pairs with its 1016.
      const isTerminal = TERMINAL_STATUSES.has(snapshot.task_status);
      if (isTerminal) {
        const owner = await this.resolveOwnerMapping(wake);
        if (owner.outcome !== 'agent') {
          // Record the true terminal state on the row, then complete it in the
          // same sweep pass — the dispatch sweep runs strictly after field-sync
          // within runOnce, so the transient queued status is never selectable.
          await this.deps.wakeRepo.graduateFromPending(wake.id, snapshot.task_status, snapshot.task_audit);
          await this.deps.wakeRepo.updateStatus(wake.id, 'completed');
          if (owner.outcome === 'principal') {
            this.deps.eventWriter.emit(EVENT_CODES.REQUEST_PRINCIPAL_HANDLED, {
              wake_id: wake.id,
              task_key: wake.task_key,
              task_status: snapshot.task_status,
              task_audit: snapshot.task_audit,
              responsible_actor: 'owner',
              resolved_agent_id: owner.mapping?.agent_id,
              resolved_github_login: owner.mapping?.github_login,
              reason: 'identity_based',
              trigger: 'field_sync'
            });
          } else {
            this.deps.eventWriter.emit(EVENT_CODES.REQUEST_DROPPED_INELIGIBLE, {
              wake_id: wake.id,
              task_key: wake.task_key,
              reason: owner.outcome === 'unmapped' ? owner.reason : 'responsible owner not routable',
              trigger: 'field_sync'
            });
          }
          return true;
        }
      }
      await this.deps.wakeRepo.graduateFromPending(wake.id, snapshot.task_status, snapshot.task_audit);
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_FIELD_SYNC_RESOLVED, {
        wake_id: wake.id, task_key: wake.task_key, task_status: snapshot.task_status, task_audit: snapshot.task_audit
      });
      if (isTerminal) {
        this.deps.eventWriter.emit(EVENT_CODES.WAKE_CHAIN_TERMINAL_CUE, {
          wake_id: wake.id,
          task_key: wake.task_key,
          task_type: wake.task_type,
          task_status: snapshot.task_status,
          task_audit: snapshot.task_audit,
          task_branch: wake.task_branch,
          trigger: 'field_sync'
        });
      }
      return true;
    }

    // E10 (#76) backstop: if the wake's expected lifecycle position is already behind
    // the observed current state — the task progressed past what this pending wake was
    // waiting for — it is a phantom that will never graduate. Self-terminate it (complete)
    // instead of retrying to timeout. Guarded to status mismatches: an audit-only lag
    // (status already matches observed) satisfies isReachableOrSame and is left to retry.
    if (expectedStatus !== null && !isReachableOrSame(snapshot.task_status, expectedStatus)) {
      await this.deps.wakeRepo.updateStatus(wake.id, 'completed');
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_FIELD_SYNC_PHANTOM_TERMINATED, {
        wake_id: wake.id, task_key: wake.task_key,
        task_status_expected: expectedStatus, observed_task_status: snapshot.task_status
      });
      return true;
    }

    const newAttempts = wake.queue_attempts + 1;
    await this.deps.wakeRepo.bumpQueueAttempts(wake.id);

    if (newAttempts >= maxAttempts) {
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_FIELD_SYNC_TIMEOUT, {
        wake_id: wake.id, task_key: wake.task_key, queue_attempts: newAttempts,
        observed_task_status: snapshot.task_status, observed_task_audit: snapshot.task_audit,
        task_status_expected: expectedStatus, task_audit_expected: expectedAudit
      });
    } else {
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_FIELD_SYNC_RETRIED, {
        wake_id: wake.id, task_key: wake.task_key, queue_attempts: newAttempts,
        observed_task_status: snapshot.task_status, observed_task_audit: snapshot.task_audit,
        task_status_expected: expectedStatus, task_audit_expected: expectedAudit
      });
    }
    return true;
  }

  /**
   * Owner identity resolution mirroring ingress Stage 4's identity-based rules
   * (IngressService.checkEligibility): both-field match when id+name present,
   * login-only fallback, unmapped/no-identity → not an agent.
   */
  private async resolveOwnerMapping(wake: Wake): Promise<
    | { outcome: 'agent' | 'principal'; mapping: { agent_id: string; github_login: string; role: string } | null }
    | { outcome: 'unmapped'; mapping: null; reason: string }
  > {
    const ownerId = wake.owner_id;
    const ownerName = wake.owner_name;
    let mapping: { agent_id: string; github_login: string; role: string } | null = null;
    if (ownerId && ownerName) {
      mapping = await this.deps.githubAgentRepo.resolveByGitHub(ownerName, ownerId);
    } else if (ownerName) {
      mapping = await this.deps.githubAgentRepo.findByGitHubLogin(ownerName);
    } else {
      return { outcome: 'unmapped', mapping: null, reason: 'responsible owner has no identity data' };
    }
    if (!mapping) {
      return { outcome: 'unmapped', mapping: null, reason: `responsible owner (${ownerName}) has no github_agent entry` };
    }
    return { outcome: mapping.role === 'principal' ? 'principal' : 'agent', mapping };
  }

  // ── Stages 1–5 — the dispatch sweep ───────────────────────────────────────

  private async runDispatchSweep(): Promise<boolean> {
    const candidates = await this.deps.wakeRepo.findSelectionCandidates(
      this.deps.dispatchReboundCooldownMs ?? 0
    );

    for (const wake of candidates) {
      // Task-turn gate, condition 1 (evaluated fresh each sweep): no open
      // lease for the wake's task_key on ANY route. This also excludes the
      // wake's own running turn — a `dispatched` wake under an open lease is
      // not an empty run.
      const openTurn = await this.deps.leaseRepo.findOpenByTaskKey(wake.task_key);
      if (openTurn) continue;

      // Condition 2: the wake is its task's newest open wake — an older
      // sibling never dispatches past its successor.
      const newest = await this.deps.wakeRepo.findCurrentByTaskKey(wake.task_key);
      if (!newest || newest.id !== wake.id) continue;

      if (wake.status === 'dispatched') {
        // Govern exemption (spec_wakery-dispatch-worker.md Stage 5,
        // milestone_govern-notice_v2026.08.05): a Govern cue wake awaits the
        // Principal, not an agent — one notice turn suffices, and the wake
        // completes by progression when the verdict lands. Never an
        // empty-run candidate.
        if (wake.task_audit === 'Govern') continue;
        // Stall-alarm exemption (self-healing F2): the synthetic stall wake
        // is a one-duty confession turn — never re-woken; the board sweep
        // completes it when the stall condition clears.
        if (wake.task_labels?.includes(STALL_ALARM_LABEL)) continue;
        // Empty run: dispatched + no open lease + newest open wake of its
        // task. Stage 5 guards apply before it may enter the pool.
        const admitted = await this.applyEmptyRunGuards(wake);
        if (admitted === 'completed') return true;
        if (admitted === 'skip') continue;
        if (admitted === 'cap_alert') return this.processCandidate(wake, true);
      }

      return this.processCandidate(wake);
    }
    return false;
  }

  /**
   * Stage 5 guards for an empty-run candidate: the re-wake cap and the
   * terminal verifier. Returns 'rewake' (candidate enters the pool),
   * 'completed' (the verifier closed the cue locally — work was done this
   * sweep), 'cap_alert' (exactly at the cap — one final one-duty delivery
   * turn, self-healing F2b), or 'skip'.
   */
  private async applyEmptyRunGuards(wake: Wake): Promise<'rewake' | 'completed' | 'skip' | 'cap_alert'> {
    if (wake.wake_attempts >= this.rewakeMaxAttempts) {
      // Surface once: 2017 remains the machine record of the cap.
      if (!this.rewakeCapSurfaced.has(wake.id)) {
        this.rewakeCapSurfaced.add(wake.id);
        this.deps.eventWriter.emit(EVENT_CODES.WAKE_REWAKE_MAX_ATTEMPTS, {
          wake_id: wake.id,
          task_key: wake.task_key,
          state_key: wake.state_key,
          wake_attempts: wake.wake_attempts,
          max_attempts: this.rewakeMaxAttempts
        });
      }
      // Cap-alert final wake (self-healing F2b): exactly at the cap, one
      // additional one-duty alert turn delivers the conclusion to the
      // Principal (the outage incident's gap was delivery, not machinery).
      // The alert send bumps wake_attempts past the cap, after which the
      // wake leaves the selection pool permanently — only external
      // reconciliation (progression, operator action) moves it. A failed
      // alert send leaves attempts at the cap and retries next sweep.
      if (wake.wake_attempts === this.rewakeMaxAttempts) return 'cap_alert';
      return 'skip';
    }

    // Terminal guard: a terminal-status empty run is a chain cue whose ack
    // may have been lost — verify against the live issue before spending a
    // turn. This is the cue's only completion path after a lost close webhook.
    if (TERMINAL_STATUSES.has(wake.task_status) && this.deps.terminalVerifier) {
      const closed = await this.deps.terminalVerifier(wake);
      if (closed === true) {
        await this.deps.wakeRepo.updateStatus(wake.id, 'completed');
        this.deps.eventWriter.emit(EVENT_CODES.WAKE_CHAIN_TERMINAL_VERIFIED, {
          wake_id: wake.id,
          task_key: wake.task_key,
          task_status: wake.task_status,
          task_type: wake.task_type
        });
        return 'completed';
      }
      if (closed === null) return 'skip'; // lookup failed — conservative
      // closed === false: the ack genuinely has not happened; re-wake eligible.
    }
    return 'rewake';
  }

  /** Stages 2–4 for one admitted candidate; capAlert marks the F2b delivery turn. */
  private async processCandidate(wake: Wake, capAlert = false): Promise<boolean> {
    this.deps.eventWriter.emit(EVENT_CODES.WAKE_SELECTED, {
      wake_id: wake.id, task_key: wake.task_key, state_key: wake.state_key, wake_attempts: wake.wake_attempts
    });

    // Stage 2 — resolve route.
    const route = await this.deps.routeRepo.resolveForWake(wake);
    if (!route) {
      await this.deps.wakeRepo.bumpDispatchAttempts(wake.id, 'parked');
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_PARKED, { wake_id: wake.id, task_key: wake.task_key, state_key: wake.state_key });
      return true;
    }
    this.deps.eventWriter.emit(EVENT_CODES.WAKE_ROUTE_RESOLVED, { wake_id: wake.id, route_id: route.id, actor: route.actor });

    // Stage 3 — capacity: the count of open leases vs route.max_run. Nothing
    // here is task-aware — the task-turn gate already serialized the task
    // upstream; delivery=session lanes are capacity 1 by construction.
    const openCount = await this.deps.leaseRepo.countOpenByRouteId(route.id);
    const capacity = route.delivery === 'session' ? 1 : (route.max_run ?? 1);
    if (openCount >= capacity) {
      await this.deps.wakeRepo.bumpDispatchAttempts(wake.id, wake.status);
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_DISPATCH_CAPACITY_REBOUND, { wake_id: wake.id, route_id: route.id, actor: route.actor });
      return true;
    }

    // Stage 4 — snooze consult FIRST (both delivery modes, the stateless
    // hold predicate): a holding result defers admission — current status
    // kept, dispatch_attempts bumped for pacing, wake_attempts NEVER touched
    // (held waits don't consume the re-wake cap). No lease is created; no
    // state is written anywhere.
    // The cap-alert turn bypasses the snooze consult: it delivers a
    // conclusion, it does not execute work — a hold guarding execution must
    // not defer the report of the blockage (self-healing F2b).
    const holding = this.deps.snooze && !capAlert ? await this.deps.snooze.consultSnoozes(wake) : [];
    if (holding.length > 0) {
      await this.deps.wakeRepo.bumpDispatchAttempts(wake.id, wake.status);
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_DISPATCH_HOLD_DEFERRED, {
        wake_id: wake.id,
        task_key: wake.task_key,
        branch: wake.task_branch,
        task_status: wake.task_status,
        task_audit: wake.task_audit,
        holding_types: this.deps.snooze!.holdingTypeNames(holding)
      });
      return true;
    }

    // Mint, render, persist, send — in that order (Stage 4). The lease id is
    // minted before the render so a `delivery=run` send can embed it in the
    // run-session key; nothing persists until the render has succeeded.
    // Template-selection precedence: task_audit='Govern' → the govern-notice
    // message (rendered by the adapter on the wake's own fields, precedence
    // over both); else wake_attempts selects wake vs re-wake.
    const leaseId = mintId('lease');
    const isStall = wake.task_labels?.includes(STALL_ALARM_LABEL) ?? false;
    const isGovern = !isStall && wake.task_audit === 'Govern';
    const isRewake = !isStall && !isGovern && wake.wake_attempts > 0;
    let message: string;
    try {
      message = await this.deps.adapter.renderTurn(
        wake,
        route,
        isRewake ? { ...(await this.buildRewakeContext(wake)), ...(capAlert ? { capAlert: true } : {}) } : undefined
      );
    } catch (err) {
      // Render failure has persisted nothing — park the wake (E7 poison-pill
      // removal) and stop; a downstream/send failure is handled further down.
      if (!(err instanceof RenderError)) throw err;
      await this.deps.wakeRepo.bumpDispatchAttempts(wake.id, 'parked');
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_DISPATCH_PARKED_ON_ERROR, {
        wake_id: wake.id,
        task_key: wake.task_key,
        state_key: wake.state_key,
        route_id: route.id,
        actor: route.actor,
        error: err.message
      });
      return true;
    }

    const now = Date.now();
    const lease: WakeRouteLease = {
      id: leaseId,
      route_id: route.id,
      wake_id: wake.id,
      wake_task_status: wake.task_status,
      task_key: wake.task_key,
      activity_time: now,
      status: 'active',
      create_time: now,
      update_time: now
    };
    await this.deps.leaseRepo.create(lease);
    this.deps.eventWriter.emit(EVENT_CODES.LEASE_CREATED, {
      wake_id: wake.id, route_id: route.id, wake_route_lease_id: lease.id, task_key: wake.task_key, actor: route.actor
    });

    // Send with idempotencyKey = lease.id — the gateway adopts it as the
    // run's runId, so the lease knows its run before the send completes and a
    // crash-resend cannot double-fire the turn.
    try {
      await this.deps.adapter.send({ wake, route, lease }, message);
    } catch (err) {
      // The send never took: complete the lease `send_failed` and leave the
      // wake in its pre-send status — the next sweep retries with a fresh
      // lease. wake_attempts is NOT incremented (no turn started).
      await this.completeLease(lease, 'send_failed', {
        error: err instanceof Error ? err.message : String(err)
      });
      await this.deps.wakeRepo.bumpDispatchAttempts(wake.id, wake.status);
      return true;
    }

    await this.deps.wakeRepo.markDispatched(wake.id);
    const attemptsAfter = wake.wake_attempts + 1;
    const dispatchedFields = {
      wake_id: wake.id,
      route_id: route.id,
      wake_route_lease_id: lease.id,
      actor: route.actor,
      wake_attempts: attemptsAfter,
      template: isStall ? 'stall-notice' : isGovern ? 'govern-notice' : capAlert ? 'cap-alert' : isRewake ? 'rewake' : 'wake'
    };
    this.deps.eventWriter.emit(EVENT_CODES.WAKE_DISPATCHED, dispatchedFields);
    if (capAlert) {
      // 2017 is the machine record of the cap; this is its human delivery.
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_CAP_ALERT_DISPATCHED, {
        ...dispatchedFields,
        last_turn_minutes_ago: await this.lastTurnMinutesAgo(wake)
      });
    } else if (attemptsAfter > 1) {
      this.deps.eventWriter.emit(EVENT_CODES.WAKE_REWAKE_DISPATCHED, {
        ...dispatchedFields,
        last_turn_minutes_ago: await this.lastTurnMinutesAgo(wake)
      });
    }
    return true;
  }

  /** The re-wake template's derived context (spec_wakery-rewake-message.md §Placeholders). */
  private async buildRewakeContext(wake: Wake) {
    const lastEnd = await this.lastTurnEndMs(wake);
    return {
      wakeAttempts: wake.wake_attempts + 1,
      rewakeCap: this.rewakeMaxAttempts,
      lastTurnMinutesAgo: Math.max(0, Math.round((Date.now() - lastEnd) / 60_000)),
      settledHolds: this.deps.snooze ? await this.deps.snooze.settledHolds(wake, lastEnd) : []
    };
  }

  private async lastTurnEndMs(wake: Wake): Promise<number> {
    const lastCompleted = await this.deps.leaseRepo.findLatestCompletedByWakeId(wake.id);
    return lastCompleted?.update_time ?? wake.update_time;
  }

  private async lastTurnMinutesAgo(wake: Wake): Promise<number> {
    return Math.max(0, Math.round((Date.now() - (await this.lastTurnEndMs(wake))) / 60_000));
  }
}
