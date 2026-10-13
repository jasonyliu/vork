/**
 * Canonical core-data seed for Wakery — idempotent (insert-if-not-exists).
 *
 * TWO-FILE DATA MODEL (2026-06-11):
 *   - `migrate.ts` owns DB **structure** only (tables, columns, indexes). No data.
 *   - `seed.ts` (this file) owns all canonical **core data**, upserted idempotently.
 *     It is re-run on a fresh/restored DB after migrations; re-running is a no-op.
 *
 * TABLES THIS SEED KEEPS IN SYNC (the canonical set — keep this list current; when a
 * milestone changes the core data of any of these, this file is the place to update):
 *   0. project             — the platform registry (slug is the unique key)
 *   1. github_agent        — bounded identity set (`agent_id` is the unique key)
 *   2. github_repo_project — platform project ↔ GitHub repo/board mapping
 *   3. task_type_label     — the 15 canonical task types (Stage-6 validation authority)
 *   4. project_risk_mapping — Resolver wildcard risk map (54 wildcard rows, 0 overlay)
 *   5. route               — dispatch routing table
 *
 * Run:  npm run seed  (apps/data — loads migrations first, then seeds; vork_owner)
 */
import type { Queryable } from './queryable.js';
import { mintId } from './ids.js';
import { routeTemplate, type RouteSeed, type Specialist } from './routes.js';

export interface SeedResult { table: string; total: number; inserted: number; skipped: number; }

// ──────────────────────────────── 0. project ────────────────────────────────
// The platform registry (specs/data/spec_database.md §11) — seeded FIRST so the
// config-plane FKs (github_repo_project, route, risk-mapping overlays) have
// their parent. Idempotency key = project slug (UNIQUE). The platform's own
// project is the one row the seed carries; every other project is registered
// by foundry's register stage at its founding.
export interface ProjectSeed { project: string; name: string; }
export const PROJECT_SEED: ProjectSeed[] = [
  { project: 'vork', name: 'vork' }
];

export async function seedProjects(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const proj of PROJECT_SEED) {
    const exists = await pool.query('SELECT 1 FROM project WHERE project=$1 LIMIT 1', [proj.project]);
    if (exists.rows.length > 0) { skipped++; continue; }
    const ts = now();
    await pool.query(
      `INSERT INTO project (id, project, name, status, create_time, update_time)
       VALUES ($1,$2,$3,'active',$4,$4)`,
      [mintId('prj'), proj.project, proj.name, ts]
    );
    inserted++;
  }
  return { table: 'project', total: PROJECT_SEED.length, inserted, skipped };
}

// helper: resolve a registry slug to its platform id (seed-time lookups)
export async function projectIdBySlug(pool: Queryable, slug: string): Promise<string> {
  const r = await pool.query('SELECT id FROM project WHERE project=$1 LIMIT 1', [slug]);
  if (r.rows.length === 0) throw new Error(`project registry missing slug: ${slug}`);
  return r.rows[0].id as string;
}

// ───────────────────────────── 1. github_agent ─────────────────────────────
// Bounded identity model: identity is `agent_id`; multiple agent_ids may share one
// GitHub login (the shared worker login → {main, visor}). Idempotency key = agent_id.
//
// ENVIRONMENT INPUT — no default. The rows are the operator's own GitHub accounts
// (the Principal's, the shared worker account's, the auditor's) with their logins
// and node ids; the original instance's rows are not carried. Fill this array
// before `npm run seed`, or write the rows by hand; foundry's register stage adds
// a crew/specialist row per project it founds.
export interface GithubAgentSeed { github_login: string; github_node_id: string; agent_id: string; agent_name: string; role: 'principal' | 'auditor' | 'agent'; }
export const GITHUB_AGENT_SEED: GithubAgentSeed[] = [];

export async function seedGithubAgents(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const a of GITHUB_AGENT_SEED) {
    const exists = await pool.query('SELECT 1 FROM github_agent WHERE agent_id=$1 LIMIT 1', [a.agent_id]);
    if (exists.rows.length > 0) { skipped++; continue; }
    const ts = now();
    await pool.query(
      `INSERT INTO github_agent (id, github_login, github_node_id, agent_id, agent_name, role, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7)`,
      [mintId('ga'), a.github_login, a.github_node_id, a.agent_id, a.agent_name, a.role, ts]
    );
    inserted++;
  }
  return { table: 'github_agent', total: GITHUB_AGENT_SEED.length, inserted, skipped };
}

