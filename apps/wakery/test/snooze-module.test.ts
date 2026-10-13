// The snooze module (spec_wakery-snooze.md): intake upsert on the single-form
// key, the stateless hold predicate at dispatch admission, the tick-riding
// timeout sweep, and the settled-holds set for the re-wake template.
import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestPool, createTempDir } from './helpers.js';
import { runMigrations } from '@vork/data';
import { SnoozeRepository, makeSnoozeKey } from '../src/db/snooze-repository.js';
import { SnoozeTaskTypeRepository } from '../src/db/snooze-task-type-repository.js';
import { SnoozeIntakeModule } from '../src/snooze/intake.js';
import { SnoozeModule } from '../src/snooze/module.js';
import { EventWriter } from '../src/events/writer.js';
import type { Wake } from '../src/shared/types.js';

let pool: Pool;
let snoozeRepo: SnoozeRepository;
let snoozeTaskTypeRepo: SnoozeTaskTypeRepository;
let eventDir: string;
let eventWriter: EventWriter;

beforeEach(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  snoozeRepo = new SnoozeRepository(pool);
  snoozeTaskTypeRepo = new SnoozeTaskTypeRepository(pool);
  eventDir = createTempDir();
  eventWriter = new EventWriter(eventDir);
  await pool.query(
    `INSERT INTO snooze_task_type (snooze_type, task_type, active, create_time, update_time)
     VALUES (1, 'coding', TRUE, 1, 1), (2, 'coding', TRUE, 1, 1), (1, 'dbops', FALSE, 1, 1)`
  );
});

