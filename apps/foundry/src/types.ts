// Input bundle per `spec_foundry-interface.md §Input bundle`: the Project's
// mission core. Tokens and GitHub coordinates are machine environment and stay
// there.
export interface Bundle {
  project_name: string;
  project_key: string;
  mission: string;
  description: string;
  scope: string;
}

// The environment per `spec_foundry-interface.md §Environment` —
// `apps/foundry/.env` on the run surface, machine-local. The registry
// connection is the platform `PSYPHIX_DATABASE_*` contract; absent (no host),
// bootstrap runs standalone and the register stage is skipped with an event.
export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password_path: string;
}

export interface FoundryEnv {
  owner_token_path: string;
  work_token_path: string;
  ruleset: 'standard' | 'none';
  project_storage_path: string;
  database?: DatabaseConfig;
}

// An identity resolved at preflight: the token file authenticated and its
// login captured.
export interface ResolvedIdentity {
  tokenPath: string;
  login: string;
  nodeId: string;
}
