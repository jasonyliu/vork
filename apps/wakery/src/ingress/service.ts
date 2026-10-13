import { EVENT_CODES } from '../events/codes.js';
import type { EventWriter } from '../events/writer.js';
import { makeStateKey, makeTaskKey, mintId } from '../shared/ids.js';
import type { WakeRequest, WakeResponse, Wake } from '../shared/types.js';
import { resolveResponsibleActor, type ResponsibleActor } from '../shared/eligibility.js';
import { WakeRepository } from '../db/wake-repository.js';
import type { GithubAgentRepository } from '../db/github-agent-repository.js';

// Discriminated outcome surfaced by checkEligibility so handleWakeRequest can
// emit the right event per spec_wakery-ingress-api.md §Stage 4:
//   - 'eligible'        → wake stored, dispatched
//   - 'principal_state_based'
//                       → wake.request.principal_handled (1009,
//                         reason=state_based) — but NOT silent
//                         (milestone_govern-notice_v2026.08.05): a
//                         notification cue wake is stored beside it and
//                         wake.govern.cue (1020) emitted, so Sarge's turn
//                         sends the Principal's checkpoint notice
//   - 'principal_identity_based'
//                       → wake.request.principal_handled (1009,
//                         reason=identity_based); no wake stored — silent by
//                         design
//   - 'dropped'         → wake.request.dropped_ineligible (1003); no wake
//                         stored (no-actor, no-identity, no-mapping)
export type EligibilityOutcome =
  | 'eligible'
  | 'principal_state_based'
  | 'principal_identity_based'
  | 'dropped';

interface EligibilityResult {
  outcome: EligibilityOutcome;
  eligible: boolean;
  reason: string;
  responsibleActor?: ResponsibleActor;
  resolvedActorAgentId?: string;
  resolvedActorGithubLogin?: string;
}

export class IngressService {
  constructor(
    private readonly wakeRepo: WakeRepository,
    private readonly githubAgentRepo: GithubAgentRepository,
    private readonly eventWriter: EventWriter
  ) {}

  async checkEligibility(request: WakeRequest): Promise<EligibilityResult> {
    const lifecycle = request.task_status;
    const audit = request.task_audit;

    // Terminal states (Completed/Cancelled) are NOT dropped here: the matrix
    // resolves them to the owner lane as chain cues
    // (spec_wakery-conduction-chaining.md Stage 2). A Principal-owned task's
    // terminal transition still takes the identity-based principal_handled
    // path below — Principal-owned checkpoints chain on the Principal's own
    // direction, not on a cue.
    const actor = resolveResponsibleActor(lifecycle, audit);
    if (!actor) {
      return { outcome: 'dropped', eligible: false, reason: `no eligible lifecycle+audit combination: ${lifecycle}:${audit}` };
    }

    // Principal-targeted states are not eligible for agent routing — STATE-BASED
    // principal-handled (the actor matrix itself resolves to `principal` for
    // this lifecycle+audit, e.g. Todo:Govern).
    if (actor === 'principal') {
      return {
        outcome: 'principal_state_based',
        eligible: false,
        reason: `responsible actor is principal (${lifecycle}:${audit})`,
        responsibleActor: actor
      };
    }

    // Resolve the responsible actor's identity to check their role
    const actorId = actor === 'owner' ? request.owner_id : actor === 'assignee' ? request.assignee_id : null;
    const actorName = actor === 'owner' ? request.owner_name : actor === 'assignee' ? request.assignee_name : null;

    // Auditor actor doesn't need identity resolution — it's routed by task type
    if (actor === 'auditor') {
      return { outcome: 'eligible', eligible: true, reason: `auditor routable (${lifecycle}:${audit})`, responsibleActor: actor };
    }

    // For owner/assignee actors, resolve via github_agent to verify they are agents.
    // IDENTITY-BASED principal-handled fires when the resolved github_agent has
    // role: principal (e.g. Pending:Approved with owner = the Principal).
    if (actorId && actorName) {
      const mapping = await this.githubAgentRepo.resolveByGitHub(actorName, actorId);
      if (mapping && mapping.role === 'principal') {
        return {
          outcome: 'principal_identity_based',
          eligible: false,
          reason: `responsible ${actor} resolves to principal role`,
          responsibleActor: actor,
          resolvedActorAgentId: mapping.agent_id,
          resolvedActorGithubLogin: mapping.github_login
        };
      }
      if (!mapping) {
        return { outcome: 'dropped', eligible: false, reason: `responsible ${actor} (${actorName}) has no github_agent entry` };
      }
    } else if (actorName) {
      const mapping = await this.githubAgentRepo.findByGitHubLogin(actorName);
      if (mapping && mapping.role === 'principal') {
        return {
          outcome: 'principal_identity_based',
          eligible: false,
          reason: `responsible ${actor} resolves to principal role`,
          responsibleActor: actor,
          resolvedActorAgentId: mapping.agent_id,
          resolvedActorGithubLogin: mapping.github_login
        };
      }
      if (!mapping) {
        return { outcome: 'dropped', eligible: false, reason: `responsible ${actor} (${actorName}) has no github_agent entry` };
      }
    } else {
      return { outcome: 'dropped', eligible: false, reason: `responsible ${actor} has no identity data` };
    }

    return { outcome: 'eligible', eligible: true, reason: `eligible (${lifecycle}:${audit}, actor=${actor})`, responsibleActor: actor };
  }

