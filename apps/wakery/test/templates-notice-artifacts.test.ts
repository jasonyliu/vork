// The cap-alert and stall-notice artifacts (self-healing F2b/F2,
// spec_wakery-cap-alert-message.md / spec_wakery-stall-notice-message.md):
// one-duty delivery turns — report to the Principal, then end. Both render
// from the shipped template files so a placeholder drift fails here.
import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadTemplateFile } from '../src/templates/loader.js';
import { validateTemplate } from '../src/templates/validator.js';
import { Renderer, type RendererDeps } from '../src/templates/renderer.js';
import type { GithubAgent, Route, Wake } from '../src/shared/types.js';
import { STALL_ALARM_LABEL, STALL_ALARM_TASK_ID } from '../src/events/codes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

function load(name: string) {
  return validateTemplate(name, loadTemplateFile(resolve(TEMPLATES_DIR, `${name}.json`)));
}

function wake(overrides: Partial<Wake> = {}): Wake {
  return {
    id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1',
    project_id: 'PVT_xyz', project_name: 'Sample Project',
    task_id: '42', task_type: 'coding', task_title: 'Build the thing',
    task_priority: null,
    task_status: 'Progress', task_status_expected: null,
    task_audit: 'Gated', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: null, task_payload: null,
    assignee_id: 'agent-1', assignee_name: null, owner_id: null, owner_name: null,
    queue_attempts: 0, dispatch_attempts: 0, wake_attempts: 5, status: 'dispatched',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  };
}

function route(): Route {
  return {
    id: 'route-1', project_id: 'PVT_xyz', task_type: null, actor: 'owner',
    session_key: 'agent:sarge:main', agent_id: 'sarge', agent_name: 'Sarge',
    delivery: 'session', max_run: 1, status: 'active',
    create_time: Date.now(), update_time: Date.now()
  };
}

function agent(): GithubAgent {
  return {
    id: 'a-1', github_login: 'sarge-login', github_node_id: 'U_x',
    agent_id: 'sarge', agent_name: 'Sarge',
    role: 'agent', status: 'active',
    create_time: Date.now(), update_time: Date.now()
  };
}

function deps(extra: Partial<RendererDeps> = {}): RendererDeps {
  return {
    template: validateTemplate('wake-message', loadTemplateFile(resolve(TEMPLATES_DIR, 'wake-message.json'))),
    capAlertTemplate: load('cap-alert-message'),
    stallNoticeTemplate: load('stall-notice-message'),
    fetchAgent: () => agent(),
    fetchRepoProject: () => ({
      id: 'grp-1', project_id: 'prj_sample', github_repo_id: 'R_1', github_owner_id: 'U_1',
      github_owner_name: 'owner-login', github_repo: 'sample_project', github_project_id: 'PVT_xyz',
      github_project_title: 'Sample Project', github_project_number: 7, project_slug: 'sample_project',
      status: 'active', create_time: Date.now(), update_time: Date.now()
    }),
    projectStoragePath: '/home/x/projects',
    ...extra
  };
}

describe('cap-alert message artifact', () => {
  test('renders fully with the re-wake counters and the one-duty instruction', async () => {
    const r = new Renderer(deps());
    const msg = await r.renderCapAlert(wake(), route(), {
      wakeAttempts: 5, rewakeCap: 5, lastTurnMinutesAgo: 42, settledHolds: []
    });
    expect(msg).toContain('re-wake budget exhausted');
    expect(msg).toContain('5 turns of 5');
    expect(msg).toContain('42 minutes ago');
    expect(msg).toContain('report the blockage to the Principal');
    expect(msg).toContain('Then end your turn.');
    expect(msg).not.toMatch(/\{\{[a-z_]+\}\}/); // no surviving placeholders
  });
});

describe('stall-notice message artifact', () => {
  test('renders fully from the synthetic wake payload', async () => {
    const r = new Renderer(deps());
    const stallWake = wake({
      task_id: STALL_ALARM_TASK_ID,
      task_labels: [STALL_ALARM_LABEL],
      task_status: 'Pending', task_audit: 'Approved', task_type: 'project_operation',
      task_payload: { open_task_count: 3, stalled_minutes: 45 }
    });
    const msg = await r.renderStallNotice(stallWake, route());
    expect(msg).toContain('full stop');
    expect(msg).toContain('3 open task(s)');
    expect(msg).toContain('45 minutes');
    expect(msg).toContain('send the stall notice to the Principal');
    expect(msg).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  test('a payload without the stall facts aborts the render (no silent blanks)', async () => {
    const r = new Renderer(deps());
    const bare = wake({ task_labels: [STALL_ALARM_LABEL], task_payload: null });
    await expect(r.renderStallNotice(bare, route())).rejects.toThrow(/open_task_count|stalled_minutes/);
  });
});
