import { Octokit } from '@octokit/rest';
import type { GitHubApi, RepoInfo, LabelInfo, RulesetInfo } from './api.js';
import type { Visibility } from '../types.js';

// GitHubApi over @octokit/rest. The token-file model is the single auth
// surface — ambient `gh` auth is never consulted. `acceptorTokens` maps each
// grantable login to a token of that account, for in-run invitation acceptance
// (`spec_foundry-data.md §GitHub artifacts`, collaborator grant).

export interface OctokitApiOptions {
  mainToken: string;
  acceptorTokens: Map<string, string>;
}

// The GitHub REST API version every request names. Without the header GitHub
// serves 2022-11-28, supported until 2028-03-10; naming the version keeps the
// contract explicit and the deprecation notices away.
export const GITHUB_API_VERSION = '2026-03-10';

export function octokitOptions(token: string): { auth: string; request: { headers: { 'X-GitHub-Api-Version': string } } } {
  return { auth: token, request: { headers: { 'X-GitHub-Api-Version': GITHUB_API_VERSION } } };
}

const RATE_LIMIT_MAX_ATTEMPTS = 3;
const RATE_LIMIT_MAX_WAIT_MS = 60_000;

// Bounded rate-limit waits (`spec_foundry.md §Idempotency and resume`): retry a
// primary/secondary rate-limit rejection up to twice, honoring Retry-After
// capped at 60s; anything else propagates immediately.
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      const headers = (error as { response?: { headers?: Record<string, string> } }).response?.headers ?? {};
      const isRateLimit =
        status === 429 || (status === 403 && (headers['x-ratelimit-remaining'] === '0' || headers['retry-after'] !== undefined));
      if (!isRateLimit || attempt === RATE_LIMIT_MAX_ATTEMPTS) throw error;
      const retryAfterSeconds = Number(headers['retry-after'] ?? '10');
      const waitMs = Math.min(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 10_000, RATE_LIMIT_MAX_WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number }).status === 404;
}

export interface TokenIdentity {
  login: string;
  nodeId: string;
  scopes: string[] | null; // null for fine-grained tokens (no x-oauth-scopes header)
  plan: string | null; // `plan.name` when the token carries read:user or user; null otherwise
}

// Authenticate one token: its `GET /user` login is the identity
// (`spec_foundry.md §Preflight`); the plan rides along when the scope allows.
export async function authIdentity(token: string): Promise<TokenIdentity> {
  const rest = new Octokit(octokitOptions(token));
  const response = await withRateLimitRetry(() => rest.users.getAuthenticated());
  const scopesHeader = (response.headers as Record<string, string | undefined>)['x-oauth-scopes'];
  const plan = (response.data as { plan?: { name?: string } }).plan?.name;
  return {
    login: response.data.login,
    nodeId: response.data.node_id,
    scopes: scopesHeader === undefined ? null : scopesHeader.split(',').map((scope) => scope.trim()).filter((scope) => scope !== ''),
    plan: typeof plan === 'string' && plan !== '' ? plan : null
  };
}

