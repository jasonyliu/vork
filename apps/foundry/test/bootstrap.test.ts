import { describe, expect, it } from 'vitest';
import { labelInventory, rulesetPayloads } from '../src/artifacts.js';
import {
  ensureDevBranch,
  ensureGrants,
  ensureLabels,
  ensureRulesets,
  runGitHubBootstrap,
  type BootstrapContext
} from '../src/github/bootstrap.js';
import type { CollaboratorRecord, LabelRecord, RulesetRecord } from '../src/events.js';
import { FakeGitHubApi } from './fakes.js';

function context(api: FakeGitHubApi, overrides: Partial<BootstrapContext> = {}): BootstrapContext {
  return {
    api,
    ownerLogin: 'jasonyliu',
    projectKey: 'throwaway',
    projectName: 'Throwaway Project',
    workLogin: 'psyphix-claw',
    ...overrides
  };
}

describe('committed artifact shapes', () => {
  it('the label pass adds defect alone, beside the GitHub defaults', () => {
    const labels = labelInventory();
    expect(labels).toEqual([{ name: 'defect', color: 'e99695' }]);
  });

  it('ruleset shapes reserve the status-check rule for CI and pin merge-only PRs', () => {
    const payloads = rulesetPayloads();
    expect(payloads.map((payload) => payload.name).sort()).toEqual(['protect-dev', 'protect-main']);
    for (const payload of payloads) {
      const types = payload.rules.map((rule) => rule.type);
      expect(types).toEqual(['deletion', 'non_fast_forward', 'pull_request']);
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
  it('produces exactly repo, board (default fields), link, defect label, work grant', async () => {
    const api = new FakeGitHubApi();
    const result = await runGitHubBootstrap(context(api));

    expect(result.repo.name).toBe('throwaway');
    expect(result.board.title).toBe('Throwaway Project');
    expect(api.labels).toEqual([{ name: 'defect', color: 'e99695' }]);
    const collaboratorRecords = result.records.filter((r): r is CollaboratorRecord => r.resource === 'collaborator');
    expect(collaboratorRecords.map((r) => r.github_login)).toEqual(['psyphix-claw']);
    expect(collaboratorRecords[0]!.repo_invite_status).toBe('accepted');
    expect(collaboratorRecords[0]!.project_grant_status).toBe('granted');
    expect(api.acceptedInvitations.length).toBe(1);
    const resources = result.records.map((r) => r.resource);
    expect([...new Set(resources)].sort()).toEqual(['collaborator', 'label', 'project_repo_link', 'project_v2', 'repo']);
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
  it('a second run skips every artifact; existing state stands', async () => {
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

  it('records label color drift and leaves the live label standing', async () => {
    const api = new FakeGitHubApi();
    api.labels.push({ name: 'defect', color: '000000' });
    const records = await ensureLabels(context(api));
    const defect = records.find((record): record is LabelRecord => record.name === 'defect')!;
    expect(defect.created_or_updated_or_skipped).toBe('skipped');
    expect(defect.drift).toMatch(/color 000000 differs from canonical e99695/);
    expect(api.labels.find((label) => label.name === 'defect')!.color).toBe('000000');
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

describe('grants leave the bootstrap running', () => {
  it('a failed invite records failed; the board grant is still attempted', async () => {
    const api = new FakeGitHubApi();
    const failingApi = new Proxy(api, {
      get(target, prop, receiver) {
        if (prop === 'inviteCollaborator') {
          return async () => {
            throw new Error('invite exploded');
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    const records = await ensureGrants(context(failingApi as FakeGitHubApi), 'PVT_1');
    expect(records.length).toBe(1);
    expect(records[0]!.repo_invite_status).toBe('failed');
    expect(records[0]!.error).toMatch(/invite exploded/);
    expect(records[0]!.project_grant_status).toBe('granted');
  });
});
