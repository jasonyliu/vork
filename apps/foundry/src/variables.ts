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
  'owner_login',
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

// The values a render draws from. Substitution is verbatim, no escaping.
export interface VariableValues {
  project_name: string;
  project_key: string;
  mission: string;
  description: string;
  scope: string;
  owner_login: string;
  utc_now: string;
  utc_now_compact: string;
  run_id: string;
  project_node_id?: string;
  repo_node_id?: string;
}

export function variableString(values: VariableValues, name: VariableName): string | undefined {
  const value = values[name];
  return value === undefined || value === '' ? undefined : value;
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
