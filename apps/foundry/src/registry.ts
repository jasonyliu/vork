import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { localError } from './errors.js';
import type { Ruleset, Visibility } from './types.js';

// The machine's project registry (`spec_foundry-data.md §Registry`):
// `<foundry-var>/projects.json`, one entry per founded key, written whole and
// atomically at each bootstrap's close, read by `foundry list`. The seed for
// anything built on it later.

export interface RegistryEntry {
  name: string;
  owner: string;
  repository: string;
  visibility: Visibility;
  ruleset: Ruleset;
  owner_plan: string;
  vork_login: string;
  vork_name: string;
  vork_email: string;
  path: string;
  founded_at: string;
  updated_at: string;
  run_id: string;
}

export interface Registry {
  projects: Record<string, RegistryEntry>;
}

export type RegistryInput = Omit<RegistryEntry, 'founded_at' | 'updated_at'>;

export interface RegistryOutcome {
  path: string;
  outcome: 'created' | 'updated';
}

export function registryPath(foundryVar: string): string {
  return join(foundryVar, 'projects.json');
}

// An absent file is an empty registry; an unparseable one exits 5 naming it.
export function readRegistry(foundryVar: string): Registry {
  const path = registryPath(foundryVar);
  if (!existsSync(path)) return { projects: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw localError(`registry unparseable: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
  const projects = (parsed as { projects?: unknown } | null)?.projects;
  if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) {
    throw localError(`registry malformed: ${path} carries no "projects" object`);
  }
  return { projects: projects as Record<string, RegistryEntry> };
}

function writeRegistry(foundryVar: string, registry: Registry): void {
  const path = registryPath(foundryVar);
  const sorted: Registry = { projects: {} };
  for (const key of Object.keys(registry.projects).sort()) sorted.projects[key] = registry.projects[key]!;
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp.${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

// Idempotency key: the project key. An existing entry is refreshed in every
// field except `founded_at`.
export function upsertProject(foundryVar: string, key: string, input: RegistryInput, now: string): RegistryOutcome {
  const registry = readRegistry(foundryVar);
  const existing = registry.projects[key];
  registry.projects[key] = {
    ...input,
    founded_at: existing?.founded_at ?? now,
    updated_at: now
  };
  writeRegistry(foundryVar, registry);
  return { path: registryPath(foundryVar), outcome: existing === undefined ? 'created' : 'updated' };
}

// `foundry list`: one row per entry, in key order.
export function formatRegistry(registry: Registry): string {
  const keys = Object.keys(registry.projects).sort();
  if (keys.length === 0) return 'no projects founded from this clone';
  const rows = keys.map((key) => {
    const entry = registry.projects[key]!;
    return [key, entry.name, entry.visibility, entry.ruleset, entry.path, entry.founded_at.slice(0, 10)];
  });
  const header = ['key', 'name', 'visibility', 'ruleset', 'path', 'founded'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}
