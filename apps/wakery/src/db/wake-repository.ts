import type { Pool } from 'pg';
import type { TaskRelations, Wake, WakeStatus } from '../shared/types.js';
import { makeStateKey } from '../shared/ids.js';

const NON_TERMINAL_STATUSES = ['pending', 'queued', 'parked', 'dispatched'] as const;

function mapWake(row: any): Wake {
  return {
    ...row,
    queue_attempts: Number(row.queue_attempts ?? 0),
    dispatch_attempts: Number(row.dispatch_attempts ?? 0),
    wake_attempts: Number(row.wake_attempts ?? 0),
    create_time: Number(row.create_time),
    update_time: Number(row.update_time),
    task_labels: row.task_labels ?? null,
    task_relations: row.task_relations ?? null,
    task_branch: row.task_branch ?? null
  };
}

export class WakeRepository {
  constructor(private readonly pool: Pool) {}

  async create(wake: Wake) {
    // task_branch is written at INSERT only — immutable once stored
    // (spec_wakery-conduction-chaining.md invariants); update() omits it.
    await this.pool.query(`INSERT INTO wake (
      id, task_key, state_key, project_id, project_name, task_id, task_type, task_title, task_priority,
      task_status, task_status_expected, task_audit, task_audit_expected, task_labels, task_relations, task_branch, task_payload,
      assignee_id, assignee_name, owner_id, owner_name,
      queue_attempts, dispatch_attempts, wake_attempts, status, create_time, update_time
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`, [
      wake.id, wake.task_key, wake.state_key, wake.project_id, wake.project_name, wake.task_id, wake.task_type, wake.task_title, wake.task_priority,
      wake.task_status, wake.task_status_expected, wake.task_audit, wake.task_audit_expected,
      wake.task_labels ? JSON.stringify(wake.task_labels) : null,
      wake.task_relations ? JSON.stringify(wake.task_relations) : null,
      wake.task_branch,
      wake.task_payload ? JSON.stringify(wake.task_payload) : null,
      wake.assignee_id, wake.assignee_name, wake.owner_id, wake.owner_name,
      wake.queue_attempts, wake.dispatch_attempts, wake.wake_attempts ?? 0, wake.status, wake.create_time, wake.update_time
    ]);
    return wake;
  }

  async update(wake: Wake) {
    await this.pool.query(`UPDATE wake SET
      task_title=$2, task_priority=$3,
      task_status=$4, task_status_expected=$5, task_audit=$6, task_audit_expected=$7,
      task_labels=$8::jsonb, task_relations=$9::jsonb,
      task_payload=$10::jsonb, assignee_id=$11, assignee_name=$12, owner_id=$13, owner_name=$14,
      task_type=$15, project_name=$16, queue_attempts=$17, dispatch_attempts=$18, status=$19, update_time=$20
      WHERE id=$1`, [
      wake.id, wake.task_title, wake.task_priority,
      wake.task_status, wake.task_status_expected, wake.task_audit, wake.task_audit_expected,
      wake.task_labels ? JSON.stringify(wake.task_labels) : null,
      wake.task_relations ? JSON.stringify(wake.task_relations) : null,
      wake.task_payload ? JSON.stringify(wake.task_payload) : null,
      wake.assignee_id, wake.assignee_name, wake.owner_id, wake.owner_name,
      wake.task_type, wake.project_name, wake.queue_attempts, wake.dispatch_attempts, wake.status, wake.update_time
    ]);
    return wake;
  }

