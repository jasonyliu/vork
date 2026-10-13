import { CREW_ROLE_LABEL } from '@vork/data';
import { localError } from './errors.js';

// The closed template-variable set per `spec_foundry-data.md §Template variables`.
// A template referencing any other name fails the startup lint with
// TEMPLATE_UNKNOWN_VARIABLE.
export const VARIABLE_NAMES = [
  'project_name',
  'project_key',
  'mission',
  'description',
  'scope',
  'channel',
  'owner_login',
  'team',
  'team_resolved',
  'utc_now',
  'utc_now_compact',
  'run_id',
  'project_node_id',
  'repo_node_id'
] as const;

export type VariableName = (typeof VARIABLE_NAMES)[number];

const VARIABLE_NAME_SET: ReadonlySet<string> = new Set(VARIABLE_NAMES);

export function isVariableName(name: string): name is VariableName {
  return VARIABLE_NAME_SET.has(name);
}

export interface TeamMemberResolved {
  name: string;
  github_login: string;
  github_node_id: string;
}

// The values a render draws from. Substitution is verbatim, no escaping; list
// and object variables substitute through the string forms below.
export interface VariableValues {
  project_name: string;
  project_key: string;
  mission: string;
  description: string;
  scope: string;
  channel: string;
  owner_login: string;
  team: string[];
  team_resolved?: TeamMemberResolved[];
  utc_now: string;
  utc_now_compact: string;
  run_id: string;
  project_node_id?: string;
  repo_node_id?: string;
}

// String form per variable. `team` renders as the charter team-table rows —
// crew agents with their platform roles, specialists with Role left to
// Inception; Responsibilities always Inception's. `team_resolved` renders as
// JSON (run-event consumption).
export function variableString(values: VariableValues, name: VariableName): string | undefined {
  switch (name) {
    case 'team':
      return values.team.map((member) => `| ${member} | ${CREW_ROLE_LABEL[member] ?? '—'} | — |`).join('\n');
    case 'team_resolved':
      return values.team_resolved === undefined ? undefined : JSON.stringify(values.team_resolved);
    default: {
      const value = values[name];
      return value === undefined || value === '' ? undefined : value;
    }
  }
}

export const VARIABLE_PATTERN = /\{\{([a-z_]+)\}\}/g;

// Substitute every {{name}} in a template body. A referenced variable resolving
// empty aborts the render (`spec_foundry-data.md §Template variables`); the
// caller runs substitution fully in memory before any file is written.
export function substitute(body: string, values: VariableValues, path: string): string {
  return body.replace(VARIABLE_PATTERN, (_match, name: string) => {
    if (!isVariableName(name)) {
      throw localError(`TEMPLATE_UNKNOWN_VARIABLE: {{${name}}} in ${path}`);
    }
    const value = variableString(values, name);
    if (value === undefined) {
      throw localError(`TEMPLATE_EMPTY_VARIABLE: {{${name}}} in ${path} resolved empty`);
    }
    return value;
  });
}
