import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localError, usageError } from './errors.js';
import type { GitOps } from './gitops.js';

// Kickoff (`spec_foundry.md §Kickoff`): a milestone record opened for the
// Principal and the agent to settle in conversation, or a fix record opened
// for its work. In the project's main/ clone: the lane off its start point,
// the record from the canonical template, committed under the clone's
// configured identity, pushed.

export const MILESTONE_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export function milestoneFolderName(date: Date, slug: string): string {
  if (!MILESTONE_SLUG_PATTERN.test(slug)) throw usageError(`--milestone must match [a-z][a-z0-9-]* (got "${slug}")`);
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '.');
  return `milestone_v${stamp}_${slug}`;
}

// The record rendered from the canonical template: title, folder, status and
// date filled; Scope seeded with the note; every other section left as the
// template's placeholder for the drafting conversation.
export type FixBase = 'main' | 'dev';

const BASE_MEANING: Record<FixBase, string> = {
  main: '`main` — released on its own',
  dev: '`dev` — riding the next release'
};

export function fixFolderName(date: Date, slug: string): string {
  if (!MILESTONE_SLUG_PATTERN.test(slug)) throw usageError(`--fix must match [a-z][a-z0-9-]* (got "${slug}")`);
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '.');
  return `fix_v${stamp}_${slug}`;
}

// The fix record: title, folder, status, date and base filled; Problem seeded
// with the note; Change, Verification and Sync left as the template's.
export function renderFixRecord(template: string, input: { title: string; folder: string; date: Date; base: FixBase; note?: string }): string {
  const day = input.date.toISOString().slice(0, 10);
  let body = template
    .replace('{Title}', input.title)
    .replace('fix_v<YYYY.MM.DD>_<slug>', input.folder)
    .replace(/\*\*Status:\*\* \{[^\n]*\}/, `**Status:** \`Active (started ${day})\``)
    .replace(/\*\*Base:\*\* \{[^\n]*\}/, `**Base:** ${BASE_MEANING[input.base]}`);
  if (input.note) {
    body = body.replace(/## Problem\n\n\{[^\n]*\}/, `## Problem\n\n${input.note}`);
  }
  return body;
}

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
  workToken: string; // fetch + push with the Vork account's token
}

export interface OpenMilestoneResult {
  lane: string;
  recordPath: string; // relative to main/
  existing: boolean;
}

export interface OpenFixInput extends OpenMilestoneInput {
  base: FixBase;
}

// The one act both kinds share: a folder already on dev, on main, on the
// remote lane, or in the working tree is reported, never duplicated.
function openRecord(
  git: GitOps,
  input: { mainDir: string; folder: string; workToken: string },
  record: { dir: 'milestones' | 'fixes'; file: string; lane: string; startPoint: string; body: () => string }
): OpenMilestoneResult {
  const recordPath = `docs/${record.dir}/${input.folder}/${record.file}`;
  const lane = record.lane;
  if (!existsSync(join(input.mainDir, '.git'))) throw localError(`main/ clone missing at ${input.mainDir} — bootstrap the project first`);
  git.fetch(input.mainDir, input.workToken);
  const onRemote = ['origin/dev', 'origin/main', `origin/${lane}`].some((ref) => git.pathExistsOnRef(input.mainDir, ref, recordPath));
  if (onRemote || existsSync(join(input.mainDir, recordPath))) {
    return { lane, recordPath, existing: true };
  }
  git.checkoutNewBranch(input.mainDir, lane, record.startPoint);
  const dir = join(input.mainDir, 'docs', record.dir, input.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, record.file), record.body(), 'utf8');
  const sha = git.commitAll(input.mainDir, `kickoff: open ${input.folder}`);
  if (sha === null) throw localError(`zero changes to commit for ${input.folder} — record already present`);
  git.push(input.mainDir, lane, input.workToken);
  return { lane, recordPath, existing: false };
}

export function openMilestoneRecord(git: GitOps, input: OpenMilestoneInput): OpenMilestoneResult {
  return openRecord(git, input, {
    dir: 'milestones',
    file: 'milestone.md',
    lane: `feature/${input.folder}/draft`,
    startPoint: 'origin/dev',
    body: () => renderMilestoneRecord(input.template, input)
  });
}

export function openFixRecord(git: GitOps, input: OpenFixInput): OpenMilestoneResult {
  return openRecord(git, input, {
    dir: 'fixes',
    file: 'fix.md',
    lane: `fix/${input.folder}/change`,
    startPoint: `origin/${input.base}`,
    body: () => renderFixRecord(input.template, input)
  });
}
