// The re-wake artifact (spec_wakery-rewake-message.md): the wake-message
// composition with the re-wake header, the allowed-empty settled-holds block,
// and the verbatim re-wake preamble — self-sufficient as first contact in a
// context-free fresh run session.
import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadTemplateFile } from '../src/templates/loader.js';
import { validateTemplate } from '../src/templates/validator.js';
import { Renderer, type RendererDeps, type RewakeRenderContext } from '../src/templates/renderer.js';
import type { GithubAgent, Route, Wake } from '../src/shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

function loadWake() {
  return validateTemplate('wake-message', loadTemplateFile(resolve(TEMPLATES_DIR, 'wake-message.json')));
}
function loadRewake() {
  return validateTemplate('rewake-message', loadTemplateFile(resolve(TEMPLATES_DIR, 'rewake-message.json')));
}

function wake(overrides: Partial<Wake> = {}): Wake {
  return {
    id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1',
    project_id: 'PVT_xyz', project_name: null,
    task_id: '42', task_type: 'coding', task_title: 'Build the thing',
    task_priority: null,
    task_status: 'Progress', task_status_expected: null,
    task_audit: 'Gated', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: 'feature/x/build', task_payload: { foo: 'bar' },
    assignee_id: 'agent-1', assignee_name: null, owner_id: null, owner_name: null,
    queue_attempts: 0, dispatch_attempts: 2, wake_attempts: 1, status: 'dispatched',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  };
}

function route(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-1', project_id: 'PVT_xyz', task_type: 'coding', actor: 'assignee',
    session_key: 'agent:main:sample_project:run:[wake_route_lease_id]', agent_id: 'main', agent_name: 'Main',
    delivery: 'run', max_run: 1, status: 'active',
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
    rewakeTemplate: loadRewake(),
    fetchAgent: () => agent(),
    fetchRepoProject: () => ({
      id: 'rp-1', project_id: 'prj_sample', github_repo_id: 'R_1', github_owner_id: 'O_1',
      github_owner_name: 'owner-login', github_repo: 'sample_project', github_project_id: 'PVT_xyz',
      github_project_title: 'Sample Project', github_project_number: 7, project_slug: 'sample_project',
      status: 'active' as const,
      create_time: Date.now(), update_time: Date.now()
    }),
    projectStoragePath: '/tmp/projects',
    now: () => new Date('2026-07-29T12:00:00.000Z')
  };
}

function ctx(overrides: Partial<RewakeRenderContext> = {}): RewakeRenderContext {
  return { wakeAttempts: 2, rewakeCap: 5, lastTurnMinutesAgo: 14, settledHolds: [], ...overrides };
}

describe('rewake-message.json artifact', () => {
  test('loads and validates against the rewake-message schema', () => {
    const template = loadRewake();
    expect(template.composition).toContain('{{settled_holds_block}}');
    expect(template.composition).toContain('{{lane_instructions}}');
    expect(template.composition).toContain('{{wake_attempts}}');
    expect(template.composition).toContain('{{rewake_cap}}');
    expect(template.composition).toContain('{{last_turn_minutes_ago}}');
  });

  test('the header identifies the re-wake with turn counter and cap', async () => {
    const out = await new Renderer(deps()).renderRewake(wake(), route(), ctx());
    expect(out).toContain('[2026-07-29T12:00:00.000Z] Wakery re-wake — turn 2 of 5 for this task state');
  });

  test('the re-wake preamble appears verbatim per spec §Composition delta 3', async () => {
    const out = await new Renderer(deps()).renderRewake(wake(), route(), ctx());
    expect(out).toContain('Why you are being woken again: your previous turn on this task ended 14 minutes ago without an observed transition. Wakery reads no outcomes and does not know why.');
    expect(out).toContain('Possible causes: the work is unfinished; the work is done but the transition comment or field move was never posted; upstream event delivery is lagging; or your previous session dropped mid-work.');
    expect(out).toContain("Read the issue's current state first, then act on what you find:");
    expect(out).toContain('- Work already done and transitioned → reply confirming in one line and end your turn (upstream lag heals itself).');
    expect(out).toContain('- Transition missing → post the transition per TASK.md and end your turn.');
    expect(out).toContain('- Work unfinished → continue and finish, ending with its transition.');
    expect(out).toContain('- Cannot proceed within scope → transition to Pending per TASK.md with the blocker named.');
    expect(out).toContain('This is turn 2 of at most 5; at the cap wakery stops waking you and raises an alert instead.');
  });

  test('self-sufficient: carries the full wake-message task packet (fresh-session first contact)', async () => {
    const out = await new Renderer(deps()).renderRewake(wake(), route(), ctx());
    // The identity/preamble block of the wake message.
    expect(out).toContain('Hi Main, you are AI Lead working under github account (worker-login).');
    expect(out).toContain('Project: Sample Project  (board: https://github.com/users/owner-login/projects/7, repo: owner-login/sample_project)');
    expect(out).toContain('Required first action: cd /tmp/projects/sample_project/main && git fetch && git rebase @{u}');
    // The state-specific instruction block, selected exactly as the wake message selects it.
    expect(out).toContain('This is an execution wake.');
    // The wake-context footer.
    expect(out).toContain('wake_id=wake-1');
    expect(out).toContain('task_payload_json={"foo":"bar"}');
    expect(out).toContain('actor=assignee');
  });

  test('settled-holds block renders between the header and the preamble when non-empty', async () => {
    const out = await new Renderer(deps()).renderRewake(wake(), route(), ctx({
      settledHolds: [
        { typeName: 'CI', status: 'completed', heldMinutes: 12 },
        { typeName: 'PR', status: 'timeout', heldMinutes: 31 }
      ]
    }));
    expect(out).toContain('External holds settled since your last turn: CI (completed, held 12m), PR (timeout, held 31m).');
    expect(out).toContain('Wakery reads no outcomes. Check the real external state yourself — the CI conclusion, the pull request, the merge.');
    expect(out).toContain('A hold marked `timeout` never sent its completion signal: verify that external process is not still running before you proceed.');
    expect(out.indexOf('Wakery re-wake')).toBeLessThan(out.indexOf('External holds settled'));
    expect(out.indexOf('External holds settled')).toBeLessThan(out.indexOf('Hi Main'));
  });

  test('allowed-empty: no settled holds renders no block and leaks no placeholder', async () => {
    const out = await new Renderer(deps()).renderRewake(wake(), route(), ctx({ settledHolds: [] }));
    expect(out).not.toContain('External holds settled');
    expect(out).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
  });

  test('every rendered re-wake is placeholder-clean', async () => {
    const renderer = new Renderer(deps());
    for (const [status, audit, actor] of [
      ['Progress', 'Gated', 'assignee'],
      ['Todo', 'Gated', 'auditor'],
      ['Completed', 'Approved', 'owner']
    ] as const) {
      const out = await renderer.renderRewake(
        wake({ task_status: status, task_audit: audit }),
        route({ actor }),
        ctx()
      );
      expect(out, `${actor}/${status}/${audit}`).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
    }
  });
});
