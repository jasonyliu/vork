// Input bundle per `spec_foundry-interface.md §Input bundle`: the project's
// mission core plus the repository's visibility. Tokens and GitHub coordinates
// are machine environment and stay there.
export type Visibility = 'private' | 'public';

export interface Bundle {
  project_name: string;
  project_key: string;
  mission: string;
  description: string;
  scope: string;
  visibility: Visibility;
}

// The environment per `spec_foundry-interface.md §Environment`:
// `apps/foundry/.env` beside the app, machine-local.
export interface FoundryEnv {
  owner_token_path: string;
  work_token_path: string;
  ruleset: 'standard' | 'none';
  project_storage_path: string;
}

// An identity resolved at preflight: the token file authenticated and its
// login captured.
export interface ResolvedIdentity {
  tokenPath: string;
  login: string;
  nodeId: string;
}
