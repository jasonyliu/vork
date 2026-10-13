import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import type { GitHubApi, RepoInfo, BoardInfo, FieldInfo, LabelInfo, HookInfo, RulesetInfo, IssueInfo } from './api.js';

// GitHubApi over @octokit/rest + @octokit/graphql. The PAT-file model is the
// single auth surface — ambient `gh` auth is never consulted. `acceptorTokens`
// maps each grantable login to a token of that account, for in-run invitation
// acceptance (`spec_foundry-data.md §GitHub artifacts`, collaborator grants).

export interface OctokitApiOptions {
  mainToken: string;
  acceptorTokens: Map<string, string>;
}

type GraphqlClient = typeof graphql;

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
  scopes: string[] | null; // null for fine-grained PATs (no x-oauth-scopes header)
}

// Authenticate one PAT: its `GET /user` login is the identity
// (`spec_foundry.md §Preflight`).
export async function authIdentity(token: string): Promise<TokenIdentity> {
  const rest = new Octokit({ auth: token });
  const response = await withRateLimitRetry(() => rest.users.getAuthenticated());
  const scopesHeader = (response.headers as Record<string, string | undefined>)['x-oauth-scopes'];
  return {
    login: response.data.login,
    nodeId: response.data.node_id,
    scopes: scopesHeader === undefined ? null : scopesHeader.split(',').map((scope) => scope.trim()).filter((scope) => scope !== '')
  };
}

