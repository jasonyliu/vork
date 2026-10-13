import { beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, createTempDir } from './helpers.js';
import { runMigrations } from '@vork/data';
import { WakeRepository } from '../src/db/wake-repository.js';
import { RouteRepository } from '../src/db/route-repository.js';
import { LeaseRepository } from '../src/db/lease-repository.js';
import { GithubAgentRepository } from '../src/db/github-agent-repository.js';
import { DispatchWorker } from '../src/worker/dispatch-worker.js';
import { BoardSweeper, type BoardItem, type BoardSweeperDeps } from '../src/worker/board-sweep.js';
import { EventWriter } from '../src/events/writer.js';
import type { GitHubIssueState } from '../src/adapters/github/adapter.js';
import type { GithubRepoProject, Wake, WakeRequest, WakeResponse } from '../src/shared/types.js';
import { STALL_ALARM_LABEL, STALL_ALARM_TASK_ID } from '../src/events/codes.js';

// The BoardSweeper is a pure module over injected surfaces — every dep is a
// stub here; the ingress path it mints through has its own suite
// (ingress.test.ts), and the sweep's contract is candidacy + synthesis.

const NOW = Date.now();

function makeProject(overrides: Partial<GithubRepoProject> = {}): GithubRepoProject {
  return {
    id: 'grp-1',
    project_id: 'prj_sample',
    github_repo_id: 'R_repo1',
    github_owner_id: 'U_owner',
    github_owner_name: 'owner-login',
    github_repo: 'sample_project',
    github_project_id: 'PVT_sample',
    github_project_number: null,
    github_project_title: 'Sample Project',
    status: 'active',
    create_time: NOW,
    update_time: NOW,
    ...overrides
  };
}

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    issueNumber: 57,
    issueState: 'OPEN',
    repoOwner: 'owner-login',
    repoName: 'sample_project',
    taskStatus: 'Init',
    taskAudit: 'Gated',
    hasAssignee: true,
    lastActivityMs: NOW - 600_000, // ten minutes quiet — past any default threshold
    ...overrides
  };
}

function makeIssueState(overrides: Partial<GitHubIssueState> = {}): GitHubIssueState {
  return {
    number: 57,
    issueState: 'OPEN',
    title: 'Journal wiring',
    body: 'Task body',
    authorLogin: 'sarge-login',
    assignees: [{ login: 'worker-login', nodeId: 'U_worker' }],
    labels: ['type:coding', 'task:child'],
    parentNumber: null,
    subIssuesTotal: 0,
    subIssuesCompleted: 0,
    blockedByOpen: 0,
    blockedByTotal: 0,
    blockingOpen: 0,
    blockingTotal: 0,
    linkedBranchNames: ['feature/journal'],
    projectId: 'PVT_sample',
    projectTitle: 'Sample Project',
    taskStatus: 'Init',
    taskAudit: 'Gated',
    ...overrides
  };
}

interface Harness {
  sweeper: BoardSweeper;
  requests: WakeRequest[];
  events: Array<{ code: number; fields: Record<string, unknown> }>;
  createdWakes: Wake[];
  completedTaskKeys: string[];
}

