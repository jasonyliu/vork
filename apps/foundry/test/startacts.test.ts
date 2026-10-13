import { describe, expect, it } from 'vitest';
import type { FieldInfo } from '../src/github/api.js';
import { createInceptionTask, kickoff, taskBody, INCEPTION_LANE } from '../src/github/startacts.js';
import { FakeGitHubApi } from './fakes.js';

const statusField: FieldInfo = {
  id: 'F_status',
  name: 'Status',
  options: ['Init', 'Todo', 'Pending', 'Progress', 'Done', 'Reviewed', 'Completed', 'Cancelled'].map((name, i) => ({
    name,
    id: `O_S_${i}`
  }))
};
const auditField: FieldInfo = {
  id: 'F_audit',
  name: 'Audit',
  options: ['Gated', 'Approved', 'Revise', 'Govern'].map((name, i) => ({ name, id: `O_A_${i}` }))
};

function inceptionContext(api: FakeGitHubApi) {
  return {
    api,
    ownerLogin: 'owner-login',
    aiLeadLogin: 'worker-login',
    projectKey: 'throwaway',
    projectName: 'Throwaway Project',
    boardId: 'PVT_1',
    statusField,
    auditField,
    repoNodeId: 'R_throwaway',
    headSha: 'sha_scaffold'
  };
}

