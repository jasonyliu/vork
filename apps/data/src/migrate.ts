import type { Queryable } from './queryable.js';

const migrationSql = `
-- The project registry (specs/data/spec_database.md §11): the parent entity for
-- per-project data and the platform key of the runtime. Pure platform identity —
-- GitHub coordinates live only in the integration mapping. Retire by status,
-- never DELETE (inbound FKs are RESTRICT by default).
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_agent (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  github_node_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);
-- Bounded-identity model: identity is agent_id (multiple agent_ids may share one login,
-- e.g. the shared worker login -> {main, visor}). The old composite (github_login, github_node_id)
-- unique encoded the retired per-agent-account model; agent_id is the unique key.
CREATE UNIQUE INDEX IF NOT EXISTS github_agent_agent_id_idx ON github_agent(agent_id);

-- The GitHub integration mapping (specs/data/spec_database.md §5): binds one
-- platform project to its GitHub coordinates — every GitHub-native field under
-- the github_ prefix; nothing outside this table (and github_agent) stores a
-- GitHub identifier. One repo per project (project_id UNIQUE), one project per
-- repo (github_repo_id UNIQUE). On existing DBs the platform project_id column
-- arrives nullable via the pre-SQL rename migration and is tightened NOT NULL
-- + UNIQUE + FK by the cutover window's data script post-backfill.
CREATE TABLE IF NOT EXISTS github_repo_project (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES project(id),
  github_repo_id TEXT NOT NULL UNIQUE,
  github_owner_id TEXT NOT NULL,
  github_owner_name TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_project_id TEXT NOT NULL,
  github_project_number INTEGER,
  github_project_title TEXT,
  status TEXT NOT NULL,
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS wake (
  id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL,
  state_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT,
  task_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  task_title TEXT,
  task_priority INTEGER,
  task_status TEXT NOT NULL,
  task_status_expected TEXT,
  task_audit TEXT NOT NULL,
  task_audit_expected TEXT,
  task_labels JSONB,
  task_relations JSONB,
  task_payload JSONB,
  task_branch TEXT,
  assignee_id TEXT,
  assignee_name TEXT,
  owner_id TEXT,
  owner_name TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  queue_attempts INTEGER NOT NULL DEFAULT 0,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  wake_attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);
ALTER TABLE wake ADD COLUMN IF NOT EXISTS task_status_expected TEXT;
ALTER TABLE wake ADD COLUMN IF NOT EXISTS task_audit_expected TEXT;
ALTER TABLE wake ADD COLUMN IF NOT EXISTS queue_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wake ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER NOT NULL DEFAULT 0;
-- Turn-signal (spec_wakery-contracts.md §3): wake_attempts counts agent turns
-- actually started for the wake (template selector + re-wake cap basis).
ALTER TABLE wake ADD COLUMN IF NOT EXISTS wake_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wake ADD COLUMN IF NOT EXISTS task_labels JSONB;
ALTER TABLE wake ADD COLUMN IF NOT EXISTS task_relations JSONB;
-- Conduction chaining (spec_wakery-conduction-chaining.md): the branch↔task binding,
-- resolved at wake build, immutable per row. Snooze correlation reads it via the index.
ALTER TABLE wake ADD COLUMN IF NOT EXISTS task_branch TEXT;
CREATE INDEX IF NOT EXISTS wake_task_key_idx ON wake(task_key);
CREATE INDEX IF NOT EXISTS wake_state_key_idx ON wake(state_key);
CREATE INDEX IF NOT EXISTS wake_status_priority_idx ON wake(status, task_priority DESC, create_time ASC);
CREATE INDEX IF NOT EXISTS wake_status_update_idx ON wake(status, update_time);
CREATE INDEX IF NOT EXISTS wake_task_branch_idx ON wake(task_branch) WHERE task_branch IS NOT NULL;

-- route.project_id carries project.id (config plane, FK-enforced on fresh DBs;
-- existing DBs gain the FK in the cutover window post re-key).
CREATE TABLE IF NOT EXISTS route (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  task_type TEXT,
  actor TEXT,
  session_key TEXT,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  delivery TEXT NOT NULL,
  max_run INTEGER,
  status TEXT NOT NULL,
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);
ALTER TABLE route ADD COLUMN IF NOT EXISTS actor TEXT;
UPDATE route SET actor = CASE WHEN agent_id = 'heimdall' THEN 'auditor' ELSE 'assignee' END WHERE actor IS NULL;
ALTER TABLE route ALTER COLUMN actor SET NOT NULL;
CREATE INDEX IF NOT EXISTS route_lookup_idx ON route(project_id, task_type, status);
CREATE INDEX IF NOT EXISTS route_actor_lookup_idx ON route(project_id, task_type, actor, status);

-- Turn ledger (spec_wakery-contracts.md §5): one row per agent turn started.
-- wake_id is NOT unique — a wake accumulates one lease per turn over its
-- lifetime (first dispatch plus each re-wake), with at most one open.
-- activity_time is the operational-recency column (set at send, refreshed by
-- the lifecycle watcher); update_time stays record bookkeeping only.
-- Retired columns dispatch_time / probe_attempts are no longer in the fresh
-- DDL; on existing DBs the physical columns are left in place for the
-- deploy-time data migration (migrateLeaseTurnSignal never drops them).
CREATE TABLE IF NOT EXISTS wake_route_lease (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES route(id),
  wake_id TEXT NOT NULL,
  wake_task_status TEXT NOT NULL,
  task_key TEXT,
  activity_time BIGINT,
  status TEXT NOT NULL,
  create_time BIGINT NOT NULL,
  update_time BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS wake_route_lease_route_status_idx ON wake_route_lease(route_id, status);
CREATE INDEX IF NOT EXISTS wake_route_lease_task_key_status_idx ON wake_route_lease(task_key, status);
CREATE INDEX IF NOT EXISTS wake_route_lease_wake_id_idx ON wake_route_lease(wake_id);
`;

