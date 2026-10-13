import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadTemplateFile } from '../src/templates/loader.js';
import { validateTemplate } from '../src/templates/validator.js';
import { Renderer, type RendererDeps } from '../src/templates/renderer.js';
import type { GithubAgent, GithubRepoProject, Route, Wake } from '../src/shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(__dirname, '..', 'templates', 'wake-message.json');

function loadArtifact() {
  const parsed = loadTemplateFile(ARTIFACT_PATH);
  return validateTemplate('wake-message', parsed);
}

function wake(overrides: Partial<Wake> = {}): Wake {
  return {
    id: 'wake-1', task_key: 'tk-1', state_key: 'sk-1',
    project_id: 'PVT_xyz', project_name: null,
    task_id: '42', task_type: 'coding', task_title: 'Build the thing',
    task_priority: null,
    task_status: 'Todo', task_status_expected: null,
    task_audit: 'Approved', task_audit_expected: null,
    task_labels: null, task_relations: null, task_branch: null, task_payload: { foo: 'bar' },
    assignee_id: 'agent-1', assignee_name: null, owner_id: null, owner_name: null,
    queue_attempts: 0, dispatch_attempts: 0, wake_attempts: 0, status: 'queued',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  };
}

function route(overrides: Partial<Route> = {}): Route {
  return {
    id: 'route-1', project_id: 'PVT_xyz', task_type: 'coding', actor: 'assignee',
    session_key: 'agent:main:sample_project:spec', agent_id: 'main', agent_name: 'Main',
    delivery: 'session', max_run: 1, status: 'active',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  };
}

function agent(overrides: Partial<GithubAgent & { role: string }> = {}): GithubAgent {
  return {
    id: 'a-1', github_login: 'worker-login', github_node_id: 'U_worker',
    agent_id: 'main', agent_name: 'Main',
    role: 'AI Lead' as unknown as GithubAgent['role'],
    status: 'active',
    create_time: Date.now(), update_time: Date.now(),
    ...overrides
  } as GithubAgent;
}

function repoProject() {
  return {
    id: 'rp-1', project_id: 'prj_sample', github_repo_id: 'R_1', github_owner_id: 'O_1',
    github_owner_name: 'owner-login', github_repo: 'sample_project', github_project_id: 'PVT_xyz',
    github_project_title: 'Sample Project', github_project_number: 7, project_slug: 'sample_project',
    status: 'active' as const,
    create_time: Date.now(), update_time: Date.now()
  };
}

function deps(): RendererDeps {
  return {
    template: loadArtifact(),
    fetchAgent: () => agent(),
    fetchRepoProject: () => repoProject(),
    projectStoragePath: '/tmp/projects',
    now: () => new Date('2026-05-25T03:59:00.000Z')
  };
}

