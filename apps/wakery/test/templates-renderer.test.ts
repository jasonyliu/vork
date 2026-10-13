import { describe, expect, test } from 'vitest';
import { Renderer, RenderError, buildSettledHoldsBlock, type RendererDeps, type RepoProjectView, type RewakeRenderContext } from '../src/templates/renderer.js';
import type { RewakeMessageTemplate, WakeMessageTemplate } from '../src/templates/validator.js';
import type { GithubAgent, GithubRepoProject, Route, Wake } from '../src/shared/types.js';

const TEMPLATE: WakeMessageTemplate = {
  composition: [
    'Hi {{agent_name}} ({{agent_role}}), you are {{actor}}.',
    'Project: {{project_name}} (board: {{project_url}}, repo: {{repo_full_name}})',
    'Homespace: {{agent_homespace}}',
    'Issue: {{issue_url}}',
    'Wake: wake_id={{wake_id}} task_id={{task_id}} task_status={{task_status}} task_audit={{task_audit}} payload={{task_payload_json}}',
    'utc={{utc_timestamp}}',
    '',
    '{{lane_instructions}}'
  ].join('\n'),
  stateBlocks: {
    'assignee/Todo/Approved': 'Accept or pend the task. {{comment_length_contingent}}',
    default: 'Follow TASK.md for your role. {{comment_length_lean}}'
  },
  commentLengths: {
    contingent: 'Lean on Progress; verbose on Pending.',
    lean: 'One sentence.'
  }
};

function wake(overrides: Partial<Wake> = {}): Wake {
  return {
    id: 'wake-1',
    task_key: 'tk-1',
    state_key: 'sk-1',
    project_id: 'PVT_xyz',
    project_name: null,
    task_id: '42',
    task_type: 'coding',
    task_title: 'Build the thing',
    task_priority: null,
    task_status: 'Todo',
    task_status_expected: null,
    task_audit: 'Approved',
    task_audit_expected: null,
    task_labels: null,
    task_relations: null, task_branch: null,
    task_payload: { foo: 'bar' },
    assignee_id: 'agent-1',
    assignee_name: null,
    owner_id: null,
    owner_name: null,
    queue_attempts: 0,
    dispatch_attempts: 0,
    wake_attempts: 0,
    status: 'queued',
    create_time: Date.now(),
    update_time: Date.now(),
    ...overrides
  };
}

function route(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-1',
    project_id: 'PVT_xyz',
    task_type: 'coding',
    actor: 'assignee',
    session_key: 'agent:main:sample_project:spec',
    agent_id: 'main',
    agent_name: 'Main',
    delivery: 'session',
    max_run: 1,
    status: 'active',
    create_time: Date.now(),
    update_time: Date.now(),
    ...overrides
  };
}

function agent(overrides: Partial<GithubAgent & { role: string }> = {}): GithubAgent {
  return {
    id: 'a-1',
    github_login: 'worker-login',
    github_node_id: 'U_worker',
    agent_id: 'main',
    agent_name: 'Main',
    // spec wake-message §Placeholders treats agent_role as a human-readable string
    role: 'AI Lead' as unknown as GithubAgent['role'],
    status: 'active',
    create_time: Date.now(),
    update_time: Date.now(),
    ...overrides
  } as GithubAgent;
}

function repoProject(overrides: Partial<RepoProjectView> = {}): RepoProjectView {
  return {
    id: 'rp-1',
    project_id: 'prj_sample',
    github_repo_id: 'R_1',
    github_owner_id: 'O_1',
    github_owner_name: 'owner-login',
    github_repo: 'sample_project',
    github_project_id: 'PVT_xyz',
    github_project_title: 'Sample Project',
    github_project_number: 7,
    project_slug: 'sample_project',
    status: 'active',
    create_time: Date.now(),
    update_time: Date.now(),
    ...overrides
  } as RepoProjectView;
}

function deps(overrides: Partial<RendererDeps> = {}): RendererDeps {
  return {
    template: TEMPLATE,
    fetchAgent: () => agent(),
    fetchRepoProject: () => repoProject(),
    projectStoragePath: '/tmp/projects',
    now: () => new Date('2026-05-25T03:59:00.000Z'),
    ...overrides
  };
}

