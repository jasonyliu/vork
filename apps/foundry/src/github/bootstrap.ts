import { labelInventory, rulesetPayloads } from '../artifacts.js';
import { githubError, preflightError } from '../errors.js';
import type { BranchRecord, CollaboratorRecord, LabelRecord, RepoRecord, ResourceRecord, RulesetRecord } from '../events.js';
import type { Visibility } from '../types.js';
import type { GitHubApi, RepoInfo } from './api.js';

// The GitHub bootstrap sub-steps, in pipeline order (`spec_foundry.md §GitHub
// bootstrap`): repo, labels, grant — each idempotent per the resume table, each
// streaming its resource event. Rulesets and the `dev` branch live here too;
// the pipeline invokes them at their later stage.

export interface BootstrapContext {
  api: GitHubApi;
  ownerLogin: string;
  projectKey: string;
  visibility: Visibility;
  workLogin: string; // the work account — the one grant
}

export interface GitHubBootstrapResult {
  records: ResourceRecord[];
  repo: RepoInfo;
}

export async function ensureRepo(ctx: BootstrapContext): Promise<{ record: RepoRecord; repo: RepoInfo }> {
  const existing = await ctx.api.findRepo(ctx.ownerLogin, ctx.projectKey);
  if (existing) {
    if (existing.ownerLogin !== ctx.ownerLogin) {
      throw preflightError(`repo ${ctx.projectKey} exists under foreign owner ${existing.ownerLogin}`);
    }
    return {
      record: { resource: 'repo', name: ctx.projectKey, node_id: existing.nodeId, visibility: ctx.visibility, created_or_skipped: 'skipped', settings_applied: false },
      repo: existing
    };
  }
  const repo = await ctx.api.createUserRepo(ctx.projectKey, ctx.visibility);
  await ctx.api.patchRepoSettings(ctx.ownerLogin, ctx.projectKey);
  return {
    record: { resource: 'repo', name: ctx.projectKey, node_id: repo.nodeId, visibility: ctx.visibility, created_or_skipped: 'created', settings_applied: true },
    repo
  };
}

// Upsert by name; an existing different color is recorded as drift and the live
// label left standing — GitHub's auto-generated defaults stand, Foundry adds.
export async function ensureLabels(ctx: BootstrapContext): Promise<LabelRecord[]> {
  const existing = await ctx.api.listLabels(ctx.ownerLogin, ctx.projectKey);
  const byName = new Map(existing.map((l) => [l.name, l]));
  const records: LabelRecord[] = [];
  for (const label of labelInventory()) {
    const found = byName.get(label.name);
    if (found) {
      const drift = found.color.toLowerCase() === label.color.toLowerCase() ? undefined : `color ${found.color} differs from canonical ${label.color}`;
      records.push({ resource: 'label', repo: ctx.projectKey, name: label.name, created_or_updated_or_skipped: 'skipped', ...(drift ? { drift } : {}) });
      continue;
    }
    await ctx.api.createLabel(ctx.ownerLogin, ctx.projectKey, label.name, label.color);
    records.push({ resource: 'label', repo: ctx.projectKey, name: label.name, created_or_updated_or_skipped: 'created' });
  }
  return records;
}

