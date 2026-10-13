// The govern-notice artifact (spec_wakery-govern-notice-message.md): the
// notification cue turn for a state-based Govern arrival
// (milestone_govern-notice_v2026.08.05) — one duty, send the Principal's
// checkpoint notice, then end the turn. Outcome-blind toward the decision.
import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadTemplateFile } from '../src/templates/loader.js';
import { validateTemplate } from '../src/templates/validator.js';
import { Renderer, RenderError, type RendererDeps } from '../src/templates/renderer.js';
import type { GithubAgent, Route, Wake } from '../src/shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

function loadWake() {
  return validateTemplate('wake-message', loadTemplateFile(resolve(TEMPLATES_DIR, 'wake-message.json')));
}
function loadGovernNotice() {
  return validateTemplate('govern-notice-message', loadTemplateFile(resolve(TEMPLATES_DIR, 'govern-notice-message.json')));
}

function wake(overrides: Partial<Wake> = {}): Wake {
  return {
    id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1',
    project_id: 'PVT_xyz', project_name: null,
    task_id: '42', task_type: 'coding', task_title: 'Build the thing',
    task_priority: null,
    task_status: 'Todo', task_status_expected: null,
    task_audit: 'Govern', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: null, task_payload: null,
    assignee_id: 'agent-1', assignee_name: null, owner_id: null, owner_name: null,
    queue_attempts: 0, dispatch_attempts: 0, wake_attempts: 0, status: 'queued',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  };
}

function route(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-1', project_id: 'PVT_xyz', task_type: null, actor: 'owner',
    session_key: 'agent:main:main', agent_id: 'main', agent_name: 'Main',
    delivery: 'session', max_run: 1, status: 'active',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  };
}

function agent(): GithubAgent {
  return {
    id: 'a-1', github_login: 'worker-login', github_node_id: 'U_worker',
    agent_id: 'main', agent_name: 'Main',
    role: 'AI Lead' as unknown as GithubAgent['role'],
    status: 'active',
    create_time: Date.now(), update_time: Date.now()
  } as GithubAgent;
}

function deps(): RendererDeps {
  return {
    template: loadWake(),
    governNoticeTemplate: loadGovernNotice(),
    fetchAgent: () => agent(),
    fetchRepoProject: () => ({
      id: 'rp-1', project_id: 'prj_sample', github_repo_id: 'R_1', github_owner_id: 'O_1',
      github_owner_name: 'owner-login', github_repo: 'sample_project', github_project_id: 'PVT_xyz',
      github_project_title: 'Sample Project', github_project_number: 7, project_slug: 'sample_project',
      status: 'active' as const,
      create_time: Date.now(), update_time: Date.now()
    }),
    projectStoragePath: '/tmp/projects',
    now: () => new Date('2026-08-05T12:00:00.000Z')
  };
}

describe('govern-notice-message.json artifact', () => {
  test('loads and validates against the govern-notice-message schema', () => {
    const template = loadGovernNotice();
    expect(template.composition).toContain('{{gate}}');
    expect(template.composition).toContain('{{decision_required}}');
    expect(template.composition).toContain('{{utc_timestamp}}');
    expect(template.composition).toContain('{{wake_id}}');
  });

  test('the header identifies the govern notice', async () => {
    const out = await new Renderer(deps()).renderGovernNotice(wake(), route());
    expect(out).toContain('[2026-08-05T12:00:00.000Z] Wakery govern notice — Principal checkpoint reached');
  });

  test('Todo:Govern derives the pre-execution (Preview) gate', async () => {
    const out = await new Renderer(deps()).renderGovernNotice(wake({ task_status: 'Todo' }), route());
    expect(out).toContain('Task #42 (coding, "Build the thing") is parked at Todo:Govern — the pre-execution (Preview) gate has escalated to the Principal.');
  });

  test('Done:Govern derives the post-execution (Review) gate', async () => {
    const out = await new Renderer(deps()).renderGovernNotice(wake({ task_status: 'Done' }), route());
    expect(out).toContain('Task #42 (coding, "Build the thing") is parked at Done:Govern — the post-execution (Review) gate has escalated to the Principal.');
  });

  test('decision_required names the Principal verdict in place of the Auditor (both gates, one content)', async () => {
    const renderer = new Renderer(deps());
    for (const status of ['Todo', 'Done'] as const) {
      const out = await renderer.renderGovernNotice(wake({ task_status: status }), route());
      expect(out).toContain("Decision required: Approved | Revise (the Principal's verdict in place of the Auditor), performed by the Principal on the issue per TASK.md §Transition.");
    }
  });

  test('the one-duty paragraph appears verbatim per spec §Composition', async () => {
    const out = await new Renderer(deps()).renderGovernNotice(wake(), route());
    expect(out).toContain(
      'Your one duty this turn, per DELIVERY.md §Communication: send the checkpoint notice to the Principal over the designated channel (your TOOLS.md §Channel) — task reference, the gate, the decision required, and a one-line summary of the Auditor\'s verdict comment (read it from the issue). Then end your turn. Do not transition the task, do not argue the verdict, do not wait for the reply — conduction resumes on the Principal\'s own transition.'
    );
  });

  test('carries the identity preamble and the wake-context footer', async () => {
    const out = await new Renderer(deps()).renderGovernNotice(wake(), route());
    expect(out).toContain('Hi Main, you are AI Lead working under github account (worker-login).');
    expect(out).toContain('Project: Sample Project  (board: https://github.com/users/owner-login/projects/7, repo: owner-login/sample_project)');
    expect(out).toContain('Issue: https://github.com/owner-login/sample_project/issues/42');
    expect(out).toContain('wake_id=wake-1');
    expect(out).toContain('task_status=Todo');
    expect(out).toContain('task_audit=Govern');
    expect(out).toContain('task_title=Build the thing');
  });

  test('every rendered govern notice is placeholder-clean', async () => {
    const renderer = new Renderer(deps());
    for (const status of ['Todo', 'Done'] as const) {
      const out = await renderer.renderGovernNotice(wake({ task_status: status }), route());
      expect(out, `${status}:Govern`).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
    }
  });

  test('render aborts on a missing placeholder (null task_title)', async () => {
    await expect(
      new Renderer(deps()).renderGovernNotice(wake({ task_title: null }), route())
    ).rejects.toThrow(RenderError);
  });

  test('render aborts when no gate can be derived (a non-Todo/Done lifecycle carrying Govern)', async () => {
    await expect(
      new Renderer(deps()).renderGovernNotice(wake({ task_status: 'Pending' }), route())
    ).rejects.toThrow(RenderError);
  });

  test('render aborts when the govern-notice template is not configured', async () => {
    const d = deps();
    delete d.governNoticeTemplate;
    await expect(new Renderer(d).renderGovernNotice(wake(), route())).rejects.toThrow(RenderError);
  });
});
