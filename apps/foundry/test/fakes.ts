import type { GitHubApi, LabelInfo, RepoInfo, RulesetInfo } from '../src/github/api.js';
import type { Visibility } from '../src/types.js';

// In-memory GitHubApi with call recording and injectable failures — the mocked
// API surface every bootstrap decision is tested against.

export class FakeGitHubApi implements GitHubApi {
  calls: string[] = [];
  failOn: Set<string> = new Set();

  owner = 'owner-login';
  repos = new Map<string, RepoInfo>();
  labels: LabelInfo[] = [];
  collaborators = new Set<string>();
  rulesets: RulesetInfo[] = [];
  refs = new Map<string, string>(); // 'heads/x' → sha
  invitations = new Map<number, string>(); // invitationId → login
  acceptedInvitations: number[] = [];
  createdVisibility = new Map<string, Visibility>();

  private nextId = 1;

  private record(call: string): void {
    this.calls.push(call);
    if (this.failOn.has(call.split('(')[0]!)) throw new Error(`injected failure: ${call}`);
  }

  async findRepo(owner: string, name: string): Promise<RepoInfo | null> {
    this.record(`findRepo(${owner}/${name})`);
    return this.repos.get(name) ?? null;
  }

  async createUserRepo(name: string, visibility: Visibility): Promise<RepoInfo> {
    this.record(`createUserRepo(${name}, ${visibility})`);
    const repo: RepoInfo = { nodeId: `R_${name}`, ownerLogin: this.owner, name };
    this.repos.set(name, repo);
    this.createdVisibility.set(name, visibility);
    return repo;
  }

  async patchRepoSettings(owner: string, name: string): Promise<void> {
    this.record(`patchRepoSettings(${owner}/${name})`);
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
