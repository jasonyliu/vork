import crypto from 'node:crypto';

// Durable-identity derivation (specs/data/spec_database.md §Naming Rules,
// §Durable identity) — the data layer owns the key shapes; apps consume them
// (wakery re-exports from here). The cutover script's SQL recompute mirrors
// these concatenations exactly.

export function md5(input: string) {
  return crypto.createHash('md5').update(input).digest('hex');
}

export function makeTaskKey(projectId: string, taskId: string) {
  return md5(`${projectId}:${taskId}`);
}

export function makeStateKey(projectId: string, taskId: string, taskStatus: string, taskAudit: string) {
  return md5(`${projectId}:${taskId}:${taskStatus}:${taskAudit}`);
}

export function mintId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
