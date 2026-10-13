import { afterEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../src/testing.js';
import {
  renameGithubRepoProjectToPlatformKeying,
  renameProjectRiskMappingProjectColumn
} from '../src/migrate.js';
import { cutoverPlatformKeying } from '../src/cutover-platform-keying.js';
import { makeStateKey, makeTaskKey } from '../src/ids.js';

// The window's dry-check (decomposition E2.1): a copy of the pre-F9 live
// schema, carried through the migrate renames (structure) and
// `cutoverPlatformKeying` (data acts) — re-key, key recompute, lease re-sync,
// zero orphans, idempotent re-run. The rename functions are driven directly
// rather than through runMigrations: pg-mem cannot re-parse the canonical
// CREATE TABLE IF NOT EXISTS blocks over pre-existing tables (inline-FK AST
// limitation); real Postgres runs the full `npm run migrate` in the window.

let pool: Pool;

afterEach(async () => {
  if (pool) await pool.end();
});

const PVT = 'PVT_platform_board';

// the structure half the window's `npm run migrate` performs on the live DB
async function migrateStructure(p: Pool): Promise<void> {
  await renameGithubRepoProjectToPlatformKeying(p);
  await renameProjectRiskMappingProjectColumn(p);
  await p.query(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      create_time BIGINT NOT NULL,
      update_time BIGINT NOT NULL
    )
  `);
}

async function buildPreF9LiveCopy(p: Pool): Promise<void> {
  // the pre-F9 production shapes (old column names, GitHub-keyed project ids)
  await p.query(`
    CREATE TABLE github_repo_project (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      repo TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_number INTEGER,
      project_title TEXT,
      status TEXT NOT NULL,
      create_time BIGINT NOT NULL,
      update_time BIGINT NOT NULL
    )
  `);
  await p.query(
    `INSERT INTO github_repo_project (id, repo_id, owner_id, owner_name, repo, project_id, project_number, project_title, status, create_time, update_time)
     VALUES ('grp-1','R_1','O_1','owner-login','vork','${PVT}',4,'vork','active',1,1)`
  );
  await p.query(`
    CREATE TABLE route (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_type TEXT, actor TEXT NOT NULL,
      session_key TEXT, agent_id TEXT NOT NULL, agent_name TEXT, delivery TEXT NOT NULL,
      max_run INTEGER, status TEXT NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL,
      CONSTRAINT route_actor_check CHECK (actor IN ('owner','assignee','auditor'))
    )
  `);
  await p.query(
    `INSERT INTO route (id, project_id, task_type, actor, agent_id, delivery, status, create_time, update_time)
     VALUES ('route-1','${PVT}',NULL,'owner','main','run','active',1,1),
            ('route-dead','PVT_retired_board',NULL,'assignee','main','session','deleted',1,1)`
  );
  await p.query(`
    CREATE TABLE wake (
      id TEXT PRIMARY KEY, task_key TEXT NOT NULL, state_key TEXT NOT NULL,
      project_id TEXT NOT NULL, project_name TEXT, task_id TEXT NOT NULL, task_type TEXT NOT NULL,
      task_title TEXT, task_priority INTEGER, task_status TEXT NOT NULL, task_status_expected TEXT,
      task_audit TEXT NOT NULL, task_audit_expected TEXT, task_labels JSONB, task_relations JSONB,
      task_payload JSONB, task_branch TEXT, assignee_id TEXT, assignee_name TEXT, owner_id TEXT,
      owner_name TEXT, attempts INTEGER NOT NULL DEFAULT 0, queue_attempts INTEGER NOT NULL DEFAULT 0,
      dispatch_attempts INTEGER NOT NULL DEFAULT 0, wake_attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL
    )
  `);
  const oldTaskKey = makeTaskKey(PVT, '42');
  const oldStateKey = makeStateKey(PVT, '42', 'Progress', 'Gated');
  await p.query(
    `INSERT INTO wake (id, task_key, state_key, project_id, task_id, task_type, task_status, task_audit, status, create_time, update_time)
     VALUES ('w-open','${oldTaskKey}','${oldStateKey}','${PVT}','42','coding','Progress','Gated','dispatched',1,1)`
  );
  await p.query(`
    CREATE TABLE wake_route_lease (
      id TEXT PRIMARY KEY, route_id TEXT NOT NULL REFERENCES route(id), wake_id TEXT NOT NULL,
      wake_task_status TEXT NOT NULL, task_key TEXT, activity_time BIGINT, status TEXT NOT NULL,
      create_time BIGINT NOT NULL, update_time BIGINT NOT NULL
    )
  `);
  await p.query(
    `INSERT INTO wake_route_lease (id, route_id, wake_id, wake_task_status, task_key, activity_time, status, create_time, update_time)
     VALUES ('lease-open','route-1','w-open','Progress','${oldTaskKey}',1,'active',1,1)`
  );
  await p.query(`
    CREATE TABLE snooze (
      id TEXT PRIMARY KEY, snooze_key TEXT NOT NULL UNIQUE, type INTEGER NOT NULL, snooze_payload JSONB NOT NULL,
      project_id TEXT, project_name TEXT, task_status TEXT NOT NULL, task_audit TEXT NOT NULL,
      status TEXT NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL
    )
  `);
  await p.query(
    `INSERT INTO snooze (id, snooze_key, type, snooze_payload, project_id, task_status, task_audit, status, create_time, update_time)
     VALUES ('sn-1','key-1',1,'{}','${PVT}','Progress','Gated','active',1,1)`
  );
  await p.query(`
    CREATE TABLE project_risk_mapping (
      project_name TEXT, action TEXT NOT NULL, subject TEXT NOT NULL, zone TEXT NOT NULL,
      risk_code TEXT NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL,
      CONSTRAINT project_risk_mapping_risk_code_check CHECK (risk_code IN ('R100','R200','R300','R999'))
    )
  `);
  await p.query(
    `INSERT INTO project_risk_mapping (project_name, action, subject, zone, risk_code, create_time, update_time)
     VALUES (NULL,'read','file','workspace','R100',1,1), ('vork','control','service','external','R200',1,1)`
  );
}

describe('cutover: platform keying (F6/F9 window data acts)', () => {
  test('the full dry-check: rename → registry → backfill → re-key → recompute → re-sync, zero orphans', async () => {
    pool = await createTestPool();
    await buildPreF9LiveCopy(pool);

    // structure half — the migrate renames
    await migrateStructure(pool);
    const renamed = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'github_repo_project'`
    );
    const cols = new Set(renamed.rows.map((r: any) => r.column_name));
    expect(cols.has('github_project_id')).toBe(true);
    expect(cols.has('project_id')).toBe(true);
    expect(cols.has('repo_id')).toBe(false);

    // data half
    const report = await cutoverPlatformKeying(pool, [
      { github_project_id: 'PVT_retired_board', slug: 'legacyproj', name: 'Legacy Project' }
    ]);
    expect(report.registry_inserted).toBe(1);
    expect(report.legacy_projects).toEqual(['legacyproj']);
    // 1 live route via the mapping + 1 dead route via the legacy identity
    expect(report.routes_rekeyed).toBe(2);
    expect((await pool.query(`SELECT count(*)::int AS n FROM route`)).rows[0].n).toBe(2);
    const legacy = await pool.query(`SELECT id, status FROM project WHERE project = 'legacyproj'`);
    expect(legacy.rows[0].status).toBe('deleted');
    const deadRoute = await pool.query(`SELECT project_id FROM route WHERE id = 'route-dead'`);
    expect(deadRoute.rows[0].project_id).toBe(legacy.rows[0].id);
    expect(report.wakes_rekeyed).toBe(1);
    expect(report.snoozes_rekeyed).toBe(1);
    expect(report.wake_keys_recomputed).toBe(1);
    expect(report.lease_keys_resynced).toBe(1);
    expect(report.orphan_open_wakes).toBe(0);
    expect(report.orphan_open_leases).toBe(0);

    // the open wake now keys on project.id, and its lease followed
    const wake = await pool.query(`SELECT project_id, task_key, state_key FROM wake WHERE id='w-open'`);
    const platformId: string = wake.rows[0].project_id;
    expect(platformId.startsWith('prj_')).toBe(true);
    expect(wake.rows[0].task_key).toBe(makeTaskKey(platformId, '42'));
    expect(wake.rows[0].state_key).toBe(makeStateKey(platformId, '42', 'Progress', 'Gated'));
    const lease = await pool.query(`SELECT task_key FROM wake_route_lease WHERE id='lease-open'`);
    expect(lease.rows[0].task_key).toBe(wake.rows[0].task_key);

    // the risk-mapping slug column renamed with rows intact
    const overlay = await pool.query(`SELECT risk_code FROM project_risk_mapping WHERE project = 'vork'`);
    expect(overlay.rows[0].risk_code).toBe('R200');
  });

  test('idempotent: a second run changes nothing', async () => {
    pool = await createTestPool();
    await buildPreF9LiveCopy(pool);
    await migrateStructure(pool);
    const legacy = [{ github_project_id: 'PVT_retired_board', slug: 'legacyproj', name: 'Legacy Project' }];
    await cutoverPlatformKeying(pool, legacy);

    const second = await cutoverPlatformKeying(pool, legacy);
    expect(second.registry_inserted).toBe(0);
    expect(second.mappings_backfilled).toBe(0);
    expect(second.routes_rekeyed).toBe(0);
    expect(second.wakes_rekeyed).toBe(0);
    expect(second.wake_keys_recomputed).toBe(0);
    expect(second.lease_keys_resynced).toBe(0);
  });

  test('aborts naming any route on an unregistered board absent from LEGACY_BOARDS', async () => {
    pool = await createTestPool();
    await buildPreF9LiveCopy(pool);
    await migrateStructure(pool);
    // route-dead's board is NOT given a legacy identity here
    await expect(cutoverPlatformKeying(pool, [])).rejects.toThrow(/route-dead.*LEGACY_BOARDS or dispose deliberately/);
  });

  test('aborts naming the repo when a mapping has no registry project', async () => {
    pool = await createTestPool();
    await buildPreF9LiveCopy(pool);
    await pool.query(
      `INSERT INTO github_repo_project (id, repo_id, owner_id, owner_name, repo, project_id, status, create_time, update_time)
       VALUES ('grp-3','R_3','O_1','owner-login','unregistered','PVT_x','active',1,1)`
    );
    await migrateStructure(pool);
    await expect(
      cutoverPlatformKeying(pool, [{ github_project_id: 'PVT_retired_board', slug: 'legacyproj', name: 'Legacy Project' }])
    ).rejects.toThrow(/unregistered.*register them before the cutover/);
  });
});
