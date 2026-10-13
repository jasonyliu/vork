import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The audit trail of one bootstrap run: append-only JSONL run events
// (`spec_foundry-data.md §Run events`) — the same genre as wakery's event log.
// One `resource` event per artifact touched, emitted as each act completes, so
// a failed run's trail already covers everything that ran; registry state
// lives in the DB (the register stage), never here. Replaces the retired
// manifest (Principal ruling, 2026-08-25): a `project` row is the project's
// creation — the durable state; events are the history.

export interface RepoRecord {
  resource: 'repo';
  name: string;
  node_id: string;
  created_or_skipped: 'created' | 'skipped';
  settings_applied: boolean;
}

export interface ProjectV2Record {
  resource: 'project_v2';
  title: string;
  node_id: string;
  created_or_skipped: 'created' | 'skipped';
}

export interface ProjectFieldRecord {
  resource: 'project_field';
  name: string;
  options: { name: string; id: string }[];
  created_or_skipped: 'created' | 'converged' | 'skipped';
  drift?: string;
}

export interface ProjectRepoLinkRecord {
  resource: 'project_repo_link';
  project_node_id: string;
  repo_node_id: string;
}

export interface LabelRecord {
  resource: 'label';
  repo: string;
  name: string;
  created_or_updated_or_skipped: 'created' | 'updated' | 'skipped';
  drift?: string;
}


export interface WebhookRecord {
  resource: 'webhook';
  hook_id: number;
  url: string;
  events: string[];
  active: boolean;
  created_or_skipped: 'created' | 'skipped';
  drift?: string;
}

export interface CollaboratorRecord {
  resource: 'collaborator';
  github_login: string;
  repo_invite_status: 'invited' | 'accepted' | 'already_collaborator' | 'failed';
  project_grant_status: 'granted' | 'failed'; // an upsert — no already_granted is observable
  invitation_id?: number;
  accepted_at?: string;
  error?: string;
}

export interface RulesetRecord {
  resource: 'ruleset';
  name: string;
  enforcement: string;
  rules_applied: string[];
  created_or_skipped: 'created' | 'converged' | 'skipped';
  drift?: string;
}

export interface InceptionTaskRecord {
  resource: 'inception_task';
  issue_number: number | null;
  node_id: string | null;
  linked_branch: string | null;
  created_or_skipped: 'created' | 'converged' | 'skipped';
  assignee?: string;
  creation_comment?: 'posted' | 'skipped';
  skipped_reason?: string;
  drift?: string;
}

export interface CloneRecord {
  resource: 'clone';
  name: string;
  path: string;
  probe_result: 'ok' | 'failed';
  drift?: string; // e.g. a torn clone from an interrupted run, re-cloned
}

export interface FileRecord {
  resource: 'file';
  path: string;
  created_or_skipped_or_drift: 'created' | 'skipped' | 'drift';
}

export interface BranchRecord {
  resource: 'branch';
  name: string;
  sha: string;
  created_or_skipped: 'created' | 'skipped';
}

export interface RegistryRecord {
  resource: 'registry';
  project_id: string | null;
  project: 'created' | 'existing' | 'skipped';
  mapping?: 'created' | 'existing';
  agents_created?: string[];
  agents_existing?: string[];
  routes_created?: number;
  routes_existing?: number;
  routes_drift?: { task_type: string | null; actor: string; agent_id: string }[];
  skipped_reason?: string;
}

export type ResourceRecord =
  | RepoRecord
  | ProjectV2Record
  | ProjectFieldRecord
  | ProjectRepoLinkRecord
  | LabelRecord
  | WebhookRecord
  | CollaboratorRecord
  | RulesetRecord
  | InceptionTaskRecord
  | CloneRecord
  | FileRecord
  | BranchRecord
  | RegistryRecord;


// Sanitization per `spec_foundry-data.md §Run events`: a field whose name,
// split on `_`/`-`/case boundaries, carries a secret-pattern segment is written
// as "***". Segment matching, not substring — `path` is not `pat`.
const SECRET_SEGMENTS = new Set(['token', 'password', 'passwd', 'secret', 'key', 'pat', 'bearer', 'auth', 'authorization', 'credential', 'credentials']);

export function isSecretFieldName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_-]+/)
    .some((segment) => SECRET_SEGMENTS.has(segment));
}

export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretFieldName(k) ? '***' : sanitize(v);
    }
    return out;
  }
  return value;
}





// One run's event log: `FOUNDRY_VAR/runs/PROJECT_KEY/run_TS_RUNID8.jsonl`
// — unique by construction, runs accumulate side by side per project. Every
// payload passes sanitization; secrets never appear in any event.
export class RunEventLog {
  readonly path: string;
  readonly records: ResourceRecord[] = [];

  constructor(
    foundryVar: string,
    projectKey: string,
    private readonly runId: string,
    utcNowCompact: string
  ) {
    const dir = join(foundryVar, 'runs', projectKey);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `run_${utcNowCompact}_${runId.replaceAll('-', '').slice(0, 8)}.jsonl`);
  }

  emit(event: string, payload: object): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), run_id: this.runId, event, ...(sanitize(payload) as object) });
    appendFileSync(this.path, `${line}\n`, 'utf8');
  }

  push(...records: ResourceRecord[]): number {
    for (const record of records) {
      this.records.push(record);
      this.emit('resource', record);
    }
    return this.records.length;
  }
}
