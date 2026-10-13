// Snooze intake (spec_wakery-snooze.md Stage 1) — module code invoked by
// ingress routing for `pull_request`/`workflow_run` webhooks; runs in the
// ingress process. Intake stores the fact that external work is running on a
// branch, nothing more: NO wake lookup, NO correlation query, NO task-type
// check — the hold match is the consult-time predicate (SnoozeModule), never
// a stored linkage. The stub is the default for builds of the server that
// don't wire the module (tests, tooling): events are acknowledged and dropped.

import { EVENT_CODES } from '../events/codes.js';
import { mintId } from '../shared/ids.js';
import type { Snooze } from '../shared/types.js';
import { SnoozeRepository, makeSnoozeKey } from '../db/snooze-repository.js';
import {
  resolveSnoozeEvent,
  STANDING_BRANCHES,
  type SnoozeTypeDef
} from './types.js';

export interface SnoozeIntakeResult {
  status: 'ignored' | 'accepted';
  message: string;
}

export interface SnoozeIntake {
  handleEvent(event: string, payload: unknown): Promise<SnoozeIntakeResult>;
}

export const stubSnoozeIntake: SnoozeIntake = {
  async handleEvent(event: string) {
    return { status: 'ignored', message: `snooze intake not wired: ${event}` };
  }
};

interface EventCode { code: number; name: string; severity: string }
interface Emitter { emit(event: EventCode, fields?: Record<string, unknown>): void }

export interface SnoozeIntakeDeps {
  snoozeRepo: SnoozeRepository;
  githubRepoProjectRepo: {
    findByRepoId(repoId: string): Promise<{ project_id: string; github_project_title: string | null } | null>;
  };
  eventWriter: Emitter;
}

export class SnoozeIntakeModule implements SnoozeIntake {
  constructor(private readonly deps: SnoozeIntakeDeps) {}

  async handleEvent(event: string, payload: any): Promise<SnoozeIntakeResult> {
    const action = String(payload?.action ?? '');
    const resolved = resolveSnoozeEvent(event, action, payload);
    if (!resolved) {
      // An unclaimed event takes the existing ignore path — no event emitted;
      // .github/workflows is a generic automation surface.
      return { status: 'ignored', message: `no snooze type claims ${event}:${action}` };
    }
    const { type, kind } = resolved;

    const correlationValue = type.correlationValueOf(payload);
    if (!correlationValue) {
      this.emitUnmatched(type, kind, 'no correlation value on payload');
      return { status: 'ignored', message: 'no correlation value on payload' };
    }

    if (kind === 'end') {
      return this.handleEnd(type, correlationValue);
    }
    return this.handleStart(type, payload, correlationValue);
  }

  /**
   * Start event: upsert on snooze_key = md5(type + correlation value) —
   * create active, or refresh update_time on a repeat; a settled row with the
   * same key (a re-run suite on the same head sha) re-arms in place.
   */
  private async handleStart(type: SnoozeTypeDef, payload: any, correlationValue: string): Promise<SnoozeIntakeResult> {
    const branch = type.branchOf(payload);
    if (branch && STANDING_BRANCHES.has(branch)) {
      // Standing-branch events (dev/main) are expected noise — never stored.
      this.emitUnmatched(type, 'start', `standing branch: ${branch}`);
      return { status: 'ignored', message: `standing branch: ${branch}` };
    }

    const key = makeSnoozeKey(type.type, correlationValue);
    const existing = await this.deps.snoozeRepo.findBySnoozeKey(key);
    if (existing) {
      if (existing.status === 'active') {
        await this.deps.snoozeRepo.refresh(existing.id);
        return { status: 'accepted', message: `snooze refreshed (${type.name})` };
      }
      // Re-arm: same process instance restarted after settling.
      await this.deps.snoozeRepo.updateStatus(existing.id, 'active');
      this.emitSnooze(EVENT_CODES.SNOOZE_CREATED, existing.id, type, key, correlationValue, branch, { rearmed: true });
      return { status: 'accepted', message: `snooze re-armed (${type.name})` };
    }

    // Project context from the source repo; expected scope from the registry.
    const repoNodeId = String(payload?.repository?.node_id ?? '');
    const repoProject = repoNodeId ? await this.deps.githubRepoProjectRepo.findByRepoId(repoNodeId) : null;
    const now = Date.now();
    const snooze: Snooze = {
      id: mintId('snooze'),
      snooze_key: key,
      type: type.type,
      snooze_payload: type.buildPayload(payload),
      // platform project key; the board title stands in for project.name (they
      // match by foundry convention) — both informational on flow rows
      project_id: repoProject?.project_id ?? null,
      project_name: repoProject?.github_project_title ?? null,
      task_status: type.expectedState.task_status,
      task_audit: type.expectedState.task_audit,
      status: 'active',
      create_time: now,
      update_time: now
    };
    await this.deps.snoozeRepo.create(snooze);
    this.emitSnooze(EVENT_CODES.SNOOZE_CREATED, snooze.id, type, key, correlationValue, branch);
    return { status: 'accepted', message: `snooze active (${type.name})` };
  }

  /** End event: the active row matching (type, correlation value) → completed. Outcome never read. */
  private async handleEnd(type: SnoozeTypeDef, correlationValue: string): Promise<SnoozeIntakeResult> {
    const key = makeSnoozeKey(type.type, correlationValue);
    const row = await this.deps.snoozeRepo.findBySnoozeKey(key);
    if (!row || row.status !== 'active') {
      this.emitUnmatched(type, 'end', `no active snooze for ${type.name}:${correlationValue}`);
      return { status: 'ignored', message: 'no matching snooze' };
    }
    await this.deps.snoozeRepo.updateStatus(row.id, 'completed');
    this.emitSnooze(EVENT_CODES.SNOOZE_COMPLETED, row.id, type, key, correlationValue, rowBranch(row));
    return { status: 'accepted', message: `snooze completed (${type.name})` };
  }

  private emitSnooze(
    code: EventCode,
    snoozeId: string,
    type: SnoozeTypeDef,
    snoozeKey: string,
    correlationValue: string,
    branch: string | null,
    extra: Record<string, unknown> = {}
  ) {
    this.deps.eventWriter.emit(code, {
      snooze_id: snoozeId,
      snooze_key: snoozeKey,
      type: type.name,
      branch,
      correlation_value: correlationValue,
      ...extra
    });
  }

  private emitUnmatched(type: SnoozeTypeDef, kind: string, reason: string) {
    this.deps.eventWriter.emit(EVENT_CODES.SNOOZE_EVENT_UNMATCHED, {
      type: type.name,
      kind,
      reason
    });
  }
}

function rowBranch(row: Snooze): string | null {
  const branch = row.snooze_payload?.branch;
  return typeof branch === 'string' && branch.length > 0 ? branch : null;
}