export async function runMigrations(pool: Queryable) {
  await renameGithubRepoProjectNodeIdColumn(pool);
  await renameGithubRepoProjectToPlatformKeying(pool);
  await pool.query(migrationSql);
  await ensureRouteActorCheck(pool);
  await migrateAgentMappingToGithubAgent(pool);
  await reorganizeWakeDropTaskDependency(pool);
  await reorganizeRouteActorBeforeAgentId(pool);
  await addGithubRepoProjectProjectNumber(pool);
  await addProjectRiskMapping(pool);
  await renameProjectRiskMappingProjectColumn(pool);
  await createTaskTypeLabelTable(pool);
  await addLeaseTaskKey(pool);
  await migrateLeaseTurnSignal(pool);
  await createSnoozeTable(pool);
  await createSnoozeTaskTypeTable(pool);
}

// F9 platform-keying rename (specs/data/spec_database.md §5, §Cutover migration
// act 3, structure half): on an existing DB, rename every GitHub-native column
// of github_repo_project to its github_ prefix and add the platform project_id
// column NULLABLE. Runs BEFORE the canonical CREATE TABLE block so a fresh DB
// sees the final schema directly. Data acts — registry rows, backfill,
// tightening, route/wake/snooze re-key — belong to the cutover
// window script (scripts/cutover-platform-keying.ts), not here.
//
// (The tightening acts are: NOT NULL + UNIQUE + FK on project_id post-backfill.)
export async function renameGithubRepoProjectToPlatformKeying(pool: Queryable) {
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'github_repo_project'`
  );
  if (probe.rowCount === 0) return; // fresh DB — canonical CREATE TABLE owns it
  const names = new Set(probe.rows.map((r: any) => r.column_name));
  if (names.has('repo_id') && !names.has('github_repo_id')) {
    // the repo_id UNIQUE is dropped and re-added under its canonical
    // github_repo_id name — index bindings follow the rename cleanly on every
    // engine (pg-mem's index does not track RENAME COLUMN)
    await pool.query(`ALTER TABLE github_repo_project DROP CONSTRAINT IF EXISTS github_repo_project_repo_id_key`);
    // old project_id (the ProjectV2 node id) must move to github_project_id
    // BEFORE the platform project_id column can take the name
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN project_id TO github_project_id`);
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN repo_id TO github_repo_id`);
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN owner_id TO github_owner_id`);
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN owner_name TO github_owner_name`);
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN repo TO github_repo`);
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN project_number TO github_project_number`);
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN project_title TO github_project_title`);
    await pool.query(`ALTER TABLE github_repo_project ADD CONSTRAINT github_repo_project_github_repo_id_key UNIQUE (github_repo_id)`);
  }
  const recheck = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'github_repo_project' AND column_name = 'project_id'`
  );
  if (recheck.rowCount === 0) {
    await pool.query(`ALTER TABLE github_repo_project ADD COLUMN project_id TEXT`);
  }
}

// F9 rename, risk-mapping half (specs/data/spec_database.md §10): project_name
// carries the project slug, so the column is named `project`. The two partial
// unique indexes track the renamed column automatically; the FK to
// project(project) is a cutover-window act on existing DBs.
export async function renameProjectRiskMappingProjectColumn(pool: Queryable) {
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'project_risk_mapping' AND column_name IN ('project_name', 'project')`
  );
  const names = new Set(probe.rows.map((r: any) => r.column_name));
  if (names.has('project_name') && !names.has('project')) {
    await pool.query(`ALTER TABLE project_risk_mapping RENAME COLUMN project_name TO project`);
  }
}

