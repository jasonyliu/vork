// The canonical Task-type set is no longer code-pinned here. As of E2 (#54,
// spec_wakery-task-type-registry.md §R1/§R2) the runtime authority is the
// `task_type_label` DB table (read via TaskTypeLabelRepository); the initial
// seed lives in `scripts/seed.ts` (TASK_TYPE_LABEL_SEED). A type is added/retired
// by a row change — no code edit or redeploy. `docs/conventions/constants.md
// §Task types` is the human-readable reflection of that table.

export type WakeStatus = 'pending' | 'queued' | 'parked' | 'dispatched' | 'completed' | 'deleted';
export type RouteDelivery = 'session' | 'run';
export type RouteStatus = 'active' | 'disabled' | 'deleted';
export type RouteActor = 'owner' | 'assignee' | 'auditor';
// A lease is a turn record (spec_wakery-queue-and-leases.md Stage 3): it is
// never paused and never re-pointed. `active` = the turn is believed running;
// completion is idempotent and terminal, owned by the dispatch worker's
// gateway-derived causes only.
export type LeaseStatus = 'active' | 'completed' | 'deleted';
// Snooze rows are pure delay records (spec_wakery-snooze.md): `parked` and
// `revoked` are retired with intake correlation — a predicate that matches
// nothing already holds nothing.
export type SnoozeStatus = 'active' | 'completed' | 'timeout';
export type GithubAgentRole = 'principal' | 'auditor' | 'agent';
export type GithubAgentStatus = 'active' | 'disabled';
export type GithubRepoProjectStatus = 'active' | 'disabled';

export interface TaskRelations {
  parent?: { task_id: string };
  children?: { total: number; completed: number };
  blocked_by?: { total: number; completed: number };
  blocking?: { total: number; completed: number };
}

export interface WakeRequest {
  request_id: string;
  source: string;
  project_id: string;
  project_name?: string;
  task_id: string;
  task_type: string;
  task_title?: string;
  task_priority?: number;
  task_status: string;
  task_status_expected?: string;
  task_audit: string;
  task_audit_expected?: string;
  task_labels?: string[];
  task_relations?: TaskRelations;
  // Branch↔task binding resolved at wake build (spec_wakery-conduction-chaining.md
  // Stage 3); absent when resolution came up empty (laneless types by design).
  task_branch?: string;
  task_payload?: unknown;
  assignee_id?: string;
  assignee_name?: string;
  owner_id?: string;
  owner_name?: string;
  timestamp: number;
}

export interface WakeResponse {
  request_id: string;
  status: 'accepted' | 'updated' | 'dropped' | 'rejected';
  message: string;
}

export interface Wake {
  id: string;
  task_key: string;
  state_key: string;
  project_id: string;
  project_name: string | null;
  task_id: string;
  task_type: string;
  task_title: string | null;
  task_priority: number | null;
  task_status: string;
  task_status_expected: string | null;
  task_audit: string;
  task_audit_expected: string | null;
  task_labels: string[] | null;
  task_relations: TaskRelations | null;
  // Immutable once stored: each wake resolves its branch at its own build;
  // no code path updates task_branch on an existing row.
  task_branch: string | null;
  task_payload: unknown | null;
  assignee_id: string | null;
  assignee_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  queue_attempts: number;
  dispatch_attempts: number;
  // Agent turns actually started for this wake — incremented at each successful
  // send (first dispatch and every re-wake). 0 selects the wake-message
  // template, >0 the re-wake template; capped by WAKERY_REWAKE_MAX_ATTEMPTS
  // (spec_wakery-dispatch-worker.md Stages 4-5).
  wake_attempts: number;
  status: WakeStatus;
  create_time: number;
  update_time: number;
}

export interface Route {
  id: string;
  project_id: string;
  task_type: string | null;
  actor: RouteActor;
  session_key: string | null;
  agent_id: string;
  agent_name: string | null;
  delivery: RouteDelivery;
  max_run: number | null;
  status: RouteStatus;
  create_time: number;
  update_time: number;
}

export interface GithubAgent {
  id: string;
  github_login: string;
  github_node_id: string;
  agent_id: string;
  agent_name: string | null;
  role: GithubAgentRole;
  status: GithubAgentStatus;
  create_time: number;
  update_time: number;
}

// The project registry row (specs/data/spec_database.md §11): pure platform
// identity — `project` is the slug, the canonical cross-system key.
export interface Project {
  id: string;
  project: string;
  name: string;
  status: 'active' | 'suspend' | 'deleted';
  create_time: number;
  update_time: number;
}

// The GitHub integration mapping (specs/data/spec_database.md §5): platform
// project_id + github_-prefixed GitHub coordinates. github_repo_id is the
// GraphQL node(id:) address; github_owner_name is display-only.
export interface GithubRepoProject {
  id: string;
  project_id: string;
  github_repo_id: string;
  github_owner_id: string;
  github_owner_name: string;
  github_repo: string;
  github_project_id: string;
  github_project_number: number | null;
  github_project_title: string | null;
  status: GithubRepoProjectStatus;
  create_time: number;
  update_time: number;
}

// Turn record (spec_wakery-contracts.md §5): one row per agent turn started —
// one route, engaged by one wake, executed as one gateway run. One lease = one
// turn = one send; the lease id IS the run's runId (sent as the idempotency
// key). A wake accumulates one lease per turn over its lifetime, at most one
// open. Retired by milestone_wakery-turn-signal_v2026.07.29: dispatch_time,
// probe_attempts, and the paused status.
export interface WakeRouteLease {
  id: string;
  route_id: string;
  wake_id: string;
  wake_task_status: string;
  // The task this turn serves — set on every lease, both delivery modes. The
  // task-turn gate reads it: at most one open lease per task_key, system-wide.
  task_key: string;
  // The last moment the gateway showed this run doing anything: set at send,
  // refreshed by the lifecycle watcher on any agent-family event carrying this
  // lease's runId. Operational recency lives here, never in update_time.
  activity_time: number;
  status: LeaseStatus;
  create_time: number;
  update_time: number;
}

// Durable hold record (spec_wakery-contracts.md §9): one external process
// instance running (or believed running) against one branch. Pure delay —
// carries no outcome, references no wake and no lease. snooze_key is the one
// upsert identity: md5(type + correlation value). The hold match is the
// consult-time predicate (spec_wakery-snooze.md Stage 2), never a stored link.
export interface Snooze {
  id: string;
  snooze_key: string;
  type: number;
  snooze_payload: Record<string, unknown>;
  project_id: string | null;
  project_name: string | null;
  task_status: string;
  task_audit: string;
  status: SnoozeStatus;
  create_time: number;
  update_time: number;
}

export interface RoutedWake {
  wake: Wake;
  route: Route;
  lease: WakeRouteLease;
}