  async handleWakeRequest(request: WakeRequest): Promise<WakeResponse> {
    this.eventWriter.emit(EVENT_CODES.REQUEST_RECEIVED, { request_id: request.request_id, project_id: request.project_id, task_id: request.task_id });

    const taskKey = makeTaskKey(request.project_id, request.task_id);
    const stateKey = makeStateKey(request.project_id, request.task_id, request.task_status, request.task_audit);
    let current = await this.wakeRepo.findCurrentByTaskKey(taskKey);

    // Computed up-front because Stage 3 reconciliation needs it to detect
    // hint-driven state progression (see spec_wakery-ingress-api.md
    // Stage 3): an agent's transition comment carries a `To:` hint that the
    // source adapter parses into task_status_expected / task_audit_expected.
    // When those hints disagree with the freshly fetched canonical fields,
    // upstream has lagged but the transition has been performed.
    const expectedStatus = request.task_status_expected ?? null;
    const expectedAudit = request.task_audit_expected ?? null;
    const fieldLagged =
      (expectedStatus !== null && expectedStatus !== request.task_status) ||
      (expectedAudit !== null && expectedAudit !== request.task_audit);

    // Stage 3 — Reconcile state progression. Closure runs before eligibility
    // checking so a transition into a principal-owned or terminal state still
    // closes the prior wake.
    //
    // Two progression signals trigger closure:
    //   - observed-state progression: canonical state_key differs from the
    //     open wake's. Upstream is ahead.
    //   - hint-driven progression: canonical state_key still matches, but the
    //     request's expected hints disagree with canonical. The agent's
    //     transition comment is treated as authoritative for progression even
    //     when the ProjectV2 read path has not yet caught up. Stage 5 then
    //     takes the new-row pending path so the field-sync sweep can graduate
    //     the wake once canonical reflects the expected state.
    //
    // Leases are NEVER touched here (two-ledger rule,
    // spec_wakery-queue-and-leases.md): lease completion is the dispatch
    // worker's, driven by the gateway's turn-end signal. A progression that
    // closes a wake mid-turn leaves the turn's lease open — the task-turn
    // gate is what holds the successor wake until that turn truly ends.
    if (current && current.state_key !== stateKey) {
      await this.wakeRepo.completeOpenByTaskKey(taskKey);
      this.eventWriter.emit(EVENT_CODES.WAKE_COMPLETED_BY_TASK_PROGRESSION, {
        request_id: request.request_id,
        wake_id: current.id,
        task_key: taskKey,
        trigger: 'observed'
      });
      current = null;
    } else if (current && current.state_key === stateKey && fieldLagged) {
      // Hint-driven progression fires only when the incoming hints differ
      // from what the existing wake already captures. A repeated request with
      // the same hint (e.g. the field-sync sweep cadence outpacing canonical
      // catch-up while the assignee keeps the bounce comment fresh) must NOT
      // churn a new wake on every webhook — the existing pending row is
      // already tracking the same expected destination. We only treat the
      // signal as progression when it represents a NEW transition not yet
      // captured.
      const hintIsNew =
        expectedStatus !== (current.task_status_expected ?? null) ||
        expectedAudit !== (current.task_audit_expected ?? null);
      if (hintIsNew) {
        // Hint-driven progression closes the same way — wake ledger only;
        // leases are untouched on this path too (two-ledger rule).
        await this.wakeRepo.completeOpenByTaskKey(taskKey);
        this.eventWriter.emit(EVENT_CODES.WAKE_COMPLETED_BY_TASK_PROGRESSION, {
          request_id: request.request_id,
          wake_id: current.id,
          task_key: taskKey,
          trigger: 'hint',
          task_status_expected: expectedStatus,
          task_audit_expected: expectedAudit,
          prior_task_status_expected: current.task_status_expected ?? null,
          prior_task_audit_expected: current.task_audit_expected ?? null
        });
        current = null;
      }
    }

    const eligibility = await this.checkEligibility(request);
    if (!eligibility.eligible) {
      // Principal-handled cases get a dedicated event per spec_wakery-events.md
      // (event 1009) so the audit trail is greppable as a distinct outcome. The
      // legacy dropped_ineligible "reason=...principal..." paths are retired.
      if (eligibility.outcome === 'principal_state_based' || eligibility.outcome === 'principal_identity_based') {
        this.eventWriter.emit(EVENT_CODES.REQUEST_PRINCIPAL_HANDLED, {
          request_id: request.request_id,
          project_id: request.project_id,
          task_id: request.task_id,
          task_status: request.task_status,
          task_audit: request.task_audit,
          responsible_actor: eligibility.responsibleActor,
          resolved_agent_id: eligibility.resolvedActorAgentId,
          resolved_github_login: eligibility.resolvedActorGithubLogin,
          reason: eligibility.outcome === 'principal_state_based' ? 'state_based' : 'identity_based'
        });
      } else {
        this.eventWriter.emit(EVENT_CODES.REQUEST_DROPPED_INELIGIBLE, {
          request_id: request.request_id, project_id: request.project_id, task_id: request.task_id,
          reason: eligibility.reason
        });
      }
      if (eligibility.outcome !== 'principal_state_based') {
        return { request_id: request.request_id, status: 'dropped', message: eligibility.reason };
      }
      // Govern carve-out (milestone_govern-notice_v2026.08.05,
      // spec_wakery-ingress-api.md Stage 4 "State-based"): the state is the
      // Principal's, but it is NOT silent — alongside the 1009 the request
      // falls through to the normal storage path below and stores a
      // notification cue wake (same dedup/same-state-update semantics as any
      // wake), routed at dispatch as an owner-lane wake so Sarge's turn sends
      // the checkpoint notice (spec_wakery-govern-notice-message.md). The cue
      // completes by ordinary progression closure when the Principal's verdict
      // transitions the task. 1020 is emitted beside the 1009 — every Govern
      // arrival pairs one 1009 with one 1020. Identity-based principal
      // handling above stays silent by design.
      this.eventWriter.emit(EVENT_CODES.WAKE_GOVERN_CUE, {
        request_id: request.request_id,
        project_id: request.project_id,
        task_id: request.task_id,
        task_key: taskKey,
        task_status: request.task_status,
        task_audit: request.task_audit,
        gate: `${request.task_status}:${request.task_audit}`
      });
    }

    if (current && current.state_key === stateKey) {
      // Ingress never mutates wake.status on an existing row; pending → queued
      // is owned exclusively by the dispatch worker's field-sync sweep. The
      // one ingress-side mutation of a pending row is to reset queue_attempts
      // when a fresh request reports a fully-synced state, re-opening the
      // field-sync attempt budget for a wake that may have been frozen by
      // WAKERY_PENDING_MAX_ATTEMPTS. See
      // specs/apps/wakery/spec_wakery-ingress-api.md Stage 5.
      const isPendingRefresh = current.status === 'pending' && !fieldLagged;
      const updated: Wake = {
        ...current,
        task_type: request.task_type,
        task_title: request.task_title ?? current.task_title,
        task_priority: request.task_priority ?? current.task_priority,
        task_status: request.task_status,
        task_audit: request.task_audit,
        task_labels: request.task_labels ?? current.task_labels,
        task_relations: request.task_relations ?? current.task_relations,
        task_payload: request.task_payload ?? current.task_payload,
        assignee_id: request.assignee_id ?? current.assignee_id,
        assignee_name: request.assignee_name ?? current.assignee_name,
        owner_id: request.owner_id ?? current.owner_id,
        owner_name: request.owner_name ?? current.owner_name,
        project_name: request.project_name ?? current.project_name,
        queue_attempts: isPendingRefresh ? 0 : current.queue_attempts,
        update_time: Date.now()
      };
      await this.wakeRepo.update(updated);
      if (isPendingRefresh) {
        this.eventWriter.emit(EVENT_CODES.WAKE_PENDING_REFRESHED, {
          request_id: request.request_id,
          wake_id: updated.id,
          task_key: taskKey,
          state_key: stateKey,
          prior_queue_attempts: current.queue_attempts
        });
      } else {
        this.eventWriter.emit(EVENT_CODES.WAKE_UPDATED, { request_id: request.request_id, wake_id: updated.id, task_key: taskKey, state_key: stateKey });
      }
      return {
        request_id: request.request_id,
        status: 'updated',
        message: isPendingRefresh ? 'Pending wake refreshed: queue_attempts reset' : 'Current wake occurrence updated'
      };
    }

    const wake: Wake = {
      id: mintId('wake'),
      task_key: taskKey,
      state_key: stateKey,
      project_id: request.project_id,
      project_name: request.project_name ?? null,
      task_id: request.task_id,
      task_type: request.task_type,
      task_title: request.task_title ?? null,
      task_priority: request.task_priority ?? null,
      task_status: request.task_status,
      task_status_expected: fieldLagged ? expectedStatus : null,
      task_audit: request.task_audit,
      task_audit_expected: fieldLagged ? expectedAudit : null,
      task_labels: request.task_labels ?? null,
      task_relations: request.task_relations ?? null,
      task_branch: request.task_branch ?? null,
      task_payload: request.task_payload ?? null,
      assignee_id: request.assignee_id ?? null,
      assignee_name: request.assignee_name ?? null,
      owner_id: request.owner_id ?? null,
      owner_name: request.owner_name ?? null,
      queue_attempts: 0,
      dispatch_attempts: 0,
      wake_attempts: 0,
      status: fieldLagged ? 'pending' : 'queued',
      create_time: Date.now(),
      update_time: Date.now()
    };
    await this.wakeRepo.create(wake);
    if (fieldLagged) {
      this.eventWriter.emit(EVENT_CODES.WAKE_CREATED_PENDING, {
        request_id: request.request_id,
        wake_id: wake.id,
        task_key: taskKey,
        state_key: stateKey,
        task_status_expected: expectedStatus,
        task_audit_expected: expectedAudit
      });
    } else {
      this.eventWriter.emit(EVENT_CODES.WAKE_CREATED, { request_id: request.request_id, wake_id: wake.id, task_key: taskKey, state_key: stateKey });
    }
    // Chain cue stored (spec_wakery-conduction-chaining.md Stage 2): an observed
    // terminal transition became an owner-lane wake. Emitted at cue storage —
    // the chain audit trail; dedupe rides the same-state update path above, so
    // a duplicate terminal comment never produces a second cue event.
    if (request.task_status === 'Completed' || request.task_status === 'Cancelled') {
      this.eventWriter.emit(EVENT_CODES.WAKE_CHAIN_TERMINAL_CUE, {
        request_id: request.request_id,
        wake_id: wake.id,
        task_key: taskKey,
        task_type: request.task_type,
        task_status: request.task_status,
        task_audit: request.task_audit,
        task_branch: wake.task_branch,
        trigger: 'observed'
      });
    }
    return { request_id: request.request_id, status: 'accepted', message: fieldLagged ? 'Wake accepted in pending state pending upstream sync' : 'Wake accepted into local storage' };
  }
}
