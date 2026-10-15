// The narrow GitHub surface the bootstrap consumes. `octokit.ts` implements it
// over @octokit/rest; tests substitute a fake. Keeping the seam here keeps every
// bootstrap decision unit-testable with the API mocked.

import type { Visibility } from '../types.js';

export interface RepoInfo {
  nodeId: string;
  ownerLogin: string;
  name: string;
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
  // repository
  findRepo(owner: string, name: string): Promise<RepoInfo | null>;
  createUserRepo(name: string, visibility: Visibility): Promise<RepoInfo>;
  patchRepoSettings(owner: string, name: string): Promise<void>;

  // labels
  listLabels(owner: string, repo: string): Promise<LabelInfo[]>;
  createLabel(owner: string, repo: string, name: string, color: string): Promise<void>;

  // collaborator grant — repository surface
  isCollaborator(owner: string, repo: string, login: string): Promise<boolean>;
  inviteCollaborator(owner: string, repo: string, login: string): Promise<{ invitationId: number | null }>;
  acceptInvitationAs(login: string, invitationId: number): Promise<void>;

  // rulesets
  listRulesets(owner: string, repo: string): Promise<RulesetInfo[]>;
  createRuleset(owner: string, repo: string, payload: object): Promise<RulesetInfo>;
  updateRuleset(owner: string, repo: string, rulesetId: number, payload: object): Promise<void>;

  // git refs
  getRef(owner: string, repo: string, ref: string): Promise<string | null>;
  createRef(owner: string, repo: string, ref: string, sha: string): Promise<void>;
}
