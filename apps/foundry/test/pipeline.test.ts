import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import type { GitOps } from '../src/gitops.js';
import { runMigrations } from '@psyphix/data';
import { createTestPool } from '@psyphix/data/testing';
import { runBootstrapPipeline, type PipelineDeps, type PipelineOptions } from '../src/pipeline.js';
import type { Bundle, FoundryEnv } from '../src/types.js';
import { FakeGitHubApi } from './fakes.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-pipe-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

class FakeGitOps implements GitOps {
  ops: string[] = [];
  cloned = new Map<string, string>(); // dir → remote
  probeResult = true;

  clone(remoteUrl: string, targetDir: string): void {
    this.ops.push(`clone(${remoteUrl} → ${targetDir})`);
    mkdirSync(targetDir, { recursive: true });
    this.cloned.set(targetDir, remoteUrl);
  }

  originUrl(repoDir: string): string | null {
    return this.cloned.get(repoDir) ?? null;
  }

  commitAll(repoDir: string, message: string): string | null {
    this.ops.push(`commitAll(${repoDir}, ${message})`);
    const marker = join(repoDir, '.committed');
    if (existsSync(marker)) return null; // resume with zero new changes
    writeFileSync(marker, 'x', 'utf8');
    return 'sha_scaffold';
  }

  push(repoDir: string, branch: string): void {
    this.ops.push(`push(${repoDir}, ${branch})`);
  }

  setIdentity(repoDir: string, name: string, email: string): void {
    this.ops.push(`setIdentity(${repoDir}, ${name}, ${email})`);
  }

  probeRemote(repoDir: string): boolean {
    this.ops.push(`probeRemote(${repoDir})`);
    return this.probeResult;
  }

  torn = new Set<string>(); // dirs whose HEAD resolution fails
  headResolves(repoDir: string): boolean {
    this.ops.push(`headResolves(${repoDir})`);
    return !this.torn.has(repoDir);
  }

  setUnbornBranch(repoDir: string, branch: string): void {
    this.ops.push(`setUnbornBranch(${repoDir}, ${branch})`);
  }

  onRef = new Set<string>();
  fetch(repoDir: string): void {
    this.ops.push(`fetch(${repoDir})`);
  }
  pathExistsOnRef(_repoDir: string, ref: string, path: string): boolean {
    return this.onRef.has(`${ref}:${path}`);
  }
  checkoutNewBranch(repoDir: string, branch: string, startPoint: string): void {
    this.ops.push(`checkoutNewBranch(${repoDir}, ${branch}, ${startPoint})`);
  }
}

interface Harness {
  api: FakeGitHubApi;
  git: FakeGitOps;
  deps: PipelineDeps;
  options: PipelineOptions;
  foundryVar: string;
  storage: string;
  registryDb: any;
}

async function harness(): Promise<Harness> {
  const root = tempDir();
  const storage = join(root, 'projects');
  const keystore = join(root, 'keystore');
  const foundryVar = join(root, 'var');
  mkdirSync(storage, { recursive: true });
  mkdirSync(keystore, { recursive: true });
  writeFileSync(join(keystore, 'owner.token'), 'owner-token-value\n', 'utf8');
  writeFileSync(join(keystore, 'work.token'), 'work-token-value\n', 'utf8');

  const bundle: Bundle = {
    project_name: 'Throwaway Project',
    project_key: 'throwaway',
    mission: 'A one-paragraph mission.',
    description: 'The goal.',
    scope: 'The boundary.'
  };
  const env: FoundryEnv = {
    owner_token_path: join(keystore, 'owner.token'),
    work_token_path: join(keystore, 'work.token'),
    ruleset: 'standard',
    project_storage_path: storage,
    database: { host: 'mem', port: 5432, name: 'psyphix', user: 'psyphix_app', password_path: join(keystore, 'owner.token') }
  };

  const registryDb = await createTestPool();
  await runMigrations(registryDb);

  const api = new FakeGitHubApi();
  const git = new FakeGitOps();
  const identities: Record<string, { login: string; nodeId: string }> = {
    'owner-token-value': { login: 'jasonyliu', nodeId: 'U_owner' },
    'work-token-value': { login: 'psyphix-claw', nodeId: 'U_psyphix-claw' }
  };
  const deps: PipelineDeps = {
    authIdentity: async (token: string) => {
      const identity = identities[token];
      if (!identity) throw new Error('bad credentials');
      return { ...identity, scopes: null };
    },
    buildApi: () => api,
    originUrl: (repoDir) => git.originUrl(repoDir),
    git,
    foundryVar,
    log: () => {},
    openRegistry: async () => ({ db: registryDb, close: async () => {} })
  };
  return { api, git, deps, foundryVar, storage, registryDb, options: { bundle, env, storagePath: storage, dryRun: false } };
}

