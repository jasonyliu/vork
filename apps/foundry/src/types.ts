import type { Specialist } from '@vork/data';

// Input bundle per `spec_foundry-interface.md §Input bundle`: the Project's
// mission core and its specialists. No tokens, no GitHub coordinates — those
// are machine environment, not project input. The crew (main / heimdall /
// sarge) is a Foundry constant (§Crew), never bundle input.
export interface Bundle {
  project_name: string;
  project_key: string;
  mission: string;
  description: string;
  scope: string;
  channel: string;
  specialists: Specialist[];
}

// The environment per `spec_foundry-interface.md §Environment` — `apps/foundry/.env`
// on the run surface, the deployment-local shape wakery and resolver use. The
// registry connection is the platform `VORK_DATABASE_*` contract; absent
// (no host), bootstrap runs standalone and the register stage is skipped with
// an event — the extraction seam.
export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password_path: string;
}

export interface FoundryEnv {
  owner_token_path: string;
  agent_token_dir: string;
  ruleset: 'standard' | 'none';
  project_storage_path: string;
  webhook_url: string;
  webhook_secret_path: string;
  database?: DatabaseConfig;
}

// A crew or specialist identity resolved at preflight: the token file
// authenticated and its login captured. Work tokens share one account, so
// resolved logins dedupe across agents.
export interface ResolvedAgent {
  name: string;
  tokenPath: string;
  login: string;
  nodeId: string;
}

export const STATUS_OPTIONS = [
  'Init',
  'Todo',
  'Pending',
  'Progress',
  'Done',
  'Reviewed',
  'Completed',
  'Cancelled'
] as const;

export const AUDIT_OPTIONS = ['Gated', 'Approved', 'Revise', 'Govern'] as const;

// Option colors (ProjectV2SingleSelectFieldOptionColor) — the platform board's
// scheme, pinned in `spec_foundry-data.md §GitHub artifacts`.
export const OPTION_COLORS: Record<string, string> = {
  Init: 'RED',
  Todo: 'BLUE',
  Pending: 'PINK',
  Progress: 'ORANGE',
  Done: 'YELLOW',
  Reviewed: 'PURPLE',
  Completed: 'GREEN',
  Cancelled: 'GRAY',
  Gated: 'BLUE',
  Approved: 'GREEN',
  Revise: 'YELLOW',
  Govern: 'RED'
};

export function optionColor(name: string): string {
  return OPTION_COLORS[name] ?? 'GRAY';
}