// Turn-signal migration (milestone_wakery-turn-signal_v2026.07.29;
// spec_wakery-contracts.md §5) — additive + corrective, existing-DB path only:
//   1. `activity_time` — the lease's operational-recency column, backfilled
//      from update_time so pre-migration open leases enter the quiet-lease
//      reconcile with a sane clock. Fresh DBs get it from the canonical
//      CREATE TABLE; the probe short-circuits there.
//   2. Drop the UNIQUE constraint on wake_id — one lease per TURN, a wake
//      holds many leases over time. The inline `UNIQUE` in the pre-migration
//      DDL materialized as the `wake_route_lease_wake_id_key` constraint;
//      fresh DBs never had it, so the pg_constraint probe is a no-op there
//      (mirroring ensureRouteActorCheck's probe pattern for pg-mem).
// The retired physical columns dispatch_time / probe_attempts are deliberately
// NOT dropped here — the deploy-time data migration owns their disposal; the
// code simply stops reading them.
export async function migrateLeaseTurnSignal(pool: Queryable) {
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'wake_route_lease' AND column_name = 'activity_time'`
  );
  if (!(probe.rowCount && probe.rowCount > 0)) {
    await pool.query(`ALTER TABLE wake_route_lease ADD COLUMN activity_time BIGINT`);
    await pool.query(`UPDATE wake_route_lease SET activity_time = update_time WHERE activity_time IS NULL`);
  }

  const unique = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'wake_route_lease_wake_id_key' LIMIT 1`
  );
  if (unique.rowCount && unique.rowCount > 0) {
    await pool.query(`ALTER TABLE wake_route_lease DROP CONSTRAINT wake_route_lease_wake_id_key`);
  }
}

// `task_type_label` table — STRUCTURE ONLY. The canonical task-type set is seeded
// by `seed.ts` (the migrate=structure / seed=data split, 2026-06-11), not here.
// Stage 6 of the GitHub adapter reads this table at runtime (spec_wakery-task-type-
// registry.md §R1/§R2). Columns: `type:` value (PK), human label + purpose, and
// active/retired state (retire = `active=FALSE`, not a delete). Probe-then-create
// mirrors addProjectRiskMapping's idempotency (pg-mem cannot re-run CREATE TABLE
// IF NOT EXISTS).
export async function createTaskTypeLabelTable(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'task_type_label' LIMIT 1`
  );
  if (!(probe.rowCount && probe.rowCount > 0)) {
    await pool.query(`
      CREATE TABLE task_type_label (
        type_value TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        purpose TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        create_time BIGINT NOT NULL,
        update_time BIGINT NOT NULL
      )
    `);
  }
}

// E9 (#75) additive migration: introduce `wake_route_lease.task_key` so a
// `delivery=session` lease can carry the (route, task) identity it occupies
// across the task's whole active lifecycle. Nullable — existing rows backfill
// NULL, which is fine (run leases never consult task_key, and a pre-E9 session
// lease is the holder's continuation either way once re-pointed).
//
// Probes information_schema first so the ALTER only runs on existing DBs that
// pre-date the column; the fresh-DB path already has it from the canonical
// CREATE TABLE above. Kept out of inline `ALTER … IF NOT EXISTS` because
// pg-mem (used in tests) cannot re-run `CREATE TABLE IF NOT EXISTS` and the
// probe makes idempotency testable, matching addGithubRepoProjectProjectNumber.
export async function addLeaseTaskKey(pool: Queryable) {
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'wake_route_lease' AND column_name = 'task_key'`
  );
  if (probe.rowCount && probe.rowCount > 0) return;
  await pool.query(`ALTER TABLE wake_route_lease ADD COLUMN task_key TEXT`);
  // Backfill task_key on existing active leases from their wake, so an in-flight
  // session task's continuation re-points its held lease (task_key-aware capacity)
  // instead of deadlocking against a NULL task_key at the deploy transition. Runs
  // ONLY on this existing-DB column-add path (a fresh DB already has the column and
  // returns above, so this never executes on the pg-mem test DB).
  await pool.query(
    `UPDATE wake_route_lease l SET task_key = w.task_key
       FROM wake w WHERE l.wake_id = w.id AND l.task_key IS NULL`
  );
}