function makeSweeper(opts: {
  projects?: GithubRepoProject[];
  boards?: Record<string, BoardItem[] | null>;
  issueState?: GitHubIssueState | null;
  openWakeTaskKeys?: Set<string>;
  openLeaseTaskKeys?: Set<string>;
  /** Stall-predicate counts (stall-wake-excluded, per the repo contract). */
  projectOpenWakes?: number;
  projectOpenLeases?: number;
  ingressStatus?: WakeResponse['status'];
  deps?: Partial<BoardSweeperDeps>;
} = {}): Harness {
  const requests: WakeRequest[] = [];
  const events: Array<{ code: number; fields: Record<string, unknown> }> = [];
  const createdWakes: Wake[] = [];
  const completedTaskKeys: string[] = [];
  const sweeper = new BoardSweeper({
    githubToken: 'test-token',
    githubRepoProjectRepo: { listAll: async () => opts.projects ?? [makeProject()] },
    wakeRepo: {
      findCurrentByTaskKey: async (taskKey) =>
        opts.openWakeTaskKeys?.has(taskKey) ? { id: 'wake-existing' } : null,
      countOpenByProjectId: async () => opts.projectOpenWakes ?? opts.openWakeTaskKeys?.size ?? 0,
      create: async (wake) => { createdWakes.push(wake as Wake); },
      completeOpenByTaskKey: async (taskKey) => { completedTaskKeys.push(taskKey); }
    },
    leaseRepo: {
      findOpenByTaskKey: async (taskKey) =>
        opts.openLeaseTaskKeys?.has(taskKey) ? { id: 'lease-existing' } : null,
      countOpenByProjectId: async () => opts.projectOpenLeases ?? opts.openLeaseTaskKeys?.size ?? 0
    },
    taskTypeLabelRepo: { activeTypeValues: async () => new Set(['coding', 'spec', 'bug']) },
    githubAgentRepo: { findByGitHubLogin: async (login) => (login === 'sarge-login' ? { github_node_id: 'U_sarge' } : null) },
    ingress: {
      handleWakeRequest: async (request) => {
        requests.push(request);
        return { request_id: request.request_id, status: opts.ingressStatus ?? 'accepted', message: '' };
      }
    },
    eventWriter: { emit: (event, fields = {}) => events.push({ code: event.code, fields }) },
    fetchBoardItems: async (_token, projectId) => {
      const boards = opts.boards ?? { PVT_sample: [makeItem()] };
      return projectId in boards ? boards[projectId] : [];
    },
    fetchIssue: async () => (opts.issueState === undefined ? makeIssueState() : opts.issueState),
    ...opts.deps
  });
  return { sweeper, requests, events, createdWakes, completedTaskKeys };
}