  /**
   * Refresh task_relations on all open wakes for a given (project_id, task_id).
   * Used by the GitHub webhook handlers and the periodic stale-relations sweep.
   * Returns the number of wake rows affected.
   */
  async updateTaskRelationsByTaskId(
    projectId: string,
    taskId: string,
    taskRelations: TaskRelations | null
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE wake SET task_relations=$3::jsonb, update_time=$4
       WHERE project_id=$1 AND task_id=$2 AND status IN ('queued','parked','pending','dispatched')`,
      [projectId, taskId, taskRelations ? JSON.stringify(taskRelations) : null, Date.now()]
    );
    return result.rowCount ?? 0;
  }

  /**
   * List all open wakes whose Task carries a gating label (`task:parent` or
   * `task:blocked`). Used by the periodic stale-relations sweep — these are
   * the wakes whose dispatch eligibility depends on task_relations data and
   * benefits from periodic catch-up against missed webhooks. Label-membership
   * check uses a text-substring match for pg-mem compatibility (see
   * findSelectionCandidates).
   */
  async findOpenGated(): Promise<Wake[]> {
    const result = await this.pool.query(
      `SELECT * FROM wake
       WHERE status IN ('queued','parked','pending','dispatched')
         AND (
           task_labels::text LIKE '%"task:parent"%'
           OR task_labels::text LIKE '%"task:blocked"%'
         )`
    );
    return result.rows.map(mapWake);
  }

  async updateStatus(id: string, status: WakeStatus) {
    await this.pool.query('UPDATE wake SET status=$2, update_time=$3 WHERE id=$1', [id, status, Date.now()]);
  }

  async bumpDispatchAttempts(id: string, status: WakeStatus) {
    await this.pool.query(
      'UPDATE wake SET status=$2, dispatch_attempts=dispatch_attempts+1, update_time=$3 WHERE id=$1',
      [id, status, Date.now()]
    );
  }

  /**
   * A turn actually started (spec_wakery-dispatch-worker.md Stage 4, on send
   * success): status → dispatched, wake_attempts (turns-started counter) and
   * dispatch_attempts (selection pacing) both incremented.
   */
  async markDispatched(id: string) {
    await this.pool.query(
      `UPDATE wake SET status='dispatched', wake_attempts=wake_attempts+1, dispatch_attempts=dispatch_attempts+1, update_time=$2 WHERE id=$1`,
      [id, Date.now()]
    );
  }

  async bumpQueueAttempts(id: string) {
    await this.pool.query(
      'UPDATE wake SET queue_attempts=queue_attempts+1, update_time=$2 WHERE id=$1',
      [id, Date.now()]
    );
  }

  async graduateFromPending(id: string, taskStatus: string, taskAudit: string) {
    // Recompute state_key alongside the new task_status/task_audit so the
    // row's state signature stays consistent with its observed state. Without
    // this, Stage 3 reconciliation can spuriously close the wake when a
    // future same-state comment arrives because the stored state_key was
    // frozen at the original (pre-graduation) state.
    const row = await this.pool.query(
      'SELECT project_id, task_id FROM wake WHERE id=$1',
      [id]
    );
    if (!row.rows[0]) return;
    const { project_id, task_id } = row.rows[0];
    const newStateKey = makeStateKey(project_id, task_id, taskStatus, taskAudit);
    await this.pool.query(
      `UPDATE wake SET
         status='queued',
         task_status=$2, task_audit=$3,
         task_status_expected=NULL, task_audit_expected=NULL,
         state_key=$4,
         update_time=$5
       WHERE id=$1`,
      [id, taskStatus, taskAudit, newStateKey, Date.now()]
    );
  }

  async completeOpenByTaskKey(taskKey: string) {
    await this.pool.query(
      `UPDATE wake SET status='completed', update_time=$2 WHERE task_key=$1 AND status IN ('pending','queued','parked','dispatched')`,
      [taskKey, Date.now()]
    );
  }

  /**
   * Open wakes across a whole project (stall predicate, self-healing F2).
   * excludeTaskId keeps the synthetic stall-alarm wake itself out of the
   * count — its presence must not read as "the project has a wake".
   */
  async countOpenByProjectId(projectId: string, excludeTaskId?: string): Promise<number> {
    const result = excludeTaskId === undefined
      ? await this.pool.query(
          `SELECT COUNT(*)::int AS count FROM wake WHERE project_id=$1 AND status IN ('pending','queued','parked','dispatched')`,
          [projectId]
        )
      : await this.pool.query(
          `SELECT COUNT(*)::int AS count FROM wake WHERE project_id=$1 AND task_id<>$2 AND status IN ('pending','queued','parked','dispatched')`,
          [projectId, excludeTaskId]
        );
    return Number(result.rows[0]?.count ?? 0);
  }

  async findCurrentByTaskKey(taskKey: string) {
    const result = await this.pool.query(
      `SELECT * FROM wake WHERE task_key=$1 AND status IN ('pending','queued','parked','dispatched') ORDER BY create_time DESC LIMIT 1`,
      [taskKey]
    );
    return result.rows[0] ? mapWake(result.rows[0]) : null;
  }

  /**
   * The dispatch sweep's ordered candidate pool (spec_wakery-dispatch-worker.md
   * Stage 1): `queued` wakes plus `dispatched` wakes (the empty-run
   * candidates — the worker applies the open-lease and newest-open-wake
   * halves of the task-turn gate, the terminal-verifier guard, and the
   * re-wake cap per candidate, re-derived fresh each sweep).
   *
   * Rebound pacing rides here: dispatch_attempts > 0 requires update_time
   * older than the rebound cooldown; first-time wakes are not gated. The
   * retired dispatch grace window has no successor — the task-turn gate
   * supersedes it by fact.
   *
   * Two independent dispatch gates (see spec_wakery-task-relations.md):
   *   Parent gate:  task:parent  + task_relations.children    (must be total>0 AND total==completed)
   *   Blocked gate: task:blocked + task_relations.blocked_by  (must be total>0 AND total==completed),
   *                 scoped to the auditor's pre-execution queue (Todo:Gated) only —
   *                 SECURITY.md §R995 suspends the audit, not the Owner's lane
   *                 (self-healing F3: the any-state form ate the owner cue a
   *                 reclaim-created dependency needs).
   * Wakes without the corresponding label pass each gate unconditionally.
   *
   * Label-membership check uses a text-substring match on the JSONB array
   * serialized form (e.g. `["task:parent","type:spec"]`) rather than the
   * JSONB `@>` / `?` operators, because pg-mem (used in our tests) has
   * limited support for those operators. The quoted literal `"task:<x>"`
   * is unambiguous against the JSON serialization since label names are
   * not allowed to contain double-quote characters.
   */
  async findSelectionCandidates(reboundCooldownMs = 0, limit = 20) {
    const reboundCutoff = Date.now() - reboundCooldownMs;
    const result = await this.pool.query(
      `SELECT * FROM wake
       WHERE status IN ('queued','dispatched')
         AND (dispatch_attempts = 0 OR update_time <= $1)
         AND (
           task_labels IS NULL
           OR task_labels::text NOT LIKE '%"task:parent"%'
           OR (
             task_relations -> 'children' IS NOT NULL
             AND (task_relations->'children'->>'total')::int > 0
             AND (task_relations->'children'->>'total')::int = (task_relations->'children'->>'completed')::int
           )
         )
         AND (
           NOT (task_status = 'Todo' AND task_audit = 'Gated')
           OR task_labels IS NULL
           OR task_labels::text NOT LIKE '%"task:blocked"%'
           OR (
             task_relations -> 'blocked_by' IS NOT NULL
             AND (task_relations->'blocked_by'->>'total')::int > 0
             AND (task_relations->'blocked_by'->>'total')::int = (task_relations->'blocked_by'->>'completed')::int
           )
         )
       ORDER BY COALESCE(task_priority,0) DESC, update_time ASC
       LIMIT $2`,
      [reboundCutoff, limit]
    );
    return result.rows.map(mapWake);
  }

  async findPendingDueForSync(retryIntervalMs: number, maxAttempts: number) {
    const cutoff = Date.now() - retryIntervalMs;
    const result = await this.pool.query(
      `SELECT * FROM wake
       WHERE status='pending'
         AND queue_attempts < $1
         AND update_time < $2
       ORDER BY update_time ASC`,
      [maxAttempts, cutoff]
    );
    return result.rows.map(mapWake);
  }

  async findById(id: string) {
    const result = await this.pool.query('SELECT * FROM wake WHERE id=$1', [id]);
    return result.rows[0] ? mapWake(result.rows[0]) : null;
  }

  async listAll() {
    const result = await this.pool.query('SELECT * FROM wake ORDER BY create_time ASC');
    return result.rows.map(mapWake);
  }
}

export { NON_TERMINAL_STATUSES };
