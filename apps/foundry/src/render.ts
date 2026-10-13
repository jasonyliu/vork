import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { localError } from './errors.js';
import { skeletonInventory, skeletonSource, type SkeletonEntry } from './skeleton.js';
import { isVariableName, substitute, VARIABLE_PATTERN, type VariableValues } from './variables.js';

export interface RenderedFile {
  path: string;
  content: string;
}

export type FileOutcome = 'created' | 'skipped';

export interface WrittenFile {
  path: string;
  outcome: FileOutcome;
}

// Startup lint per `spec_foundry-data.md §Verification`: every {{variable}} in
// the committed skeleton resolves against the variable table. Verbatim files are
// exempt — foundry never interprets the canonical record templates' content.
export function lintSkeleton(): void {
  for (const entry of skeletonInventory()) {
    if (entry.mode === 'verbatim') continue;
    const body = skeletonSource(entry);
    for (const match of body.matchAll(VARIABLE_PATTERN)) {
      const name = match[1]!;
      if (!isVariableName(name)) {
        throw localError(`TEMPLATE_UNKNOWN_VARIABLE: {{${name}}} in ${entry.path}`);
      }
    }
  }
}

// Render the full skeleton inventory in memory. A referenced variable resolving
// empty aborts here — before the first write (`spec_foundry.md §Local render`).
export function renderSkeleton(values: VariableValues): RenderedFile[] {
  return skeletonInventory().map((entry: SkeletonEntry) => {
    const body = skeletonSource(entry);
    return {
      path: entry.path,
      content: entry.mode === 'render' ? substitute(body, values, entry.path) : body
    };
  });
}

// Write a rendered skeleton under the target directory. An existing path is
// skipped and recorded — existing wins (`spec_foundry.md §Idempotency and resume`).
export function writeSkeleton(rendered: RenderedFile[], targetDir: string): WrittenFile[] {
  return rendered.map((file) => {
    const target = join(targetDir, file.path);
    if (existsSync(target)) {
      return { path: file.path, outcome: 'skipped' as const };
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
    return { path: file.path, outcome: 'created' as const };
  });
}
