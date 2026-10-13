// The snooze module's dispatch-worker surfaces (spec_wakery-snooze.md): the
// stateless hold predicate consulted at admission, the tick-riding timeout
// sweep, and the settled-holds set feeding the re-wake template. No worker,
// no poll loop, no in-memory state: a hold is re-asked at every consult and
// is never stored, attached, paused, or resumed.

import { EVENT_CODES } from '../events/codes.js';
import type { Snooze, Wake } from '../shared/types.js';
import { SnoozeRepository } from '../db/snooze-repository.js';
import { SnoozeTaskTypeRepository } from '../db/snooze-task-type-repository.js';
import { snoozeTypeByCode } from './types.js';

interface EventCode { code: number; name: string; severity: string }
interface Emitter { emit(event: EventCode, fields?: Record<string, unknown>): void }

export interface SnoozeModuleDeps {
  snoozeRepo: SnoozeRepository;
  snoozeTaskTypeRepo: SnoozeTaskTypeRepository;
  eventWriter: Emitter;
  /** WAKERY_SNOOZE_TIMEOUT_MS — the single clock for all types. */
  timeoutMs?: number;
}

/** One settled hold as rendered into the re-wake's settled-holds context. */
export interface SettledHold {
  typeName: string;
  status: 'completed' | 'timeout';
  heldMinutes: number;
}

export class SnoozeModule {
  constructor(private readonly deps: SnoozeModuleDeps) {}

  private get timeoutMs(): number {
    return this.deps.timeoutMs ?? 1_800_000;
  }

  /**
   * The hold predicate (Stage 2), evaluated fresh per candidate wake at
   * dispatch admission. The wake is held iff an active snooze exists where:
   *   1. payload branch = wake.task_branch,
   *   2. the snooze's expected scope equals the wake's (task_status, task_audit),
   *   3. wake.task_type is in the snooze type's snooze_task_type rows, and
   *   4. the row is unexpired: now - update_time <= WAKERY_SNOOZE_TIMEOUT_MS
   *      (lazy expiry — correctness without the sweep).
   * Pure read; returns the holding set for the deferral event's payload.
   */
  async consultSnoozes(wake: Wake): Promise<Snooze[]> {
    if (!wake.task_branch) return [];
    const active = await this.deps.snoozeRepo.findByStatuses(['active']);
    if (active.length === 0) return [];

    const now = Date.now();
    const holding: Snooze[] = [];
    const allowedByType = new Map<number, Set<string>>();
    for (const row of active) {
      if (rowBranch(row) !== wake.task_branch) continue;
      if (row.task_status !== wake.task_status || row.task_audit !== wake.task_audit) continue;
      if (now - row.update_time > this.timeoutMs) continue; // lazy expiry
      let allowed = allowedByType.get(row.type);
      if (!allowed) {
        allowed = await this.deps.snoozeTaskTypeRepo.allowedTaskTypes(row.type);
        allowedByType.set(row.type, allowed);
      }
      if (!allowed.has(wake.task_type)) continue;
      holding.push(row);
    }
    return holding;
  }

  /** Registry names of a holding set, for the hold-deferral event payload. */
  holdingTypeNames(holding: Snooze[]): string[] {
    return Array.from(new Set(holding.map((s) => snoozeTypeByCode(s.type)?.name ?? String(s.type))));
  }

  /**
   * The timeout sweep (Stage 4), ridden by the dispatch worker's tick:
   * active rows past the clock → timeout, snooze.timeout (warn) once per row.
   * Bookkeeping only — holding-correctness never depends on this sweep.
   */
  async timeoutSweep(): Promise<number> {
    const now = Date.now();
    const expired = await this.deps.snoozeRepo.expireActiveOlderThan(now - this.timeoutMs);
    for (const row of expired) {
      this.deps.eventWriter.emit(EVENT_CODES.SNOOZE_TIMEOUT, {
        snooze_id: row.id,
        snooze_key: row.snooze_key,
        type: snoozeTypeByCode(row.type)?.name ?? row.type,
        branch: rowBranch(row),
        age_ms: now - row.update_time
      });
    }
    return expired.length;
  }

  /**
   * The settled-holds set (spec_wakery-rewake-message.md): this branch's
   * snoozes of matching scope that reached completed or timeout since the
   * wake's previous turn ended. Type-aware, outcome-blind — status and held
   * duration only, never a conclusion.
   */
  async settledHolds(wake: Wake, sinceMs: number): Promise<SettledHold[]> {
    if (!wake.task_branch) return [];
    const settled = await this.deps.snoozeRepo.findByStatuses(['completed', 'timeout']);
    return settled
      .filter(
        (row) =>
          rowBranch(row) === wake.task_branch &&
          row.task_status === wake.task_status &&
          row.task_audit === wake.task_audit &&
          row.update_time >= sinceMs
      )
      .map((row) => ({
        typeName: snoozeTypeByCode(row.type)?.name ?? String(row.type),
        status: row.status as 'completed' | 'timeout',
        heldMinutes: Math.max(0, Math.round((row.update_time - row.create_time) / 60_000))
      }));
  }
}

function rowBranch(row: Snooze): string | null {
  const branch = row.snooze_payload?.branch;
  return typeof branch === 'string' && branch.length > 0 ? branch : null;
}
