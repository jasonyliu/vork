import type {
  BoardInfo,
  GitHubApi,
  LabelInfo,
  RepoInfo,
  RulesetInfo
} from '../src/github/api.js';

// In-memory GitHubApi with call recording and injectable failures — the mocked
// API surface every bootstrap decision is tested against.

export class FakeGitHubApi implements GitHubApi {
  calls: string[] = [];
  failOn: Set<string> = new Set();

  owner = 'jasonyliu';
  repos = new Map<string, RepoInfo>();
  boards: BoardInfo[] = [];
  labels: LabelInfo[] = [];
  collaborators = new Set<string>();
  boardCollaborators = new Map<string, Set<string>>(); // projectId → user node ids
  rulesets: RulesetInfo[] = [];
  refs = new Map<string, string>(); // 'heads/x' → sha
  invitations = new Map<number, string>(); // invitationId → login
  acceptedInvitations: number[] = [];

  private nextId = 1;
  private commitCounter = 0;

  private record(call: string): void {
    this.calls.push(call);
    if (this.failOn.has(call.split('(')[0]!)) throw new Error(`injected failure: ${call}`);
  }



  async userNodeId(login: string): Promise<string> {
    this.record(`userNodeId(${login})`);
    return `U_${login}`;
  }

  async findRepo(owner: string, name: string): Promise<RepoInfo | null> {
    this.record(`findRepo(${owner}/${name})`);
    return this.repos.get(name) ?? null;
  }

  async createUserRepo(name: string): Promise<RepoInfo> {
    this.record(`createUserRepo(${name})`);
    const repo: RepoInfo = { nodeId: `R_${name}`, ownerLogin: this.owner, ownerNodeId: 'U_owner', name };
    this.repos.set(name, repo);
    return repo;
  }

  async patchRepoSettings(owner: string, name: string): Promise<void> {
    this.record(`patchRepoSettings(${owner}/${name})`);
  }

  async findBoardsByTitle(ownerLogin: string, title: string): Promise<BoardInfo[]> {
    this.record(`findBoardsByTitle(${ownerLogin}, ${title})`);
    return this.boards.filter((board) => board.title === title);
  }


  async createBoard(ownerNodeId: string, title: string): Promise<BoardInfo> {
    this.record(`createBoard(${ownerNodeId}, ${title})`);
    const board: BoardInfo = { id: `PVT_${this.nextId++}`, title, number: this.nextId };
    this.boards.push(board);
    return board;
  }







  async linkBoardToRepo(projectId: string, repoNodeId: string): Promise<void> {
    this.record(`linkBoardToRepo(${projectId}, ${repoNodeId})`);
  }

  async listLabels(): Promise<LabelInfo[]> {
    this.record('listLabels()');
    return [...this.labels];
  }

  async createLabel(_owner: string, _repo: string, name: string, color: string): Promise<void> {
    this.record(`createLabel(${name}, ${color})`);
    this.labels.push({ name, color });
  }



  async isCollaborator(_owner: string, _repo: string, login: string): Promise<boolean> {
    this.record(`isCollaborator(${login})`);
    return this.collaborators.has(login);
  }

  async inviteCollaborator(_owner: string, _repo: string, login: string): Promise<{ invitationId: number | null }> {
    this.record(`inviteCollaborator(${login})`);
    if (this.collaborators.has(login)) return { invitationId: null };
    const invitationId = this.nextId++;
    this.invitations.set(invitationId, login);
    return { invitationId };
  }

  async acceptInvitationAs(login: string, invitationId: number): Promise<void> {
    this.record(`acceptInvitationAs(${login}, ${invitationId})`);
    this.acceptedInvitations.push(invitationId);
    this.collaborators.add(login);
  }

  async grantBoardWriter(projectId: string, userNodeId: string): Promise<void> {
    this.record(`grantBoardWriter(${projectId}, ${userNodeId})`);
    const granted = this.boardCollaborators.get(projectId) ?? new Set<string>();
    granted.add(userNodeId); // upsert
    this.boardCollaborators.set(projectId, granted);
  }

  async listRulesets(): Promise<RulesetInfo[]> {
    this.record('listRulesets()');
    return [...this.rulesets];
  }

  async createRuleset(_owner: string, _repo: string, payload: object): Promise<RulesetInfo> {
    const shaped = payload as { name: string; enforcement: string; rules: { type: string }[] };
    this.record(`createRuleset(${shaped.name})`);
    const ruleset: RulesetInfo = {
      id: this.nextId++,
      name: shaped.name,
      enforcement: shaped.enforcement,
      ruleTypes: shaped.rules.map((rule) => rule.type)
    };
    this.rulesets.push(ruleset);
    return ruleset;
  }

  async updateRuleset(_owner: string, _repo: string, rulesetId: number, payload: object): Promise<void> {
    const shaped = payload as { name: string; enforcement: string; rules: { type: string }[] };
    this.record(`updateRuleset(${rulesetId}, ${shaped.name})`);
    const index = this.rulesets.findIndex((ruleset) => ruleset.id === rulesetId);
    if (index >= 0) {
      this.rulesets[index] = { id: rulesetId, name: shaped.name, enforcement: shaped.enforcement, ruleTypes: shaped.rules.map((rule) => rule.type) };
    }
  }

  async getRef(_owner: string, _repo: string, ref: string): Promise<string | null> {
    this.record(`getRef(${ref})`);
    return this.refs.get(ref) ?? null;
  }

  async createRef(_owner: string, _repo: string, ref: string, sha: string): Promise<void> {
    this.record(`createRef(${ref}, ${sha})`);
    this.refs.set(ref.replace(/^refs\//, ''), sha);
  }







}