describe('task body shape', () => {
  it('renders the four sections in order and parses back', () => {
    const body = taskBody({
      type: 'project_draft',
      scope: 'the settled direction',
      primarySpecification: 'The current Charter and PROJECT.md',
      definitiveDeliverable: 'The active milestone.md'
    });
    const sections = body.split(/^## /m).filter((s) => s.length > 0);
    expect(sections.map((s) => s.split('\n')[0])).toEqual(['Type', 'Scope', 'Primary Specification', 'Definitive Deliverable']);
    expect(sections[0]).toContain('project_draft');
    expect(sections[1]).toContain('the settled direction');
  });
});

describe('inception task', () => {
  it('creates the task under the principal client with lane linked through it', async () => {
    const api = new FakeGitHubApi();
    const record = await createInceptionTask(inceptionContext(api));

    expect(record.created_or_skipped).toBe('created');
    expect(record.linked_branch).toBe(INCEPTION_LANE);
    const issue = api.issues[0]!;
    expect(issue.title).toBe('Project Inception — Throwaway Project');
    expect(issue.labels).toEqual(['type:project_inception', 'agent:owner']);
    expect(issue.body).toContain('## Type\nproject_inception');
    expect(issue.body).toContain('## Primary Specification\nPROJECT.md');
    expect(issue.body).toContain('## Definitive Deliverable\nmain/docs/charter.md');
    // board placement Init / Gated
    const item = api.boardItems[0]!;
    expect(item.fields['F_status']).toBe('O_S_0');
    expect(item.fields['F_audit']).toBe('O_A_0');
    // lane created through the task at the scaffold commit
    expect(api.linkedBranches).toEqual([{ issueNodeId: issue.nodeId, name: INCEPTION_LANE, oid: 'sha_scaffold' }]);
    // assigned to the AI Lead; creation comment in the canonical paired form under the Principal's actor line
    expect(issue.assignees).toEqual(['worker-login']);
    expect(record).toMatchObject({ assignee: 'worker-login', creation_comment: 'posted' });
    const comment = api.comments[0]!;
    expect(comment.issueNumber).toBe(issue.number);
    expect(comment.body.split('\n').slice(0, 5)).toEqual(['Transition', 'From: Init (Audit: Gated)', 'To: Init (Audit: Gated)', 'Actor: Principal (owner-login)', 'Reason: Stage Task created by foundry bootstrap.']);
    // the comment follows board placement and the lane
    const order = api.calls.map((c) => c.split('(')[0]);
    expect(order.indexOf('createIssueComment')).toBeGreaterThan(order.indexOf('createLinkedBranch'));
  });

  it('converges an open inception task left half-made — placement, fields, lane, comment ensured; nothing duplicated', async () => {
    const api = new FakeGitHubApi();
    api.fieldsByProject.set('PVT_1', [statusField, auditField]);
    api.issues.push({ number: 7, nodeId: 'I_7', title: 'x', body: '', labels: ['type:project_inception'], state: 'open', assignees: ['worker-login'] });
    const record = await createInceptionTask(inceptionContext(api));
    expect(record.created_or_skipped).toBe('converged');
    expect(record.issue_number).toBe(7);
    expect(record.creation_comment).toBe('posted');
    expect(api.calls.some((call) => call.startsWith('createIssue('))).toBe(false);
    expect(api.boardItems).toHaveLength(1);
    expect(api.boardItems[0]!.fields).toEqual({ F_status: 'O_S_0', F_audit: 'O_A_0' });
    expect(api.linkedBranches).toEqual([{ issueNodeId: 'I_7', name: INCEPTION_LANE, oid: 'sha_scaffold' }]);
    expect(api.comments).toHaveLength(1);
    // a second convergence changes nothing: one item, one lane, one comment
    const again = await createInceptionTask(inceptionContext(api));
    expect(again.creation_comment).toBe('skipped');
    expect(api.boardItems).toHaveLength(1);
    expect(api.linkedBranches).toHaveLength(1);
    expect(api.comments).toHaveLength(1);
  });

  it('records drift for a closed inception with no open successor — never resurrects', async () => {
    const api = new FakeGitHubApi();
    api.issues.push({ number: 3, nodeId: 'I_3', title: 'x', body: '', labels: ['type:project_inception'], state: 'closed' });
    const record = await createInceptionTask(inceptionContext(api));
    expect(record.created_or_skipped).toBe('skipped');
    expect(record.drift).toMatch(/#3 is closed with no open successor/);
    expect(api.calls.some((call) => call.startsWith('createIssue('))).toBe(false);
  });
});

describe('kickoff', () => {
  function seededBoard(api: FakeGitHubApi): void {
    api.boards.push({ id: 'PVT_1', title: 'Throwaway Project', number: 1 });
    api.fieldsByProject.set('PVT_1', [statusField, auditField]);
  }

  it('creates the project-manager-authored draft task at Init/Gated with the note in scope', async () => {
    const api = new FakeGitHubApi();
    seededBoard(api);
    const result = await kickoff({ api, ownerLogin: 'owner-login', aiLeadLogin: 'worker-login', projectKey: 'throwaway', milestoneFolder: 'milestone_v2026.08.26_widget', title: 'Widget', note: 'settled: build the widget' });

    expect(result.existing).toBe(false);
    const issue = api.issues[0]!;
    expect(issue.title).toBe('Project Draft — Widget');
    expect(issue.labels).toEqual(['type:project_draft', 'agent:owner']);
    expect(issue.assignees).toEqual(['worker-login']);
    expect(issue.body).toContain('milestone_v2026.08.26_widget');
    expect(issue.body).toContain('Settling pointer: settled: build the widget');
    expect(issue.body).toContain('## Definitive Deliverable\ndocs/milestones/milestone_v2026.08.26_widget/milestone.md');
    const item = api.boardItems[0]!;
    expect(item.fields['F_status']).toBe('O_S_0');
    expect(item.fields['F_audit']).toBe('O_A_0');
    expect(api.comments[0]!.body).toContain('Actor: Owner (Sarge)');
    expect(api.comments[0]!.body).toContain('Reason: Stage Task created by foundry kickoff.');
  });

  it('reports an existing open draft and creates nothing — one-active-milestone at the source', async () => {
    const api = new FakeGitHubApi();
    seededBoard(api);
    api.issues.push({ number: 12, nodeId: 'I_12', title: 'x', body: '', labels: ['type:project_draft'], state: 'open' });
    const result = await kickoff({ api, ownerLogin: 'owner-login', aiLeadLogin: 'worker-login', projectKey: 'throwaway', milestoneFolder: 'milestone_v2026.08.26_widget', title: 'Widget' });
    expect(result).toEqual({ issueNumber: 12, existing: true });
    // the existing open Draft is converged, not duplicated: placed at Init/Gated with its creation comment
    expect(api.issues).toHaveLength(1);
    expect(api.boardItems[0]!.fields).toEqual({ F_status: 'O_S_0', F_audit: 'O_A_0' });
    expect(api.comments).toHaveLength(1);
    expect(api.calls.some((call) => call.startsWith('createIssue('))).toBe(false);
  });

  it('fails precisely when the repo does not link exactly one board', async () => {
    const api = new FakeGitHubApi();
    await expect(kickoff({ api, ownerLogin: 'owner-login', aiLeadLogin: 'worker-login', projectKey: 'throwaway', milestoneFolder: 'milestone_v2026.08.26_widget', title: 'Widget' })).rejects.toThrow(/links 0 boards/);
  });
});