function readEvents() {
  return readdirSync(eventDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
    readFileSync(join(eventDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  );
}

function makeIntake() {
  return new SnoozeIntakeModule({
    snoozeRepo,
    githubRepoProjectRepo: {
      findByRepoId: async (repoId: string) =>
        repoId === 'R_repo1' ? { project_id: 'prj_1', github_project_title: 'Sample Project' } : null
    },
    eventWriter
  });
}

function makeModule(timeoutMs = 1_800_000) {
  return new SnoozeModule({ snoozeRepo, snoozeTaskTypeRepo, eventWriter, timeoutMs });
}

function workflowRun(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    workflow_run: { name: 'CI', head_branch: 'feature/x/build', head_sha: 'sha-1', id: 99, ...overrides },
    repository: { node_id: 'R_repo1', full_name: 'owner-login/sample_project' }
  };
}

function pullRequest(action: string, number = 12) {
  return {
    action,
    pull_request: { number, head: { ref: 'feature/x/build' }, base: { ref: 'dev' } },
    repository: { node_id: 'R_repo1', full_name: 'owner-login/sample_project' }
  };
}

function executionWake(overrides: Partial<Wake> = {}): Wake {
  const now = Date.now();
  return {
    id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1', project_id: 'prj_1', project_name: null,
    task_id: '42', task_type: 'coding', task_title: 'Build', task_priority: 1,
    task_status: 'Progress', task_status_expected: null, task_audit: 'Gated', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: 'feature/x/build', task_payload: null,
    assignee_id: 'a', assignee_name: null, owner_id: null, owner_name: null,
    queue_attempts: 0, dispatch_attempts: 0, wake_attempts: 1, status: 'dispatched',
    create_time: now, update_time: now,
    ...overrides
  };
}

describe('SnoozeIntakeModule (Stage 1 — intake)', () => {
  test('CI start upserts an active row on snooze_key = md5(type + correlation value) — no wake correlation, no task-type check', async () => {
    const result = await makeIntake().handleEvent('workflow_run', workflowRun('requested'));
    expect(result.status).toBe('accepted');

    const row = await snoozeRepo.findBySnoozeKey(makeSnoozeKey(1, 'sha-1'));
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.type).toBe(1);
    expect(row!.task_status).toBe('Progress');
    expect(row!.task_audit).toBe('Gated');
    expect(row!.project_id).toBe('prj_1');
    expect(row!.snooze_payload).toMatchObject({ branch: 'feature/x/build', ci_head_sha: 'sha-1', workflow_run_id: 99 });
    expect(readEvents().some((e) => e.event_code === 6001)).toBe(true);
  });

  test('repeat start refreshes the same row — one row per external process instance', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    const first = (await snoozeRepo.findBySnoozeKey(makeSnoozeKey(1, 'sha-1')))!;
    await pool.query('UPDATE snooze SET update_time=$2 WHERE id=$1', [first.id, 1000]);

    await intake.handleEvent('workflow_run', workflowRun('in_progress'));

    const rows = await snoozeRepo.findByStatuses(['active']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
    expect(rows[0]!.update_time).toBeGreaterThan(1000);
  });

  test('a settled row re-arms in place on a fresh start (re-run suite, same head sha)', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    await intake.handleEvent('workflow_run', workflowRun('completed'));
    expect((await snoozeRepo.findBySnoozeKey(makeSnoozeKey(1, 'sha-1')))!.status).toBe('completed');

    // A re-run fires no `requested` — in_progress is the mandatory start signal.
    await intake.handleEvent('workflow_run', workflowRun('in_progress'));
    const rearmed = await snoozeRepo.findBySnoozeKey(makeSnoozeKey(1, 'sha-1'));
    expect(rearmed!.status).toBe('active');
    expect(readEvents().filter((e) => e.event_code === 6001)).toHaveLength(2); // create + re-arm
  });

  test('a force-push is a new instance: new head sha = new key = new row', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    await intake.handleEvent('workflow_run', workflowRun('requested', { head_sha: 'sha-2' }));
    expect(await snoozeRepo.findByStatuses(['active'])).toHaveLength(2);
  });

  test('end event completes the active row; outcome never read', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    const result = await intake.handleEvent('workflow_run', { ...workflowRun('completed'), workflow_run: { ...workflowRun('completed').workflow_run, conclusion: 'failure' } });

    expect(result.status).toBe('accepted');
    const row = await snoozeRepo.findBySnoozeKey(makeSnoozeKey(1, 'sha-1'));
    expect(row!.status).toBe('completed');
    expect(row!.snooze_payload).not.toHaveProperty('conclusion');
    expect(readEvents().some((e) => e.event_code === 6004)).toBe(true);
  });

  test('end event with no matching row is unmatched noise (6008), a no-op', async () => {
    const result = await makeIntake().handleEvent('workflow_run', workflowRun('completed'));
    expect(result.status).toBe('ignored');
    expect(readEvents().some((e) => e.event_code === 6008)).toBe(true);
    expect(await snoozeRepo.findByStatuses(['active', 'completed', 'timeout'])).toHaveLength(0);
  });

  test('standing-branch events (dev/main) drop with 6008 and are never stored', async () => {
    const result = await makeIntake().handleEvent('workflow_run', workflowRun('requested', { head_branch: 'dev' }));
    expect(result.status).toBe('ignored');
    expect(readEvents().some((e) => e.event_code === 6008)).toBe(true);
    expect(await snoozeRepo.findByStatuses(['active'])).toHaveLength(0);
  });

  test('unclaimed events fall through: a non-gate workflow, an unknown action', async () => {
    const intake = makeIntake();
    expect((await intake.handleEvent('workflow_run', workflowRun('requested', { name: 'docs-build' }))).status).toBe('ignored');
    expect((await intake.handleEvent('pull_request', pullRequest('synchronize'))).status).toBe('ignored');
    expect(await snoozeRepo.findByStatuses(['active'])).toHaveLength(0);
  });

  test('PR type: opened starts, closed ends (merged or not — never read)', async () => {
    const intake = makeIntake();
    await intake.handleEvent('pull_request', pullRequest('opened'));
    const key = makeSnoozeKey(2, '12');
    expect((await snoozeRepo.findBySnoozeKey(key))!.status).toBe('active');

    await intake.handleEvent('pull_request', { ...pullRequest('closed'), pull_request: { ...pullRequest('closed').pull_request, merged: false } });
    expect((await snoozeRepo.findBySnoozeKey(key))!.status).toBe('completed');
  });
});

