import { describe, expect, test, vi, afterEach } from 'vitest';
import { buildWakeRequestFromComment, parseTransitionTargets, validateTaskTypeLabel } from '../src/adapters/github/adapter.js';
import { EventWriter } from '../src/events/writer.js';
import { createTempDir } from './helpers.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoProjectRepo = {
  findByRepoId: async () => ({
    project_id: 'prj_sample',
    github_repo_id: 'REPO_NODE',
    github_project_id: 'PVT_project'
  })
};

const githubAgentRepo = {
  findByGitHubLogin: async (login: string) => login === 'owner-login'
    ? { github_node_id: 'OWNER_NODE', role: 'principal' }
    : null
};

// The active task-type set Stage 6 validates against, as loaded from
// task_type_label (E2 §R2). Mirrors the seed; excludes `weird-not-in-registry`.
const VALID_TYPES = new Set([
  'project_inception', 'project_draft', 'project_decomposition',
  'project_review', 'project_release', 'project_operation',
  'spec', 'research', 'deliberation', 'coding', 'bug', 'enhancement', 'dbops'
]);
const taskTypeLabelRepo = {
  activeTypeValues: async () => VALID_TYPES
};

function githubPayload(body: string) {
  return {
    action: 'created',
    comment: { body },
    repository: { full_name: 'owner-login/sample_project', node_id: 'REPO_NODE' },
    issue: { number: 8 }
  };
}

function mockIssueFetch(status: string, audit: string, labels: string[] = ['type:spec']) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        node: {
          issue: {
            number: 8,
            title: 'Wake Radar projection contracts and ERD spec pass',
            body: 'issue body',
            author: { login: 'owner-login' },
            assignees: { nodes: [{ login: 'worker-login', id: 'ASSIGNEE_NODE' }] },
            labels: { nodes: labels.map((name) => ({ name })) },
            projectItems: {
              nodes: [{
                project: { id: 'PVT_project', title: 'Sample Project' },
                fieldValues: {
                  nodes: [
                    { name: status, field: { name: 'Status' } },
                    { name: audit, field: { name: 'Audit' } }
                  ]
                }
              }]
            }
          }
        }
      }
    })
  })) as any);
}

function readEventLog(dir: string): Array<Record<string, unknown>> {
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  );
}

const TRANSITION_COMMENT = `
**From:** Todo
**To:** Progress
**Actor:** Assignee (worker-login)
**Reason:** Acceptance wake inspected and execution packet is sufficient.
`;

describe('GitHub adapter transition comment handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('parses lifecycle transition target from TASK transition comment', () => {
    expect(parseTransitionTargets(`
**From:** Todo
**To:** Progress
**Actor:** Assignee (worker-login)
`)).toEqual({ taskStatus: 'Progress' });
  });

  test('parses audit transition target from Heimdall audit comment', () => {
    expect(parseTransitionTargets(`
## Heimdall Audit

- **From:** Audit \`Gated\`
- **To:** Audit \`Approved\`
- **Actor:** Auditor
`)).toEqual({ taskAudit: 'Approved' });
  });

  test('emits the lifecycle transition target as task_status_expected; observed task_status stays at the upstream value', async () => {
    mockIssueFetch('Todo', 'Approved');

    const result = await buildWakeRequestFromComment('delivery-1', githubPayload(`
**From:** Todo
**To:** Progress
**Actor:** Assignee (worker-login)
**Reason:** Acceptance wake inspected and execution packet is sufficient.
`), {
      githubToken: 'token',
      githubAgentRepo: githubAgentRepo as any,
      githubRepoProjectRepo: repoProjectRepo as any,
      taskTypeLabelRepo: taskTypeLabelRepo as any
    });

    expect('wakeRequest' in result && result.wakeRequest.task_status).toBe('Todo');
    expect('wakeRequest' in result && result.wakeRequest.task_status_expected).toBe('Progress');
    expect('wakeRequest' in result && result.wakeRequest.task_audit).toBe('Approved');
    expect('wakeRequest' in result && result.wakeRequest.task_audit_expected).toBeUndefined();
  });

  test('emits the audit transition target as task_audit_expected; observed task_audit stays at the upstream value', async () => {
    mockIssueFetch('Todo', 'Gated');

    const result = await buildWakeRequestFromComment('delivery-2', githubPayload(`
## Heimdall Audit

- **From:** Audit \`Gated\`
- **To:** Audit \`Approved\`
- **Actor:** Auditor
- **Risk code:** \`R200\`
`), {
      githubToken: 'token',
      githubAgentRepo: githubAgentRepo as any,
      githubRepoProjectRepo: repoProjectRepo as any,
      taskTypeLabelRepo: taskTypeLabelRepo as any
    });

    expect('wakeRequest' in result && result.wakeRequest.task_status).toBe('Todo');
    expect('wakeRequest' in result && result.wakeRequest.task_status_expected).toBeUndefined();
    expect('wakeRequest' in result && result.wakeRequest.task_audit).toBe('Gated');
    expect('wakeRequest' in result && result.wakeRequest.task_audit_expected).toBe('Approved');
  });
});

