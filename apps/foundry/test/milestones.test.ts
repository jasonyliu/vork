import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import type { GitOps } from '../src/gitops.js';
import { addIndexRow, milestoneFolderName, openMilestoneRecord, renderMilestoneRecord } from '../src/milestones.js';

// Unconducted kickoff: the milestone record opened on a draft lane.

const TEMPLATE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skeleton', 'docs', 'conventions', 'templates', 'milestone.md'), 'utf8');
const DATE = new Date('2026-08-26T10:00:00Z');

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-ms-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

class RecordingGit implements GitOps {
  ops: string[] = [];
  onRef = new Set<string>();
  clone(): void {}
  originUrl(): string | null { return null; }
  commitAll(repoDir: string, message: string): string | null { this.ops.push(`commitAll(${message})`); return 'sha_ms'; }
  push(_repoDir: string, branch: string): void { this.ops.push(`push(${branch})`); }
  setIdentity(): void {}
  probeRemote(): boolean { return true; }
  headResolves(): boolean { return true; }
  fetch(): void { this.ops.push('fetch'); }
  pathExistsOnRef(_repoDir: string, ref: string, path: string): boolean { return this.onRef.has(`${ref}:${path}`); }
  checkoutNewBranch(_repoDir: string, branch: string, startPoint: string): void { this.ops.push(`checkoutNewBranch(${branch}, ${startPoint})`); }
  setUnbornBranch(): void {}
}

describe('milestone folder naming', () => {
  it('is date-first per PROJECT.md §Milestones and rejects a malformed slug with exit 2', () => {
    expect(milestoneFolderName(DATE, 'sample-milestone')).toBe('milestone_v2026.08.26_sample-milestone');
    try {
      milestoneFolderName(DATE, 'Bad_Slug');
      expect.unreachable();
    } catch (error) {
      expect((error as FoundryError).exitCode).toBe(EXIT.USAGE);
    }
  });
});

describe('renderMilestoneRecord', () => {
  it('fills title, folder, status and date; seeds Scope with the note; leaves the other placeholders', () => {
    const body = renderMilestoneRecord(TEMPLATE, { title: 'Sample Milestone', folder: 'milestone_v2026.08.26_sample-milestone', date: DATE, note: 'sample planning note' });
    expect(body).toContain('# Milestone: Sample Milestone (`milestone_v2026.08.26_sample-milestone`)');
    expect(body).toContain('**Status:** `Active (started 2026-08-26)`');
    expect(body).toContain('## Scope\n\nsample planning note');
    expect(body).toContain('1. {concrete output expected from the milestone}');
    expect(body).toContain('### Spec trail');
  });
  it('keeps the Scope placeholder without a note', () => {
    const body = renderMilestoneRecord(TEMPLATE, { title: 'X', folder: 'milestone_v2026.08.26_x', date: DATE });
    expect(body).toContain('## Scope\n\n{the objective');
  });
});

describe('addIndexRow', () => {
  it('replaces the skeleton bullet, inserts a table row, or appends', () => {
    expect(addIndexRow('# Milestones\n\n- Active: (none)\n- Past: (none)\n', 'milestone_v2026.08.26_x', 'X', '2026-08-26')).toContain('- Active: `milestone_v2026.08.26_x/` — X (started 2026-08-26)');
    const table = '| Folder | Status | Summary |\n|---|---|---|\n| `old/` | done | old |\n';
    expect(addIndexRow(table, 'milestone_v2026.08.26_x', 'X', '2026-08-26').split('\n')[2]).toBe('| `milestone_v2026.08.26_x/` | **Active (started 2026-08-26)** — Draft stage | X |');
    expect(addIndexRow('# Milestones\n', 'milestone_v2026.08.26_x', 'X', '2026-08-26')).toContain('- `milestone_v2026.08.26_x/` — X (Active, started 2026-08-26)');
  });
});

describe('openMilestoneRecord', () => {
  it('creates the lane off origin/dev, renders the record + index row, commits, pushes', () => {
    const mainDir = join(tempDir(), 'main');
    mkdirSync(join(mainDir, '.git'), { recursive: true });
    mkdirSync(join(mainDir, 'docs', 'milestones'), { recursive: true });
    writeFileSync(join(mainDir, 'docs', 'milestones', 'README.md'), '# Milestones\n\n- Active: (none)\n- Past: (none)\n', 'utf8');
    const git = new RecordingGit();
    const result = openMilestoneRecord(git, { mainDir, folder: 'milestone_v2026.08.26_x', title: 'X', date: DATE, template: TEMPLATE, aiLeadToken: 't' });
    expect(result).toEqual({ lane: 'feature/milestone_v2026.08.26_x/draft', recordPath: 'docs/milestones/milestone_v2026.08.26_x/milestone.md', existing: false });
    expect(git.ops).toEqual(['fetch', 'checkoutNewBranch(feature/milestone_v2026.08.26_x/draft, origin/dev)', 'commitAll(kickoff: open milestone_v2026.08.26_x)', 'push(feature/milestone_v2026.08.26_x/draft)']);
    expect(existsSync(join(mainDir, result.recordPath))).toBe(true);
    expect(readFileSync(join(mainDir, 'docs', 'milestones', 'README.md'), 'utf8')).toContain('- Active: `milestone_v2026.08.26_x/` — X');
  });
  it('reports an existing record on origin/dev and creates nothing', () => {
    const mainDir = join(tempDir(), 'main');
    mkdirSync(join(mainDir, '.git'), { recursive: true });
    const git = new RecordingGit();
    git.onRef.add('origin/dev:docs/milestones/milestone_v2026.08.26_x/milestone.md');
    const result = openMilestoneRecord(git, { mainDir, folder: 'milestone_v2026.08.26_x', title: 'X', date: DATE, template: TEMPLATE, aiLeadToken: 't' });
    expect(result.existing).toBe(true);
    expect(git.ops).toEqual(['fetch']);
  });
  it('exits 5 when main/ is not a clone', () => {
    const git = new RecordingGit();
    try {
      openMilestoneRecord(git, { mainDir: join(tempDir(), 'main'), folder: 'milestone_v2026.08.26_x', title: 'X', date: DATE, template: TEMPLATE, aiLeadToken: 't' });
      expect.unreachable();
    } catch (error) {
      expect((error as FoundryError).exitCode).toBe(EXIT.LOCAL);
    }
  });
});
