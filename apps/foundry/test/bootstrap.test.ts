import { describe, expect, it } from 'vitest';
import { labelInventory, rulesetPayloads, webhookEvents } from '../src/artifacts.js';
import {
  ensureDevBranch,
  ensureGrants,
  ensureLabels,
  ensureRulesets,
  ensureWebhook,
  runGitHubBootstrap,
  type BootstrapContext
} from '../src/github/bootstrap.js';
import type { CollaboratorRecord, LabelRecord, RulesetRecord, WebhookRecord } from '../src/events.js';
import { FakeGitHubApi } from './fakes.js';

function context(api: FakeGitHubApi, overrides: Partial<BootstrapContext> = {}): BootstrapContext {
  return {
    api,
    ownerLogin: 'owner-login',
    projectKey: 'throwaway',
    projectName: 'Throwaway Project',
    webhookUrl: 'https://ingress.example.com/adapters/github/webhook',
    readWebhookSecret: () => 'hmac-secret',
    grantLogins: ['worker-login', 'auditor-login'],
    ...overrides
  };
}

describe('committed artifact shapes', () => {
  it('label inventory matches the spec table by name and color', () => {
    const labels = new Map(labelInventory().map((label) => [label.name, label.color]));
    expect(labels.size).toBe(28);
    expect(labels.get('type:project_inception')).toBe('0e8a16');
    expect(labels.get('type:project_hotfix')).toBe('d93f0b');
    expect(labels.get('type:dbops')).toBe('006b75');
    expect(labels.get('task:parent')).toBe('0e8a16');
    expect(labels.get('task:child')).toBe('bfd4f2');
    expect(labels.get('task:blocked')).toBe('fef2c0');
    expect(labels.get('task:blocking')).toBe('e99695');
    expect(labels.get('agent:owner')).toBe('c5def5');
    expect(labels.get('risk:R100')).toBe('0e8a16');
    expect(labels.get('risk:R200')).toBe('fbca04');
    expect(labels.get('risk:R300')).toBe('d93f0b');
    expect(labels.get('risk:R999')).toBe('b60205');
  });

  it('webhook event list equals the adapter subscription set', () => {
    expect([...webhookEvents()].sort()).toEqual([
      'issue_comment',
      'issue_dependencies',
      'issues',
      'pull_request',
      'sub_issues',
      'workflow_run'
    ]);
  });

  it('ruleset shapes omit the status-check rule and pin merge-only PRs', () => {
    const payloads = rulesetPayloads();
    expect(payloads.map((payload) => payload.name).sort()).toEqual(['protect-dev', 'protect-main']);
    for (const payload of payloads) {
      const types = payload.rules.map((rule) => rule.type);
      expect(types).toEqual(['deletion', 'non_fast_forward', 'pull_request']);
      expect(types).not.toContain('required_status_checks');
      const pr = payload.rules.find((rule) => rule.type === 'pull_request')!.parameters as {
        allowed_merge_methods: string[];
        required_approving_review_count: number;
      };
      expect(pr.allowed_merge_methods).toEqual(['merge']);
      expect(pr.required_approving_review_count).toBe(payload.name === 'protect-main' ? 1 : 0);
      expect(payload.enforcement).toBe('active');
    }
  });
});