// ─────────────────────────── 2. github_repo_project ───────────────────────────
// The platform project's repo ↔ its GitHub Project V2. Idempotency key =
// github_repo_id (UNIQUE). The platform project_id resolves from the registry
// slug at seed time.
//
// ENVIRONMENT INPUT — no default. The row is the operator's own repo and board
// (node ids, owner login, board number); the original instance's row is not
// carried. Fill it before `npm run seed`; foundry's register stage writes the
// mapping for every project it founds.
export interface RepoProjectSeed { project: string; github_repo_id: string; github_owner_id: string; github_owner_name: string; github_repo: string; github_project_id: string; github_project_number: number | null; github_project_title: string; }
export const GITHUB_REPO_PROJECT_SEED: RepoProjectSeed[] = [];

export async function seedRepoProjects(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const rp of GITHUB_REPO_PROJECT_SEED) {
    const exists = await pool.query('SELECT 1 FROM github_repo_project WHERE github_repo_id=$1 LIMIT 1', [rp.github_repo_id]);
    if (exists.rows.length > 0) { skipped++; continue; }
    const projectId = await projectIdBySlug(pool, rp.project);
    const ts = now();
    await pool.query(
      `INSERT INTO github_repo_project (id, project_id, github_repo_id, github_owner_id, github_owner_name, github_repo, github_project_id, github_project_number, github_project_title, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)`,
      [mintId('grp'), projectId, rp.github_repo_id, rp.github_owner_id, rp.github_owner_name, rp.github_repo, rp.github_project_id, rp.github_project_number, rp.github_project_title, ts]
    );
    inserted++;
  }
  return { table: 'github_repo_project', total: GITHUB_REPO_PROJECT_SEED.length, inserted, skipped };
}

// ──────────────────────────── 3. task_type_label ────────────────────────────
// The 17 canonical task types — the Stage-6 validation authority. Kept in sync
// 3 ways: this seed ↔ prod DB ↔ GitHub `type:*` labels. `purpose` mirrors the
// GitHub label description. Retire a type with `active=false` (not a delete).
export interface TaskTypeLabelSeed { type_value: string; label: string; purpose: string; }
export const TASK_TYPE_LABEL_SEED: TaskTypeLabelSeed[] = [
  // Stage Task types (DELIVERY.md §Stages) — 9
  { type_value: 'project_inception', label: 'Project Inception', purpose: 'Inception Stage Task' },
  { type_value: 'project_draft', label: 'Project Draft', purpose: 'Draft Stage Task' },
  { type_value: 'project_decomposition', label: 'Project Decomposition', purpose: 'Decomposition Stage Task' },
  { type_value: 'project_integration', label: 'Project Integration', purpose: 'Integration Stage Task — merge a feature branch into dev (PROJECT.md §Integration)' },
  { type_value: 'project_review', label: 'Project Review', purpose: 'Review Stage Task' },
  { type_value: 'project_release', label: 'Project Release', purpose: 'Release Stage Task' },
  { type_value: 'project_deployment', label: 'Project Deployment', purpose: 'Deployment Stage Task (DELIVERY.md §Deployment)' },
  { type_value: 'project_operation', label: 'Project Operation', purpose: 'Operation Stage Task' },
  { type_value: 'project_hotfix', label: 'Project Hotfix', purpose: 'Hotfix Stage Task (DELIVERY.md §Hotfix)' },
  // Execution Task types — 8
  { type_value: 'spec', label: 'Spec', purpose: 'Produces a spec' },
  { type_value: 'research', label: 'Research', purpose: 'Produces a research record' },
  { type_value: 'coding', label: 'Coding', purpose: 'Produces implementation work' },
  { type_value: 'bug', label: 'Bug', purpose: 'Bug' },
  { type_value: 'enhancement', label: 'Enhancement', purpose: 'Enhancement' },
  { type_value: 'deliberation', label: 'Deliberation', purpose: 'Documentation or policy writing with governing effect, per FRAMEWORK.md §Amendment' },
  { type_value: 'dbops', label: 'DB Ops', purpose: 'Live-database operation (data/role reconciliation), not a repo commit' },
  { type_value: 'defect', label: 'Defect', purpose: 'A defect — wrong/inconsistent but not a feature; small fix to circle back to' }
];

