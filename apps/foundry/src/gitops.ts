import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localError } from './errors.js';

// Local git acts: clone, scaffold commit + push, per-clone identity, remote
// probe. Credentials ride one-shot GIT_ASKPASS injection — the token never
// lands in `.git/config` (`spec_foundry.md §Team clones`).

export interface GitOps {
  clone(remoteUrl: string, targetDir: string, token: string): void;
  originUrl(repoDir: string): string | null;
  commitAll(repoDir: string, message: string): string | null; // sha, or null when nothing to commit
  push(repoDir: string, branch: string, token: string): void;
  setIdentity(repoDir: string, name: string, email: string): void;
  probeRemote(repoDir: string, token: string): boolean; // git ls-remote origin
  headResolves(repoDir: string): boolean; // git rev-parse --verify HEAD — false on a torn clone
  fetch(repoDir: string, token: string): void; // git fetch origin
  pathExistsOnRef(repoDir: string, ref: string, path: string): boolean; // git cat-file -e <ref>:<path>
  checkoutNewBranch(repoDir: string, branch: string, startPoint: string): void; // git checkout -B <branch> <startPoint>
  setUnbornBranch(repoDir: string, branch: string): void; // git symbolic-ref HEAD refs/heads/<branch> — a fresh clone of an empty remote sits on the machine's default name
}

function runGit(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    encoding: 'utf8'
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// One-shot credential injection: a 0700 askpass script answering the username
// prompt with x-access-token and the password prompt with the token from env.
function withAskpass<T>(token: string, fn: (env: NodeJS.ProcessEnv) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-askpass-'));
  const script = join(dir, 'askpass.sh');
  writeFileSync(script, '#!/bin/sh\ncase "$1" in\n  Username*) echo x-access-token ;;\n  *) printf %s "$FOUNDRY_GIT_TOKEN" ;;\nesac\n', 'utf8');
  chmodSync(script, 0o700);
  try {
    return fn({ GIT_ASKPASS: script, FOUNDRY_GIT_TOKEN: token });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function buildGitOps(): GitOps {
  return {
    clone(remoteUrl, targetDir, token) {
      const result = withAskpass(token, (env) => runGit(['clone', remoteUrl, targetDir], { env }));
      if (result.status !== 0) throw localError(`git clone failed for ${remoteUrl}: ${result.stderr.trim()}`);
    },

    originUrl(repoDir) {
      const result = runGit(['remote', 'get-url', 'origin'], { cwd: repoDir });
      return result.status === 0 ? result.stdout.trim() : null;
    },

    commitAll(repoDir, message) {
      const add = runGit(['add', '-A'], { cwd: repoDir });
      if (add.status !== 0) throw localError(`git add failed in ${repoDir}: ${add.stderr.trim()}`);
      const status = runGit(['status', '--porcelain'], { cwd: repoDir });
      if (status.stdout.trim() === '') return null;
      // author/email from the operator's git config (`spec_foundry.md §Scaffold commit`)
      const commit = runGit(['commit', '-m', message], { cwd: repoDir });
      if (commit.status !== 0) throw localError(`git commit failed in ${repoDir}: ${commit.stderr.trim()}`);
      const sha = runGit(['rev-parse', 'HEAD'], { cwd: repoDir });
      return sha.stdout.trim();
    },

    push(repoDir, branch, token) {
      const result = withAskpass(token, (env) => runGit(['push', 'origin', branch], { cwd: repoDir, env }));
      if (result.status !== 0) {
        // a rejection from an operator-created ruleset is reported by name
        const rulesetMatch = result.stderr.match(/ruleset[^\n]*/i);
        const detail = rulesetMatch ? rulesetMatch[0] : result.stderr.trim();
        throw localError(`git push ${branch} rejected: ${detail}`);
      }
    },

    setIdentity(repoDir, name, email) {
      for (const [key, value] of [
        ['user.name', name],
        ['user.email', email]
      ] as const) {
        const result = runGit(['config', key, value], { cwd: repoDir });
        if (result.status !== 0) throw localError(`git config ${key} failed in ${repoDir}: ${result.stderr.trim()}`);
      }
    },

    headResolves(repoDir) {
      return runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: repoDir }).status === 0;
    },

    fetch(repoDir, token) {
      const result = withAskpass(token, (env) => runGit(['fetch', '--quiet', 'origin'], { cwd: repoDir, env }));
      if (result.status !== 0) throw localError(`git fetch failed in ${repoDir}: ${result.stderr.trim()}`);
    },

    pathExistsOnRef(repoDir, ref, path) {
      return runGit(['cat-file', '-e', `${ref}:${path}`], { cwd: repoDir }).status === 0;
    },

    setUnbornBranch(repoDir, branch) {
      const result = runGit(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: repoDir });
      if (result.status !== 0) throw localError(`git symbolic-ref HEAD refs/heads/${branch} failed in ${repoDir}: ${result.stderr.trim()}`);
    },

    checkoutNewBranch(repoDir, branch, startPoint) {
      const result = runGit(['checkout', '-B', branch, startPoint], { cwd: repoDir });
      if (result.status !== 0) throw localError(`git checkout -B ${branch} ${startPoint} failed in ${repoDir}: ${result.stderr.trim()}`);
    },

    probeRemote(repoDir, token) {
      const result = withAskpass(token, (env) => runGit(['ls-remote', 'origin', 'HEAD'], { cwd: repoDir, env }));
      return result.status === 0;
    }
  };
}