describe('GitHub adapter Stage 6 — type:* label validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('validateTaskTypeLabel: zero type:* labels → not_a_task_issue', () => {
    expect(validateTaskTypeLabel(['task:parent', 'bug'], VALID_TYPES)).toEqual({ outcome: 'not_a_task_issue', typeLabels: [] });
  });

  test('validateTaskTypeLabel: one canonical type:* label → ok with task_type stripped of the type: prefix', () => {
    expect(validateTaskTypeLabel(['type:coding'], VALID_TYPES)).toEqual({ outcome: 'ok', taskType: 'coding' });
    // Non-type labels alongside one canonical type:* still pass per spec.
    expect(validateTaskTypeLabel(['task:parent', 'type:project_draft', 'priority:high'], VALID_TYPES))
      .toEqual({ outcome: 'ok', taskType: 'project_draft' });
  });

  test('validateTaskTypeLabel: one non-canonical type:* label → unknown_task_type', () => {
    expect(validateTaskTypeLabel(['type:weird-not-in-registry'], VALID_TYPES)).toEqual({
      outcome: 'unknown_task_type',
      typeLabel: 'type:weird-not-in-registry'
    });
  });

  test('validateTaskTypeLabel: multiple type:* labels → ambiguous_task_type (carries the full list)', () => {
    expect(validateTaskTypeLabel(['type:coding', 'type:spec'], VALID_TYPES)).toEqual({
      outcome: 'ambiguous_task_type',
      typeLabels: ['type:coding', 'type:spec']
    });
    // Even mixed canonical + non-canonical is ambiguous — never pick silently.
    expect(validateTaskTypeLabel(['type:coding', 'type:nonsense'], VALID_TYPES)).toEqual({
      outcome: 'ambiguous_task_type',
      typeLabels: ['type:coding', 'type:nonsense']
    });
  });

  test('outcome: zero type:* labels → buildWakeRequestFromComment drops with REQUEST_DROPPED_NOT_A_TASK_ISSUE (1010); payload includes issue URL + full label set', async () => {
    mockIssueFetch('Todo', 'Approved', ['task:parent', 'priority:high']);
    const eventDir = createTempDir();
    const eventWriter = new EventWriter(eventDir);

    const result = await buildWakeRequestFromComment('delivery-zero', githubPayload(TRANSITION_COMMENT), {
      githubToken: 'token',
      githubAgentRepo: githubAgentRepo as any,
      githubRepoProjectRepo: repoProjectRepo as any,
      taskTypeLabelRepo: taskTypeLabelRepo as any,
      eventWriter
    });

    expect('ignored' in result).toBe(true);
    const events = readEventLog(eventDir);
    const drop = events.find((e) => e.event_code === 1010);
    expect(drop).toBeDefined();
    expect(drop?.event_name).toBe('wake.request.dropped_not_a_task_issue');
    expect(drop?.severity).toBe('warn'); // E3 §R4: elevated above silent `info`
    expect(drop?.issue_url).toBe('https://github.com/owner-login/sample_project/issues/8');
    expect(drop?.labels).toEqual(['task:parent', 'priority:high']);
    // Must not fire other Stage-6 drop events.
    expect(events.find((e) => e.event_code === 1011)).toBeUndefined();
    expect(events.find((e) => e.event_code === 1012)).toBeUndefined();
  });

  test('outcome: one canonical type:* label → proceeds; task_type carries the stripped value', async () => {
    mockIssueFetch('Todo', 'Approved', ['task:parent', 'type:coding']);
    const eventDir = createTempDir();
    const eventWriter = new EventWriter(eventDir);

    const result = await buildWakeRequestFromComment('delivery-ok', githubPayload(TRANSITION_COMMENT), {
      githubToken: 'token',
      githubAgentRepo: githubAgentRepo as any,
      githubRepoProjectRepo: repoProjectRepo as any,
      taskTypeLabelRepo: taskTypeLabelRepo as any,
      eventWriter
    });

    expect('wakeRequest' in result).toBe(true);
    expect('wakeRequest' in result && result.wakeRequest.task_type).toBe('coding');
    // No Stage 6 drop events fired on the happy path.
    const events = readEventLog(eventDir);
    expect(events.find((e) => e.event_code === 1010)).toBeUndefined();
    expect(events.find((e) => e.event_code === 1011)).toBeUndefined();
    expect(events.find((e) => e.event_code === 1012)).toBeUndefined();
  });

  test('outcome: one non-canonical type:* label → drops with REQUEST_DROPPED_UNKNOWN_TASK_TYPE (1011); payload includes the offending label', async () => {
    mockIssueFetch('Todo', 'Approved', ['type:weird-not-in-registry']);
    const eventDir = createTempDir();
    const eventWriter = new EventWriter(eventDir);

    const result = await buildWakeRequestFromComment('delivery-unknown', githubPayload(TRANSITION_COMMENT), {
      githubToken: 'token',
      githubAgentRepo: githubAgentRepo as any,
      githubRepoProjectRepo: repoProjectRepo as any,
      taskTypeLabelRepo: taskTypeLabelRepo as any,
      eventWriter
    });

    expect('ignored' in result).toBe(true);
    const events = readEventLog(eventDir);
    const drop = events.find((e) => e.event_code === 1011);
    expect(drop).toBeDefined();
    expect(drop?.event_name).toBe('wake.request.dropped_unknown_task_type');
    expect(drop?.severity).toBe('warn'); // E3 §R4: the 2026-06-04 silent-stall mode no longer reproduces
    expect(drop?.type_label).toBe('type:weird-not-in-registry');
    expect(drop?.issue_url).toBe('https://github.com/owner-login/sample_project/issues/8');
  });

  test('outcome: more than one type:* label → drops with REQUEST_DROPPED_AMBIGUOUS_TASK_TYPE (1012); payload carries the full type:* set', async () => {
    mockIssueFetch('Todo', 'Approved', ['type:coding', 'type:spec', 'task:parent']);
    const eventDir = createTempDir();
    const eventWriter = new EventWriter(eventDir);

    const result = await buildWakeRequestFromComment('delivery-ambiguous', githubPayload(TRANSITION_COMMENT), {
      githubToken: 'token',
      githubAgentRepo: githubAgentRepo as any,
      githubRepoProjectRepo: repoProjectRepo as any,
      taskTypeLabelRepo: taskTypeLabelRepo as any,
      eventWriter
    });

    expect('ignored' in result).toBe(true);
    const events = readEventLog(eventDir);
    const drop = events.find((e) => e.event_code === 1012);
    expect(drop).toBeDefined();
    expect(drop?.event_name).toBe('wake.request.dropped_ambiguous_task_type');
    expect(drop?.severity).toBe('warn'); // E3 §R4: elevated above silent `info`
    // Only `type:*` labels are carried — task:parent must not leak into the payload.
    expect(drop?.type_labels).toEqual(['type:coding', 'type:spec']);
    expect(drop?.issue_url).toBe('https://github.com/owner-login/sample_project/issues/8');
  });
});

