import type { Pool } from 'pg';
import type { WakeRouteLease } from '../shared/types.js';

// The turn ledger's data layer (spec_wakery-queue-and-leases.md Stage 3;
// contracts §5). One row per agent turn started; the lease id IS the run's
// runId. Leases are written exclusively by the dispatch worker (two-ledger
// rule): created at dispatch, completed by the watcher / reconcile /
// send-failure — never by wake arrivals or task progression. "Open" means
// status='active' and nothing else — the retired `paused` status must never
// count as occupancy again, so every open-lease query pins status='active'.

function mapLease(row: any): WakeRouteLease {
  return {
    ...row,
    task_key: row.task_key ?? '',
    activity_time: Number(row.activity_time ?? row.update_time),
    create_time: Number(row.create_time),
    update_time: Number(row.update_time)
  };
}

export class LeaseRepository {
  constructor(private readonly pool: Pool) {}

  async create(lease: WakeRouteLease) {
    await this.pool.query(
      `INSERT INTO wake_route_lease (id, route_id, wake_id, wake_task_status, task_key, activity_time, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [lease.id, lease.route_id, lease.wake_id, lease.wake_task_status, lease.task_key, lease.activity_time, lease.status, lease.create_time, lease.update_time]
    );
    return lease;
  }

  async findById(leaseId: string): Promise<WakeRouteLease | null> {
    const result = await this.pool.query('SELECT * FROM wake_route_lease WHERE id=$1 LIMIT 1', [leaseId]);
    return result.rows[0] ? mapLease(result.rows[0]) : null;
  }

  /** The open lease with this id (= runId), if any. The watcher's lookup. */
  async findOpenById(leaseId: string): Promise<WakeRouteLease | null> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE id=$1 AND status='active' LIMIT 1`,
      [leaseId]
    );
    return result.rows[0] ? mapLease(result.rows[0]) : null;
  }

  /** The wake's open lease, if any (at most one exists by invariant). */
  async findOpenByWakeId(wakeId: string): Promise<WakeRouteLease | null> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE wake_id=$1 AND status='active' LIMIT 1`,
      [wakeId]
    );
    return result.rows[0] ? mapLease(result.rows[0]) : null;
  }

  /**
   * Task-turn gate read (spec_wakery-dispatch-worker.md Stage 1): the open
   * lease for a task_key on ANY route — an open turn anywhere blocks every
   * wake of that task.
   */
  async findOpenByTaskKey(taskKey: string): Promise<WakeRouteLease | null> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE task_key=$1 AND status='active' LIMIT 1`,
      [taskKey]
    );
    return result.rows[0] ? mapLease(result.rows[0]) : null;
  }

  /** All open leases — the reconnect bulk-reconcile set. */
  async findAllOpen(): Promise<WakeRouteLease[]> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE status='active' ORDER BY activity_time ASC`
    );
    return result.rows.map(mapLease);
  }

  /**
   * Quiet open leases: activity_time older than the cutoff — the quiet-lease
   * reconcile's selection (the absorbed probe duty).
   */
  async findQuietOpen(activityCutoffMs: number): Promise<WakeRouteLease[]> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE status='active' AND activity_time < $1 ORDER BY activity_time ASC`,
      [activityCutoffMs]
    );
    return result.rows.map(mapLease);
  }

  /**
   * Open leases across a whole project (stall predicate, self-healing F2):
   * the lease row carries no project column, so the read joins through the
   * wake the lease serves. excludeTaskId keeps the stall-notice turn's own
   * lease out of the count — the confession must not read as activity.
   */
  async countOpenByProjectId(projectId: string, excludeTaskId?: string): Promise<number> {
    const result = excludeTaskId === undefined
      ? await this.pool.query(
          `SELECT COUNT(*)::int AS count
             FROM wake_route_lease l
             JOIN wake w ON w.id = l.wake_id
            WHERE l.status='active' AND w.project_id=$1`,
          [projectId]
        )
      : await this.pool.query(
          `SELECT COUNT(*)::int AS count
             FROM wake_route_lease l
             JOIN wake w ON w.id = l.wake_id
            WHERE l.status='active' AND w.project_id=$1 AND w.task_id<>$2`,
          [projectId, excludeTaskId]
        );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Route occupancy = the count of open leases on the route (contracts §5). */
  async countOpenByRouteId(routeId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM wake_route_lease WHERE route_id=$1 AND status='active'`,
      [routeId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Idempotent, terminal completion: watcher, reconcile, and send-failure
   * converge here. Returns true when this call performed the transition,
   * false when the lease was already terminal (or unknown) — the caller emits
   * the completion event only on a real transition.
   */
  async complete(leaseId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE wake_route_lease SET status='completed', update_time=$2 WHERE id=$1 AND status='active'`,
      [leaseId, Date.now()]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Refresh operational recency: the watcher calls this on ANY agent-family
   * event carrying an open lease's runId (assistant chunks, tool traffic,
   * heartbeats, non-terminal lifecycle phases).
   */
  async touchActivity(leaseId: string) {
    await this.pool.query(
      `UPDATE wake_route_lease SET activity_time=$2, update_time=$2 WHERE id=$1 AND status='active'`,
      [leaseId, Date.now()]
    );
  }

  /** The wake's most recent lease of any status (diagnostics, tests). */
  async findLatestByWakeId(wakeId: string): Promise<WakeRouteLease | null> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE wake_id=$1 ORDER BY create_time DESC LIMIT 1`,
      [wakeId]
    );
    return result.rows[0] ? mapLease(result.rows[0]) : null;
  }

  /**
   * The wake's most recent completed lease — the previous turn's end marker,
   * feeding the re-wake template's {{last_turn_minutes_ago}}.
   */
  async findLatestCompletedByWakeId(wakeId: string): Promise<WakeRouteLease | null> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE wake_id=$1 AND status='completed' ORDER BY update_time DESC LIMIT 1`,
      [wakeId]
    );
    return result.rows[0] ? mapLease(result.rows[0]) : null;
  }

  /** All leases for a wake, oldest first (tests, diagnostics). */
  async listByWakeId(wakeId: string): Promise<WakeRouteLease[]> {
    const result = await this.pool.query(
      `SELECT * FROM wake_route_lease WHERE wake_id=$1 ORDER BY create_time ASC`,
      [wakeId]
    );
    return result.rows.map(mapLease);
  }
}
