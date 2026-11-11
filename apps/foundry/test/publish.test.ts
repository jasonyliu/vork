import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import type { NewRelease, ReleaseApi, ReleaseInfo } from '../src/github/api.js';
import { buildReleaseGit } from '../src/gitops.js';
import { compareVersions, formatPublishOutcome, githubCoordinates, parseRecord, parseVersion, runPublish } from '../src/publish.js';

// Publish (`spec_foundry.md §Publish`) against real git: a bare repository
// stands in for the remote, so tags, merges and ancestry are git's own; the
// GitHub Release surface is the in-memory fake below.

const savedEnv = { global: process.env['GIT_CONFIG_GLOBAL'], nosystem: process.env['GIT_CONFIG_NOSYSTEM'] };
beforeAll(() => {
  // the operator's own git config (signing, hooks) stays out of the fixture
  process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
});
afterAll(() => {
  if (savedEnv.global === undefined) delete process.env['GIT_CONFIG_GLOBAL'];
  else process.env['GIT_CONFIG_GLOBAL'] = savedEnv.global;
  if (savedEnv.nosystem === undefined) delete process.env['GIT_CONFIG_NOSYSTEM'];
  else process.env['GIT_CONFIG_NOSYSTEM'] = savedEnv.nosystem;
});

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content, 'utf8');
}

function identity(dir: string): void {
  git(dir, 'config', 'user.name', 'Actor');
  git(dir, 'config', 'user.email', 'actor@example.com');
}

function recordText(version: string, title?: string): string {
  return `# Release ${version}${title === undefined ? '' : ` — ${title}`}\n\n- **Tag:** \`${version}\`\n\n## Features\n\n- shipped in ${version}\n`;
}

// A remote with main and dev, a seed clone that plays the Principal's merges,
// and the project's main/ clone that publish runs in.
interface Fixture {
  remote: string;
  seed: string;
  mainDir: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'foundry-publish-'));
  tempDirs.push(root);
  const remote = join(root, 'remote.git');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  const seed = join(root, 'seed');
  git(root, 'clone', '--quiet', remote, seed);
  identity(seed);
  git(seed, 'checkout', '--quiet', '-B', 'main');
  write(seed, 'README.md', 'project\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '--quiet', '-m', 'scaffold');
  git(seed, 'push', '--quiet', 'origin', 'main');
  git(seed, 'checkout', '--quiet', '-b', 'dev');
  git(seed, 'push', '--quiet', 'origin', 'dev');
  const mainDir = join(root, 'project', 'main');
  git(root, 'clone', '--quiet', remote, mainDir);
  identity(mainDir);
  return { remote, seed, mainDir };
}

// The release record lands on dev, then dev merges into main: the publishing merge.
function release(f: Fixture, version: string, title?: string): string {
  git(f.seed, 'checkout', '--quiet', 'dev');
  write(f.seed, `docs/releases/release_${version}/release.md`, recordText(version, title));
  git(f.seed, 'add', '-A');
  git(f.seed, 'commit', '--quiet', '-m', `release ${version}`);
  git(f.seed, 'push', '--quiet', 'origin', 'dev');
  git(f.seed, 'checkout', '--quiet', 'main');
  git(f.seed, 'merge', '--quiet', '--no-ff', 'dev', '-m', `Merge dev for ${version}`);
  git(f.seed, 'push', '--quiet', 'origin', 'main');
  return git(f.seed, 'rev-parse', 'HEAD');
}

function remoteTags(f: Fixture): string[] {
  const out = git(f.remote, 'for-each-ref', '--format=%(refname:short)', 'refs/tags');
  return out === '' ? [] : out.split('\n');
}

class FakeReleaseApi implements ReleaseApi {
  releases = new Map<string, ReleaseInfo>();
  created: NewRelease[] = [];
  failCreate = false;

