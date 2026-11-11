import { githubError, refusedError } from './errors.js';
import type { ReleaseApi, ReleaseInfo } from './github/api.js';
import type { ReleaseGit } from './gitops.js';

// Publish (`spec_foundry.md §Publish`): the tag on a release's publishing
// merge and its GitHub Release, from the release record already on
// origin/main. Every check runs before the first mutation; a re-run converges.

const RELEASES_DIR = 'docs/releases';
const MAIN = 'origin/main';
const HEADING_PREFIX = '# Release ';

// `<version>` per `spec_foundry-data.md §Identifier system`: v<YYYY.MM.DD>, or
// v<YYYY.MM.DD>.r<n> with n ≥ 2; a bare date counts as n = 1 in the order.
const VERSION_PATTERN = /^v(\d{4}\.\d{2}\.\d{2})(?:\.r([1-9]\d*))?$/;

export interface Version {
  date: string;
  n: number;
}

export function parseVersion(version: string): Version | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return null;
  const n = match[2] === undefined ? 1 : Number(match[2]);
  if (match[2] !== undefined && n < 2) return null;
  return { date: match[1]!, n };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)!;
  const right = parseVersion(b)!;
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  return left.n - right.n;
}

// `<name>` and `<notes>` per `spec_foundry-data.md §Release artifacts`.
export function parseRecord(version: string, text: string, path: string): { name: string; notes: string } {
  const lines = text.split('\n');
  const heading = (lines[0] ?? '').replace(/\r$/, '');
  const match = /^# Release (v\S+)(?: — (.+))?$/.exec(heading);
  if (!match) throw refusedError(`${path}: the first line must read "# Release ${version}" or "# Release ${version} — <title>"`);
  if (match[1] !== version) throw refusedError(`${path}: the heading names ${match[1]}, the folder ${version}`);
  let start = 1;
  while (start < lines.length && lines[start]!.trim() === '') start += 1;
  return { name: heading.slice(HEADING_PREFIX.length), notes: lines.slice(start).join('\n') };
}

// The repository a clone's origin names; null for anything but GitHub over https.
export function githubCoordinates(originUrl: string): { owner: string; repo: string } | null {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(originUrl.trim());
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

export interface PublishInput {
  mainDir: string; // <storage>/<project_key>/main
  owner: string;
  repo: string;
  version?: string; // default: the newest record on origin/main
  dryRun: boolean;
  token: string; // the Vork token: fetch, ls-remote, tag push, Release
}

export interface PublishOutcome {
  version: string;
  name: string;
  latest: boolean;
  tag: { state: 'created' | 'present' | 'would create'; commit: string };
  release: { state: 'created' | 'present' | 'drift' | 'would create'; url: string | null };
}

const short = (sha: string): string => sha.slice(0, 7);
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runPublish(git: ReleaseGit, api: ReleaseApi, input: PublishInput): Promise<PublishOutcome> {
  const { mainDir, token } = input;
  git.fetchWithTags(mainDir, token);

  // Resolve: records, target, heading, Latest.
  const versions = git
    .listDir(mainDir, MAIN, RELEASES_DIR)
    .filter((entry) => entry.startsWith('release_'))
    .map((entry) => entry.slice('release_'.length))
    .filter((version) => parseVersion(version) !== null)
    .sort(compareVersions);
  if (versions.length === 0) throw refusedError(`no release record under ${RELEASES_DIR}/ on ${MAIN}`);
  const newest = versions[versions.length - 1]!;
  const version = input.version ?? newest;
  if (!versions.includes(version)) throw refusedError(`no release record ${RELEASES_DIR}/release_${version}/ on ${MAIN}`);
  const recordPath = `${RELEASES_DIR}/release_${version}/release.md`;
  const text = git.readOnRef(mainDir, MAIN, recordPath);
  if (text === null) throw refusedError(`${recordPath} missing on ${MAIN}`);
  const record = parseRecord(version, text, recordPath);
  const latest = version === newest;

  // Tag: the remote's own tag decides presence.
  let name = record.name;
  let tag: PublishOutcome['tag'];
  const remoteCommit = git.remoteTagCommit(mainDir, version, token);
  if (remoteCommit !== null) {
    if (!git.isAncestor(mainDir, remoteCommit, MAIN)) throw refusedError(`tag ${version} points at ${short(remoteCommit)}, outside ${MAIN}'s history`);
    name = git.tagSubject(mainDir, version) ?? record.name;
    tag = { state: 'present', commit: remoteCommit };
  } else {
    if (!latest) throw refusedError(`${version} has no tag and is older than the newest record, ${newest}: tag it by hand at its own publishing merge`);
    const tip = git.commitOf(mainDir, MAIN);
    if (tip === null) throw refusedError(`${MAIN} does not resolve in ${mainDir}`);
    const parents = git.parents(mainDir, tip);
    if (parents.length !== 2) throw refusedError(`${MAIN}'s tip ${short(tip)} is no merge, so it is not ${version}'s publishing merge`);
    if (git.readOnRef(mainDir, parents[0]!, recordPath) !== null) {
      throw refusedError(`a commit landed on main after ${version}'s publishing merge: ${MAIN}'s tip ${short(tip)} is not that merge`);
    }
    const local = git.localTagCommit(mainDir, version);
    if (local !== null && local !== tip) throw refusedError(`a local tag ${version} points at ${short(local)}, not the publishing merge ${short(tip)}`);
    if (input.dryRun) {
      tag = { state: 'would create', commit: tip };
    } else {
      if (local === null) git.createAnnotatedTag(mainDir, version, tip, record.name);
      git.pushTag(mainDir, version, token);
      tag = { state: 'created', commit: tip };
    }
  }

  // Release: an existing one stands, equal or not.
  let existing: ReleaseInfo | null;
  try {
    existing = await api.getReleaseByTag(input.owner, input.repo, version);
  } catch (error) {
    throw githubError(`reading the GitHub Release ${version} failed: ${reason(error)}`);
  }
  let release: PublishOutcome['release'];
  if (existing !== null) {
    release = { state: existing.name === name && existing.body === record.notes ? 'present' : 'drift', url: existing.htmlUrl };
  } else if (input.dryRun) {
    release = { state: 'would create', url: null };
  } else {
    try {
      const created = await api.createRelease(input.owner, input.repo, { tagName: version, name, body: record.notes, makeLatest: latest });
      release = { state: 'created', url: created.htmlUrl };
    } catch (error) {
      throw githubError(`creating the GitHub Release ${version} failed: ${reason(error)}; the tag stands, and a re-run completes the Release`);
    }
  }
  return { version, name, latest, tag, release };
}

export function formatPublishOutcome(outcome: PublishOutcome): string {
  return [
    `tag ${outcome.tag.state} ${outcome.version} ${outcome.tag.commit}`,
    `release ${outcome.release.state} "${outcome.name}" latest=${outcome.latest} ${outcome.release.url ?? '-'}`
  ].join('\n');
}
