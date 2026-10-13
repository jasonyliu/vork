/**
 * F6/F9 cutover — the DATA acts of the platform-keying window
 * (specs/data/spec_database.md §Cutover migration, acts 2–6), run once on the
 * live DB inside the deployment window, after `npm run migrate` (structure) and
 * before the role flip. Idempotent: every act no-ops once applied, so an
 * interrupted window resumes by re-running.
 *
 * Ordered acts:
 *   2. registry rows — via the canonical seed
 *   3. github_repo_project.project_id backfill (github_repo = registry slug),
 *      then tighten NOT NULL + UNIQUE
 *   4. re-key route/wake/snooze project_id from the ProjectV2 node id to
 *      project.id (join through the mapping); recompute wake.task_key and
 *      wake.state_key for ALL rows (both derive from project_id); re-sync
 *      wake_route_lease.task_key from each lease's wake — skipping this
 *      orphans every open wake and lease at the cutover
 *   5. project_risk_mapping FK (column already renamed by migrate)
 *   6. remaining FKs NOT VALID → VALIDATE
 *
 * The database rename (`ALTER DATABASE wakery RENAME TO vork`), the role
 * creation/flip, and the `.env` updates are operator acts (specs/data/
 * spec_database.md §Cutover migration) — a connection cannot rename the
 * database it sits in, and roles are cluster acts.
 *
 * `--dry-run` wraps everything in one transaction and rolls back, printing the
 * would-be counts — the dry-check the decomposition requires before the flip.
 */
import type { Queryable } from './queryable.js';
import { seedProjects } from './seed.js';
import { mintId } from './ids.js';

// Legacy boards: ProjectV2 node ids of retired predecessor boards whose flow
// and config history must survive the cutover under their own registry
// identity — never folded into a live project (old task_ids would collide in
// the task_key space).
//
// ENVIRONMENT INPUT — no default. The original instance listed its pre-rename
// board here; an operator lists their own retired boards, or none.
export interface LegacyBoard {
  github_project_id: string;
  slug: string;
  name: string;
}

export const LEGACY_BOARDS: LegacyBoard[] = [];

export interface CutoverReport {
  registry_inserted: number;
  legacy_projects: string[];
  mappings_backfilled: number;
  unmapped_mappings: string[];
  routes_rekeyed: number;
  wakes_rekeyed: number;
  snoozes_rekeyed: number;
  wake_keys_recomputed: number;
  lease_keys_resynced: number;
  orphan_open_wakes: number;
  orphan_open_leases: number;
  fk_acts: string[];
}