export async function seedTaskTypeLabels(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const t of TASK_TYPE_LABEL_SEED) {
    const exists = await pool.query('SELECT 1 FROM task_type_label WHERE type_value=$1 LIMIT 1', [t.type_value]);
    if (exists.rows.length > 0) { skipped++; continue; }
    const ts = now();
    await pool.query(
      `INSERT INTO task_type_label (type_value, label, purpose, active, create_time, update_time)
       VALUES ($1,$2,$3,TRUE,$4,$4)`,
      [t.type_value, t.label, t.purpose, ts]
    );
    inserted++;
  }
  return { table: 'task_type_label', total: TASK_TYPE_LABEL_SEED.length, inserted, skipped };
}

// ────────────────────────── 4. project_risk_mapping ──────────────────────────
// Resolver wildcard primitive map (project NULL). 54 rows = the 30 from the
// resolver survey's practical wildcard primitive set + 16 added via live hotfix
// (2026-06-04..06-11) to retire R999 Govern loops on common ops + 3 data-op rows
// from live conduction (2026-08-06..08-08: PR-flow submit/update×repository×external,
// inspect×surface×external for a stall fix; live-first, reflected here 2026-08-12)
// + 5 deployment-verification primitives from a Principal-ruled R999 Preview
// (2026-08-09). The platform seed carries no overlay rows — partial overlays
// became safe when the chain-level lock-in rule was retired (spec_resolver.md
// §Stage 2, amended 2026-08-12). Idempotency is partition-aware (a wildcard row
// and a project row for the same cell are distinct).
// Breakdown: 11×R100, 27×R200, 13×R300, 3×R999.
export interface RiskMappingSeed { project: string | null; action: string; subject: string; zone: string; risk_code: 'R100' | 'R200' | 'R300' | 'R999'; }
export const RISK_MAPPING_WILDCARD_ROWS: RiskMappingSeed[] = [
  // R100 — observe (11)
  { project: null, action: 'enumerate', subject: 'repository', zone: 'workspace', risk_code: 'R100' },
  { project: null, action: 'inspect', subject: 'file', zone: 'local', risk_code: 'R100' },
  { project: null, action: 'inspect', subject: 'file', zone: 'workspace', risk_code: 'R100' },
  { project: null, action: 'inspect', subject: 'job', zone: 'external', risk_code: 'R100' },
  { project: null, action: 'inspect', subject: 'repository', zone: 'external', risk_code: 'R100' },
  { project: null, action: 'inspect', subject: 'repository', zone: 'workspace', risk_code: 'R100' },
  { project: null, action: 'inspect', subject: 'service', zone: 'external', risk_code: 'R100' },
  { project: null, action: 'query', subject: 'record', zone: 'internal', risk_code: 'R100' },
  { project: null, action: 'query', subject: 'record', zone: 'workspace', risk_code: 'R100' },
  { project: null, action: 'read', subject: 'file', zone: 'workspace', risk_code: 'R100' },
  { project: null, action: 'read', subject: 'repository', zone: 'workspace', risk_code: 'R100' },
  // R200 — active (27)
  { project: null, action: 'append', subject: 'file', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'create', subject: 'file', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'create', subject: 'identity', zone: 'internal', risk_code: 'R200' },
  { project: null, action: 'create', subject: 'record', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'create', subject: 'record', zone: 'internal', risk_code: 'R200' },
  { project: null, action: 'create', subject: 'record', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'create', subject: 'store', zone: 'internal', risk_code: 'R200' },
  { project: null, action: 'inspect', subject: 'surface', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'interpret', subject: 'job', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'invoke', subject: 'endpoint', zone: 'local', risk_code: 'R200' },
  { project: null, action: 'invoke', subject: 'endpoint', zone: 'public', risk_code: 'R200' },
  { project: null, action: 'invoke', subject: 'job', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'move', subject: 'file', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'push', subject: 'repository', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'read', subject: 'credential', zone: 'internal', risk_code: 'R200' },
  { project: null, action: 'read', subject: 'record', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'send', subject: 'message', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'submit', subject: 'endpoint', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'submit', subject: 'endpoint', zone: 'internal', risk_code: 'R200' },
  { project: null, action: 'submit', subject: 'repository', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'file', zone: 'local', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'file', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'identity', zone: 'internal', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'record', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'record', zone: 'workspace', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'repository', zone: 'external', risk_code: 'R200' },
  { project: null, action: 'update', subject: 'repository', zone: 'workspace', risk_code: 'R200' },
  // R300 — sensitive / destructive (13)
  { project: null, action: 'control', subject: 'service', zone: 'external', risk_code: 'R300' },
  { project: null, action: 'control', subject: 'service', zone: 'internal', risk_code: 'R300' },
  { project: null, action: 'create', subject: 'config', zone: 'internal', risk_code: 'R300' },
  { project: null, action: 'create', subject: 'credential', zone: 'internal', risk_code: 'R300' },
  { project: null, action: 'create', subject: 'permission', zone: 'internal', risk_code: 'R300' },
  { project: null, action: 'delete', subject: 'file', zone: 'workspace', risk_code: 'R300' },
  { project: null, action: 'delete', subject: 'record', zone: 'workspace', risk_code: 'R300' },
  { project: null, action: 'truncate', subject: 'file', zone: 'workspace', risk_code: 'R300' },
  { project: null, action: 'update', subject: 'config', zone: 'internal', risk_code: 'R300' },
  { project: null, action: 'update', subject: 'config', zone: 'workspace', risk_code: 'R300' },
  { project: null, action: 'update', subject: 'permission', zone: 'internal', risk_code: 'R300' },
  { project: null, action: 'update', subject: 'policy', zone: 'workspace', risk_code: 'R300' },
  { project: null, action: 'update', subject: 'store', zone: 'workspace', risk_code: 'R300' },
  // R999 — boundary / Govern (3)
  { project: null, action: 'delete', subject: 'repository', zone: 'external', risk_code: 'R999' },
  { project: null, action: 'publish', subject: 'publication', zone: 'public', risk_code: 'R999' },
  { project: null, action: 'revoke', subject: 'permission', zone: 'external', risk_code: 'R999' }
];
// Project overlay rows: none in the platform seed. An overlay row loosens or
// tightens one cell for one project — e.g. a deployment manual's conditional
// rollback (previous known-good only, on a failed attempt only) at R200 while
// the wildcard stays a conservative R300, since a failed deployment already
// Governs unconditionally post-execution (SECURITY.md §Outcome). Overlay rows
// are deploy-time data per project; they require the partial-overlay resolution
// rule (spec_resolver.md §Stage 2, 2026-08-12).
export const RISK_MAPPING_OVERLAY_ROWS: RiskMappingSeed[] = [];
export const RISK_MAPPING_ROWS: RiskMappingSeed[] = [...RISK_MAPPING_WILDCARD_ROWS, ...RISK_MAPPING_OVERLAY_ROWS];

