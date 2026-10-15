import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localError, usageError } from './errors.js';
import type { GitOps } from './gitops.js';

// Kickoff (`spec_foundry.md §Kickoff`): the milestone record opened for the
// Principal and the agent to settle in conversation. In the project's main/
// clone: lane off origin/dev, milestone.md from the canonical template,
// committed under the work identity, pushed.

export const MILESTONE_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export function milestoneFolderName(date: Date, slug: string): string {
  if (!MILESTONE_SLUG_PATTERN.test(slug)) throw usageError(`--milestone must match [a-z][a-z0-9-]* (got "${slug}")`);
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '.');
  return `milestone_v${stamp}_${slug}`;
}

// The record rendered from the canonical template: title, folder, status and
// date filled; Scope seeded with the note; every other section left as the
// template's placeholder for the drafting conversation.
export function renderMilestoneRecord(template: string, input: { title: string; folder: string; date: Date; note?: string }): string {
  const day = input.date.toISOString().slice(0, 10);
  let body = template
    .replace('{Title}', input.title)
    .replace('milestone_v<YYYY.MM.DD>_<slug>', input.folder)
    .replace(/\*\*Status:\*\* \{[^\n]*\}/, `**Status:** \`Active (started ${day})\``);
  if (input.note) {
    body = body.replace(/## Scope\n\n\{[^\n]*\}/, `## Scope\n\n${input.note}`);
  }
  return body;
}

export interface OpenMilestoneInput {
  mainDir: string; // <storage>/<project_key>/main
  folder: string; // milestone_v<date>_<slug>
  title: string;
  date: Date;
  note?: string;
  template: string; // the canonical milestone template body
  workToken: string; // fetch + push under the work identity
}

export interface OpenMilestoneResult {
  lane: string;
  recordPath: string; // relative to main/
  existing: boolean;
}

export function openMilestoneRecord(git: GitOps, input: OpenMilestoneInput): OpenMilestoneResult {
  const recordPath = `docs/milestones/${input.folder}/milestone.md`;
  const lane = `feature/${input.folder}/draft`;
  if (!existsSync(join(input.mainDir, '.git'))) throw localError(`main/ clone missing at ${input.mainDir} — bootstrap the project first`);
  git.fetch(input.mainDir, input.workToken);
  if (git.pathExistsOnRef(input.mainDir, 'origin/dev', recordPath) || existsSync(join(input.mainDir, recordPath))) {
    return { lane, recordPath, existing: true };
  }
  git.checkoutNewBranch(input.mainDir, lane, 'origin/dev');
  const dir = join(input.mainDir, 'docs', 'milestones', input.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'milestone.md'), renderMilestoneRecord(input.template, input), 'utf8');
  const sha = git.commitAll(input.mainDir, `kickoff: open ${input.folder}`);
  if (sha === null) throw localError(`zero changes to commit for ${input.folder} — record already present`);
  git.push(input.mainDir, lane, input.workToken);
  return { lane, recordPath, existing: false };
}
