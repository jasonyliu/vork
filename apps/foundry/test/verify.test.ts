import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderSkeleton, writeSkeleton } from '../src/render.js';
import { verifyAgainst } from '../src/verify.js';
import { fixtureValues } from './helpers.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-verify-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// the standing fixture: the Vork clone's own tree passes (`spec_foundry.md §Verify`)
const VORK_TREE = join(import.meta.dirname, '..', '..', '..');

describe('verify --against', () => {
  it('passes on the Vork tree — the standing fixture', () => {
    const result = verifyAgainst(VORK_TREE);
    expect(result.findings).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it('passes on a freshly rendered tree', () => {
    const dir = tempDir();
    writeSkeleton(renderSkeleton(fixtureValues()), dir);
    expect(verifyAgainst(dir).clean).toBe(true);
  });

  it('reports a deleted canonical path precisely, naming it', () => {
    const dir = tempDir();
    writeSkeleton(renderSkeleton(fixtureValues()), dir);
    unlinkSync(join(dir, 'docs', 'backlog.md'));
    const result = verifyAgainst(dir);
    expect(result.clean).toBe(false);
    expect(result.findings).toEqual([{ path: 'docs/backlog.md', problem: 'missing' }]);
  });

  it('reports record-template byte drift, naming the path', () => {
    const dir = tempDir();
    writeSkeleton(renderSkeleton(fixtureValues()), dir);
    const template = join(dir, 'docs', 'conventions', 'templates', 'milestone.md');
    writeFileSync(template, `${readFileSync(template, 'utf8')}\ndrifted\n`, 'utf8');
    const result = verifyAgainst(dir);
    expect(result.findings).toEqual([{ path: 'docs/conventions/templates/milestone.md', problem: 'template_drift' }]);
  });

  it('never flags content beyond the skeleton and mutates nothing', () => {
    const dir = tempDir();
    writeSkeleton(renderSkeleton(fixtureValues()), dir);
    writeFileSync(join(dir, 'docs', 'extra-record.md'), 'project content beyond the skeleton', 'utf8');
    const before = readFileSync(join(dir, 'docs', 'charter.md'), 'utf8');
    const result = verifyAgainst(dir);
    expect(result.clean).toBe(true);
    expect(readFileSync(join(dir, 'docs', 'charter.md'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'docs', 'extra-record.md'))).toBe(true);
  });
});