describe('runGitHubBootstrap on a fresh owner', () => {
  it('produces every artifact with canonical field option sets in order', async () => {
    const api = new FakeGitHubApi();
    const result = await runGitHubBootstrap(context(api));

    expect(result.repo.name).toBe('throwaway');
    expect(result.board.title).toBe('Throwaway Project');
    expect(result.statusField.options.map((o) => o.name)).toEqual([
      'Init',
      'Todo',
      'Pending',
      'Progress',
      'Done',
      'Reviewed',
      'Completed',
      'Cancelled'
    ]);
    expect(result.auditField.options.map((o) => o.name)).toEqual(['Gated', 'Approved', 'Revise', 'Govern']);
    // GitHub's default Status field was converged, not duplicated; Audit created
    const fieldRecords = result.records.filter((r: any) => r.resource === 'project_field') as any[];
    expect(fieldRecords.find((r) => r.name === 'Status')?.created_or_skipped).toBe('converged');
    // the converged field carries the persisted option ids, not the mutation response's placeholders
    expect(result.statusField.options.every((o) => !o.id.startsWith('placeholder_'))).toBe(true);
    // the platform color scheme on both fields
    expect(result.statusField.options.map((o) => `${o.name}=${o.color}`)).toEqual(['Init=RED', 'Todo=BLUE', 'Pending=PINK', 'Progress=ORANGE', 'Done=YELLOW', 'Reviewed=PURPLE', 'Completed=GREEN', 'Cancelled=GRAY']);
    expect(result.auditField.options.map((o) => `${o.name}=${o.color}`)).toEqual(['Gated=BLUE', 'Approved=GREEN', 'Revise=YELLOW', 'Govern=RED']);
    expect(fieldRecords.find((r) => r.name === 'Audit')?.created_or_skipped).toBe('created');
    expect(api.fieldsByProject.get(result.board.id)!.filter((f) => f.name === 'Status')).toHaveLength(1);

    // full label inventory seeded
    expect(api.labels.length).toBe(28);
    // webhook configured with the canonical events
    expect(api.hooks.length).toBe(1);
    expect([...api.hooks[0]!.events].sort()).toEqual([...webhookEvents()].sort());
    // dual grants per login
    const collaboratorRecords = result.records.filter((r): r is CollaboratorRecord => r.resource === 'collaborator');
    expect(collaboratorRecords.map((r) => r.github_login)).toEqual(['worker-login', 'auditor-login']);
    expect(collaboratorRecords.every((r) => r.repo_invite_status === 'accepted' && r.project_grant_status === 'granted')).toBe(true);
    expect(api.acceptedInvitations.length).toBe(2);
  });

  it('aborts when the repo exists under a foreign owner', async () => {
    const api = new FakeGitHubApi();
    api.repos.set('throwaway', { nodeId: 'R_x', ownerLogin: 'someone-else', ownerNodeId: 'U_x', name: 'throwaway' });
    await expect(runGitHubBootstrap(context(api))).rejects.toThrow(/foreign owner someone-else/);
  });

  it('aborts when more than one board matches the title', async () => {
    const api = new FakeGitHubApi();
    api.boards.push({ id: 'PVT_a', title: 'Throwaway Project', number: 1 }, { id: 'PVT_b', title: 'Throwaway Project', number: 2 });
    await expect(runGitHubBootstrap(context(api))).rejects.toThrow(/matches 2 existing boards/);
  });
});

