import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The skeleton inventory per `spec_foundry-data.md §Skeleton inventory`: the
// root README, the charter, the backlog, and the record-template set — every
// other folder materializes at first use. Sourced from the committed copy
// under `assets/skeleton/`.
//
// Modes:
//   render   — foundry-authored template; {{variable}} substitution applies
//   verbatim — byte-verbatim copy of the canonical record-template set; foundry
//              never interprets these (they carry the templates' own {placeholders})
export type SkeletonMode = 'render' | 'verbatim';

export interface SkeletonEntry {
  path: string; // repo-relative target path
  mode: SkeletonMode;
}

const ASSETS_SKELETON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skeleton');

const RENDER_PATHS = ['README.md', 'docs/charter.md', 'docs/backlog.md'] as const;

const TEMPLATES_DIR = 'docs/conventions/templates';

// The record-template set is discovered from the committed copy, so adding a
// canonical template is one file drop — the inventory follows the directory.
function verbatimPaths(): string[] {
  return readdirSync(join(ASSETS_SKELETON_DIR, TEMPLATES_DIR))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => `${TEMPLATES_DIR}/${name}`);
}

export function skeletonInventory(): SkeletonEntry[] {
  return [
    ...RENDER_PATHS.map((path) => ({ path, mode: 'render' as const })),
    ...verbatimPaths().map((path) => ({ path, mode: 'verbatim' as const }))
  ];
}

export function skeletonSource(entry: SkeletonEntry): string {
  return readFileSync(join(ASSETS_SKELETON_DIR, entry.path), 'utf8');
}
