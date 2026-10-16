import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The skeleton inventory per `spec_foundry-data.md §Skeleton inventory`: the
// root README, the charter, the backlog (render mode, from `assets/skeleton/`)
// and the record-template set (verbatim, from the kit's one home: the Vork
// clone's own `docs/conventions/templates/`). Every other folder materializes
// at first use.
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

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ASSETS_SKELETON_DIR = join(SRC_DIR, '..', 'assets', 'skeleton');
const VORK_ROOT = join(SRC_DIR, '..', '..', '..');

const RENDER_PATHS = ['README.md', 'docs/charter.md', 'docs/backlog.md'] as const;

export const TEMPLATES_DIR = 'docs/conventions/templates';

// The kit's canonical record-template set, read at run time.
export function templatesSourceDir(): string {
  return join(VORK_ROOT, TEMPLATES_DIR);
}

export function templateSource(name: string): string {
  return readFileSync(join(templatesSourceDir(), name), 'utf8');
}

// The record-template set is discovered from the home directory, so adding a
// canonical template is one file drop — the inventory follows the directory.
function verbatimPaths(): string[] {
  return readdirSync(templatesSourceDir())
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
  if (entry.mode === 'verbatim') return templateSource(basename(entry.path));
  return readFileSync(join(ASSETS_SKELETON_DIR, entry.path), 'utf8');
}