// E2 (#31) additive migration: introduce `project_risk_mapping` for the Resolver.
//
// The contracts spec frames the row identity as a composite "primary key" over
// `(project_name, action, subject, zone)` with `project_name` nullable (NULL = a
// wildcard row). That cannot be a literal Postgres PRIMARY KEY — PK columns are
// implicitly NOT NULL, which would reject every wildcard row. The identity is
// therefore enforced as the spec's own note prescribes: two partial unique indexes,
// one per partition (project rows where `project_name IS NOT NULL`, wildcard rows
// where `project_name IS NULL`). The CHECK pins `risk_code` to the Resolver-emit set.
//
// Mirrors T5's probe-then-create pattern (addGithubRepoProjectProjectNumber): probe
// information_schema first so the migration is idempotent and additive — it only
// creates the table on DBs that lack it, and never touches an existing Wakery table.
// (Kept out of the canonical CREATE TABLE block because pg-mem, used in tests,
// cannot re-run `CREATE TABLE IF NOT EXISTS`; the probe makes idempotency testable.)
export async function addProjectRiskMapping(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'project_risk_mapping' LIMIT 1`
  );
  if (probe.rowCount && probe.rowCount > 0) return;
  // F9: the column is `project` (it carries the slug — specs/data/spec_database.md
  // §10); non-null values FK-bind to project(project) so an overlay row cannot
  // name an unregistered project (config plane).
  await pool.query(`
    CREATE TABLE project_risk_mapping (
      project TEXT REFERENCES project(project),
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      zone TEXT NOT NULL,
      risk_code TEXT NOT NULL,
      create_time BIGINT NOT NULL,
      update_time BIGINT NOT NULL,
      CONSTRAINT project_risk_mapping_risk_code_check CHECK (risk_code IN ('R100','R200','R300','R999'))
    )
  `);
  await pool.query(
    `CREATE UNIQUE INDEX project_risk_mapping_project_cell_idx
       ON project_risk_mapping(project, action, subject, zone) WHERE project IS NOT NULL`
  );
  await pool.query(
    `CREATE UNIQUE INDEX project_risk_mapping_wildcard_cell_idx
       ON project_risk_mapping(action, subject, zone) WHERE project IS NULL`
  );
}

// T5 additive migration: introduce `github_repo_project.project_number`
// (nullable; tightened to NOT NULL post-backfill at v2 cutover per the
// decomposition record). Probes information_schema first so the ALTER only
// runs on existing DBs that pre-date the column; the fresh-DB path already
// has the column from the canonical CREATE TABLE above, making this a no-op.
export async function addGithubRepoProjectProjectNumber(pool: Queryable) {
  // post-F9 the column lives as github_project_number (renamed or created
  // canonically) — either presence makes this legacy add a no-op
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'github_repo_project' AND column_name IN ('project_number', 'github_project_number')`
  );
  if (probe.rowCount && probe.rowCount > 0) return;
  await pool.query(`ALTER TABLE github_repo_project ADD COLUMN project_number INTEGER`);
}