  async getReleaseByTag(_owner: string, _repo: string, tag: string): Promise<ReleaseInfo | null> {
    return this.releases.get(tag) ?? null;
  }

  async createRelease(_owner: string, _repo: string, release: NewRelease): Promise<ReleaseInfo> {
    if (this.failCreate) throw new Error('injected failure: createRelease');
    this.created.push(release);
    const info = { name: release.name, body: release.body, htmlUrl: `https://github.com/owner-login/project/releases/tag/${release.tagName}` };
    this.releases.set(release.tagName, info);
    return info;
  }
}

function publish(f: Fixture, api: FakeReleaseApi, options: { version?: string; dryRun?: boolean } = {}) {
  return runPublish(buildReleaseGit(), api, {
    mainDir: f.mainDir,
    owner: 'owner-login',
    repo: 'project',
    version: options.version,
    dryRun: options.dryRun ?? false,
    token: 'unused-on-a-file-remote'
  });
}

async function expectRefused(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect((error as FoundryError).exitCode).toBe(EXIT.PUBLISH_REFUSED);
    expect((error as Error).message).toMatch(pattern);
  }
}

describe('version grammar and order', () => {
  it('accepts a date and a date with .r<n>, n ≥ 2, and nothing else', () => {
    expect(parseVersion('v2026.10.16')).toEqual({ date: '2026.10.16', n: 1 });
    expect(parseVersion('v2026.10.16.r2')).toEqual({ date: '2026.10.16', n: 2 });
    for (const bad of ['v2026.1.5', '2026.01.05', 'v2026.01.05.r1', 'v2026.01.05.r0', 'v2026.01.05.r02', 'v2026.01.05-r2']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('orders by date, then by n, a bare date counting as 1', () => {
    const ordered = ['v2026.10.16', 'v2026.10.16.r2', 'v2026.10.16.r10', 'v2026.10.17'];
    const shuffled = ['v2026.10.17', 'v2026.10.16.r10', 'v2026.10.16', 'v2026.10.16.r2'];
    expect([...shuffled].sort(compareVersions)).toEqual(ordered);
  });
});

describe('release record', () => {
  it('takes the heading, `Release ` dropped, as the name and the file below it as the notes', () => {
    expect(parseRecord('v2026.11.12', '# Release v2026.11.12 — handoff and fixes\n\n\n- **Tag:** x\n\n## Features\n', 'p')).toEqual({
      name: 'v2026.11.12 — handoff and fixes',
      notes: '- **Tag:** x\n\n## Features\n'
    });
    expect(parseRecord('v2026.10.24', '# Release v2026.10.24\n\n- a\n', 'p').name).toBe('v2026.10.24');
  });

  it('refuses another first line, or a heading naming another version', () => {
    for (const [text, pattern] of [
      ['Release notes\n', /first line must read/],
      ['# Release v2026.10.23 — wrong folder\n', /names v2026\.10\.23, the folder v2026\.10\.24/]
    ] as const) {
      try {
        parseRecord('v2026.10.24', text, 'docs/releases/release_v2026.10.24/release.md');
        expect.unreachable();
      } catch (error) {
        expect((error as FoundryError).exitCode).toBe(EXIT.PUBLISH_REFUSED);
        expect((error as Error).message).toMatch(pattern);
      }
    }
  });

  it('reads a GitHub origin over https, with or without .git, and nothing else', () => {
    expect(githubCoordinates('https://github.com/owner-login/project.git')).toEqual({ owner: 'owner-login', repo: 'project' });
    expect(githubCoordinates('https://github.com/owner-login/project')).toEqual({ owner: 'owner-login', repo: 'project' });
    expect(githubCoordinates('git@github.com:owner-login/project.git')).toBeNull();
    expect(githubCoordinates('https://gitea.example.com/owner-login/project.git')).toBeNull();
  });
});

describe('publish', () => {
  it('tags the publishing merge and creates the Release as Latest; a second run reports both present', async () => {
    const f = fixture();
    const merge = release(f, 'v2026.11.12', 'handoff and fixes');
    const api = new FakeReleaseApi();

    const outcome = await publish(f, api);
    expect(outcome.tag).toEqual({ state: 'created', commit: merge });
    expect(outcome.release.state).toBe('created');
    expect(remoteTags(f)).toEqual(['v2026.11.12']);
    expect(git(f.remote, 'cat-file', '-t', 'v2026.11.12')).toBe('tag');
    expect(git(f.remote, 'rev-parse', 'v2026.11.12^{commit}')).toBe(merge);
    expect(git(f.remote, 'for-each-ref', '--format=%(contents:subject)', 'refs/tags/v2026.11.12')).toBe('v2026.11.12 — handoff and fixes');
    expect(api.created).toEqual([
      { tagName: 'v2026.11.12', name: 'v2026.11.12 — handoff and fixes', body: '- **Tag:** `v2026.11.12`\n\n## Features\n\n- shipped in v2026.11.12\n', makeLatest: true }
    ]);
    expect(formatPublishOutcome(outcome)).toBe(
      `tag created v2026.11.12 ${merge}\nrelease created "v2026.11.12 — handoff and fixes" latest=true https://github.com/owner-login/project/releases/tag/v2026.11.12`
    );

    const again = await publish(f, api);
    expect(again.tag.state).toBe('present');
    expect(again.release.state).toBe('present');
    expect(api.created).toHaveLength(1);
  });

  it('refuses a tip that is no merge, and a merge after the publishing merge; nothing is tagged', async () => {
    const f = fixture();
    release(f, 'v2026.11.12', 'x');
    git(f.seed, 'checkout', '--quiet', 'main');
    write(f.seed, 'NOTE.md', 'direct\n');
    git(f.seed, 'add', '-A');
    git(f.seed, 'commit', '--quiet', '-m', 'a direct commit');
    git(f.seed, 'push', '--quiet', 'origin', 'main');
    const api = new FakeReleaseApi();
    await expectRefused(publish(f, api), /tip [0-9a-f]{7} is no merge/);

    const g = fixture();
    release(g, 'v2026.11.12', 'x');
    git(g.seed, 'checkout', '--quiet', 'dev');
    write(g.seed, 'LATER.md', 'later\n');
    git(g.seed, 'add', '-A');
    git(g.seed, 'commit', '--quiet', '-m', 'later work');
    git(g.seed, 'checkout', '--quiet', 'main');
    git(g.seed, 'merge', '--quiet', '--no-ff', 'dev', '-m', 'a later merge');
    git(g.seed, 'push', '--quiet', 'origin', 'main');
    await expectRefused(publish(g, api), /a commit landed on main after v2026\.11\.12's publishing merge/);

    expect(remoteTags(f)).toEqual([]);
    expect(remoteTags(g)).toEqual([]);
    expect(api.created).toEqual([]);
  });

  it('--version of an older tagged record creates its Release under the tag subject, not Latest; an older untagged record is refused', async () => {
    const f = fixture();
    const older = release(f, 'v2026.10.23');
    git(f.seed, 'tag', '-a', 'v2026.10.23', older, '-m', 'v2026.10.23 — the vault in the convention');
    git(f.seed, 'push', '--quiet', 'origin', 'v2026.10.23');
    release(f, 'v2026.10.24');
    release(f, 'v2026.11.12', 'newest');
    const api = new FakeReleaseApi();

    const outcome = await publish(f, api, { version: 'v2026.10.23' });
    expect(outcome.tag).toEqual({ state: 'present', commit: older });
    expect(api.created).toEqual([
      { tagName: 'v2026.10.23', name: 'v2026.10.23 — the vault in the convention', body: '- **Tag:** `v2026.10.23`\n\n## Features\n\n- shipped in v2026.10.23\n', makeLatest: false }
    ]);

    await expectRefused(publish(f, api, { version: 'v2026.10.24' }), /v2026\.10\.24 has no tag and is older than the newest record, v2026\.11\.12/);
    await expectRefused(publish(f, api, { version: 'v2026.09.01' }), /no release record docs\/releases\/release_v2026\.09\.01\//);
  });

  it('refuses a tag that points outside main', async () => {
    const f = fixture();
    release(f, 'v2026.11.12', 'x');
    git(f.seed, 'checkout', '--quiet', 'dev');
    write(f.seed, 'SIDE.md', 'side\n');
    git(f.seed, 'add', '-A');
    git(f.seed, 'commit', '--quiet', '-m', 'unmerged work');
    git(f.seed, 'tag', '-a', 'v2026.11.12', 'HEAD', '-m', 'misplaced');
    git(f.seed, 'push', '--quiet', 'origin', 'v2026.11.12');
    await expectRefused(publish(f, new FakeReleaseApi()), /tag v2026\.11\.12 points at [0-9a-f]{7}, outside origin\/main's history/);
  });

  it('refuses a malformed heading on main', async () => {
    const f = fixture();
    git(f.seed, 'checkout', '--quiet', 'dev');
    write(f.seed, 'docs/releases/release_v2026.11.12/release.md', 'Release notes for the week\n');
    git(f.seed, 'add', '-A');
    git(f.seed, 'commit', '--quiet', '-m', 'a malformed record');
    git(f.seed, 'checkout', '--quiet', 'main');
    git(f.seed, 'merge', '--quiet', '--no-ff', 'dev', '-m', 'merge');
    git(f.seed, 'push', '--quiet', 'origin', 'main');
    await expectRefused(publish(f, new FakeReleaseApi()), /release_v2026\.11\.12\/release\.md: the first line must read/);
  });

  it('reports drift and leaves an existing Release whose body differs as it stands', async () => {
    const f = fixture();
    release(f, 'v2026.11.12', 'x');
    const api = new FakeReleaseApi();
    api.releases.set('v2026.11.12', { name: 'v2026.11.12 — x', body: 'written by hand', htmlUrl: 'https://github.com/owner-login/project/releases/tag/v2026.11.12' });
    const outcome = await publish(f, api);
    expect(outcome.release.state).toBe('drift');
    expect(api.created).toEqual([]);
    expect(api.releases.get('v2026.11.12')!.body).toBe('written by hand');
  });

  it('a Release that fails after the tag push exits 4; the re-run finds the tag present and completes it', async () => {
    const f = fixture();
    const merge = release(f, 'v2026.11.12', 'x');
    const api = new FakeReleaseApi();
    api.failCreate = true;
    try {
      await publish(f, api);
      expect.unreachable();
    } catch (error) {
      expect((error as FoundryError).exitCode).toBe(EXIT.GITHUB);
    }
    expect(remoteTags(f)).toEqual(['v2026.11.12']);

    api.failCreate = false;
    const outcome = await publish(f, api);
    expect(outcome.tag).toEqual({ state: 'present', commit: merge });
    expect(outcome.release.state).toBe('created');
  });

  it('--dry-run resolves and prints the plan, and pushes and creates nothing', async () => {
    const f = fixture();
    const merge = release(f, 'v2026.11.12', 'x');
    const api = new FakeReleaseApi();
    const outcome = await publish(f, api, { dryRun: true });
    expect(outcome.tag).toEqual({ state: 'would create', commit: merge });
    expect(outcome.release).toEqual({ state: 'would create', url: null });
    expect(formatPublishOutcome(outcome)).toBe(`tag would create v2026.11.12 ${merge}\nrelease would create "v2026.11.12 — x" latest=true -`);
    expect(remoteTags(f)).toEqual([]);
    expect(git(f.mainDir, 'tag', '--list')).toBe('');
    expect(api.created).toEqual([]);
  });
});
