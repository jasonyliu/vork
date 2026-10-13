import { existsSync, readFileSync } from 'node:fs';
import { CREW_AGENTS, TASK_TYPES, type Specialist } from '@vork/data';
import { usageError } from './errors.js';
import type { Bundle } from './types.js';

// Input-bundle validation per `spec_foundry-interface.md §Input bundle`: each
// required-field omission, a malformed project_key, and every specialist rule
// exits 2 naming the field.

export const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const REQUIRED_STRING_FIELDS = ['project_name', 'project_key', 'mission', 'description', 'scope', 'channel'] as const;

function validateSpecialists(raw: unknown): Specialist[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw usageError('bundle field malformed: specialists must be a list');
  const specialists: Specialist[] = [];
  const claimed = new Map<string, string>();
  raw.forEach((entry, index) => {
    const at = `specialists[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw usageError(`bundle field malformed: ${at} must be an object`);
    const { name, tasks } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name === '') throw usageError(`bundle field missing or empty: ${at}.name`);
    if (CREW_AGENTS.includes(name)) throw usageError(`bundle field invalid: ${at}.name "${name}" is a crew agent (main, heimdall, sarge are constants)`);
    if (specialists.some((existing) => existing.name === name)) throw usageError(`bundle field invalid: ${at}.name "${name}" listed twice`);
    if (!Array.isArray(tasks) || tasks.length === 0) throw usageError(`bundle field missing or empty: ${at}.tasks`);
    const taskList: string[] = [];
    for (const task of tasks) {
      if (typeof task !== 'string' || !TASK_TYPES.includes(task)) throw usageError(`bundle field invalid: ${at}.tasks names unknown task type "${String(task)}"`);
      const holder = claimed.get(task);
      if (holder !== undefined) throw usageError(`bundle field invalid: ${at}.tasks — "${task}" already claimed by "${holder}"`);
      claimed.set(task, name);
      taskList.push(task);
    }
    specialists.push({ name, tasks: taskList });
  });
  return specialists;
}

export function validateBundle(raw: unknown): Bundle {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw usageError('bundle must be a JSON object');
  }
  const source = raw as Record<string, unknown>;
  const bundle: Partial<Bundle> = {};
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = source[field];
    if (typeof value !== 'string' || value === '') throw usageError(`bundle field missing or empty: ${field}`);
    bundle[field] = value;
  }
  if (!PROJECT_KEY_PATTERN.test(bundle.project_key!)) {
    throw usageError(`bundle field malformed: project_key must match [a-z][a-z0-9_]* (got "${bundle.project_key}")`);
  }
  if (source['team'] !== undefined) {
    throw usageError('bundle field retired: team — the crew is a Foundry constant; list extra agents under specialists[{name, tasks}]');
  }
  return { ...(bundle as Omit<Bundle, 'specialists'>), specialists: validateSpecialists(source['specialists']) };
}

export function loadBundle(path: string): Bundle {
  if (!existsSync(path)) throw usageError(`bundle file not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw usageError(`bundle unparseable: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
  return validateBundle(parsed);
}
