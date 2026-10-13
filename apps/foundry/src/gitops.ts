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
