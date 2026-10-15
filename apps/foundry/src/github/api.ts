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

export interface LabelInfo {
  name: string;
  color: string;
}

export interface RulesetInfo {
  id: number;
  name: string;
  enforcement: string;
  ruleTypes: string[];
}

export interface GitHubApi {
  // identity
  userNodeId(login: string): Promise<string>;

  // repository
  findRepo(owner: string, name: string): Promise<RepoInfo | null>;
  createUserRepo(name: string): Promise<RepoInfo>;
  patchRepoSettings(owner: string, name: string): Promise<void>;

  // ProjectV2 board — created with GitHub's default fields, as shipped
  findBoardsByTitle(ownerLogin: string, title: string): Promise<BoardInfo[]>;
  createBoard(ownerNodeId: string, title: string): Promise<BoardInfo>;
  linkBoardToRepo(projectId: string, repoNodeId: string): Promise<void>;

  // labels
  listLabels(owner: string, repo: string): Promise<LabelInfo[]>;
  createLabel(owner: string, repo: string, name: string, color: string): Promise<void>;

  // collaborator grants — repo (REST) and board (GraphQL) surfaces
  isCollaborator(owner: string, repo: string, login: string): Promise<boolean>;
  inviteCollaborator(owner: string, repo: string, login: string): Promise<{ invitationId: number | null }>;
  acceptInvitationAs(login: string, invitationId: number): Promise<void>;
  grantBoardWriter(projectId: string, userNodeId: string): Promise<void>; // idempotent upsert — ProjectV2 exposes teams alone, so the grant re-applies every run

  // rulesets
  listRulesets(owner: string, repo: string): Promise<RulesetInfo[]>;
  createRuleset(owner: string, repo: string, payload: object): Promise<RulesetInfo>;
  updateRuleset(owner: string, repo: string, rulesetId: number, payload: object): Promise<void>;

  // git refs
  getRef(owner: string, repo: string, ref: string): Promise<string | null>;
  createRef(owner: string, repo: string, ref: string, sha: string): Promise<void>;
}