// The local git acts `publish` performs (`spec_foundry.md §Publish`), apart
// from the bootstrap surface above. Reads take refs as given; the remote's
// tags are asked of the remote itself, so a tag left local by a failed push
// never counts as published.
export interface ReleaseGit {
  fetchWithTags(repoDir: string, token: string): void; // git fetch --force --tags origin
  remoteTagCommit(repoDir: string, tag: string, token: string): string | null; // the commit the remote's tag points at
  localTagCommit(repoDir: string, tag: string): string | null;
  tagSubject(repoDir: string, tag: string): string | null; // an annotated tag's subject; null for a lightweight one
  listDir(repoDir: string, ref: string, dir: string): string[]; // entry names under <dir> at <ref>
  readOnRef(repoDir: string, ref: string, path: string): string | null;
  commitOf(repoDir: string, ref: string): string | null;
  parents(repoDir: string, commit: string): string[];
  isAncestor(repoDir: string, ancestor: string, descendant: string): boolean;
  createAnnotatedTag(repoDir: string, tag: string, commit: string, message: string): void;
  pushTag(repoDir: string, tag: string, token: string): void;
}

export function buildReleaseGit(): ReleaseGit {
  return {
    fetchWithTags(repoDir, token) {
      const result = withAskpass(token, (env) => runGit(['fetch', '--quiet', '--force', '--tags', 'origin'], { cwd: repoDir, env }));
      if (result.status !== 0) throw localError(`git fetch --tags failed in ${repoDir}: ${result.stderr.trim()}`);
    },

    remoteTagCommit(repoDir, tag, token) {
      const result = withAskpass(token, (env) => runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { cwd: repoDir, env }));
      if (result.status !== 0) throw localError(`git ls-remote --tags failed in ${repoDir}: ${result.stderr.trim()}`);
      const lines = result.stdout.trim().split('\n').filter((line) => line !== '');
      // an annotated tag lists its peeled commit as <tag>^{}; a lightweight one points at the commit directly
      const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
      const direct = lines.find((line) => line.endsWith(`refs/tags/${tag}`));
      return (peeled ?? direct)?.split(/\s+/)[0] ?? null;
    },

    localTagCommit(repoDir, tag) {
      const result = runGit(['rev-parse', '--quiet', '--verify', `refs/tags/${tag}^{commit}`], { cwd: repoDir });
      return result.status === 0 ? result.stdout.trim() : null;
    },

    tagSubject(repoDir, tag) {
      const result = runGit(['for-each-ref', '--format=%(objecttype)%09%(contents:subject)', `refs/tags/${tag}`], { cwd: repoDir });
      const [type, subject] = result.stdout.replace(/\n$/, '').split('\t');
      return type === 'tag' && subject !== undefined && subject !== '' ? subject : null;
    },

    listDir(repoDir, ref, dir) {
      const result = runGit(['ls-tree', '--name-only', ref, `${dir}/`], { cwd: repoDir });
      if (result.status !== 0) return [];
      return result.stdout.split('\n').filter((line) => line !== '').map((path) => path.slice(path.lastIndexOf('/') + 1));
    },

    readOnRef(repoDir, ref, path) {
      const result = runGit(['show', `${ref}:${path}`], { cwd: repoDir });
      return result.status === 0 ? result.stdout : null;
    },

    commitOf(repoDir, ref) {
      const result = runGit(['rev-parse', '--quiet', '--verify', `${ref}^{commit}`], { cwd: repoDir });
      return result.status === 0 ? result.stdout.trim() : null;
    },

    parents(repoDir, commit) {
      const result = runGit(['rev-list', '--parents', '-n', '1', commit], { cwd: repoDir });
      if (result.status !== 0) throw localError(`git rev-list --parents ${commit} failed in ${repoDir}: ${result.stderr.trim()}`);
      return result.stdout.trim().split(/\s+/).slice(1);
    },

    isAncestor(repoDir, ancestor, descendant) {
      return runGit(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoDir }).status === 0;
    },

    createAnnotatedTag(repoDir, tag, commit, message) {
      // tagger: the clone's configured identity, the actor's own (`rules/PROJECT.md §Identity`)
      const result = runGit(['tag', '-a', tag, commit, '-m', message], { cwd: repoDir });
      if (result.status !== 0) throw localError(`git tag -a ${tag} failed in ${repoDir}: ${result.stderr.trim()}`);
    },

    pushTag(repoDir, tag, token) {
      const result = withAskpass(token, (env) => runGit(['push', 'origin', `refs/tags/${tag}`], { cwd: repoDir, env }));
      if (result.status !== 0) throw localError(`git push of tag ${tag} rejected: ${result.stderr.trim()}`);
    }
  };
}