interface EventRun {
  events: any[];
  resources: any[];
  finished: boolean;
  failed: boolean;
}

function readEventRuns(foundryVar: string): EventRun[] {
  const runsDir = join(foundryVar, 'runs', 'throwaway');
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((name) => name.startsWith('run_') && name.endsWith('.jsonl'))
    .sort()
    .map((name) => {
      const events = readFileSync(join(runsDir, name), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line));
      return {
        events,
        resources: events.filter((event) => event.event === 'resource'),
        finished: events.some((event) => event.event === 'run_finished'),
        failed: events.some((event) => event.event === 'run_failed')
      };
    });
}

describe('bootstrap pipeline', () => {
  it('runs the full staged pipeline, registers the project row, and finishes the event trail', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);

    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(outcome.eventsPath).toBeDefined();
    const [run] = readEventRuns(h.foundryVar);
    expect(run!.finished).toBe(true);
    const resources = run!.resources.map((event) => event.resource);
    for (const expected of ['repo', 'project_v2', 'project_repo_link', 'label', 'collaborator', 'registry', 'file', 'branch', 'ruleset']) {
      expect(resources).toContain(expected);
    }
    // artifact set exactly: zero issues, zero webhooks, zero custom fields
    expect(h.api.calls.filter((c) => /^createHook|^createIssue|^createSingleSelectField/.test(c))).toEqual([]);
    // the register stage wrote the one project row
    expect(outcome.registry?.project).toBe('created');
    const projectRow = await h.registryDb.query(`SELECT id, name FROM project WHERE project = 'throwaway'`);
    expect(projectRow.rows).toHaveLength(1);
    expect(projectRow.rows[0].name).toBe('Throwaway Project');
    const routeRows = await h.registryDb.query(`SELECT count(*)::int AS n FROM route`);
    expect(Number(routeRows.rows[0].n)).toBe(0);
    // one grant: the work account
    const collaborators = run!.resources.filter((event) => event.resource === 'collaborator');
    expect(collaborators.map((event) => event.github_login)).toEqual(['psyphix-claw']);
    // empty remote: the unborn branch pinned to main before the scaffold commit
    const mainDir = join(h.storage, 'throwaway', 'main');
    expect(h.git.ops).toContain(`setUnbornBranch(${mainDir}, main)`);
    // main/ committed as the owner, then handed to the work identity
    const identityOps = h.git.ops.filter((op) => op.startsWith(`setIdentity(${mainDir},`));
    expect(identityOps).toEqual([
      `setIdentity(${mainDir}, jasonyliu, jasonyliu@throwaway.localhost)`,
      `setIdentity(${mainDir}, psyphix-claw, psyphix-claw@throwaway.localhost)`
    ]);
    // the empty team/ directory, and it alone
    expect(existsSync(join(h.storage, 'throwaway', 'team'))).toBe(true);
    expect(readdirSync(join(h.storage, 'throwaway', 'team'))).toEqual([]);
    // skeleton rendered into main/
    expect(existsSync(join(mainDir, 'docs', 'charter.md'))).toBe(true);
    expect(existsSync(join(mainDir, 'docs', 'backlog.md'))).toBe(true);
    // scaffold message per spec
    expect(h.git.ops.some((op) => op.includes('Foundry: initial project scaffold'))).toBe(true);
  });

  it('writes zero secret values into the event trail', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    const raw = readFileSync(outcome.eventsPath!, 'utf8');
    for (const secret of ['owner-token-value', 'work-token-value']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('leaves a failure-marked event trail on mid-pipeline failure (exit 4) and resumes on re-run', async () => {
    const h = await harness();
    h.api.failOn.add('linkBoardToRepo');

    let caught: FoundryError | null = null;
    try {
      await runBootstrapPipeline(h.options, h.deps);
    } catch (error) {
      caught = error as FoundryError;
    }
    expect(caught).toBeInstanceOf(FoundryError);
    expect(caught!.exitCode).toBe(EXIT.GITHUB);
    const partials = readEventRuns(h.foundryVar);
    expect(partials.length).toBe(1);
    expect(partials[0]!.finished).toBe(false);
    expect(partials[0]!.failed).toBe(true);

    h.api.failOn.clear();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    const runs = readEventRuns(h.foundryVar);
    expect(runs.length).toBe(2);
    const final = runs.find((run) => run.finished)!;
    const repoEvent = final.resources.find((event) => event.resource === 'repo')!;
    expect(repoEvent.created_or_skipped).toBe('skipped');
    expect(h.api.calls.filter((call) => call.startsWith('createUserRepo')).length).toBe(1);
    expect(outcome.registry?.project).toBe('created');
    const projectRows = await h.registryDb.query(`SELECT id FROM project WHERE project = 'throwaway'`);
    expect(projectRows.rows).toHaveLength(1);
  });

  it('dry-run performs zero GitHub mutations, zero registry writes, and zero writes under the storage path', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline({ ...h.options, dryRun: true }, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    const projects = await h.registryDb.query(`SELECT count(*)::int AS n FROM project`);
    expect(Number(projects.rows[0].n)).toBe(0);
    const mutations = h.api.calls.filter((call) =>
      /^create|^inviteCollaborator|^acceptInvitation|^grantBoard|^updateRuleset|^patchRepo|^linkBoard/.test(call)
    );
    expect(mutations).toEqual([]);
    expect(existsSync(join(h.storage, 'throwaway'))).toBe(false);
    expect(existsSync(join(h.foundryVar, 'dry-run'))).toBe(true);
  });

  it('preflight failures exit 3 naming the subject, before any mutation', async () => {
    const h = await harness();
    rmSync(h.options.env.work_token_path);
    let caught: FoundryError | null = null;
    try {
      await runBootstrapPipeline(h.options, h.deps);
    } catch (error) {
      caught = error as FoundryError;
    }
    expect(caught!.exitCode).toBe(EXIT.PREFLIGHT);
    expect(caught!.message).toMatch(/token file not found/);
    expect(h.api.calls.filter((call) => /^create/.test(call))).toEqual([]);
    expect(readEventRuns(h.foundryVar)).toEqual([]);
  });

  it('runs standalone — registry skipped with an event — when the environment carries zero database config', async () => {
    const h = await harness();
    const { database: _omit, ...envWithoutDb } = h.options.env;
    const outcome = await runBootstrapPipeline({ ...h.options, env: envWithoutDb }, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(outcome.registry).toBeUndefined();
    const [run] = readEventRuns(h.foundryVar);
    const registry = run!.resources.find((event) => event.resource === 'registry')!;
    expect(registry.project).toBe('skipped');
    expect(registry.skipped_reason).toMatch(/standalone/);
    const projects = await h.registryDb.query(`SELECT count(*)::int AS n FROM project`);
    expect(Number(projects.rows[0].n)).toBe(0);
  });

  it('repairs a torn main/ clone left by an interrupted run — removed, re-cloned, recorded as drift', async () => {
    const h = await harness();
    const mainDir = join(h.storage, 'throwaway', 'main');
    mkdirSync(join(mainDir, '.git'), { recursive: true });
    writeFileSync(join(mainDir, 'leftover.txt'), 'half-written', 'utf8');
    h.git.cloned.set(mainDir, 'https://github.com/jasonyliu/throwaway.git');
    h.git.torn.add(mainDir);
    h.api.refs.set('heads/main', 'sha_prior');
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(existsSync(join(mainDir, 'leftover.txt'))).toBe(false);
    const [run] = readEventRuns(h.foundryVar);
    const repair = run!.resources.find((event) => event.resource === 'clone' && event.name === 'main')!;
    expect(repair.drift).toMatch(/torn clone/);
    expect(existsSync(join(mainDir, 'docs', 'charter.md'))).toBe(true);
  });

  it('keeps a file path in the clear — sanitization matches secret segments rather than substrings', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    const raw = readFileSync(outcome.eventsPath!, 'utf8');
    expect(raw).toContain('"path":"docs/charter.md"');
  });

  it('aborts preflight when the project folder pre-exists with a foreign origin', async () => {
    const h = await harness();
    const mainDir = join(h.storage, 'throwaway', 'main');
    mkdirSync(mainDir, { recursive: true });
    h.git.cloned.set(mainDir, 'https://github.com/someone-else/other.git');
    let caught: FoundryError | null = null;
    try {
      await runBootstrapPipeline(h.options, h.deps);
    } catch (error) {
      caught = error as FoundryError;
    }
    expect(caught!.exitCode).toBe(EXIT.PREFLIGHT);
    expect(caught!.message).toMatch(/pre-exists but is not a prior run/);
  });
});