describe('GitHub adapter Stage 6a — stale/delayed webhook gate (#76)', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The comment's To: lifecycle target. Default TRANSITION_COMMENT is To: Progress.
  function payloadWithCommentTs(body: string, createdAt: string) {
    return { ...githubPayload(body), comment: { body, created_at: createdAt } };
  }
  const REWORK_COMMENT = `\n**From:** Done\n**To:** Rework\n**Actor:** Owner (owner-login)\n**Reason:** review failed.\n`;

  test('drops a delayed Todo→Progress comment arriving after the task is at Reviewed (emits 1015)', async () => {
    mockIssueFetch('Reviewed', 'Approved', ['type:coding']); // observed = Reviewed
    const eventDir = createTempDir();
    const result = await buildWakeRequestFromComment(
      'delivery-stale',
      payloadWithCommentTs(TRANSITION_COMMENT, '2026-06-09T00:00:00Z'), // To: Progress, old comment
      {
        githubToken: 'token',
        githubAgentRepo: githubAgentRepo as any,
        githubRepoProjectRepo: repoProjectRepo as any,
        eventWriter: new EventWriter(eventDir),
        taskTypeLabelRepo: taskTypeLabelRepo as any,
        // current-state (Reviewed) wake is newer than the comment → stale
        wakeStateReader: { findCurrentByTaskKey: async () => ({ create_time: Date.parse('2026-06-10T00:00:00Z') }) }
      }
    );

    expect('ignored' in result).toBe(true);
    const drop = readEventLog(eventDir).find((e) => e.event_code === 1015);
    expect(drop).toBeDefined();
    expect(drop?.event_name).toBe('wake.request.dropped_stale_webhook');
    expect(drop?.intended_to).toBe('Progress');
    expect(drop?.observed_state).toBe('Reviewed');
  });

  test('does NOT drop a legitimate backward transition (Done→Rework is legal from Done)', async () => {
    mockIssueFetch('Done', 'Approved', ['type:coding']); // observed = Done; Rework is legal from Done
    const eventDir = createTempDir();
    const result = await buildWakeRequestFromComment(
      'delivery-rework',
      payloadWithCommentTs(REWORK_COMMENT, '2026-06-09T00:00:00Z'), // old comment, but To is reachable
      {
        githubToken: 'token',
        githubAgentRepo: githubAgentRepo as any,
        githubRepoProjectRepo: repoProjectRepo as any,
        eventWriter: new EventWriter(eventDir),
        taskTypeLabelRepo: taskTypeLabelRepo as any,
        wakeStateReader: { findCurrentByTaskKey: async () => ({ create_time: Date.parse('2026-06-10T00:00:00Z') }) }
      }
    );

    expect('wakeRequest' in result).toBe(true);
    expect(readEventLog(eventDir).find((e) => e.event_code === 1015)).toBeUndefined();
  });

  test('does NOT drop when the comment is newer than the current-state wake (fresh out-of-order, not stale)', async () => {
    mockIssueFetch('Reviewed', 'Approved', ['type:coding']); // To: Progress not legal from Reviewed
    const eventDir = createTempDir();
    const result = await buildWakeRequestFromComment(
      'delivery-fresh',
      payloadWithCommentTs(TRANSITION_COMMENT, '2026-06-11T00:00:00Z'), // comment NEWER than current wake
      {
        githubToken: 'token',
        githubAgentRepo: githubAgentRepo as any,
        githubRepoProjectRepo: repoProjectRepo as any,
        eventWriter: new EventWriter(eventDir),
        taskTypeLabelRepo: taskTypeLabelRepo as any,
        wakeStateReader: { findCurrentByTaskKey: async () => ({ create_time: Date.parse('2026-06-10T00:00:00Z') }) }
      }
    );

    expect('wakeRequest' in result).toBe(true);
    expect(readEventLog(eventDir).find((e) => e.event_code === 1015)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// B2 — PR-origin comment guard + task_branch resolution
// (spec_wakery-github-adapter.md Stage 2/Stage 5;
//  spec_wakery-conduction-chaining.md Stage 3)
// ---------------------------------------------------------------------------

interface BranchMockOptions {
  ownBranches?: string[];
  parentNumber?: number;
  parentBranches?: string[];
  blockedByTotal?: number;
  blockerBranches?: string[];
  hopFails?: boolean;
}

// Hop-aware fetch mock: the main wake-build query is discriminated from the
// two hop queries by their query text (hops never select projectItems).
function mockIssueFetchWithBranches(status: string, audit: string, labels: string[], opts: BranchMockOptions = {}) {
  const linked = (names: string[]) => ({ nodes: names.map((name) => ({ ref: { name } })) });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    const query: string = JSON.parse(init.body).query;
    if (query.includes('blockedBy(first: 1)')) {
      if (opts.hopFails) return { ok: false } as any;
      return {
        ok: true,
        json: async () => ({
          data: { node: { issue: { blockedBy: { nodes: (opts.blockedByTotal ?? 0) > 0 ? [{ linkedBranches: linked(opts.blockerBranches ?? []) }] : [] } } } }
        })
      } as any;
    }
    if (!query.includes('projectItems')) {
      // parent-hop linkedBranches-only query
      if (opts.hopFails) return { ok: false } as any;
      return {
        ok: true,
        json: async () => ({
          data: { node: { issue: { linkedBranches: linked(opts.parentBranches ?? []) } } }
        })
      } as any;
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          node: {
            issue: {
              number: 8,
              title: 'Some task',
              body: 'issue body',
              author: { login: 'worker-login' },
              assignees: { nodes: [{ login: 'worker-login', id: 'ASSIGNEE_NODE' }] },
              labels: { nodes: labels.map((name) => ({ name })) },
              parent: opts.parentNumber !== undefined ? { number: opts.parentNumber } : null,
              issueDependenciesSummary: opts.blockedByTotal
                ? { blockedBy: opts.blockedByTotal, blocking: 0, totalBlockedBy: opts.blockedByTotal, totalBlocking: 0 }
                : null,
              linkedBranches: linked(opts.ownBranches ?? []),
              projectItems: {
                nodes: [{
                  project: { id: 'PVT_project', title: 'Sample Project' },
                  fieldValues: {
                    nodes: [
                      { name: status, field: { name: 'Status' } },
                      { name: audit, field: { name: 'Audit' } }
                    ]
                  }
                }]
              }
            }
          }
        }
      })
    } as any;
  }));
}