describe('SnoozeModule.consultSnoozes (Stage 2 — the hold predicate)', () => {
  async function armCI() {
    await makeIntake().handleEvent('workflow_run', workflowRun('requested'));
  }

  test('holds a Progress+Gated wake on the matching branch with an allowed task type', async () => {
    await armCI();
    const holding = await makeModule().consultSnoozes(executionWake());
    expect(holding).toHaveLength(1);
    expect(makeModule().holdingTypeNames(holding)).toEqual(['CI']);
  });

  test('branch mismatch holds nothing', async () => {
    await armCI();
    expect(await makeModule().consultSnoozes(executionWake({ task_branch: 'feature/other' }))).toHaveLength(0);
  });

  test('a branchless wake holds nothing', async () => {
    await armCI();
    expect(await makeModule().consultSnoozes(executionWake({ task_branch: null }))).toHaveLength(0);
  });

  test('scope mismatch holds nothing — everything after the Done claim is agent judgment, audited', async () => {
    await armCI();
    const module = makeModule();
    expect(await module.consultSnoozes(executionWake({ task_status: 'Done', task_audit: 'Gated' }))).toHaveLength(0);
    expect(await module.consultSnoozes(executionWake({ task_status: 'Progress', task_audit: 'Approved' }))).toHaveLength(0);
  });

  test('task type outside the snooze_task_type rows holds nothing (inactive rows excluded)', async () => {
    await armCI();
    const module = makeModule();
    expect(await module.consultSnoozes(executionWake({ task_type: 'project_operation' }))).toHaveLength(0);
    expect(await module.consultSnoozes(executionWake({ task_type: 'dbops' }))).toHaveLength(0); // active=FALSE row
  });

  test('lazy expiry: an expired active row holds nothing even before the sweep flips it', async () => {
    await armCI();
    const row = (await snoozeRepo.findByStatuses(['active']))[0]!;
    await pool.query('UPDATE snooze SET update_time=$2 WHERE id=$1', [row.id, Date.now() - 3_600_000]);

    expect(await makeModule(1_800_000).consultSnoozes(executionWake())).toHaveLength(0);
    // Still active in storage — holding-correctness never waited on the sweep.
    expect((await snoozeRepo.findById(row.id))!.status).toBe('active');
  });

  test('the predicate is a pure read: consulting writes nothing', async () => {
    await armCI();
    const before = (await snoozeRepo.findByStatuses(['active']))[0]!;
    await makeModule().consultSnoozes(executionWake());
    const after = (await snoozeRepo.findById(before.id))!;
    expect(after.status).toBe('active');
    expect(after.update_time).toBe(before.update_time);
  });
});

describe('SnoozeModule.timeoutSweep (Stage 4 — bookkeeping)', () => {
  test('flips expired active rows to timeout and emits 6006 once per row; unexpired rows untouched', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    await intake.handleEvent('workflow_run', workflowRun('requested', { head_sha: 'sha-2' }));
    const rows = await snoozeRepo.findByStatuses(['active']);
    await pool.query('UPDATE snooze SET update_time=$2 WHERE id=$1', [rows[0]!.id, Date.now() - 3_600_000]);

    const module = makeModule(1_800_000);
    expect(await module.timeoutSweep()).toBe(1);
    expect((await snoozeRepo.findById(rows[0]!.id))!.status).toBe('timeout');
    expect((await snoozeRepo.findById(rows[1]!.id))!.status).toBe('active');

    // Idempotent: a second sweep flips nothing more.
    expect(await module.timeoutSweep()).toBe(0);
    expect(readEvents().filter((e) => e.event_code === 6006)).toHaveLength(1);
  });
});

describe('SnoozeModule.settledHolds (the re-wake context)', () => {
  test('returns branch+scope-matched rows settled since the given moment, with timeout visible', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    await intake.handleEvent('pull_request', pullRequest('opened'));
    const since = Date.now() - 1;

    await intake.handleEvent('workflow_run', workflowRun('completed'));
    const prRow = (await snoozeRepo.findByStatuses(['active']))[0]!;
    await snoozeRepo.updateStatus(prRow.id, 'timeout');

    const settled = await makeModule().settledHolds(executionWake(), since);
    const byType = Object.fromEntries(settled.map((s) => [s.typeName, s.status]));
    expect(byType).toEqual({ CI: 'completed', PR: 'timeout' });
  });

  test('rows settled before the window, other branches, and other scopes are excluded', async () => {
    const intake = makeIntake();
    await intake.handleEvent('workflow_run', workflowRun('requested'));
    await intake.handleEvent('workflow_run', workflowRun('completed'));

    const settledLongAgo = await makeModule().settledHolds(executionWake(), Date.now() + 60_000);
    expect(settledLongAgo).toHaveLength(0);

    const otherBranch = await makeModule().settledHolds(executionWake({ task_branch: 'feature/other' }), 0);
    expect(otherBranch).toHaveLength(0);
  });
});