describe('Renderer.render (wake-message)', () => {
  test('renders a known fixture into the expected wake-message string', async () => {
    const renderer = new Renderer(deps());
    const out = await renderer.render(wake(), route());

    expect(out).toBe(
      [
        'Hi Main (AI Lead), you are assignee.',
        'Project: Sample Project (board: https://github.com/users/owner-login/projects/7, repo: owner-login/sample_project)',
        'Homespace: /tmp/projects/sample_project/main',
        'Issue: https://github.com/owner-login/sample_project/issues/42',
        'Wake: wake_id=wake-1 task_id=42 task_status=Todo task_audit=Approved payload={"foo":"bar"}',
        'utc=2026-05-25T03:59:00.000Z',
        '',
        'Accept or pend the task. Lean on Progress; verbose on Pending.'
      ].join('\n')
    );
  });

  test('non-AI-Lead agent gets a team-folder homespace', async () => {
    const renderer = new Renderer(
      deps({
        fetchAgent: () => agent({ agent_id: 'visor', agent_name: 'Visor', role: 'Coding Specialist' as unknown as GithubAgent['role'] })
      })
    );
    const out = await renderer.render(wake(), route({ agent_id: 'visor', agent_name: 'Visor' }));

    expect(out).toContain('Homespace: /tmp/projects/sample_project/team/visor');
    expect(out).toContain('Hi Visor (Coding Specialist)');
  });

  // Regression for #22: the AI Lead is identified by agent_id 'main', not by the
  // human-readable role string. In production github_agent.role is the enum 'agent'
  // (never 'AI Lead'), which the old role-keyed derivation never matched — emitting
  // the non-existent `team/main` path on every main-assigned wake. Keying on
  // agent_id keeps the homespace correct regardless of what role stores.
  test('AI Lead with the production role enum (agent_id=main, role=agent) still gets the main/ homespace (#22)', async () => {
    const renderer = new Renderer(
      deps({
        fetchAgent: () => agent({ role: 'agent' as unknown as GithubAgent['role'] })
      })
    );
    const out = await renderer.render(wake(), route());

    expect(out).toContain('Homespace: /tmp/projects/sample_project/main');
    expect(out).not.toContain('Homespace: /tmp/projects/sample_project/team/main');
  });

  test('unmatched (actor, status, audit) tuple falls back to the default state block', async () => {
    const renderer = new Renderer(deps());
    const out = await renderer.render(wake({ task_status: 'Init', task_audit: 'Gated' }), route());

    expect(out).toContain('Follow TASK.md for your role. One sentence.');
    expect(out).not.toContain('Accept or pend');
  });

  test('placeholders introduced by the spliced lane_instructions (e.g., {{actor}}) are substituted', async () => {
    const renderer = new Renderer(
      deps({
        template: {
          ...TEMPLATE,
          stateBlocks: {
            default: 'lane mentions actor={{actor}} and lean={{comment_length_lean}}'
          }
        }
      })
    );
    // Use an unmatched tuple so we get the default block.
    const out = await renderer.render(wake({ task_status: 'Init', task_audit: 'Gated' }), route({ actor: 'owner', agent_id: 'main' }));

    expect(out).toContain('lane mentions actor=owner and lean=One sentence.');
    expect(out).not.toContain('{{actor}}');
  });

  test('rejects with RenderError naming the placeholder when a required value is null', async () => {
    const renderer = new Renderer(deps({ fetchAgent: () => agent({ agent_name: null }) }));

    await expect(renderer.render(wake(), route())).rejects.toThrow(RenderError);
    try {
      await renderer.render(wake(), route());
    } catch (err) {
      expect((err as RenderError).unresolved).toContain('agent_name');
      expect((err as RenderError).wakeId).toBe('wake-1');
    }
  });

  test('rejects with RenderError when an un-substituted token would survive (template references an unknown placeholder)', async () => {
    const renderer = new Renderer(
      deps({
        template: {
          ...TEMPLATE,
          composition: 'before {{not_a_real_placeholder}} after\n{{lane_instructions}}'
        }
      })
    );

    await expect(renderer.render(wake(), route())).rejects.toThrow(RenderError);
    try {
      await renderer.render(wake(), route());
    } catch (err) {
      expect((err as RenderError).unresolved).toContain('not_a_real_placeholder');
    }
  });

  test('rejects with RenderError when fetchRepoProject returns null', async () => {
    const renderer = new Renderer(deps({ fetchRepoProject: () => null }));
    await expect(renderer.render(wake(), route())).rejects.toThrow(RenderError);
  });

  test('rejects with RenderError when fetchAgent returns null', async () => {
    const renderer = new Renderer(deps({ fetchAgent: () => null }));
    await expect(renderer.render(wake(), route())).rejects.toThrow(RenderError);
  });
});