async function riskRowExists(pool: Queryable, row: RiskMappingSeed): Promise<boolean> {
  const r = row.project === null
    ? await pool.query('SELECT 1 FROM project_risk_mapping WHERE project IS NULL AND action=$1 AND subject=$2 AND zone=$3 LIMIT 1', [row.action, row.subject, row.zone])
    : await pool.query('SELECT 1 FROM project_risk_mapping WHERE project=$1 AND action=$2 AND subject=$3 AND zone=$4 LIMIT 1', [row.project, row.action, row.subject, row.zone]);
  return r.rows.length > 0;
}

export async function seedRiskMappings(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const row of RISK_MAPPING_ROWS) {
    if (await riskRowExists(pool, row)) { skipped++; continue; }
    const ts = now();
    await pool.query(
      `INSERT INTO project_risk_mapping (project, action, subject, zone, risk_code, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [row.project, row.action, row.subject, row.zone, row.risk_code, ts]
    );
    inserted++;
  }
  return { table: 'project_risk_mapping', total: RISK_MAPPING_ROWS.length, inserted, skipped };
}

// ───────────────────────────────── 5. route ─────────────────────────────────
// Dispatch routing. Resolution: exact (project_id, task_type, actor) → fallback
// to (project_id, task_type IS NULL, actor) within the same actor lane. The
// platform seed is the route template applied to the platform project
// (routes.ts — the same function foundry's register stage writes for every new
// project); live rows that predate the template keep their hand-grouped lanes —
// the (project_id, task_type, actor) idempotency key leaves them standing.
export const PLATFORM_SPECIALISTS: Specialist[] = [
  { name: 'visor', tasks: ['coding', 'bug', 'dbops', 'enhancement', 'defect'] }
];
export const ROUTE_SEED: RouteSeed[] = routeTemplate('vork', PLATFORM_SPECIALISTS);

async function routeExists(pool: Queryable, projectId: string, taskType: string | null, actor: string): Promise<boolean> {
  const r = taskType === null
    ? await pool.query("SELECT 1 FROM route WHERE project_id=$1 AND task_type IS NULL AND actor=$2 AND status='active' LIMIT 1", [projectId, actor])
    : await pool.query("SELECT 1 FROM route WHERE project_id=$1 AND task_type=$2 AND actor=$3 AND status='active' LIMIT 1", [projectId, taskType, actor]);
  return r.rows.length > 0;
}

export async function seedRoutes(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const r of ROUTE_SEED) {
    const projectId = await projectIdBySlug(pool, r.project);
    // Idempotency: one active route per (project, task_type, actor) — an
    // existing row stands whatever agent or session key it carries.
    if (await routeExists(pool, projectId, r.task_type, r.actor)) { skipped++; continue; }
    const ts = now();
    await pool.query(
      `INSERT INTO route (id, project_id, task_type, actor, session_key, agent_id, agent_name, delivery, max_run, status, create_time, update_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)`,
      [mintId('route'), projectId, r.task_type, r.actor, r.session_key, r.agent_id, r.agent_name, r.delivery, r.max_run, ts]
    );
    inserted++;
  }
  return { table: 'route', total: ROUTE_SEED.length, inserted, skipped };
}

// ────────────────────────── 6. snooze_task_type ──────────────────────────
// Which task types each snooze type may hold (spec_wakery-snooze-worker.md §Type
// registry; spec_wakery-contracts.md §10) — a query parameter of the CI/PR
// correlation lookup, data not code. Excluded by seed choice (laneless — no repo
// lane, no CI/PR to wait on): project_operation, project_deployment, dbops.
// Retire a pair with active=FALSE, never delete.
export const SNOOZE_TYPE_CI = 1;
export const SNOOZE_TYPE_PR = 2;
const REPO_CHANGING_TASK_TYPES = [
  'project_inception', 'project_draft', 'project_decomposition', 'project_integration',
  'project_review', 'project_release', 'project_hotfix',
  'spec', 'research', 'deliberation', 'coding', 'bug', 'enhancement', 'defect'
] as const;
export interface SnoozeTaskTypeSeed { snooze_type: number; task_type: string; }
export const SNOOZE_TASK_TYPE_SEED: SnoozeTaskTypeSeed[] = [SNOOZE_TYPE_CI, SNOOZE_TYPE_PR].flatMap(
  (snooze_type) => REPO_CHANGING_TASK_TYPES.map((task_type) => ({ snooze_type, task_type }))
);

export async function seedSnoozeTaskTypes(pool: Queryable, now: () => number = Date.now): Promise<SeedResult> {
  let inserted = 0, skipped = 0;
  for (const m of SNOOZE_TASK_TYPE_SEED) {
    const exists = await pool.query(
      'SELECT 1 FROM snooze_task_type WHERE snooze_type=$1 AND task_type=$2 LIMIT 1',
      [m.snooze_type, m.task_type]
    );
    if (exists.rows.length > 0) { skipped++; continue; }
    const ts = now();
    await pool.query(
      `INSERT INTO snooze_task_type (snooze_type, task_type, active, create_time, update_time)
       VALUES ($1,$2,TRUE,$3,$3)`,
      [m.snooze_type, m.task_type, ts]
    );
    inserted++;
  }
  return { table: 'snooze_task_type', total: SNOOZE_TASK_TYPE_SEED.length, inserted, skipped };
}

// ───────────────────────────────── runner ─────────────────────────────────
export async function runSeed(pool: Queryable, now: () => number = Date.now): Promise<SeedResult[]> {
  return [
    await seedProjects(pool, now),
    await seedGithubAgents(pool, now),
    await seedRepoProjects(pool, now),
    await seedTaskTypeLabels(pool, now),
    await seedRiskMappings(pool, now),
    await seedRoutes(pool, now),
    await seedSnoozeTaskTypes(pool, now)
  ];
}