describe('board sweep — candidacy', () => {
  test('mints for an actionable quiet task absent from both ledgers', async () => {
    const h = makeSweeper();
    const minted = await h.sweeper.runOnce();
    expect(minted).toBe(1);
    expect(h.requests).toHaveLength(1);
    const req = h.requests[0];
    expect(req.source).toBe('board_sweep');
    expect(req.request_id).toMatch(/^sweep_/);
    expect(req.project_id).toBe('prj_sample');
    expect(req.task_id).toBe('57');
    expect(req.task_type).toBe('coding');
    expect(req.task_status).toBe('Init');
    expect(req.task_audit).toBe('Gated');
    expect(req.task_branch).toBe('feature/journal');
    expect(req.owner_name).toBe('sarge-login');
    expect(req.owner_id).toBe('U_sarge');
    expect(req.assignee_name).toBe('worker-login');
    // No transition hints — a sweep mint is an observed-state wake, never pending.
    expect(req.task_status_expected).toBeUndefined();
    expect(req.task_audit_expected).toBeUndefined();
    expect(h.events.filter((e) => e.code === 2020)).toHaveLength(1);
  });

  test('skips a task with an open wake', async () => {
    const h = makeSweeper({ openWakeTaskKeys: new Set([taskKeyOf('prj_sample', '57')]) });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  test('skips a task with an open lease (turn believed running)', async () => {
    const h = makeSweeper({ openLeaseTaskKeys: new Set([taskKeyOf('prj_sample', '57')]) });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  test('skips parked issues (no assignee) — never rescued, TASK.md §Mapping', async () => {
    const h = makeSweeper({ boards: { PVT_sample: [makeItem({ hasAssignee: false })] } });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  test('a parked issue on the fresh read is skipped even when the snapshot raced', async () => {
    const h = makeSweeper({ issueState: makeIssueState({ assignees: [] }) });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  test('skips states the eligibility matrix does not name', async () => {
    const h = makeSweeper({ boards: { PVT_sample: [makeItem({ taskStatus: 'Progress', taskAudit: 'Approved' })] } });
    expect(await h.sweeper.runOnce()).toBe(0);
  });

  test('skips a task still inside the quiet threshold', async () => {
    const h = makeSweeper({ boards: { PVT_sample: [makeItem({ lastActivityMs: Date.now() - 10_000 })] } });
    expect(await h.sweeper.runOnce()).toBe(0);
  });

  test('skips closed issues and items without both fields', async () => {
    const h = makeSweeper({
      boards: {
        PVT_sample: [
          makeItem({ issueState: 'CLOSED' }),
          makeItem({ issueNumber: 58, taskAudit: null })
        ]
      }
    });
    expect(await h.sweeper.runOnce()).toBe(0);
  });

  test('a Govern state is actionable — the notification cue is owed too', async () => {
    const h = makeSweeper({
      boards: { PVT_sample: [makeItem({ taskStatus: 'Todo', taskAudit: 'Govern' })] },
      issueState: makeIssueState({ taskStatus: 'Todo', taskAudit: 'Govern' })
    });
    expect(await h.sweeper.runOnce()).toBe(1);
  });
});

describe('board sweep — synthesis guards', () => {
  test('re-derives from the fresh read: a raced-to-CLOSED issue is skipped', async () => {
    const h = makeSweeper({ issueState: makeIssueState({ issueState: 'CLOSED' }) });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.requests).toHaveLength(0);
  });

  test('skips silently on a non-ok type label (no warn stream from the cadence)', async () => {
    const h = makeSweeper({ issueState: makeIssueState({ labels: ['task:child'] }) });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.events).toHaveLength(0);
  });

  test('an ingress race to updated is not counted or evented as a mint', async () => {
    const h = makeSweeper({ ingressStatus: 'updated' });
    expect(await h.sweeper.runOnce()).toBe(0);
    expect(h.requests).toHaveLength(1);
    expect(h.events.filter((e) => e.code === 2020)).toHaveLength(0);
  });
});

describe('board sweep — pass resilience', () => {
  test('a failed board query emits 2021 and other projects still sweep', async () => {
    const h = makeSweeper({
      projects: [makeProject(), makeProject({ id: 'grp-2', project_id: 'prj_other', github_project_id: 'PVT_other', github_repo: 'other_project' })],
      boards: { PVT_sample: null, PVT_other: [makeItem({ repoName: 'other_project' })] }
    });
    const minted = await h.sweeper.runOnce();
    expect(minted).toBe(1);
    expect(h.events.filter((e) => e.code === 2021)).toHaveLength(1);
    expect(h.events.filter((e) => e.code === 2020)).toHaveLength(1);
  });

  test('disabled projects are not swept', async () => {
    const h = makeSweeper({ projects: [makeProject({ status: 'disabled' })] });
    expect(await h.sweeper.runOnce()).toBe(0);
  });
});

// ── F2: the stall alarm (the floor beneath the sweep) ───────────────────────

describe('board sweep — stall alarm', () => {
  // Progress:Approved is deliberately outside the eligibility matrix: the item
  // counts as an open non-terminal task but F1 cannot mint for it — exactly
  // the class the stall alarm exists for.
  const unmintable = () => makeItem({ taskStatus: 'Progress', taskAudit: 'Approved' });
  const stallKey = () => taskKeyOf('prj_sample', STALL_ALARM_TASK_ID);

  test('a persisted full stop stores one stall-notice wake and emits 2023', async () => {
    const h = makeSweeper({
      boards: { PVT_sample: [unmintable()] },
      deps: { stallThresholdMs: 0 }
    });
    await h.sweeper.runOnce();
    expect(h.createdWakes).toHaveLength(1);
    const stall = h.createdWakes[0];
    expect(stall.task_id).toBe(STALL_ALARM_TASK_ID);
    expect(stall.task_labels).toEqual([STALL_ALARM_LABEL]);
    expect(stall.task_status).toBe('Pending'); // owner lane via the wildcard row
    expect(stall.task_type).toBe('project_operation');
    expect(stall.task_payload).toMatchObject({ open_task_count: 1 });
    expect(stall.status).toBe('queued');
    expect(h.events.filter((e) => e.code === 2023)).toHaveLength(1);
  });

  test('the threshold clock holds the alarm before the condition persists', async () => {
    const h = makeSweeper({ boards: { PVT_sample: [unmintable()] } }); // default 30m threshold
    await h.sweeper.runOnce();
    expect(h.createdWakes).toHaveLength(0);
    expect(h.events.filter((e) => e.code === 2023)).toHaveLength(0);
  });

  test('a standing stall wake dedupes — no second alarm while it is open', async () => {
    const h = makeSweeper({
      boards: { PVT_sample: [unmintable()] },
      openWakeTaskKeys: new Set([stallKey()]),
      projectOpenWakes: 0, // the standing stall wake is excluded from the count
      deps: { stallThresholdMs: 0 }
    });
    await h.sweeper.runOnce();
    expect(h.createdWakes).toHaveLength(0);
  });

  test('a real wake clears the stall: the standing stall wake completes with 2024', async () => {
    const h = makeSweeper({
      boards: { PVT_sample: [unmintable()] },
      openWakeTaskKeys: new Set([stallKey()]),
      projectOpenWakes: 1, // a real (non-stall) wake exists again
      deps: { stallThresholdMs: 0 }
    });
    await h.sweeper.runOnce();
    expect(h.completedTaskKeys).toEqual([stallKey()]);
    expect(h.events.filter((e) => e.code === 2024)).toHaveLength(1);
    expect(h.createdWakes).toHaveLength(0);
  });

  test('no open tasks means no stall regardless of empty ledgers', async () => {
    const h = makeSweeper({ boards: { PVT_sample: [] }, deps: { stallThresholdMs: 0 } });
    await h.sweeper.runOnce();
    expect(h.createdWakes).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  test('a board holding only parked issues is idle by design — never a stall', async () => {
    const h = makeSweeper({
      boards: { PVT_sample: [{ ...unmintable(), hasAssignee: false }] },
      deps: { stallThresholdMs: 0 }
    });
    await h.sweeper.runOnce();
    expect(h.createdWakes).toHaveLength(0);
    expect(h.events.filter((e) => e.code === 2023)).toHaveLength(0);
  });
});

// ── Worker tick integration: the interval gate ──────────────────────────────

describe('dispatch worker — board sweep interval gate', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = await createTestPool();
    await runMigrations(pool);
  });

  function makeWorker(sweeper: { runOnce(): Promise<number> }, intervalMs: number) {
    return new DispatchWorker({
      wakeRepo: new WakeRepository(pool),
      routeRepo: new RouteRepository(pool),
      leaseRepo: new LeaseRepository(pool),
      githubAgentRepo: new GithubAgentRepository(pool),
      adapter: { renderTurn: async () => 'MSG', send: async () => {} },
      eventWriter: new EventWriter(createTempDir()),
      boardSweeper: sweeper,
      boardSweepIntervalMs: intervalMs
    });
  }

  test('runs once per interval, not on every tick', async () => {
    let calls = 0;
    const worker = makeWorker({ runOnce: async () => { calls++; return 0; } }, 60_000);
    await worker.runOnce();
    await worker.runOnce();
    expect(calls).toBe(1);
  });

  test('a non-positive interval disables the sweep', async () => {
    let calls = 0;
    const worker = makeWorker({ runOnce: async () => { calls++; return 0; } }, 0);
    await worker.runOnce();
    expect(calls).toBe(0);
  });

  test('a pass that minted counts as work for the idle-sleep decision', async () => {
    const worker = makeWorker({ runOnce: async () => 2 }, 60_000);
    expect(await worker.runOnce()).toBe(true);
  });
});

function taskKeyOf(projectId: string, taskId: string): string {
  // Mirrors makeTaskKey (md5 of `${projectId}:${taskId}`) without importing
  // crypto here — keep the test honest about the join format.
  return md5(`${projectId}:${taskId}`);
}

import crypto from 'node:crypto';
function md5(input: string) {
  return crypto.createHash('md5').update(input).digest('hex');
}