const REWAKE_TEMPLATE: RewakeMessageTemplate = {
  composition: [
    'Re-wake turn {{wake_attempts}} of {{rewake_cap}} for {{agent_name}} ({{agent_role}}).',
    '{{settled_holds_block}}',
    'Issue: {{issue_url}}',
    'Last turn ended {{last_turn_minutes_ago}} minutes ago.',
    'utc={{utc_timestamp}}',
    'wake_id={{wake_id}} task_id={{task_id}} task_status={{task_status}} payload={{task_payload_json}}',
    '',
    '{{lane_instructions}}'
  ].join('\n')
};

function rewakeDeps(overrides: Partial<RendererDeps> = {}): RendererDeps {
  return {
    ...deps(),
    rewakeTemplate: REWAKE_TEMPLATE,
    ...overrides
  };
}

function rewakeCtx(overrides: Partial<RewakeRenderContext> = {}): RewakeRenderContext {
  return {
    wakeAttempts: 2,
    rewakeCap: 5,
    lastTurnMinutesAgo: 17,
    settledHolds: [],
    ...overrides
  };
}

describe('Renderer.renderRewake (rewake-message)', () => {
  test('renders the re-wake fixture: turn counter, cap, last-turn age, full task packet, state block', async () => {
    const renderer = new Renderer(rewakeDeps());
    const out = await renderer.renderRewake(wake(), route(), rewakeCtx());

    expect(out).toBe(
      [
        'Re-wake turn 2 of 5 for Main (AI Lead).',
        '',
        'Issue: https://github.com/owner-login/sample_project/issues/42',
        'Last turn ended 17 minutes ago.',
        'utc=2026-05-25T03:59:00.000Z',
        'wake_id=wake-1 task_id=42 task_status=Todo payload={"foo":"bar"}',
        '',
        'Accept or pend the task. Lean on Progress; verbose on Pending.'
      ].join('\n')
    );
  });

  test('state-block selection is exactly the wake message\'s — same tuple, same block, same fallback', async () => {
    const renderer = new Renderer(rewakeDeps());
    const out = await renderer.renderRewake(wake({ task_status: 'Init', task_audit: 'Gated' }), route(), rewakeCtx());
    expect(out).toContain('Follow TASK.md for your role. One sentence.');
  });

  test('settled_holds_block is the ONE allowed-empty placeholder — empty set renders to nothing, no RenderError', async () => {
    const renderer = new Renderer(rewakeDeps());
    const out = await renderer.renderRewake(wake(), route(), rewakeCtx({ settledHolds: [] }));
    expect(out).not.toContain('{{settled_holds_block}}');
    expect(out).not.toContain('External holds settled');
  });

  test('settled holds render type-aware and outcome-blind: type, status, held minutes — never a conclusion', async () => {
    const renderer = new Renderer(rewakeDeps());
    const out = await renderer.renderRewake(wake(), route(), rewakeCtx({
      settledHolds: [
        { typeName: 'CI', status: 'completed', heldMinutes: 12 },
        { typeName: 'PR', status: 'timeout', heldMinutes: 31 }
      ]
    }));
    expect(out).toContain('External holds settled since your last turn: CI (completed, held 12m), PR (timeout, held 31m).');
    expect(out).toContain('Wakery reads no outcomes.');
    expect(out).toContain('A hold marked `timeout` never sent its completion signal');
    expect(out).not.toMatch(/green|red|merged into|passed|failed/);
  });

  test('rejects with RenderError when rewakeTemplate is not provided', async () => {
    const renderer = new Renderer(rewakeDeps({ rewakeTemplate: undefined }));
    await expect(renderer.renderRewake(wake(), route(), rewakeCtx())).rejects.toThrow(RenderError);
  });

  test('rejects with RenderError when fetchAgent returns null', async () => {
    const renderer = new Renderer(rewakeDeps({ fetchAgent: () => null }));
    await expect(renderer.renderRewake(wake(), route(), rewakeCtx())).rejects.toThrow(RenderError);
  });

  test('rejects with RenderError when an unknown placeholder leaks past substitution', async () => {
    const renderer = new Renderer(rewakeDeps({
      rewakeTemplate: { composition: 'has {{not_in_resolver}} placeholder' }
    }));
    try {
      await renderer.renderRewake(wake(), route(), rewakeCtx());
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RenderError);
      expect((err as RenderError).unresolved).toContain('not_in_resolver');
    }
  });
});

describe('buildSettledHoldsBlock', () => {
  test('empty set returns the empty string', () => {
    expect(buildSettledHoldsBlock([])).toBe('');
  });

  test('lists each settled hold and carries the outcome-blind instructions', () => {
    const block = buildSettledHoldsBlock([{ typeName: 'CI', status: 'timeout', heldMinutes: 30 }]);
    expect(block).toContain('CI (timeout, held 30m)');
    expect(block).toContain('Check the real external state yourself');
  });
});