// One-shot reorganization: rebuild the `route` table so the physical column
// order matches the canonical `CREATE TABLE` definition above. On existing
// DBs `actor` was appended at the end via `ALTER TABLE ADD COLUMN`, which
// makes `SELECT *` show `actor` last (operator has to horizontal-scroll to
// see it). The canonical order places `actor` at position 4 (after
// `task_type`) so the routing key columns sit together at the front.
//
// Touches `wake_route_lease`'s FK constraint, which references `route(id)`:
// drop the FK before rebuilding `route`, re-add after. Both `route_lookup_idx`
// and `route_actor_lookup_idx` are recreated on the new table.
//
// Idempotent: probes the current ordinal position of `actor` and is a no-op
// once the column is at position 4.
async function reorganizeRouteActorBeforeAgentId(pool: Queryable) {
  const probe = await pool.query(
    `SELECT ordinal_position FROM information_schema.columns
     WHERE table_name = 'route' AND column_name = 'actor' LIMIT 1`
  );
  if (probe.rowCount === 0) return; // route table doesn't exist yet
  if (Number(probe.rows[0].ordinal_position) === 4) return; // already canonical

  await pool.query(`
    BEGIN;
    ALTER TABLE wake_route_lease DROP CONSTRAINT IF EXISTS wake_route_lease_route_id_fkey;
    DROP INDEX IF EXISTS route_lookup_idx;
    DROP INDEX IF EXISTS route_actor_lookup_idx;
    ALTER TABLE route RENAME TO route_old_pre_actor_reorder;
    CREATE TABLE route (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_type TEXT,
      actor TEXT NOT NULL,
      session_key TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      delivery TEXT NOT NULL,
      max_run INTEGER,
      status TEXT NOT NULL,
      create_time BIGINT NOT NULL,
      update_time BIGINT NOT NULL,
      CONSTRAINT route_actor_check CHECK (actor IN ('owner','assignee','auditor'))
    );
    INSERT INTO route (
      id, project_id, task_type, actor, session_key, agent_id, agent_name,
      delivery, max_run, status, create_time, update_time
    )
    SELECT
      id, project_id, task_type, actor, session_key, agent_id, agent_name,
      delivery, max_run, status, create_time, update_time
    FROM route_old_pre_actor_reorder;
    DROP TABLE route_old_pre_actor_reorder;
    ALTER TABLE wake_route_lease
      ADD CONSTRAINT wake_route_lease_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES route(id);
    CREATE INDEX route_lookup_idx ON route(project_id, task_type, status);
    CREATE INDEX route_actor_lookup_idx ON route(project_id, task_type, actor, status);
    COMMIT;
  `);
}

// One-shot reorganization: drop the unused `task_dependency` column from the
// `wake` table and physically re-create the table so the column order
// reflects the canonical layout (all task_* fields grouped together).
// `CREATE TABLE IF NOT EXISTS` above creates the new layout on fresh DBs;
// this function migrates existing DBs by rebuilding the table in place.
//
// Idempotent: probes for the presence of `task_dependency` and is a no-op
// once the column is gone.
async function reorganizeWakeDropTaskDependency(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'wake' AND column_name = 'task_dependency' LIMIT 1`
  );
  if (probe.rowCount === 0) return;

  await pool.query(`
    BEGIN;
    DROP INDEX IF EXISTS wake_task_key_idx;
    DROP INDEX IF EXISTS wake_state_key_idx;
    DROP INDEX IF EXISTS wake_status_priority_idx;
    DROP INDEX IF EXISTS wake_status_update_idx;
    ALTER TABLE wake RENAME TO wake_old_pre_dep_drop;
    CREATE TABLE wake (
      id TEXT PRIMARY KEY,
      task_key TEXT NOT NULL,
      state_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_name TEXT,
      task_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      task_title TEXT,
      task_priority INTEGER,
      task_status TEXT NOT NULL,
      task_status_expected TEXT,
      task_audit TEXT NOT NULL,
      task_audit_expected TEXT,
      task_labels JSONB,
      task_relations JSONB,
      task_payload JSONB,
      assignee_id TEXT,
      assignee_name TEXT,
      owner_id TEXT,
      owner_name TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      queue_attempts INTEGER NOT NULL DEFAULT 0,
      dispatch_attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      create_time BIGINT NOT NULL,
      update_time BIGINT NOT NULL
    );
    INSERT INTO wake (
      id, task_key, state_key, project_id, project_name, task_id, task_type, task_title, task_priority,
      task_status, task_status_expected, task_audit, task_audit_expected, task_labels, task_relations, task_payload,
      assignee_id, assignee_name, owner_id, owner_name,
      attempts, queue_attempts, dispatch_attempts, status, create_time, update_time
    )
    SELECT
      id, task_key, state_key, project_id, project_name, task_id, task_type, task_title, task_priority,
      task_status, task_status_expected, task_audit, task_audit_expected, task_labels, task_relations, task_payload,
      assignee_id, assignee_name, owner_id, owner_name,
      attempts, queue_attempts, dispatch_attempts, status, create_time, update_time
    FROM wake_old_pre_dep_drop;
    DROP TABLE wake_old_pre_dep_drop;
    CREATE INDEX wake_task_key_idx ON wake(task_key);
    CREATE INDEX wake_state_key_idx ON wake(state_key);
    CREATE INDEX wake_status_priority_idx ON wake(status, task_priority DESC, create_time ASC);
    CREATE INDEX wake_status_update_idx ON wake(status, update_time);
    COMMIT;
  `);
}

// Add the route.actor CHECK constraint exactly once. Postgres has no
// `ADD CONSTRAINT IF NOT EXISTS` so we probe `pg_constraint` first. pg-mem
// (used in tests) does not support `DO $$ ... $$` PL/pgSQL blocks, which is
// why this lives in TypeScript rather than inline SQL. The constraint enum
// stays aligned with `RouteActor` in `src/shared/types.ts`.
async function ensureRouteActorCheck(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'route_actor_check' LIMIT 1`
  );
  if (probe.rowCount && probe.rowCount > 0) return;
  await pool.query(
    `ALTER TABLE route ADD CONSTRAINT route_actor_check CHECK (actor IN ('owner','assignee','auditor'))`
  );
}

