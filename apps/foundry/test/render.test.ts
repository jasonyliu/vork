import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintSkeleton, renderSkeleton, writeSkeleton } from '../src/render.js';
import { skeletonInventory } from '../src/skeleton.js';
import { substitute } from '../src/variables.js';
import { fixtureValues } from './helpers.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-render-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('skeleton inventory', () => {
  it('carries exactly the specced paths', () => {
    const paths = skeletonInventory().map((entry) => entry.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('docs/charter.md');
    expect(paths).toContain('docs/backlog.md');
    // READMEs are on demand: the root README is the one the skeleton ships
    expect(paths.filter((p) => p.endsWith('README.md'))).toEqual(['README.md', 'docs/conventions/templates/README.md']);
    // the canonical record-template set rides verbatim
    expect(paths).toContain('docs/conventions/templates/charter.md');
    expect(paths).toContain('docs/conventions/templates/milestone.md');
    // nothing outside the inventory
    expect(paths.every((p) => !p.includes('..'))).toBe(true);
  });

  it('committed record templates byte-match the canonical set (drift alarm)', () => {
    const canonicalDir = join(import.meta.dirname, '..', '..', '..', 'docs', 'conventions', 'templates');
    const committedDir = join(import.meta.dirname, '..', 'assets', 'skeleton', 'docs', 'conventions', 'templates');
    const canonical = readdirSync(canonicalDir).filter((name) => name.endsWith('.md')).sort();
    const committed = readdirSync(committedDir).filter((name) => name.endsWith('.md')).sort();
    expect(committed).toEqual(canonical);
    for (const name of canonical) {
      expect(readFileSync(join(committedDir, name), 'utf8'), `template drift: ${name}`).toBe(
        readFileSync(join(canonicalDir, name), 'utf8')
      );
    }
  });
});

describe('lint', () => {
  it('passes on the committed skeleton', () => {
    expect(() => lintSkeleton()).not.toThrow();
  });

  it('rejects an unknown variable', () => {
    expect(() => substitute('hello {{not_a_variable}}', fixtureValues(), 'x.md')).toThrow(
      /TEMPLATE_UNKNOWN_VARIABLE: \{\{not_a_variable\}\} in x\.md/
    );
  });
});

describe('render', () => {
  it('renders the full inventory with variables substituted', () => {
    const rendered = renderSkeleton(fixtureValues());
    expect(rendered.map((f) => f.path).sort()).toEqual(
      skeletonInventory()
        .map((entry) => entry.path)
        .sort()
    );
    const readme = rendered.find((f) => f.path === 'README.md')!;
    expect(readme.content).toContain('# Throwaway Project');
    expect(readme.content).toContain('The goal the throwaway project exists to achieve.');
    expect(readme.content).not.toContain('{{');
  });

  it('instantiates the charter per the template section contract', () => {
    const charter = renderSkeleton(fixtureValues()).find((f) => f.path === 'docs/charter.md')!.content;
    for (const section of ['## Mission', '## Team', '## Path', '## Products', '## Milestones', '## Provision']) {
      expect(charter).toContain(section);
    }
    expect(charter).toContain('**Key:** `throwaway`');
    expect(charter).toContain('| jasonyliu | Principal |');
    // guidance comments deleted at instantiation
    expect(charter).not.toContain('<!--');
    expect(charter).not.toContain('{{');
  });

  it('leaves verbatim record templates uninterpreted', () => {
    const template = renderSkeleton(fixtureValues()).find(
      (f) => f.path === 'docs/conventions/templates/charter.md'
    )!.content;
    expect(template).toContain('{Project Title}');
  });

  it('aborts on an empty required variable before any write', () => {
    expect(() => renderSkeleton(fixtureValues({ mission: '' }))).toThrow(
      /TEMPLATE_EMPTY_VARIABLE: \{\{mission\}\} in docs\/charter\.md/
    );
  });

  it('is deterministic — two same-bundle runs byte-identical', () => {
    const first = renderSkeleton(fixtureValues());
    const second = renderSkeleton(fixtureValues());
    expect(second).toEqual(first);
  });
});

describe('write', () => {
  it('creates every file and skips existing paths on re-run', () => {
    const dir = tempDir();
    const rendered = renderSkeleton(fixtureValues());
    const first = writeSkeleton(rendered, dir);
    expect(first.every((f) => f.outcome === 'created')).toBe(true);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('# Throwaway Project');

    const second = writeSkeleton(rendered, dir);
    expect(second.every((f) => f.outcome === 'skipped')).toBe(true);
  });

  it('never clobbers an existing file — existing wins', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'charter.md'), 'operator content', 'utf8');
    const outcomes = writeSkeleton(renderSkeleton(fixtureValues()), dir);
    expect(outcomes.find((f) => f.path === 'docs/charter.md')!.outcome).toBe('skipped');
    expect(readFileSync(join(dir, 'docs', 'charter.md'), 'utf8')).toBe('operator content');
  });
});
