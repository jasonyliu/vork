import type {
  BoardInfo,
  FieldInfo,
  OptionSpec,
  GitHubApi,
  HookInfo,
  IssueInfo,
  LabelInfo,
  RepoInfo,
  RulesetInfo
} from '../src/github/api.js';

// In-memory GitHubApi with call recording and injectable failures — the mocked
// API surface every bootstrap decision is tested against.

export interface FakeIssue extends IssueInfo {
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  assignees?: string[];
}

export class FakeGitHubApi implements GitHubApi {
  calls: string[] = [];
  failOn: Set<string> = new Set();

  owner = 'owner-login';
  repos = new Map<string, RepoInfo>();
  boards: BoardInfo[] = [];
  fieldsByProject = new Map<string, FieldInfo[]>();
  labels: LabelInfo[] = [];
  hooks: HookInfo[] = [];
  collaborators = new Set<string>();
  boardCollaborators = new Map<string, Set<string>>(); // projectId → user node ids
  rulesets: RulesetInfo[] = [];
  refs = new Map<string, string>(); // 'heads/x' → sha
  issues: FakeIssue[] = [];
  boardItems: { projectId: string; issueNodeId: string; itemId: string; fields: Record<string, string> }[] = [];
  linkedBranches: { issueNodeId: string; name: string; oid: string }[] = [];
  invitations = new Map<number, string>(); // invitationId → login
  acceptedInvitations: number[] = [];

  private nextId = 1;
  private commitCounter = 0;

  private record(call: string): void {
    this.calls.push(call);
    if (this.failOn.has(call.split('(')[0]!)) throw new Error(`injected failure: ${call}`);
  }

  async viewerLogin(): Promise<string> {
    this.record('viewerLogin()');
    return this.owner;
  }

