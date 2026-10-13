import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The skeleton inventory per `spec_foundry-data.md §Skeleton inventory`: every
// file rendered under `PROJECT_PATH/main/`, sourced from the committed copy
// under `assets/skeleton/`.
//
// Modes:
//   render   — foundry-authored template; {{variable}} substitution applies
//   static   — foundry-authored fixed content; no variables
//   verbatim — byte-verbatim copy of the canonical record-template set; foundry
//              never interprets these (they carry the templates' own {placeholders})
export type SkeletonMode = 'render' | 'static' | 'verbatim';

export interface SkeletonEntry {
  path: string; // repo-relative target path
  mode: SkeletonMode;
}

const ASSETS_SKELETON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skeleton');

const RENDER_PATHS = ['README.md', 'docs/charter.md'] as const;

const STATIC_PATHS = [
  'docs/README.md',
  'docs/backlog.md',
  'docs/research/README.md',
  'docs/milestones/README.md',
  'docs/deployments/README.md',
  'docs/operations/README.md',
  'docs/conventions/README.md',
  'specs/README.md',
  'apps/README.md',
  'provisions/README.md',
  'releases/README.md'
] as const;

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
    ...STATIC_PATHS.map((path) => ({ path, mode: 'static' as const })),
    ...verbatimPaths().map((path) => ({ path, mode: 'verbatim' as const }))
  ];
}

export function skeletonSource(entry: SkeletonEntry): string {
  return readFileSync(join(ASSETS_SKELETON_DIR, entry.path), 'utf8');
}