export function buildGitHubApi(options: OctokitApiOptions): GitHubApi {
  const rest = new Octokit(octokitOptions(options.mainToken));

  return {
    async findRepo(owner, name): Promise<RepoInfo | null> {
      try {
        const { data } = await withRateLimitRetry(() => rest.repos.get({ owner, repo: name }));
        return { nodeId: data.node_id, ownerLogin: data.owner.login, name: data.name };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async createUserRepo(name, visibility: Visibility): Promise<RepoInfo> {
      const { data } = await withRateLimitRetry(() =>
        rest.repos.createForAuthenticatedUser({
          name,
          private: visibility === 'private',
          auto_init: false,
          has_issues: true,
          has_wiki: false,
          has_projects: false
        })
      );
      return { nodeId: data.node_id, ownerLogin: data.owner.login, name: data.name };
    },

    async patchRepoSettings(owner, name) {
      // merge-commit only — squash/rebase disabled (`rules/PROJECT.md §Branches`
      // merges are --no-ff); default branch pinned to main
      await withRateLimitRetry(() =>
        rest.repos.update({
          owner,
          repo: name,
          allow_merge_commit: true,
          allow_squash_merge: false,
          allow_rebase_merge: false,
          has_discussions: false
        })
      );
    },

    async listLabels(owner, repo): Promise<LabelInfo[]> {
      const labels = await withRateLimitRetry(() => rest.paginate(rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 }));
      return labels.map((label) => ({ name: label.name, color: label.color }));
    },

    async createLabel(owner, repo, name, color) {
      await withRateLimitRetry(() => rest.issues.createLabel({ owner, repo, name, color }));
    },

    async isCollaborator(owner, repo, login): Promise<boolean> {
      try {
        await withRateLimitRetry(() => rest.repos.checkCollaborator({ owner, repo, username: login }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    async inviteCollaborator(owner, repo, login) {
      const response = await withRateLimitRetry(() => rest.repos.addCollaborator({ owner, repo, username: login, permission: 'push' }));
      // 201 carries the invitation; 204 means the login is already a collaborator
      const invitationId = response.status === 201 && response.data ? response.data.id : null;
      return { invitationId };
    },

    async acceptInvitationAs(login, invitationId) {
      const token = options.acceptorTokens.get(login);
      if (token === undefined) throw new Error(`no acceptor token for login ${login}`);
      const acceptor = new Octokit(octokitOptions(token));
      await withRateLimitRetry(() => acceptor.repos.acceptInvitationForAuthenticatedUser({ invitation_id: invitationId }));
    },

    async listRulesets(owner, repo): Promise<RulesetInfo[]> {
      const { data } = await withRateLimitRetry(() => rest.request('GET /repos/{owner}/{repo}/rulesets', { owner, repo }));
      const rulesets: RulesetInfo[] = [];
      for (const summary of data as { id: number; name: string; enforcement: string }[]) {
        const detail = await withRateLimitRetry(() =>
          rest.request('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}', { owner, repo, ruleset_id: summary.id })
        );
        const rules = (detail.data as { rules?: { type: string }[] }).rules ?? [];
        rulesets.push({ id: summary.id, name: summary.name, enforcement: summary.enforcement, ruleTypes: rules.map((rule) => rule.type) });
      }
      return rulesets;
    },

    async createRuleset(owner, repo, payload): Promise<RulesetInfo> {
      const body = payload as { name: string; enforcement: 'active' | 'disabled' | 'evaluate' } & Record<string, unknown>;
      const { data } = await withRateLimitRetry(() => rest.request('POST /repos/{owner}/{repo}/rulesets', { owner, repo, ...body }));
      const created = data as { id: number; name: string; enforcement: string; rules?: { type: string }[] };
      return { id: created.id, name: created.name, enforcement: created.enforcement, ruleTypes: (created.rules ?? []).map((rule) => rule.type) };
    },

    async updateRuleset(owner, repo, rulesetId, payload) {
      const body = payload as { name: string; enforcement: 'active' | 'disabled' | 'evaluate' } & Record<string, unknown>;
      await withRateLimitRetry(() =>
        rest.request('PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}', { owner, repo, ruleset_id: rulesetId, ...body })
      );
    },

    async getRef(owner, repo, ref): Promise<string | null> {
      try {
        const { data } = await withRateLimitRetry(() => rest.git.getRef({ owner, repo, ref }));
        return data.object.sha;
      } catch (error) {
        if (isNotFound(error) || (error as { status?: number }).status === 409) return null; // 409: empty repository
        throw error;
      }
    },

    async createRef(owner, repo, ref, sha) {
      await withRateLimitRetry(() => rest.git.createRef({ owner, repo, ref, sha }));
    }
  };
}
