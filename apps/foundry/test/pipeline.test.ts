import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import type { GitOps } from '../src/gitops.js';
import { runBootstrapPipeline, type PipelineDeps, type PipelineOptions } from '../src/pipeline.js';
import { readRegistry, registryPath } from '../src/registry.js';
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
  ownerPlan: string | null;
}

function harness(ownerPlan: string | null = 'pro'): Harness {
  const root = tempDir();
  const storage = join(root, 'projects');
  const keystore = join(root, 'keystore');
  const foundryVar = join(root, 'var');
  mkdirSync(storage, { recursive: true });
  mkdirSync(keystore, { recursive: true });
  writeFileSync(join(keystore, 'owner.token'), 'owner-token-value\n', 'utf8');
  writeFileSync(join(keystore, 'vork.token'), 'vork-token-value\n', 'utf8');

  const bundle: Bundle = {
    project_name: 'Throwaway Project',
    project_key: 'throwaway',
    mission: 'A one-paragraph mission.',
    description: 'The goal.',
    scope: 'The boundary.',
    visibility: 'private',
    ruleset: 'standard'
  };
  const env: FoundryEnv = {
    owner_token_path: join(keystore, 'owner.token'),
    vork_token_path: join(keystore, 'vork.token'),
    vork_name: 'Vork Bot',
    vork_email: 'vork@example.com',
    project_storage_path: storage
  };

  const api = new FakeGitHubApi();
  const git = new FakeGitOps();
  const h: Harness = { api, git, foundryVar, storage, ownerPlan, deps: undefined as unknown as PipelineDeps, options: { bundle, env, storagePath: storage, dryRun: false } };
  const identities: Record<string, { login: string; nodeId: string }> = {
    'owner-token-value': { login: 'owner-login', nodeId: 'U_owner' },
    'vork-token-value': { login: 'vork-login', nodeId: 'U_vork' }
  };
  h.deps = {
    authIdentity: async (token: string) => {
      const identity = identities[token];
      if (!identity) throw new Error('bad credentials');
      return { ...identity, scopes: null, plan: token === 'owner-token-value' ? h.ownerPlan : null };
    },
    buildApi: () => api,
    originUrl: (repoDir) => git.originUrl(repoDir),
    git,
    foundryVar,
    log: () => {}
  };
  return h;
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

async function expectFailure(h: Harness, options: PipelineOptions = h.options): Promise<FoundryError> {
  try {
    await runBootstrapPipeline(options, h.deps);
  } catch (error) {
    return error as FoundryError;
  }
  return expect.unreachable('expected the pipeline to fail') as never;
}

describe('bootstrap pipeline', () => {
  it('runs the full staged pipeline, writes the registry entry, and finishes the event trail', async () => {
    const h = harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);

    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(outcome.eventsPath).toBeDefined();
    const [run] = readEventRuns(h.foundryVar);
    expect(run!.finished).toBe(true);
    const resources = run!.resources.map((event) => event.resource);
    expect([...new Set(resources)].sort()).toEqual(['branch', 'collaborator', 'file', 'label', 'registry', 'repo', 'ruleset']);
    // artifact set exactly: zero boards, zero issues, zero webhooks
    expect(h.api.calls.filter((c) => /Board|Hook|Issue|Project/i.test(c))).toEqual([]);
    // the registry entry
    expect(outcome.registry).toEqual({ path: registryPath(h.foundryVar), outcome: 'created' });
    const entry = readRegistry(h.foundryVar).projects['throwaway']!;
    expect(entry).toMatchObject({
      name: 'Throwaway Project',
      owner: 'owner-login',
      repository: 'https://github.com/owner-login/throwaway',
      visibility: 'private',
      ruleset: 'standard',
      owner_plan: 'pro',
      vork_login: 'vork-login',
      vork_name: 'Vork Bot',
      vork_email: 'vork@example.com',
      path: join(h.storage, 'throwaway')
    });
    expect(entry.founded_at).toBe(entry.updated_at);
    // one grant: the Vork account
    const collaborators = run!.resources.filter((event) => event.resource === 'collaborator');
    expect(collaborators.map((event) => event.github_login)).toEqual(['vork-login']);
    // empty remote: the unborn branch pinned to main before the scaffold commit
    const mainDir = join(h.storage, 'throwaway', 'main');
    expect(h.git.ops).toContain(`setUnbornBranch(${mainDir}, main)`);
    // main/ committed as the owner, then handed to the Vork account's commit identity from the environment
    const identityOps = h.git.ops.filter((op) => op.startsWith(`setIdentity(${mainDir},`));
    expect(identityOps).toEqual([
      `setIdentity(${mainDir}, owner-login, owner-login@throwaway.localhost)`,
      `setIdentity(${mainDir}, Vork Bot, vork@example.com)`
    ]);
    // the empty team/ directory, and it alone
    expect(existsSync(join(h.storage, 'throwaway', 'team'))).toBe(true);
    expect(readdirSync(join(h.storage, 'throwaway', 'team'))).toEqual([]);
    // skeleton rendered into main/, templates from the kit's home
    expect(existsSync(join(mainDir, 'docs', 'charter.md'))).toBe(true);
    expect(existsSync(join(mainDir, 'docs', 'backlog.md'))).toBe(true);
    expect(readdirSync(join(mainDir, 'docs', 'conventions', 'templates'))).toHaveLength(11);
    // scaffold message per spec
    expect(h.git.ops.some((op) => op.includes('Foundry: initial project scaffold'))).toBe(true);
  });

  it('writes zero secret values into the event trail', async () => {
    const h = harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    const raw = readFileSync(outcome.eventsPath!, 'utf8');
    for (const secret of ['owner-token-value', 'vork-token-value']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('leaves a failure-marked event trail on mid-pipeline failure (exit 4) and resumes on re-run', async () => {
    const h = harness();
    h.api.failOn.add('createLabel');

    const caught = await expectFailure(h);
    expect(caught).toBeInstanceOf(FoundryError);
    expect(caught.exitCode).toBe(EXIT.GITHUB);
    const partials = readEventRuns(h.foundryVar);
    expect(partials.length).toBe(1);
    expect(partials[0]!.finished).toBe(false);
    expect(partials[0]!.failed).toBe(true);
    expect(existsSync(registryPath(h.foundryVar))).toBe(false);

    h.api.failOn.clear();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    const runs = readEventRuns(h.foundryVar);
    expect(runs.length).toBe(2);
    const final = runs.find((run) => run.finished)!;
    const repoEvent = final.resources.find((event) => event.resource === 'repo')!;
    expect(repoEvent.created_or_skipped).toBe('skipped');
    expect(h.api.calls.filter((call) => call.startsWith('createUserRepo')).length).toBe(1);
    expect(outcome.registry?.outcome).toBe('created');
  });

  it('a re-run after success updates the registry entry and keeps founded_at', async () => {
    const h = harness();
    await runBootstrapPipeline(h.options, h.deps);
    const first = readRegistry(h.foundryVar).projects['throwaway']!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    expect(outcome.registry?.outcome).toBe('updated');
    const registry = readRegistry(h.foundryVar);
    expect(Object.keys(registry.projects)).toEqual(['throwaway']);
    expect(registry.projects['throwaway']!.founded_at).toBe(first.founded_at);
    expect(registry.projects['throwaway']!.run_id).not.toBe(first.run_id);
  });

  it('dry-run performs zero GitHub mutations, zero writes under the storage path, and leaves the registry untouched', async () => {
    const h = harness();
    const outcome = await runBootstrapPipeline({ ...h.options, dryRun: true }, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    const mutations = h.api.calls.filter((call) =>
      /^create|^inviteCollaborator|^acceptInvitation|^updateRuleset|^patchRepo/.test(call)
    );
    expect(mutations).toEqual([]);
    expect(existsSync(join(h.storage, 'throwaway'))).toBe(false);
    expect(existsSync(join(h.foundryVar, 'dry-run'))).toBe(true);
    expect(existsSync(registryPath(h.foundryVar))).toBe(false);
  });

  it('preflight failures exit 3 naming the subject, before any mutation', async () => {
    const h = harness();
    rmSync(h.options.env.vork_token_path);
    const caught = await expectFailure(h);
    expect(caught.exitCode).toBe(EXIT.PREFLIGHT);
    expect(caught.message).toMatch(/token file not found/);
    expect(h.api.calls.filter((call) => /^create/.test(call))).toEqual([]);
    expect(readEventRuns(h.foundryVar)).toEqual([]);
  });

  describe('plan gate', () => {
    it('refuses free + private + standard before any API call', async () => {
      const h = harness('free');
      const caught = await expectFailure(h);
      expect(caught.exitCode).toBe(EXIT.PREFLIGHT);
      expect(caught.message).toMatch(/free plan takes no branch protection/);
      expect(h.api.calls).toEqual([]);
      expect(readEventRuns(h.foundryVar)).toEqual([]);
    });

    it('passes free + public + standard, and free + private + none', async () => {
      const pub = harness('free');
      const publicOutcome = await runBootstrapPipeline({ ...pub.options, bundle: { ...pub.options.bundle, visibility: 'public' } }, pub.deps);
      expect(publicOutcome.exitCode).toBe(EXIT.SUCCESS);
      expect(pub.api.createdVisibility.get('throwaway')).toBe('public');
      expect(readRegistry(pub.foundryVar).projects['throwaway']).toMatchObject({ visibility: 'public', owner_plan: 'free' });

      const none = harness('free');
      const noneOutcome = await runBootstrapPipeline({ ...none.options, bundle: { ...none.options.bundle, ruleset: 'none' } }, none.deps);
      expect(noneOutcome.exitCode).toBe(EXIT.SUCCESS);
      expect(none.api.rulesets).toEqual([]);
      expect(readRegistry(none.foundryVar).projects['throwaway']).toMatchObject({ ruleset: 'none', owner_plan: 'free' });
    });

    it('passes an unknown plan and records it; a ruleset refusal is then named with its ways out', async () => {
      const h = harness(null);
      const outcome = await runBootstrapPipeline(h.options, h.deps);
      expect(outcome.exitCode).toBe(EXIT.SUCCESS);
      expect(readRegistry(h.foundryVar).projects['throwaway']!.owner_plan).toBe('unknown');

      const refused = harness(null);
      refused.api.failOn.add('createRuleset');
      const caught = await expectFailure(refused);
      expect(caught.exitCode).toBe(EXIT.GITHUB);
      expect(caught.message).toMatch(/rulesets failed/);
      expect(caught.message).toMatch(/ruleset none/);
      expect(caught.message).toMatch(/re-run/);
    });

    it('passes every combination on a paid plan', async () => {
      const h = harness('pro');
      const outcome = await runBootstrapPipeline(h.options, h.deps);
      expect(outcome.exitCode).toBe(EXIT.SUCCESS);
      expect(h.api.rulesets.map((r) => r.name).sort()).toEqual(['protect-dev', 'protect-main']);
    });
  });

  it('repairs a torn main/ clone left by an interrupted run — removed, re-cloned, recorded as drift', async () => {
    const h = harness();
    const mainDir = join(h.storage, 'throwaway', 'main');
    mkdirSync(join(mainDir, '.git'), { recursive: true });
    writeFileSync(join(mainDir, 'leftover.txt'), 'half-written', 'utf8');
    h.git.cloned.set(mainDir, 'https://github.com/owner-login/throwaway.git');
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
    const h = harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    const raw = readFileSync(outcome.eventsPath!, 'utf8');
    expect(raw).toContain('"path":"docs/charter.md"');
  });

  it('aborts preflight when the project folder pre-exists with a foreign origin', async () => {
    const h = harness();
    const mainDir = join(h.storage, 'throwaway', 'main');
    mkdirSync(mainDir, { recursive: true });
    h.git.cloned.set(mainDir, 'https://github.com/someone-else/other.git');
    const caught = await expectFailure(h);
    expect(caught.exitCode).toBe(EXIT.PREFLIGHT);
    expect(caught.message).toMatch(/pre-exists but is not a prior run/);
  });
});
