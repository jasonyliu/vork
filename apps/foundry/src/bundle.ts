import { existsSync, readFileSync } from 'node:fs';
import { usageError } from './errors.js';
import type { Bundle } from './types.js';

// Input-bundle validation per `spec_foundry-interface.md §Input bundle`: each
// required-field omission and a malformed project_key exits 2 naming the field.

export const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const REQUIRED_STRING_FIELDS = ['project_name', 'project_key', 'mission', 'description', 'scope'] as const;
const RETIRED_FIELDS = ['channel', 'specialists', 'team'] as const;

export function validateBundle(raw: unknown): Bundle {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw usageError('bundle must be a JSON object');
  }
  const source = raw as Record<string, unknown>;
  for (const field of RETIRED_FIELDS) {
    if (source[field] !== undefined) {
      throw usageError(`bundle field retired: ${field} — the bundle carries the mission core alone (project_name, project_key, mission, description, scope)`);
    }
  }
  const bundle: Partial<Bundle> = {};
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = source[field];
    if (typeof value !== 'string' || value === '') throw usageError(`bundle field missing or empty: ${field}`);
    bundle[field] = value;
  }
  if (!PROJECT_KEY_PATTERN.test(bundle.project_key!)) {
    throw usageError(`bundle field malformed: project_key must match [a-z][a-z0-9_]* (got "${bundle.project_key}")`);
  }
  return bundle as Bundle;
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
