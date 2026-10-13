// The narrow GitHub surface the bootstrap consumes. `octokit.ts` implements it
// over @octokit/rest + @octokit/graphql; tests substitute a fake. Keeping the
// seam here keeps every bootstrap decision unit-testable with the API mocked.

export interface RepoInfo {
  nodeId: string;
  ownerLogin: string;
  ownerNodeId: string;
  name: string;
}

export interface BoardInfo {
  id: string;
  title: string;
  number: number;
}

export interface FieldInfo {
  id: string;
  name: string;
  options: { name: string; id: string; color?: string }[];
}

export interface OptionSpec {
  name: string;
  color: string; // ProjectV2SingleSelectFieldOptionColor
}

export interface LabelInfo {
  name: string;
  color: string;
}

export interface HookInfo {
  id: number;
  url: string;
  events: string[];
  active: boolean;
}

export interface RulesetInfo {
  id: number;
  name: string;
  enforcement: string;
  ruleTypes: string[];
}

export interface IssueInfo {
  number: number;
  nodeId: string;
}

export interface GitHubApi {
  // identity
  viewerLogin(): Promise<string>;
  viewerNodeId(): Promise<string>;
  userNodeId(login: string): Promise<string>;

  // repository
  findRepo(owner: string, name: string): Promise<RepoInfo | null>;
  createUserRepo(name: string): Promise<RepoInfo>;
  patchRepoSettings(owner: string, name: string): Promise<void>;

  // ProjectV2 board
  findBoardsByTitle(ownerLogin: string, title: string): Promise<BoardInfo[]>;
  listRepoBoards(owner: string, repo: string): Promise<BoardInfo[]>;
  createBoard(ownerNodeId: string, title: string): Promise<BoardInfo>;
  listBoardFields(projectId: string): Promise<FieldInfo[]>;
  createSingleSelectField(projectId: string, name: string, options: readonly OptionSpec[]): Promise<FieldInfo>;
  updateSingleSelectFieldOptions(fieldId: string, options: readonly OptionSpec[]): Promise<FieldInfo>;
  countBoardItems(projectId: string): Promise<number>;
  linkBoardToRepo(projectId: string, repoNodeId: string): Promise<void>;

  // labels
  listLabels(owner: string, repo: string): Promise<LabelInfo[]>;
  createLabel(owner: string, repo: string, name: string, color: string): Promise<void>;

  // webhook
  listHooks(owner: string, repo: string): Promise<HookInfo[]>;
  createHook(owner: string, repo: string, url: string, secret: string, events: string[]): Promise<HookInfo>;

  // collaborator grants — repo (REST) and board (GraphQL) surfaces
  isCollaborator(owner: string, repo: string, login: string): Promise<boolean>;
  inviteCollaborator(owner: string, repo: string, login: string): Promise<{ invitationId: number | null }>;
  acceptInvitationAs(login: string, invitationId: number): Promise<void>;
  grantBoardWriter(projectId: string, userNodeId: string): Promise<void>; // idempotent upsert — ProjectV2 exposes no collaborator listing

  // rulesets
  listRulesets(owner: string, repo: string): Promise<RulesetInfo[]>;
  createRuleset(owner: string, repo: string, payload: object): Promise<RulesetInfo>;
  updateRuleset(owner: string, repo: string, rulesetId: number, payload: object): Promise<void>;

  // git refs
  getRef(owner: string, repo: string, ref: string): Promise<string | null>;
  createRef(owner: string, repo: string, ref: string, sha: string): Promise<void>;

  // issues (start acts)
  findOpenIssueByTypeLabel(owner: string, repo: string, typeLabel: string): Promise<IssueInfo | null>;
  findClosedIssueByTypeLabel(owner: string, repo: string, typeLabel: string): Promise<IssueInfo | null>;
  createIssue(owner: string, repo: string, title: string, body: string, labels: string[], assignees?: string[]): Promise<IssueInfo>;
  createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void>;
  listIssueComments(owner: string, repo: string, issueNumber: number): Promise<string[]>; // bodies
  linkedBranchNames(issueNodeId: string): Promise<string[]>;
  addIssueToBoard(projectId: string, issueNodeId: string): Promise<string>;
  setBoardItemField(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<void>;
  createLinkedBranch(repoNodeId: string, issueNodeId: string, branchName: string, oid: string): Promise<void>;
}