describe('wake-message.json artifact', () => {
  test('loads and validates against the wake-message schema', () => {
    const template = loadArtifact();
    expect(template.composition).toContain('{{lane_instructions}}');
    expect(Object.keys(template.stateBlocks)).toContain('default');
    expect(template.commentLengths.lean).toBeDefined();
    expect(template.commentLengths.verbose).toBeDefined();
    expect(template.commentLengths.contingent_pending_bounce).toBeDefined();
  });

  test('preamble lines from spec §Composition appear verbatim in every rendered message', async () => {
    const renderer = new Renderer(deps());
    const out = await renderer.render(wake(), route());

    expect(out).toContain('[2026-05-25T03:59:00.000Z] Wakery dispatch');
    expect(out).toContain('Hi Main, you are AI Lead working under github account (worker-login).');
    expect(out).toContain('Project: Sample Project  (board: https://github.com/users/owner-login/projects/7, repo: owner-login/sample_project)');
    expect(out).toContain('Your homespace: /tmp/projects/sample_project/main');
    expect(out).toContain('Issue: https://github.com/owner-login/sample_project/issues/42');
    // Branch-aware sync line: @{u} is the homespace's own upstream — the
    // hardcoded origin/main destructively rebased a dev-checked-out homespace
    // (2026-06-04 incident; fixed by the two-gate template rebuild).
    expect(out).toContain('Required first action: cd /tmp/projects/sample_project/main && git fetch && git rebase @{u}');
    expect(out).toContain('Transition comment format: must follow the canonical structure defined in `/tmp/projects/sample_project/main/apps/wakery/templates/transition-comment.md`');
  });

  test('wake-context block at the end carries all dispatch fields', async () => {
    const renderer = new Renderer(deps());
    const out = await renderer.render(wake(), route());

    expect(out).toContain('wake_id=wake-1');
    expect(out).toContain('actor=assignee');
    expect(out).toContain('project_id=PVT_xyz');
    expect(out).toContain('task_id=42');
    expect(out).toContain('task_type=coding');
    expect(out).toContain('task_status=Todo');
    expect(out).toContain('task_audit=Approved');
    expect(out).toContain('route_id=route-1');
    expect(out).toContain('task_title=Build the thing');
    expect(out).toContain('task_payload_json={"foo":"bar"}');
  });

  test('every (actor, task_status, task_audit) state block from the spec renders a unique signature phrase', async () => {
    const renderer = new Renderer(deps());
    // The two-gate matrix (spec §State-specific instructions): Rework is gone;
    // Progress+Gated is the execution wake; Done+Revise is the redo; Done+Gated
    // is the auditor's Review; Done+Approved is owner acceptance; Pending
    // carries the prior audit (4 keys, one content); terminal states are the
    // owner chain cues (5 keys, one content).
    const cases: Array<{ actor: Route['actor']; status: string; audit: string; signature: string }> = [
      { actor: 'assignee', status: 'Todo', audit: 'Approved', signature: 'This is an acceptance wake, not the execution wake.' },
      { actor: 'assignee', status: 'Progress', audit: 'Gated', signature: 'This is an execution wake.' },
      { actor: 'assignee', status: 'Done', audit: 'Revise', signature: 'This is a redo wake' },
      { actor: 'assignee', status: 'Reviewed', audit: 'Approved', signature: 'This is a final-closeout wake.' },
      { actor: 'owner', status: 'Init', audit: 'Gated', signature: 'This is an Owner preparation wake.' },
      { actor: 'owner', status: 'Pending', audit: 'Approved', signature: 'This is an Owner reclaim wake — the task returned to you as Pending' },
      { actor: 'owner', status: 'Pending', audit: 'Gated', signature: 'This is an Owner reclaim wake — the task returned to you as Pending' },
      { actor: 'owner', status: 'Pending', audit: 'Revise', signature: 'This is an Owner reclaim wake — the task returned to you as Pending' },
      { actor: 'owner', status: 'Pending', audit: 'Govern', signature: 'This is an Owner reclaim wake — the task returned to you as Pending' },
      { actor: 'owner', status: 'Done', audit: 'Approved', signature: 'This is an Owner acceptance wake' },
      { actor: 'owner', status: 'Todo', audit: 'Revise', signature: 'Owner reclaim wake from a failed audit' },
      { actor: 'auditor', status: 'Todo', audit: 'Gated', signature: 'This is a pre-execution audit wake (Preview).' },
      { actor: 'auditor', status: 'Done', audit: 'Gated', signature: 'This is a post-execution review wake (Review).' },
      { actor: 'owner', status: 'Completed', audit: 'Approved', signature: 'This is a chain cue' },
      { actor: 'owner', status: 'Cancelled', audit: 'Gated', signature: 'This is a chain cue' },
      { actor: 'owner', status: 'Cancelled', audit: 'Revise', signature: 'This is a chain cue' },
      { actor: 'owner', status: 'Cancelled', audit: 'Approved', signature: 'This is a chain cue' },
      { actor: 'owner', status: 'Cancelled', audit: 'Govern', signature: 'This is a chain cue' }
    ];

    for (const c of cases) {
      const out = await renderer.render(
        wake({ task_status: c.status, task_audit: c.audit }),
        route({ actor: c.actor, agent_id: c.actor === 'auditor' ? 'heimdall' : 'main' })
      );
      expect(out, `${c.actor}/${c.status}/${c.audit}`).toContain(c.signature);
      expect(out, `${c.actor}/${c.status}/${c.audit} must not leak placeholders`).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
    }
  });

  test('unmatched tuple falls back to the default block and substitutes {{actor}} inside it', async () => {
    const renderer = new Renderer(deps());
    // assignee/Init/Gated has no block — Init is the Owner's lane.
    const out = await renderer.render(
      wake({ task_status: 'Init', task_audit: 'Gated' }),
      route({ actor: 'assignee', agent_id: 'main' })
    );

    expect(out).toContain('You are receiving this wake as the assignee.');
    expect(out).toContain('Do not ask for confirmation unless you are actually blocked');
    expect(out).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
  });

  test('comment-length hints from spec are spliced into the matching state blocks', async () => {
    const renderer = new Renderer(deps());

    const acceptance = await renderer.render(wake(), route());
    expect(acceptance).toContain('Comment length contingent on outcome');

    const closeout = await renderer.render(wake({ task_status: 'Reviewed', task_audit: 'Approved' }), route());
    expect(closeout).toContain('Keep the transition comment lean per TASK.md');

    const revise = await renderer.render(
      wake({ task_status: 'Todo', task_audit: 'Revise' }),
      route({ actor: 'owner', agent_id: 'main' })
    );
    expect(revise).toContain('This transition is decision-bearing per TASK.md');
  });

  test('auditor blocks carry no comment-length hint (SECURITY.md overrides lean default)', async () => {
    const renderer = new Renderer(deps());
    for (const status of ['Todo', 'Done']) {
      const out = await renderer.render(
        wake({ task_status: status, task_audit: 'Gated' }),
        route({ actor: 'auditor', agent_id: 'heimdall' })
      );
      expect(out, `auditor/${status}/Gated`).toContain('SECURITY.md');
      expect(out, `auditor/${status}/Gated`).not.toContain('Keep the transition comment lean');
      expect(out, `auditor/${status}/Gated`).not.toContain('Comment length contingent');
      expect(out, `auditor/${status}/Gated`).not.toContain('decision-bearing per TASK.md');
    }
  });

  test('chain-cue block substitutes {{task_status}} and carries the DELIVERY.md conduction instruction', async () => {
    const renderer = new Renderer(deps());
    const out = await renderer.render(
      wake({ task_status: 'Completed', task_audit: 'Approved' }),
      route({ actor: 'owner', agent_id: 'main' })
    );

    expect(out).toContain('a task reached terminal state (Completed)');
    expect(out).toContain('conduct per DELIVERY.md Chaining');
    expect(out).toContain('also run the branch sweep');
    expect(out).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
  });

  test('execution block carries the CI-duty lines (spec_wakery-wake-message.md execution wake)', async () => {
    const renderer = new Renderer(deps());
    const out = await renderer.render(
      wake({ task_status: 'Progress', task_audit: 'Gated' }),
      route({ actor: 'assignee', agent_id: 'main' })
    );

    expect(out).toContain('the CI it sets in motion is part of the work');
    expect(out).toContain('the task is Done only when you have observed the suite green');
    expect(out).toContain('wakery holds this task while the external work runs and re-wakes you when it settles');
    expect(out).toContain('if the re-wake reports the hold timed out, verify the external state yourself before proceeding');
    // Self-healing F4 — the CI-rerun codification (the outage transcript settled it).
    expect(out).toContain('If a CI run fails for infrastructural reasons');
    expect(out).toContain('never to re-run away');
  });

  test('reclaim blocks carry the ordered-re-queue completeness rule (self-healing F4)', async () => {
    const renderer = new Renderer(deps());
    for (const audit of ['Approved', 'Gated', 'Revise'] as const) {
      const out = await renderer.render(
        wake({ task_status: 'Pending', task_audit: audit }),
        route({ actor: 'owner', agent_id: 'main' })
      );
      expect(out).toContain('Completeness rule:');
      expect(out).toContain('A task created without its transition parks invisibly');
      expect(out).toContain('or explicitly defer them with a reason in your transition comment');
      // Principal ruling 2026-08-12: operational instructions carry no
      // historical citations — provenance lives in records, not in what an
      // agent reads every turn.
      expect(out).not.toContain('self-healing F4');
      expect(out).not.toMatch(/#\d\d/);
    }
  });

  test('Rework has no block and no key — the state left the machine', () => {
    const template = loadArtifact();
    expect(Object.keys(template.stateBlocks).some((k) => k.includes('Rework'))).toBe(false);
  });
});