  async viewerNodeId(): Promise<string> {
    this.record('viewerNodeId()');
    return 'U_owner';
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

  async listRepoBoards(_owner: string, _repo: string): Promise<BoardInfo[]> {
    this.record('listRepoBoards()');
    return [...this.boards];
  }

  async createBoard(ownerNodeId: string, title: string): Promise<BoardInfo> {
    this.record(`createBoard(${ownerNodeId}, ${title})`);
    const board: BoardInfo = { id: `PVT_${this.nextId++}`, title, number: this.nextId };
    this.boards.push(board);
    // GitHub seeds every new board with a default Status single-select
    this.fieldsByProject.set(board.id, [
      { id: `${board.id}_status`, name: 'Status', options: ['Todo', 'In Progress', 'Done'].map((name, i) => ({ name, color: 'GRAY', id: `${board.id}_status_d${i}` })) }
    ]);
    return board;
  }

  // Like GitHub: the persisted options get new ids, but the mutation's
  // response carries placeholder ids that do not match them.
  async updateSingleSelectFieldOptions(fieldId: string, options: readonly OptionSpec[]): Promise<FieldInfo> {
    this.record(`updateSingleSelectFieldOptions(${fieldId}, ${options.map((o) => `${o.name}/${o.color}`).join('|')})`);
    for (const fields of this.fieldsByProject.values()) {
      const field = fields.find((candidate) => candidate.id === fieldId);
      if (field) {
        field.options = options.map((o, i) => ({ name: o.name, color: o.color, id: `${fieldId}_o${i}` }));
        return { ...field, options: options.map((o, i) => ({ name: o.name, color: o.color, id: `placeholder_${i}` })) };
      }
    }
    throw new Error(`field ${fieldId} not found`);
  }

  async listIssueComments(_owner: string, _repo: string, issueNumber: number): Promise<string[]> {
    this.record(`listIssueComments(${issueNumber})`);
    return this.comments.filter((c) => c.issueNumber === issueNumber).map((c) => c.body);
  }

  async linkedBranchNames(issueNodeId: string): Promise<string[]> {
    this.record(`linkedBranchNames(${issueNodeId})`);
    return this.linkedBranches.filter((b) => b.issueNodeId === issueNodeId).map((b) => b.name);
  }

  async countBoardItems(projectId: string): Promise<number> {
    this.record(`countBoardItems(${projectId})`);
    return this.boardItems.filter((item) => item.projectId === projectId).length;
  }

  async listBoardFields(projectId: string): Promise<FieldInfo[]> {
    this.record(`listBoardFields(${projectId})`);
    return this.fieldsByProject.get(projectId) ?? [];
  }

  async createSingleSelectField(projectId: string, name: string, options: readonly OptionSpec[]): Promise<FieldInfo> {
    this.record(`createSingleSelectField(${projectId}, ${name})`);
    const field: FieldInfo = {
      id: `F_${this.nextId++}`,
      name,
      options: options.map((option, index) => ({ name: option.name, color: option.color, id: `O_${name}_${index}` }))
    };
    const fields = this.fieldsByProject.get(projectId) ?? [];
    fields.push(field);
    this.fieldsByProject.set(projectId, fields);
    return field;
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

  async listHooks(): Promise<HookInfo[]> {
    this.record('listHooks()');
    return [...this.hooks];
  }

  async createHook(_owner: string, _repo: string, url: string, _secret: string, events: string[]): Promise<HookInfo> {
    this.record(`createHook(${url})`);
    const hook: HookInfo = { id: this.nextId++, url, events, active: true };
    this.hooks.push(hook);
    return hook;
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

  async findOpenIssueByTypeLabel(_owner: string, _repo: string, typeLabel: string): Promise<IssueInfo | null> {
    this.record(`findOpenIssueByTypeLabel(${typeLabel})`);
    const issue = this.issues.find((candidate) => candidate.state === 'open' && candidate.labels.includes(typeLabel));
    return issue ? { number: issue.number, nodeId: issue.nodeId } : null;
  }

  async findClosedIssueByTypeLabel(_owner: string, _repo: string, typeLabel: string): Promise<IssueInfo | null> {
    this.record(`findClosedIssueByTypeLabel(${typeLabel})`);
    const issue = this.issues.find((candidate) => candidate.state === 'closed' && candidate.labels.includes(typeLabel));
    return issue ? { number: issue.number, nodeId: issue.nodeId } : null;
  }

  comments: { issueNumber: number; body: string }[] = [];

  async createIssue(_owner: string, _repo: string, title: string, body: string, labels: string[], assignees: string[] = []): Promise<IssueInfo> {
    this.record(`createIssue(${title})`);
    const issue: FakeIssue = { number: this.nextId++, nodeId: `I_${this.nextId}`, title, body, labels, state: 'open', assignees };
    this.issues.push(issue);
    return { number: issue.number, nodeId: issue.nodeId };
  }

  async createIssueComment(_owner: string, _repo: string, issueNumber: number, body: string): Promise<void> {
    this.record(`createIssueComment(${issueNumber})`);
    this.comments.push({ issueNumber, body });
  }

  async addIssueToBoard(projectId: string, issueNodeId: string): Promise<string> {
    this.record(`addIssueToBoard(${projectId}, ${issueNodeId})`);
    const existing = this.boardItems.find((item) => item.projectId === projectId && item.issueNodeId === issueNodeId);
    if (existing) return existing.itemId; // GitHub returns the existing item
    const itemId = `ITEM_${this.nextId++}`;
    this.boardItems.push({ projectId, issueNodeId, itemId, fields: {} });
    return itemId;
  }

  async setBoardItemField(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<void> {
    const field = (this.fieldsByProject.get(projectId) ?? []).find((f) => f.id === fieldId);
    if (field && !field.options.some((o) => o.id === optionId)) throw new Error('The single select option Id does not belong to the field');
    this.record(`setBoardItemField(${itemId}, ${fieldId}, ${optionId})`);
    const item = this.boardItems.find((candidate) => candidate.projectId === projectId && candidate.itemId === itemId);
    if (item) item.fields[fieldId] = optionId;
  }

  async createLinkedBranch(_repoNodeId: string, issueNodeId: string, branchName: string, oid: string): Promise<void> {
    this.record(`createLinkedBranch(${issueNodeId}, ${branchName})`);
    this.linkedBranches.push({ issueNodeId, name: branchName, oid });
  }
}