async function foreignKeyState(pool: Queryable, table: string): Promise<'absent' | 'unvalidated' | 'valid'> {
  // pg_constraint.convalidated distinguishes an FK an interrupted run left
  // NOT VALID (must still be validated on resume) from a settled one; engines
  // without pg_constraint semantics (pg-mem) surface constraints as valid
  try {
    const probe = await pool.query(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'f' LIMIT 1`,
      [table]
    );
    if ((probe.rowCount ?? 0) === 0) return 'absent';
    return probe.rows[0].convalidated === false ? 'unvalidated' : 'valid';
  } catch {
    const fallback = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = $1 AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
      [table]
    );
    return (fallback.rowCount ?? 0) > 0 ? 'valid' : 'absent';
  }
}

export async function cutoverPlatformKeying(pool: Queryable, legacyBoards: LegacyBoard[] = LEGACY_BOARDS): Promise<CutoverReport> {
  const report: CutoverReport = {
    registry_inserted: 0,
    legacy_projects: [],
    mappings_backfilled: 0,
    unmapped_mappings: [],
    routes_rekeyed: 0,
    wakes_rekeyed: 0,
    snoozes_rekeyed: 0,
    wake_keys_recomputed: 0,
    lease_keys_resynced: 0,
    orphan_open_wakes: 0,
    orphan_open_leases: 0,
    fk_acts: []
  };

  // act 2 — registry rows, plus the retired legacy identities (status
  // `deleted` from birth — the registry records that they existed; spec §11:
  // retire by status, never DELETE)
  const seeded = await seedProjects(pool);
  report.registry_inserted = seeded.inserted;
  for (const legacy of legacyBoards) {
    const exists = await pool.query(`SELECT id FROM project WHERE project = $1 LIMIT 1`, [legacy.slug]);
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO project (id, project, name, status, create_time, update_time)
         VALUES ($1,$2,$3,'deleted',$4,$4)`,
        [mintId('prj'), legacy.slug, legacy.name, Date.now()]
      );
    }
    report.legacy_projects.push(legacy.slug);
  }

  // act 3 — mapping backfill (foundry convention: repo is named by the project
  // key, so github_repo joins the registry slug), then tighten
  const backfill = await pool.query(
    `UPDATE github_repo_project SET project_id = p.id
       FROM project p
      WHERE github_repo_project.github_repo = p.project AND github_repo_project.project_id IS NULL`
  );
  report.mappings_backfilled = backfill.rowCount ?? 0;
  const unmapped = await pool.query(`SELECT github_repo FROM github_repo_project WHERE project_id IS NULL`);
  report.unmapped_mappings = unmapped.rows.map((r: any) => r.github_repo);
  if (report.unmapped_mappings.length > 0) {
    throw new Error(
      `mapping rows with no registry project: ${report.unmapped_mappings.join(', ')} — register them before the cutover`
    );
  }
  await pool.query(`ALTER TABLE github_repo_project ALTER COLUMN project_id SET NOT NULL`);
  const uniqueProbe = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'github_repo_project' AND constraint_type = 'UNIQUE' AND constraint_name = 'github_repo_project_project_id_key' LIMIT 1`
  );
  if ((uniqueProbe.rowCount ?? 0) === 0) {
    try {
      await pool.query(`ALTER TABLE github_repo_project ADD CONSTRAINT github_repo_project_project_id_key UNIQUE (project_id)`);
      report.fk_acts.push('github_repo_project_project_id_key UNIQUE added');
    } catch {
      // fresh-DB inline UNIQUE materialized under a different name — the
      // constraint is in force either way
    }
  }

  // act 4 — re-key the runtime rows from the ProjectV2 node id to project.id:
  // first through the live mapping, then the legacy boards to their retired
  // registry identities (history preserved under a distinct key space)
  let routesRekeyed = 0;
  let wakesRekeyed = 0;
  let snoozesRekeyed = 0;
  const rekeyRoute = await pool.query(
    `UPDATE route SET project_id = g.project_id
       FROM github_repo_project g WHERE route.project_id = g.github_project_id`
  );
  routesRekeyed += rekeyRoute.rowCount ?? 0;
  const rekeyWake = await pool.query(
    `UPDATE wake SET project_id = g.project_id
       FROM github_repo_project g WHERE wake.project_id = g.github_project_id`
  );
  wakesRekeyed += rekeyWake.rowCount ?? 0;
  const rekeySnooze = await pool.query(
    `UPDATE snooze SET project_id = g.project_id
       FROM github_repo_project g WHERE snooze.project_id = g.github_project_id`
  );
  snoozesRekeyed += rekeySnooze.rowCount ?? 0;
  for (const legacy of legacyBoards) {
    const legacyId = (await pool.query(`SELECT id FROM project WHERE project = $1`, [legacy.slug])).rows[0].id as string;
    routesRekeyed += (await pool.query(`UPDATE route SET project_id = $1 WHERE project_id = $2`, [legacyId, legacy.github_project_id])).rowCount ?? 0;
    wakesRekeyed += (await pool.query(`UPDATE wake SET project_id = $1 WHERE project_id = $2`, [legacyId, legacy.github_project_id])).rowCount ?? 0;
    snoozesRekeyed += (await pool.query(`UPDATE snooze SET project_id = $1 WHERE project_id = $2`, [legacyId, legacy.github_project_id])).rowCount ?? 0;
  }
  report.routes_rekeyed = routesRekeyed;
  report.wakes_rekeyed = wakesRekeyed;
  report.snoozes_rekeyed = snoozesRekeyed;

  // any route still unresolvable is an operator problem — active or not, the
  // FK cannot land over it; abort naming the rows (register the board as a
  // legacy identity or dispose of the rows deliberately, never silently)
  const unresolvable = await pool.query(
    `SELECT r.id, r.project_id, r.status
       FROM route r LEFT JOIN project p ON p.id = r.project_id
      WHERE p.id IS NULL`
  );
  if ((unresolvable.rowCount ?? 0) > 0) {
    throw new Error(
      `route(s) reference unregistered projects: ${unresolvable.rows
        .map((r: any) => `${r.id} (${r.project_id}, ${r.status})`)
        .join(', ')} — add the board to LEGACY_BOARDS or dispose deliberately before the cutover`
    );
  }

  // recompute both derived keys for ALL wake rows (`shared/ids.ts` shapes:
  // md5(project_id:task_id) and md5(project_id:task_id:task_status:task_audit))
  const recompute = await pool.query(
    `UPDATE wake SET
       task_key = md5(project_id || ':' || task_id),
       state_key = md5(project_id || ':' || task_id || ':' || task_status || ':' || task_audit)
     WHERE task_key <> md5(project_id || ':' || task_id)
        OR state_key <> md5(project_id || ':' || task_id || ':' || task_status || ':' || task_audit)`
  );
  report.wake_keys_recomputed = recompute.rowCount ?? 0;

  // re-sync every lease's task_key from its wake
  const resync = await pool.query(
    `UPDATE wake_route_lease SET task_key = w.task_key
       FROM wake w
      WHERE wake_route_lease.wake_id = w.id
        AND (wake_route_lease.task_key IS NULL OR wake_route_lease.task_key <> w.task_key)`
  );
  report.lease_keys_resynced = resync.rowCount ?? 0;

  // orphan checks — the window's zero-orphan gate (milestone §Verification)
  const orphanWakes = await pool.query(
    `SELECT count(*)::int AS n
       FROM wake LEFT JOIN project ON project.id = wake.project_id
      WHERE wake.status IN ('pending','queued','parked','dispatched')
        AND project.id IS NULL`
  );
  report.orphan_open_wakes = Number(orphanWakes.rows[0].n);
  const orphanLeases = await pool.query(
    `SELECT count(*)::int AS n
       FROM wake_route_lease l
       LEFT JOIN wake w ON w.id = l.wake_id AND w.task_key = l.task_key
      WHERE l.status = 'active' AND w.id IS NULL`
  );
  report.orphan_open_leases = Number(orphanLeases.rows[0].n);
  if (report.orphan_open_wakes > 0 || report.orphan_open_leases > 0) {
    throw new Error(
      `cutover would orphan ${report.orphan_open_wakes} open wake(s) / ${report.orphan_open_leases} open lease(s) — investigate before proceeding`
    );
  }

  // acts 5+6 — config-plane FKs, NOT VALID first, validated after the data
  // above. A table already carrying an FK (fresh-DB inline REFERENCES) skips.
  const fkPlan: { table: string; name: string; sql: string }[] = [
    {
      table: 'github_repo_project',
      name: 'github_repo_project_project_id_fkey',
      sql: `ALTER TABLE github_repo_project ADD CONSTRAINT github_repo_project_project_id_fkey
              FOREIGN KEY (project_id) REFERENCES project(id) NOT VALID`
    },
    {
      table: 'route',
      name: 'route_project_id_fkey',
      sql: `ALTER TABLE route ADD CONSTRAINT route_project_id_fkey
              FOREIGN KEY (project_id) REFERENCES project(id) NOT VALID`
    },
    {
      table: 'project_risk_mapping',
      name: 'project_risk_mapping_project_fkey',
      sql: `ALTER TABLE project_risk_mapping ADD CONSTRAINT project_risk_mapping_project_fkey
              FOREIGN KEY (project) REFERENCES project(project) NOT VALID`
    }
  ];
  for (const fk of fkPlan) {
    const state = await foreignKeyState(pool, fk.table);
    if (state === 'valid') {
      report.fk_acts.push(`${fk.table}: FK already present`);
      continue;
    }
    if (state === 'unvalidated') {
      // an interrupted run added the FK NOT VALID — finish the validation
      await pool.query(`ALTER TABLE ${fk.table} VALIDATE CONSTRAINT ${fk.name}`);
      report.fk_acts.push(`${fk.name} validated (resume)`);
      continue;
    }
    try {
      await pool.query(fk.sql);
      await pool.query(`ALTER TABLE ${fk.table} VALIDATE CONSTRAINT ${fk.name}`);
      report.fk_acts.push(`${fk.name} added + validated`);
    } catch (error) {
      // engines without NOT VALID / VALIDATE CONSTRAINT (pg-mem in the
      // dry-check) take the plain form — immediately validated, equivalent on
      // data the acts above just made consistent
      if (!/NOT VALID|VALIDATE|parse/i.test(error instanceof Error ? error.message : String(error))) throw error;
      await pool.query(fk.sql.replace(/\s+NOT VALID$/, ''));
      report.fk_acts.push(`${fk.name} added (plain form)`);
    }
  }

  return report;
}

