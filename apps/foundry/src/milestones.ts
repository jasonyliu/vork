import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localError, usageError } from './errors.js';
import type { GitOps } from './gitops.js';

// Unconducted kickoff (`spec_foundry.md §Kickoff`): the milestone record is
// opened directly for the Principal and the AI Lead to draft in conversation —
// no Stage Task, no project-manager turn. In the project's main/ clone: lane
// off origin/dev, milestone.md from the canonical template, index row,
// committed as the AI Lead, pushed.

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

// The index row, in whichever shape the project's docs/milestones/README.md
// carries: the table the platform project keeps, or the skeleton's Active/Past bullets.
export function addIndexRow(readme: string, folder: string, title: string, day: string): string {
  const tableHeader = '| Folder | Status | Summary |\n|---|---|---|\n';
  if (readme.includes(tableHeader)) {
    return readme.replace(tableHeader, `${tableHeader}| \`${folder}/\` | **Active (started ${day})** — Draft stage | ${title} |\n`);
  }
  if (readme.includes('- Active: (none)')) {
    return readme.replace('- Active: (none)', `- Active: \`${folder}/\` — ${title} (started ${day})`);
  }
  return `${readme.trimEnd()}\n- \`${folder}/\` — ${title} (Active, started ${day})\n`;
}

export interface OpenMilestoneInput {
  mainDir: string; // <storage>/<project_key>/main
  folder: string; // milestone_v<date>_<slug>
  title: string;
  date: Date;
  note?: string;
  template: string; // the canonical milestone template body
  aiLeadToken: string; // fetch + push as the AI Lead
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
  git.fetch(input.mainDir, input.aiLeadToken);
  if (git.pathExistsOnRef(input.mainDir, 'origin/dev', recordPath) || existsSync(join(input.mainDir, recordPath))) {
    return { lane, recordPath, existing: true };
  }
  git.checkoutNewBranch(input.mainDir, lane, 'origin/dev');
  const dir = join(input.mainDir, 'docs', 'milestones', input.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'milestone.md'), renderMilestoneRecord(input.template, input), 'utf8');
  const readmePath = join(input.mainDir, 'docs', 'milestones', 'README.md');
  const day = input.date.toISOString().slice(0, 10);
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '# Milestones\n\n- Active: (none)\n- Past: (none)\n';
  writeFileSync(readmePath, addIndexRow(readme, input.folder, input.title, day), 'utf8');
  const sha = git.commitAll(input.mainDir, `kickoff: open ${input.folder}`);
  if (sha === null) throw localError(`nothing to commit for ${input.folder} — record already present`);
  git.push(input.mainDir, lane, input.aiLeadToken);
  return { lane, recordPath, existing: false };
}