// One-shot rename: `github_repo_project.github_node_id` -> `repo_id` to align
// with the owner_id/project_id naming convention. Runs before CREATE TABLE so
// a fresh DB sees the new schema directly; on an existing DB we rename in
// place. Idempotent — if the new column already exists (or neither does,
// because the table hasn't been created yet) this is a no-op.
async function renameGithubRepoProjectNodeIdColumn(pool: Queryable) {
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'github_repo_project' AND column_name IN ('github_node_id', 'repo_id')`
  );
  const names = new Set(probe.rows.map((r: any) => r.column_name));
  if (names.has('github_node_id') && !names.has('repo_id')) {
    await pool.query(`ALTER TABLE github_repo_project RENAME COLUMN github_node_id TO repo_id`);
  }
}

// One-shot transition: move rows from the old agent_mapping table into
// github_agent and drop agent_mapping. Idempotent — after the first run
// agent_mapping is gone and the probe short-circuits. Authorized for the
// original production environment only — a one-shot transition.
async function migrateAgentMappingToGithubAgent(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_mapping' LIMIT 1`
  );
  if (probe.rowCount === 0) return;
  await pool.query(
    `INSERT INTO github_agent (id, github_login, github_node_id, agent_id, agent_name, role, status, create_time, update_time)
     SELECT id, github_login, github_node_id, agent_id, agent_name, role, status, create_time, update_time
     FROM agent_mapping
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(`DROP TABLE agent_mapping`);
}

// `snooze` table — the typed delay entity (spec_wakery-snooze.md;
// spec_wakery-contracts.md §9). Status set is narrowed to
// active/completed/timeout (`parked`/`revoked` retired with intake
// correlation); snooze_key carries the single md5(type + correlation value)
// form. Writes belong to the snooze module (intake in the ingress process,
// timeout flip on the dispatch worker's tick). Probe-then-create mirrors
// createTaskTypeLabelTable's idempotency (pg-mem cannot re-run CREATE TABLE
// IF NOT EXISTS).
export async function createSnoozeTable(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'snooze' LIMIT 1`
  );
  if (!(probe.rowCount && probe.rowCount > 0)) {
    await pool.query(`
      CREATE TABLE snooze (
        id TEXT PRIMARY KEY,
        snooze_key TEXT NOT NULL UNIQUE,
        type INTEGER NOT NULL,
        snooze_payload JSONB NOT NULL,
        project_id TEXT,
        project_name TEXT,
        task_status TEXT NOT NULL,
        task_audit TEXT NOT NULL,
        status TEXT NOT NULL,
        create_time BIGINT NOT NULL,
        update_time BIGINT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX snooze_status_type_idx ON snooze (status, type)`);
  }
}

// `snooze_task_type` table — STRUCTURE ONLY; rows seeded by seed.ts (the
// migrate=structure / seed=data split). Standalone lookup: which task types each
// snooze type may hold, read as a query parameter of the correlation lookup
// (spec_wakery-snooze-worker.md Stage 1; spec_wakery-contracts.md §10). Retire a
// pair with active=FALSE, never delete.
export async function createSnoozeTaskTypeTable(pool: Queryable) {
  const probe = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'snooze_task_type' LIMIT 1`
  );
  if (!(probe.rowCount && probe.rowCount > 0)) {
    await pool.query(`
      CREATE TABLE snooze_task_type (
        snooze_type INTEGER NOT NULL,
        task_type TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        create_time BIGINT NOT NULL,
        update_time BIGINT NOT NULL,
        PRIMARY KEY (snooze_type, task_type)
      )
    `);
  }
}
