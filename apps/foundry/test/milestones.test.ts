import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import type { GitOps } from '../src/gitops.js';
import { milestoneFolderName, openMilestoneRecord, renderMilestoneRecord } from '../src/milestones.js';
import { templateSource } from '../src/skeleton.js';

// Kickoff: the milestone record opened on a draft lane, from the kit's one
// template home.

const TEMPLATE = templateSource('milestone.md');
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
  commitAll(_repoDir: string, message: string): string | null { this.ops.push(`commitAll(${message})`); return 'sha_ms'; }
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
  it('is date-first per the convention and rejects a malformed slug with exit 2', () => {
    expect(milestoneFolderName(DATE, 'first-steps')).toBe('milestone_v2026.08.26_first-steps');
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
    const body = renderMilestoneRecord(TEMPLATE, { title: 'First Steps', folder: 'milestone_v2026.08.26_first-steps', date: DATE, note: 'settled in conversation on 2026-08-26' });
    expect(body).toContain('# Milestone: First Steps (`milestone_v2026.08.26_first-steps`)');
    expect(body).toContain('**Status:** `Active (started 2026-08-26)`');
    expect(body).toContain('## Scope\n\nsettled in conversation on 2026-08-26');
    expect(body).toContain('1. {concrete output expected from the milestone}');
    expect(body).toContain('### Trail');
  });
  it('keeps the Scope placeholder without a note', () => {
    const body = renderMilestoneRecord(TEMPLATE, { title: 'X', folder: 'milestone_v2026.08.26_x', date: DATE });
    expect(body).toContain('## Scope\n\n{the objective');
  });
});

describe('openMilestoneRecord', () => {
  it('creates the lane off origin/dev, renders the record, commits, pushes', () => {
    const mainDir = join(tempDir(), 'main');
    mkdirSync(join(mainDir, '.git'), { recursive: true });
    mkdirSync(join(mainDir, 'docs', 'milestones'), { recursive: true });
    const git = new RecordingGit();
    const result = openMilestoneRecord(git, { mainDir, folder: 'milestone_v2026.08.26_x', title: 'X', date: DATE, template: TEMPLATE, workToken: 't' });
    expect(result).toEqual({ lane: 'feature/milestone_v2026.08.26_x/draft', recordPath: 'docs/milestones/milestone_v2026.08.26_x/milestone.md', existing: false });
    expect(git.ops).toEqual(['fetch', 'checkoutNewBranch(feature/milestone_v2026.08.26_x/draft, origin/dev)', 'commitAll(kickoff: open milestone_v2026.08.26_x)', 'push(feature/milestone_v2026.08.26_x/draft)']);
    expect(existsSync(join(mainDir, result.recordPath))).toBe(true);
  });
  it('reports an existing record on origin/dev and creates nothing', () => {
    const mainDir = join(tempDir(), 'main');
    mkdirSync(join(mainDir, '.git'), { recursive: true });
    const git = new RecordingGit();
    git.onRef.add('origin/dev:docs/milestones/milestone_v2026.08.26_x/milestone.md');
    const result = openMilestoneRecord(git, { mainDir, folder: 'milestone_v2026.08.26_x', title: 'X', date: DATE, template: TEMPLATE, workToken: 't' });
    expect(result.existing).toBe(true);
    expect(git.ops).toEqual(['fetch']);
  });
  it('exits 5 when main/ is not a clone', () => {
    const git = new RecordingGit();
    try {
      openMilestoneRecord(git, { mainDir: join(tempDir(), 'main'), folder: 'milestone_v2026.08.26_x', title: 'X', date: DATE, template: TEMPLATE, workToken: 't' });
      expect.unreachable();
    } catch (error) {
      expect((error as FoundryError).exitCode).toBe(EXIT.LOCAL);
    }
  });
});