// The work-account grant on the repository: invite `push`, accepted in-run with
// the work token. A failure records `failed` and continues — the grant leaves
// the bootstrap running.
export async function ensureGrants(ctx: BootstrapContext): Promise<CollaboratorRecord[]> {
  const login = ctx.workLogin;
  let repoStatus: CollaboratorRecord['repo_invite_status'] = 'failed';
  let invitationId: number | undefined;
  let acceptedAt: string | undefined;
  let error: string | undefined;
  try {
    if (await ctx.api.isCollaborator(ctx.ownerLogin, ctx.projectKey, login)) {
      repoStatus = 'already_collaborator';
    } else {
      const invite = await ctx.api.inviteCollaborator(ctx.ownerLogin, ctx.projectKey, login);
      if (invite.invitationId === null) {
        repoStatus = 'already_collaborator';
      } else {
        invitationId = invite.invitationId;
        repoStatus = 'invited';
        await ctx.api.acceptInvitationAs(login, invite.invitationId);
        repoStatus = 'accepted';
        acceptedAt = new Date().toISOString();
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return [{
    resource: 'collaborator',
    github_login: login,
    repo_invite_status: repoStatus,
    ...(invitationId !== undefined ? { invitation_id: invitationId } : {}),
    ...(acceptedAt !== undefined ? { accepted_at: acceptedAt } : {}),
    ...(error !== undefined ? { error } : {})
  }];
}

// Apply the committed shapes; an existing same-name ruleset converges by delta,
// recorded. Skipped wholly when `FOUNDRY_RULESET=none`.
export async function ensureRulesets(ctx: BootstrapContext, mode: 'standard' | 'none'): Promise<RulesetRecord[]> {
  if (mode === 'none') return [];
  const existing = await ctx.api.listRulesets(ctx.ownerLogin, ctx.projectKey);
  const records: RulesetRecord[] = [];
  for (const payload of rulesetPayloads()) {
    const wantRules = payload.rules.map((rule) => rule.type);
    const found = existing.find((ruleset) => ruleset.name === payload.name);
    if (found) {
      const drifts: string[] = [];
      if (found.enforcement !== payload.enforcement) drifts.push(`enforcement ${found.enforcement} → ${payload.enforcement}`);
      const foundRules = [...found.ruleTypes].sort();
      if (JSON.stringify(foundRules) !== JSON.stringify([...wantRules].sort())) {
        drifts.push(`rules [${foundRules.join(', ')}] → [${wantRules.join(', ')}]`);
      }
      if (drifts.length > 0) await ctx.api.updateRuleset(ctx.ownerLogin, ctx.projectKey, found.id, payload);
      records.push({
        resource: 'ruleset',
        name: payload.name,
        enforcement: payload.enforcement,
        rules_applied: wantRules,
        created_or_skipped: drifts.length > 0 ? 'converged' : 'skipped',
        ...(drifts.length > 0 ? { drift: drifts.join('; ') } : {})
      });
      continue;
    }
    await ctx.api.createRuleset(ctx.ownerLogin, ctx.projectKey, payload);
    records.push({ resource: 'ruleset', name: payload.name, enforcement: payload.enforcement, rules_applied: wantRules, created_or_skipped: 'created' });
  }
  return records;
}

// Create `dev` at the scaffold commit, so both standing branches exist before
// protection (`spec_foundry.md §Scaffold commit, push, dev`).
export async function ensureDevBranch(ctx: BootstrapContext, scaffoldSha: string): Promise<BranchRecord> {
  const existing = await ctx.api.getRef(ctx.ownerLogin, ctx.projectKey, 'heads/dev');
  if (existing !== null) {
    return { resource: 'branch', name: 'dev', sha: existing, created_or_skipped: 'skipped' };
  }
  await ctx.api.createRef(ctx.ownerLogin, ctx.projectKey, 'refs/heads/dev', scaffoldSha);
  return { resource: 'branch', name: 'dev', sha: scaffoldSha, created_or_skipped: 'created' };
}

// A sink records resource acts as they complete — the run event log in
// production, a plain array in tests. Mid-stage failure leaves everything that
// ran already recorded.
export interface RecordSink {
  push(...records: ResourceRecord[]): number;
}

// The GitHub bootstrap pipeline stage: sub-steps in order, each emitting its
// resource record into `sink` as it completes. Failure anywhere throws exit 4;
// the event trail already covers the completed sub-steps.
export async function runGitHubBootstrap(ctx: BootstrapContext, sink: RecordSink = []): Promise<GitHubBootstrapResult> {
  const all: ResourceRecord[] = [];
  const keep = (...records: ResourceRecord[]) => {
    all.push(...records);
    sink.push(...records);
  };
  try {
    const { record: repoRecord, repo } = await ensureRepo(ctx);
    keep(repoRecord);
    keep(...(await ensureLabels(ctx)));
    keep(...(await ensureGrants(ctx)));
    return { records: all, repo };
  } catch (error) {
    if (error instanceof Error && error.name === 'FoundryError') throw error;
    throw githubError(error instanceof Error ? error.message : String(error));
  }
}