function branchDeps(eventDir?: string) {
  return {
    githubToken: 'token',
    githubAgentRepo: githubAgentRepo as any,
    githubRepoProjectRepo: repoProjectRepo as any,
    taskTypeLabelRepo: taskTypeLabelRepo as any,
    ...(eventDir ? { eventWriter: new EventWriter(eventDir) } : {})
  };
}

describe('GitHub adapter Stage 2 — PR-origin comment guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a comment on a pull request never proceeds to wake building', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const payload = {
      ...githubPayload(TRANSITION_COMMENT),
      issue: { number: 8, pull_request: { url: 'https://api.github.com/repos/owner-login/sample_project/pulls/8' } }
    };
    const result = await buildWakeRequestFromComment('delivery-pr', payload, branchDeps());

    expect('ignored' in result).toBe(true);
    expect('ignored' in result && result.reason).toBe('pull_request_comment');
    // The guard reads the raw webhook payload — no GraphQL round trip spent.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GitHub adapter Stage 5 — task_branch resolution', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('own linkedBranches wins with no extra round trip; no 1017', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:coding'], { ownBranches: ['feature/wake-radar'] });
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-own', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBe('feature/wake-radar');
    expect((fetch as any).mock.calls).toHaveLength(1);
    expect(readEventLog(eventDir).find((e) => e.event_code === 1017)).toBeUndefined();
  });

  test('multi-entry linkedBranches takes the first and emits 1017 reason=ambiguous', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:coding'], { ownBranches: ['feature/a', 'feature/b'] });
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-ambiguous', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBe('feature/a');
    const warn = readEventLog(eventDir).find((e) => e.event_code === 1017);
    expect(warn).toBeDefined();
    expect(warn?.reason).toBe('ambiguous');
  });

  test('Child Task resolves via the parent hop', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:coding'], {
      parentNumber: 42,
      parentBranches: ['feature/parent-lane']
    });
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-parent-hop', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBe('feature/parent-lane');
    expect((fetch as any).mock.calls).toHaveLength(2); // main + parent hop
    expect(readEventLog(eventDir).find((e) => e.event_code === 1017)).toBeUndefined();
  });

  test('Integration Stage Task resolves via the Blocked-by hop', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:coding'], {
      blockedByTotal: 1,
      blockerBranches: ['feature/lane-under-integration']
    });
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-blocker-hop', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBe('feature/lane-under-integration');
    expect(readEventLog(eventDir).find((e) => e.event_code === 1017)).toBeUndefined();
  });

  test('fully unresolved → task_branch absent + 1017 reason=no_link; wake still builds', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:coding'], {});
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-no-link', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result).toBe(true);
    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBeUndefined();
    const warn = readEventLog(eventDir).find((e) => e.event_code === 1017);
    expect(warn).toBeDefined();
    expect(warn?.reason).toBe('no_link');
  });

  test('laneless task type (dbops) → NULL branch by design, warn suppressed', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:dbops'], {});
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-laneless', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result).toBe(true);
    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBeUndefined();
    expect(readEventLog(eventDir).find((e) => e.event_code === 1017)).toBeUndefined();
  });

  test('hop query failure → task_branch absent + 1017 reason=query_failed; never blocks the wake', async () => {
    mockIssueFetchWithBranches('Todo', 'Approved', ['type:coding'], {
      parentNumber: 42,
      hopFails: true
    });
    const eventDir = createTempDir();

    const result = await buildWakeRequestFromComment('delivery-hop-fail', githubPayload(TRANSITION_COMMENT), branchDeps(eventDir));

    expect('wakeRequest' in result).toBe(true);
    expect('wakeRequest' in result && result.wakeRequest.task_branch).toBeUndefined();
    const warn = readEventLog(eventDir).find((e) => e.event_code === 1017);
    expect(warn).toBeDefined();
    expect(warn?.reason).toBe('query_failed');
  });
});