describe('idempotency and resume', () => {
  it('a second run skips every artifact and clobbers nothing', async () => {
    const api = new FakeGitHubApi();
    await runGitHubBootstrap(context(api));
    const callsAfterFirst = api.calls.length;
    const second = await runGitHubBootstrap(context(api));

    const outcomes = second.records
      .map((record) => Object.entries(record).find(([key]) => key.startsWith('created_or'))?.[1])
      .filter((value): value is string => value !== undefined);
    expect(outcomes.every((value) => value === 'skipped' || value === 'already_collaborator')).toBe(true);
    const mutating = api.calls
      .slice(callsAfterFirst)
      .filter((call) => /^create|^inviteCollaborator|^updateRuleset|^patchRepo/.test(call));
    expect(mutating).toEqual([]);
  });

  it('converges a field whose names match but colors do not, while the board holds no items', async () => {
    const api = new FakeGitHubApi();
    const first = await runGitHubBootstrap(context(api));
    const audit = api.fieldsByProject.get(first.board.id)!.find((f) => f.name === 'Audit')!;
    audit.options = audit.options.map((o) => ({ ...o, color: 'GRAY' })); // an all-gray board, like one made before the scheme
    const second = await runGitHubBootstrap(context(api));
    const record = second.records.find((r: any) => r.resource === 'project_field' && r.name === 'Audit') as any;
    expect(record.created_or_skipped).toBe('converged');
    expect(second.auditField.options.map((o) => o.color)).toEqual(['BLUE', 'GREEN', 'YELLOW', 'RED']);
  });

  it('leaves a differing field option set as drift once the board holds items', async () => {
    const api = new FakeGitHubApi();
    const first = await runGitHubBootstrap(context(api));
    // an operator reshapes Status and the board has an item — foundry must not touch it
    const status = api.fieldsByProject.get(first.board.id)!.find((f) => f.name === 'Status')!;
    status.options = ['Init', 'Done'].map((name, i) => ({ name, id: `hand${i}` }));
    api.boardItems.push({ projectId: first.board.id, issueNodeId: 'I_x', itemId: 'PVTI_x', fields: {} });
    const second = await runGitHubBootstrap(context(api));
    const record = second.records.find((r: any) => r.resource === 'project_field' && r.name === 'Status') as any;
    expect(record.created_or_skipped).toBe('skipped');
    expect(record.drift).toMatch(/differ from canonical .* board holds 1 items, left untouched/);
    expect(status.options.map((o) => o.name)).toEqual(['Init', 'Done']);
    expect(api.calls.filter((call) => call.startsWith('updateSingleSelectFieldOptions')).length).toBe(1); // only the first run's convergence
  });

  it('records label color drift and leaves the live label untouched', async () => {
    const api = new FakeGitHubApi();
    api.labels.push({ name: 'type:bug', color: '000000' });
    const records = await ensureLabels(context(api));
    const bug = records.find((record): record is LabelRecord => record.name === 'type:bug')!;
    expect(bug.created_or_updated_or_skipped).toBe('skipped');
    expect(bug.drift).toMatch(/color 000000 differs from canonical d73a4a/);
    expect(api.labels.find((label) => label.name === 'type:bug')!.color).toBe('000000');
    // the rest of the inventory is still created
    expect(records.filter((record) => record.created_or_updated_or_skipped === 'created').length).toBe(27);
  });

  it('records webhook event drift on a url-matched hook', async () => {
    const api = new FakeGitHubApi();
    api.hooks.push({ id: 9, url: 'https://ingress.example.com/adapters/github/webhook', events: ['issue_comment'], active: true });
    const record: WebhookRecord = await ensureWebhook(context(api));
    expect(record.created_or_skipped).toBe('skipped');
    expect(record.drift).toMatch(/events \[issue_comment\] differ/);
    expect(api.hooks.length).toBe(1);
  });

  it('converges an existing same-name ruleset by delta and records it', async () => {
    const api = new FakeGitHubApi();
    api.rulesets.push({ id: 5, name: 'protect-main', enforcement: 'disabled', ruleTypes: ['deletion'] });
    const records: RulesetRecord[] = await ensureRulesets(context(api), 'standard');
    const main = records.find((record) => record.name === 'protect-main')!;
    expect(main.created_or_skipped).toBe('converged');
    expect(main.drift).toMatch(/enforcement disabled → active/);
    expect(api.rulesets.find((ruleset) => ruleset.name === 'protect-main')!.enforcement).toBe('active');
    expect(records.find((record) => record.name === 'protect-dev')!.created_or_skipped).toBe('created');
  });

  it('skips rulesets wholly when ruleset mode is none', async () => {
    const api = new FakeGitHubApi();
    expect(await ensureRulesets(context(api), 'none')).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it('skips dev branch creation when the ref exists', async () => {
    const api = new FakeGitHubApi();
    api.refs.set('heads/dev', 'sha_existing');
    const record = await ensureDevBranch(context(api), 'sha_new');
    expect(record.created_or_skipped).toBe('skipped');
    expect(record.sha).toBe('sha_existing');
  });
});

describe('grants never abort the bootstrap', () => {
  it('a failed entry records failed and the loop continues', async () => {
    const api = new FakeGitHubApi();
    const failingApi = new Proxy(api, {
      get(target, prop, receiver) {
        if (prop === 'inviteCollaborator') {
          return async (owner: string, repo: string, login: string) => {
            if (login === 'worker-login') throw new Error('invite exploded');
            return target.inviteCollaborator(owner, repo, login);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    const records = await ensureGrants(context(failingApi as FakeGitHubApi), 'PVT_1');
    expect(records.length).toBe(2);
    const claw = records.find((record) => record.github_login === 'worker-login')!;
    expect(claw.repo_invite_status).toBe('failed');
    expect(claw.error).toMatch(/invite exploded/);
    // the board grant for the failed login is still attempted, and the next login proceeds
    expect(claw.project_grant_status).toBe('granted');
    const heimdall = records.find((record) => record.github_login === 'auditor-login')!;
    expect(heimdall.repo_invite_status).toBe('accepted');
    expect(heimdall.project_grant_status).toBe('granted');
  });
});
