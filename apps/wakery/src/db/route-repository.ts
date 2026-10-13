import type { Pool } from 'pg';
import type { Route, RouteActor, Wake } from '../shared/types.js';
import { resolveRouteActor } from '../shared/eligibility.js';

function mapRoute(row: any): Route {
  return { ...row, max_run: row.max_run == null ? null : Number(row.max_run), create_time: Number(row.create_time), update_time: Number(row.update_time) };
}

export class RouteRepository {
  constructor(private readonly pool: Pool) {}

  async create(route: Route) {
    await this.pool.query(`INSERT INTO route (id, project_id, task_type, actor, session_key, agent_id, agent_name, delivery, max_run, status, create_time, update_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      route.id, route.project_id, route.task_type, route.actor, route.session_key, route.agent_id, route.agent_name,
      route.delivery, route.max_run, route.status, route.create_time, route.update_time
    ]);
    return route;
  }

  async findById(routeId: string): Promise<Route | null> {
    const result = await this.pool.query('SELECT * FROM route WHERE id=$1 LIMIT 1', [routeId]);
    return result.rows[0] ? mapRoute(result.rows[0]) : null;
  }

  /**
   * Resolve the active route for a wake by its required actor lane.
   *
   * Per `spec_wakery-dispatch-worker.md` Stage 2: derive the actor from
   * the eligibility matrix on (`task_status`, `task_audit`), then look up
   * route by `(project_id, task_type, actor, status='active')` with a
   * `task_type IS NULL` fallback inside the same actor lane.
   */
  async resolveForWake(wake: Wake): Promise<Route | null> {
    const actor = resolveRouteActor(wake.task_status, wake.task_audit);
    if (!actor) return null;

    const exact = await this.pool.query(
      `SELECT * FROM route WHERE project_id=$1 AND task_type=$2 AND actor=$3 AND status='active' ORDER BY create_time DESC LIMIT 1`,
      [wake.project_id, wake.task_type, actor]
    );
    if (exact.rows[0]) return mapRoute(exact.rows[0]);

    const fallback = await this.pool.query(
      `SELECT * FROM route WHERE project_id=$1 AND task_type IS NULL AND actor=$2 AND status='active' ORDER BY create_time DESC LIMIT 1`,
      [wake.project_id, actor]
    );
    return fallback.rows[0] ? mapRoute(fallback.rows[0]) : null;
  }

  /**
   * Distinct concrete session keys on active session-delivery routes — the
   * gateway link's belt-and-braces `sessions.messages.subscribe {key}` set
   * (spec_wakery-openclaw-adapter.md Stage 1).
   */
  async listActiveSessionKeys(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT session_key FROM route
       WHERE status='active' AND delivery='session' AND session_key IS NOT NULL`
    );
    return result.rows.map((r: any) => String(r.session_key));
  }

  /**
   * Direct actor-keyed lookup, used by tests, diagnostics, and the bootstrap
   * scripts.
   */
  async findActiveByActor(projectId: string, taskType: string | null, actor: RouteActor): Promise<Route | null> {
    const result = await this.pool.query(
      taskType === null
        ? `SELECT * FROM route WHERE project_id=$1 AND task_type IS NULL AND actor=$2 AND status='active' ORDER BY create_time DESC LIMIT 1`
        : `SELECT * FROM route WHERE project_id=$1 AND task_type=$2 AND actor=$3 AND status='active' ORDER BY create_time DESC LIMIT 1`,
      taskType === null ? [projectId, actor] : [projectId, taskType, actor]
    );
    return result.rows[0] ? mapRoute(result.rows[0]) : null;
  }
}