export function buildGitHubApi(options: OctokitApiOptions): GitHubApi {
  const rest = new Octokit({ auth: options.mainToken });
  const gql: GraphqlClient = graphql.defaults({ headers: { authorization: `token ${options.mainToken}` } });

  return {
    async viewerLogin() {
      const { data } = await withRateLimitRetry(() => rest.users.getAuthenticated());
      return data.login;
    },

    async viewerNodeId() {
      const { data } = await withRateLimitRetry(() => rest.users.getAuthenticated());
      return data.node_id;
    },

    async userNodeId(login) {
      const { data } = await withRateLimitRetry(() => rest.users.getByUsername({ username: login }));
      return data.node_id;
    },

    async findRepo(owner, name): Promise<RepoInfo | null> {
      try {
        const { data } = await withRateLimitRetry(() => rest.repos.get({ owner, repo: name }));
        return { nodeId: data.node_id, ownerLogin: data.owner.login, ownerNodeId: data.owner.node_id, name: data.name };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async createUserRepo(name): Promise<RepoInfo> {
      const { data } = await withRateLimitRetry(() =>
        rest.repos.createForAuthenticatedUser({
          name,
          private: true,
          auto_init: false,
          has_issues: true,
          has_wiki: false,
          // the Projects setting is what surfaces the linked ProjectV2 board on
          // the repository side (classic projects no longer exist) — keep it on
          has_projects: true
        })
      );
      return { nodeId: data.node_id, ownerLogin: data.owner.login, ownerNodeId: data.owner.node_id, name: data.name };
    },

    async patchRepoSettings(owner, name) {
      // merge-commit only — squash/rebase disabled (`PROJECT.md §Branching`
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

    async findBoardsByTitle(ownerLogin, title): Promise<BoardInfo[]> {
      const response = await withRateLimitRetry(() =>
        gql<{ user: { projectsV2: { nodes: { id: string; title: string; number: number }[] } } }>(
          // the variable is named $search: @octokit/graphql reserves "query"
          // (and method/url/headers/request/baseUrl/mediaType) as option names
          `query ($login: String!, $search: String!) {
             user(login: $login) { projectsV2(first: 20, query: $search) { nodes { id title number } } }
           }`,
          { login: ownerLogin, search: title }
        )
      );
      return response.user.projectsV2.nodes.filter((node) => node.title === title);
    },

    async listRepoBoards(owner, repo): Promise<BoardInfo[]> {
      const response = await withRateLimitRetry(() =>
        gql<{ repository: { projectsV2: { nodes: { id: string; title: string; number: number }[] } } }>(
          `query ($owner: String!, $repo: String!) {
             repository(owner: $owner, name: $repo) { projectsV2(first: 5) { nodes { id title number } } }
           }`,
          { owner, repo }
        )
      );
      return response.repository.projectsV2.nodes;
    },

    async createBoard(ownerNodeId, title): Promise<BoardInfo> {
      const response = await withRateLimitRetry(() =>
        gql<{ createProjectV2: { projectV2: { id: string; title: string; number: number } } }>(
          `mutation ($ownerId: ID!, $title: String!) {
             createProjectV2(input: { ownerId: $ownerId, title: $title }) { projectV2 { id title number } }
           }`,
          { ownerId: ownerNodeId, title }
        )
      );
      return response.createProjectV2.projectV2;
    },

    async listBoardFields(projectId): Promise<FieldInfo[]> {
      const response = await withRateLimitRetry(() =>
        gql<{
          node: { fields: { nodes: ({ id: string; name: string; options?: { id: string; name: string; color?: string }[] } | null)[] } };
        }>(
          `query ($projectId: ID!) {
             node(id: $projectId) {
               ... on ProjectV2 {
                 fields(first: 50) {
                   nodes {
                     ... on ProjectV2FieldCommon { id name }
                     ... on ProjectV2SingleSelectField { id name options { id name color } }
                   }
                 }
               }
             }
           }`,
          { projectId }
        )
      );
      return response.node.fields.nodes
        .filter((node): node is { id: string; name: string; options?: { id: string; name: string; color?: string }[] } => node !== null && 'id' in node)
        .map((node) => ({ id: node.id, name: node.name, options: node.options ?? [] }));
    },

    async createSingleSelectField(projectId, name, optionSpecs): Promise<FieldInfo> {
      const response = await withRateLimitRetry(() =>
        gql<{
          createProjectV2Field: { projectV2Field: { id: string; name: string; options: { id: string; name: string }[] } };
        }>(
          `mutation ($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
             createProjectV2Field(
               input: { projectId: $projectId, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options }
             ) {
               projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } }
             }
           }`,
          { projectId, name, options: optionSpecs.map((option) => ({ name: option.name, color: option.color, description: '' })) }
        )
      );
      return response.createProjectV2Field.projectV2Field;
    },

    // GitHub seeds every new board with a default Status field (Todo / In
    // Progress / Done); the canonical option set is converged onto it.
    async updateSingleSelectFieldOptions(fieldId, optionSpecs): Promise<FieldInfo> {
      const response = await withRateLimitRetry(() =>
        gql<{
          updateProjectV2Field: { projectV2Field: { id: string; name: string; options: { id: string; name: string }[] } };
        }>(
          `mutation ($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
             updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) {
               projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color } } }
             }
           }`,
          { fieldId, options: optionSpecs.map((option) => ({ name: option.name, color: option.color, description: '' })) }
        )
      );
      return response.updateProjectV2Field.projectV2Field;
    },

    async countBoardItems(projectId): Promise<number> {
      const response = await withRateLimitRetry(() =>
        gql<{ node: { items: { totalCount: number } } }>(
          `query ($projectId: ID!) { node(id: $projectId) { ... on ProjectV2 { items(first: 1) { totalCount } } } }`,
          { projectId }
        )
      );
      return response.node.items.totalCount;
    },

    async linkBoardToRepo(projectId, repoNodeId) {
      await withRateLimitRetry(() =>
        gql(
          `mutation ($projectId: ID!, $repositoryId: ID!) {
             linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) { clientMutationId }
           }`,
          { projectId, repositoryId: repoNodeId }
        )
      );
    },

    async listLabels(owner, repo): Promise<LabelInfo[]> {
      const labels = await withRateLimitRetry(() => rest.paginate(rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 }));
      return labels.map((label) => ({ name: label.name, color: label.color }));
    },

    async createLabel(owner, repo, name, color) {
      await withRateLimitRetry(() => rest.issues.createLabel({ owner, repo, name, color }));
    },

    async listHooks(owner, repo): Promise<HookInfo[]> {
      const { data } = await withRateLimitRetry(() => rest.repos.listWebhooks({ owner, repo, per_page: 100 }));
      return data.map((hook) => ({ id: hook.id, url: hook.config.url ?? '', events: hook.events, active: hook.active }));
    },

    async createHook(owner, repo, url, secret, events): Promise<HookInfo> {
      const { data } = await withRateLimitRetry(() =>
        rest.repos.createWebhook({
          owner,
          repo,
          config: { url, content_type: 'json', secret },
          events,
          active: true
        })
      );
      return { id: data.id, url: data.config.url ?? url, events: data.events, active: data.active };
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
      const acceptor = new Octokit({ auth: token });
      await withRateLimitRetry(() => acceptor.repos.acceptInvitationForAuthenticatedUser({ invitation_id: invitationId }));
    },

    // ProjectV2 exposes no collaborator listing (schema: only `teams`), so
    // the grant is applied every run — updateProjectV2Collaborators upserts
    // the role, so a repeat is a no-op on GitHub's side.
    async grantBoardWriter(projectId, userNodeId) {
      await withRateLimitRetry(() =>
        gql(
          `mutation ($projectId: ID!, $userId: ID!) {
             updateProjectV2Collaborators(input: { projectId: $projectId, collaborators: [{ userId: $userId, role: WRITER }] }) {
               clientMutationId
             }
           }`,
          { projectId, userId: userNodeId }
        )
      );
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
    },

    async findOpenIssueByTypeLabel(owner, repo, typeLabel): Promise<IssueInfo | null> {
      const { data } = await withRateLimitRetry(() =>
        rest.issues.listForRepo({ owner, repo, labels: typeLabel, state: 'open', per_page: 1 })
      );
      const issue = data.find((candidate) => !candidate.pull_request);
      return issue ? { number: issue.number, nodeId: issue.node_id } : null;
    },

    async findClosedIssueByTypeLabel(owner, repo, typeLabel): Promise<IssueInfo | null> {
      const { data } = await withRateLimitRetry(() =>
        rest.issues.listForRepo({ owner, repo, labels: typeLabel, state: 'closed', per_page: 1 })
      );
      const issue = data.find((candidate) => !candidate.pull_request);
      return issue ? { number: issue.number, nodeId: issue.node_id } : null;
    },

    async createIssue(owner, repo, title, body, labels, assignees): Promise<IssueInfo> {
      const { data } = await withRateLimitRetry(() =>
        rest.issues.create({ owner, repo, title, body, labels, ...(assignees && assignees.length > 0 ? { assignees } : {}) })
      );
      return { number: data.number, nodeId: data.node_id };
    },

    async createIssueComment(owner, repo, issueNumber, body) {
      await withRateLimitRetry(() => rest.issues.createComment({ owner, repo, issue_number: issueNumber, body }));
    },

    async listIssueComments(owner, repo, issueNumber): Promise<string[]> {
      const comments = await withRateLimitRetry(() => rest.paginate(rest.issues.listComments, { owner, repo, issue_number: issueNumber, per_page: 100 }));
      return comments.map((comment) => comment.body ?? '');
    },

    async linkedBranchNames(issueNodeId): Promise<string[]> {
      const response = await withRateLimitRetry(() =>
        gql<{ node: { linkedBranches: { nodes: { ref: { name: string } | null }[] } } }>(
          `query ($issueId: ID!) { node(id: $issueId) { ... on Issue { linkedBranches(first: 20) { nodes { ref { name } } } } } }`,
          { issueId: issueNodeId }
        )
      );
      return response.node.linkedBranches.nodes.map((node) => node.ref?.name).filter((name): name is string => typeof name === 'string');
    },

    async addIssueToBoard(projectId, issueNodeId): Promise<string> {
      const response = await withRateLimitRetry(() =>
        gql<{ addProjectV2ItemById: { item: { id: string } } }>(
          `mutation ($projectId: ID!, $contentId: ID!) {
             addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
           }`,
          { projectId, contentId: issueNodeId }
        )
      );
      return response.addProjectV2ItemById.item.id;
    },

    async setBoardItemField(projectId, itemId, fieldId, optionId) {
      await withRateLimitRetry(() =>
        gql(
          `mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
             updateProjectV2ItemFieldValue(
               input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
             ) { clientMutationId }
           }`,
          { projectId, itemId, fieldId, optionId }
        )
      );
    },

    // Branch↔Task binding from birth: create-and-link in one act — the one form
    // the public API offers (`PROJECT.md §GitHub`).
    async createLinkedBranch(repoNodeId, issueNodeId, branchName, oid) {
      await withRateLimitRetry(() =>
        gql(
          `mutation ($issueId: ID!, $name: String!, $oid: GitObjectID!, $repositoryId: ID!) {
             createLinkedBranch(input: { issueId: $issueId, name: $name, oid: $oid, repositoryId: $repositoryId }) {
               clientMutationId
             }
           }`,
          { issueId: issueNodeId, name: branchName, oid, repositoryId: repoNodeId }
        )
      );
    }
  };
}
