// The route template (specs/data/spec_database.md §2 Route provisioning): a
// project's route set is a pure function of its key and its specialists. Foundry
// writes it at the register stage through its own DB layer; the platform seed is
// the same function applied to the platform project. Nothing here touches a database.

// The platform crew — a constant of the gateway host, not project input
// (spec_foundry-interface.md §Crew).
export const CREW = {
  ai_lead: 'main',
  auditor: 'heimdall',
  project_manager: 'sarge'
} as const;

export const CREW_AGENTS: readonly string[] = [CREW.ai_lead, CREW.auditor, CREW.project_manager];

export const CREW_ROLE_LABEL: Record<string, string> = {
  [CREW.ai_lead]: 'AI Lead',
  [CREW.auditor]: 'Auditor',
  [CREW.project_manager]: 'Project Manager'
};

// Display names carried on route rows (agent_name).
const AGENT_DISPLAY_NAME: Record<string, string> = {
  [CREW.ai_lead]: 'Main',
  [CREW.auditor]: 'Heimdall',
  [CREW.project_manager]: 'Sarge'
};

export function agentDisplayName(agent: string): string {
  return AGENT_DISPLAY_NAME[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1);
}

// The canonical task types (docs/conventions/constants.md) — nine stage types
// and eight execution types. TASK_TYPE_LABEL_SEED carries the same set with
// labels; the seed test pins the two together.
export const STAGE_TASK_TYPES = [
  'project_inception',
  'project_draft',
  'project_decomposition',
  'project_integration',
  'project_review',
  'project_release',
  'project_deployment',
  'project_operation',
  'project_hotfix'
] as const;

export const EXECUTION_TASK_TYPES = ['spec', 'research', 'coding', 'bug', 'enhancement', 'deliberation', 'dbops', 'defect'] as const;

export const TASK_TYPES: readonly string[] = [...STAGE_TASK_TYPES, ...EXECUTION_TASK_TYPES];

export interface Specialist {
  name: string;
  tasks: string[];
}

export type RouteActor = 'auditor' | 'owner' | 'assignee';

// One templated route row; `project` is the registry slug, resolved to
// project.id by whoever writes the row.
export interface RouteSeed {
  project: string;
  task_type: string | null;
  actor: RouteActor;
  session_key: string;
  agent_id: string;
  agent_name: string;
  delivery: 'session' | 'run';
  max_run: number | null;
}

export const LEASE_TOKEN = '[wake_route_lease_id]';

function sessionKey(agent: string, projectKey: string, lane: string): string {
  return `agent:${agent}:${projectKey}:${lane}:run:${LEASE_TOKEN}`;
}

function assigneeRun(projectKey: string, taskType: string | null, agent: string, lane: string): RouteSeed {
  return {
    project: projectKey,
    task_type: taskType,
    actor: 'assignee',
    session_key: sessionKey(agent, projectKey, lane),
    agent_id: agent,
    agent_name: agentDisplayName(agent),
    delivery: 'run',
    max_run: 1
  };
}

// Guards the template's own invariants (the bundle validator names fields for
// the operator; this is the last line).
export function validateSpecialists(specialists: readonly Specialist[]): void {
  const seenNames = new Set<string>();
  const claimed = new Map<string, string>();
  for (const specialist of specialists) {
    if (CREW_AGENTS.includes(specialist.name)) throw new Error(`specialist "${specialist.name}" is a crew agent`);
    if (seenNames.has(specialist.name)) throw new Error(`specialist "${specialist.name}" listed twice`);
    seenNames.add(specialist.name);
    if (specialist.tasks.length === 0) throw new Error(`specialist "${specialist.name}" has no tasks`);
    for (const task of specialist.tasks) {
      if (!TASK_TYPES.includes(task)) throw new Error(`specialist "${specialist.name}" names unknown task type "${task}"`);
      const holder = claimed.get(task);
      if (holder !== undefined) throw new Error(`task type "${task}" claimed by both "${holder}" and "${specialist.name}"`);
      claimed.set(task, specialist.name);
    }
  }
}

// Crew defaults: nine stage types + the assignee wildcard → the AI Lead, the
// auditor wildcard → the auditor, the owner wildcard → the project manager;
// one exact assignee route per specialist task (a claim on a stage type
// replaces the AI Lead's row for that type). All run delivery. Row order is
// stable: stage rows, wildcards, then specialists in bundle order.
export function routeTemplate(projectKey: string, specialists: readonly Specialist[] = []): RouteSeed[] {
  validateSpecialists(specialists);
  const claimed = new Set(specialists.flatMap((specialist) => specialist.tasks));
  const rows: RouteSeed[] = [];
  for (const taskType of STAGE_TASK_TYPES) {
    if (claimed.has(taskType)) continue;
    rows.push(assigneeRun(projectKey, taskType, CREW.ai_lead, 'stage'));
  }
  rows.push(assigneeRun(projectKey, null, CREW.ai_lead, 'all'));
  rows.push({
    project: projectKey,
    task_type: null,
    actor: 'auditor',
    session_key: sessionKey(CREW.auditor, projectKey, 'audit'),
    agent_id: CREW.auditor,
    agent_name: agentDisplayName(CREW.auditor),
    delivery: 'run',
    max_run: 3
  });
  rows.push({
    project: projectKey,
    task_type: null,
    actor: 'owner',
    session_key: sessionKey(CREW.project_manager, projectKey, 'task'),
    agent_id: CREW.project_manager,
    agent_name: agentDisplayName(CREW.project_manager),
    delivery: 'run',
    max_run: 1
  });
  for (const specialist of specialists) {
    for (const task of specialist.tasks) {
      rows.push(assigneeRun(projectKey, task, specialist.name, task));
    }
  }
  return rows;
}
