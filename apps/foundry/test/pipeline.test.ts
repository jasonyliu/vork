import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, FoundryError } from '../src/errors.js';
import type { GitOps } from '../src/gitops.js';
import { runMigrations } from '@vork/data';
import { createTestPool } from '@vork/data/testing';
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
    if (existsSync(marker)) return null; // nothing new to commit on resume
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

  torn = new Set<string>(); // dirs whose HEAD does not resolve
  headResolves(repoDir: string): boolean {
    this.ops.push(`headResolves(${repoDir})`);
    return !this.torn.has(repoDir);
  }

  setUnbornBranch(repoDir: string, branch: string): void {
    this.ops.push(`setUnbornBranch(${repoDir}, ${branch})`);
  }

  onRef = new Set<string>(); // `${ref}:${path}` entries that exist
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
  writeFileSync(join(keystore, 'main.token'), 'main-token-value\n', 'utf8');
  writeFileSync(join(keystore, 'sarge.token'), 'sarge-token-value\n', 'utf8');
  writeFileSync(join(keystore, 'visor.token'), 'visor-token-value\n', 'utf8');
  writeFileSync(join(keystore, 'heimdall.token'), 'audit-token-value\n', 'utf8');
  writeFileSync(join(keystore, 'webhook.secret'), 'hmac-secret-value\n', 'utf8');

  const bundle: Bundle = {
    project_name: 'Throwaway Project',
    project_key: 'throwaway',
    mission: 'A one-paragraph mission.',
    description: 'The goal.',
    scope: 'The boundary.',
    channel: 'agent:main:throwaway',
    specialists: [{ name: 'visor', tasks: ['coding', 'bug'] }]
  };
  const env: FoundryEnv = {
    owner_token_path: join(keystore, 'owner.token'),
    agent_token_dir: keystore,
    ruleset: 'standard',
    project_storage_path: storage,
    webhook_url: 'https://ingress.example.com/adapters/github/webhook',
    webhook_secret_path: join(keystore, 'webhook.secret'),
    database: { host: 'mem', port: 5432, name: 'vork', user: 'vork_app', password_path: join(keystore, 'owner.token') }
  };

  // the registry: a migrated pg-mem DB shared across this harness's runs, so
  // resume asserts idempotent registration
  const registryDb = await createTestPool();
  await runMigrations(registryDb);

  const api = new FakeGitHubApi();
  const git = new FakeGitOps();
  const identities: Record<string, { login: string; nodeId: string }> = {
    'owner-token-value': { login: 'owner-login', nodeId: 'U_owner' },
    'main-token-value': { login: 'worker-login', nodeId: 'U_worker-login' },
    'sarge-token-value': { login: 'worker-login', nodeId: 'U_worker-login' },
    'visor-token-value': { login: 'worker-login', nodeId: 'U_worker-login' },
    'audit-token-value': { login: 'auditor-login', nodeId: 'U_auditor-login' }
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
  return { api, git, deps, foundryVar, storage, registryDb, options: { bundle, env, storagePath: storage, dryRun: false, conducted: true } };
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
  it('runs the full staged pipeline, registers the project, and finishes the event trail', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);

    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(outcome.eventsPath).toBeDefined();
    const [run] = readEventRuns(h.foundryVar);
    expect(run!.finished).toBe(true);
    const resources = run!.resources.map((event) => event.resource);
    for (const expected of ['repo', 'project_v2', 'project_field', 'project_repo_link', 'label', 'webhook', 'collaborator', 'registry', 'file', 'branch', 'ruleset', 'inception_task', 'clone']) {
      expect(resources).toContain(expected);
    }
    // the register stage wrote the platform registry through foundry's own DB layer
    expect(outcome.registry?.project).toBe('created');
    const projectRow = await h.registryDb.query(`SELECT id, name FROM project WHERE project = 'throwaway'`);
    expect(projectRow.rows).toHaveLength(1);
    expect(projectRow.rows[0].name).toBe('Throwaway Project');
    const mappingRow = await h.registryDb.query(`SELECT project_id, github_project_id FROM github_repo_project WHERE github_repo_id = 'R_throwaway'`);
    expect(mappingRow.rows).toHaveLength(1);
    expect(mappingRow.rows[0].project_id).toBe(projectRow.rows[0].id);
    const agentRows = await h.registryDb.query(`SELECT agent_id, github_login, role FROM github_agent ORDER BY create_time, agent_id`);
    expect(agentRows.rows.map((row: any) => row.agent_id).sort()).toEqual(['heimdall', 'main', 'sarge', 'visor']);
    expect(agentRows.rows.find((row: any) => row.agent_id === 'heimdall')).toMatchObject({ github_login: 'auditor-login', role: 'auditor' });
    // the route set: 9 stage + 3 wildcards + 2 specialist rows, dispatchable at once
    const routeRows = await h.registryDb.query(`SELECT task_type, actor, agent_id FROM route WHERE project_id = $1 AND status = 'active'`, [projectRow.rows[0].id]);
    expect(routeRows.rows).toHaveLength(14);
    expect(routeRows.rows.find((row: any) => row.actor === 'owner')?.agent_id).toBe('sarge');
    expect(routeRows.rows.find((row: any) => row.task_type === 'coding')?.agent_id).toBe('visor');
    expect(outcome.registry?.routes_created).toBe(14);
    // grants dedupe: one work login (main, sarge, visor) + the auditor
    const collaborators = run!.resources.filter((event) => event.resource === 'collaborator');
    expect(collaborators.map((event) => event.github_login).sort()).toEqual(['auditor-login', 'worker-login']);
    // the remote was empty at clone time: the unborn branch is pinned to main before the scaffold commit
    expect(h.git.ops).toContain(`setUnbornBranch(${join(h.storage, 'throwaway', 'main')}, main)`);
    // main/ is committed as the owner, then handed to the AI Lead
    const mainDir = join(h.storage, 'throwaway', 'main');
    const identityOps = h.git.ops.filter((op) => op.startsWith(`setIdentity(${mainDir},`));
    expect(identityOps).toEqual([
      `setIdentity(${mainDir}, owner-login, owner-login@throwaway.localhost)`,
      `setIdentity(${mainDir}, main, worker-login@throwaway.localhost)`
    ]);
    // crew + specialist clones under team/ — never one for main
    const cloneNames = run!.resources.filter((event) => event.resource === 'clone').map((event) => event.name);
    expect(cloneNames).toEqual(['heimdall', 'sarge', 'visor']);
    expect(h.git.ops.some((op) => op.includes(`setIdentity(${join(h.storage, 'throwaway', 'team', 'sarge')}, sarge, worker-login@throwaway.localhost`))).toBe(true);
    expect(existsSync(join(h.storage, 'throwaway', 'team', 'main'))).toBe(false);
    // inception lane created at the scaffold commit; the Task assigned to the AI Lead with its creation comment
    expect(h.api.linkedBranches[0]).toMatchObject({ name: 'feature/inception/charter', oid: 'sha_scaffold' });
    const inception = h.api.issues.find((issue) => issue.labels.includes('type:project_inception'))!;
    expect(inception.assignees).toEqual(['worker-login']);
    expect(h.api.comments.find((c) => c.issueNumber === inception.number)?.body).toContain('To: Init (Audit: Gated)');
    const inceptionEvent = run!.resources.find((event) => event.resource === 'inception_task')!;
    expect(inceptionEvent).toMatchObject({ created_or_skipped: 'created', assignee: 'worker-login', creation_comment: 'posted' });
    // skeleton rendered into main/
    expect(existsSync(join(h.storage, 'throwaway', 'main', 'docs', 'charter.md'))).toBe(true);
  });

  it('never writes a secret value into the event trail', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    const raw = readFileSync(outcome.eventsPath!, 'utf8');
    for (const secret of ['owner-token-value', 'main-token-value', 'sarge-token-value', 'visor-token-value', 'audit-token-value', 'hmac-secret-value']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('leaves a failure-marked event trail on mid-pipeline failure (exit 4) and resumes on re-run', async () => {
    const h = await harness();
    h.api.failOn.add('linkBoardToRepo'); // kill after the board-fields step

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
    expect(partials[0]!.resources.map((event) => event.resource)).toEqual(
      expect.arrayContaining(['repo', 'project_v2', 'project_field'])
    );

    // re-run with the same bundle: completes the remainder without disturbing
    // existing artifacts — the two event trails together cover every resource
    // exactly once as created-or-skipped
    h.api.failOn.clear();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    const runs = readEventRuns(h.foundryVar);
    expect(runs.length).toBe(2);
    const final = runs.find((run) => run.finished)!;
    const repoEvent = final.resources.find((event) => event.resource === 'repo')!;
    expect(repoEvent.created_or_skipped).toBe('skipped');
    // the fields created in run 1 are skipped in run 2
    const fieldEvents = final.resources.filter((event) => event.resource === 'project_field');
    expect(fieldEvents.every((event) => event.created_or_skipped === 'skipped')).toBe(true);
    // exactly one repo creation across both runs
    expect(h.api.calls.filter((call) => call.startsWith('createUserRepo')).length).toBe(1);
    // run 1 died before the register stage, so the resumed run performs the
    // one registration — exactly one project row either way (idempotency of a
    // repeated registration is covered in registry.test.ts)
    expect(outcome.registry?.project).toBe('created');
    const projectRows = await h.registryDb.query(`SELECT id FROM project WHERE project = 'throwaway'`);
    expect(projectRows.rows).toHaveLength(1);
  });

  it('exits 5 naming the agent when a clone probe fails', async () => {
    const h = await harness();
    h.git.probeResult = false;
    let caught: FoundryError | null = null;
    try {
      await runBootstrapPipeline(h.options, h.deps);
    } catch (error) {
      caught = error as FoundryError;
    }
    expect(caught!.exitCode).toBe(EXIT.LOCAL);
    expect(caught!.message).toMatch(/agent "heimdall"/);
    // the event trail already carries the failed probe and the run_failed mark
    const partial = readEventRuns(h.foundryVar)[0]!;
    const clone = partial.resources.find((event) => event.resource === 'clone')!;
    expect(clone.probe_result).toBe('failed');
    expect(partial.failed).toBe(true);
  });

  it('dry-run performs zero GitHub mutations, no registry write, and nothing under the storage path', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline({ ...h.options, dryRun: true }, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    const routes = await h.registryDb.query(`SELECT count(*)::int AS n FROM route`);
    expect(Number(routes.rows[0].n)).toBe(0);
    const mutations = h.api.calls.filter((call) =>
      /^create|^inviteCollaborator|^acceptInvitation|^grantBoard|^updateRuleset|^patchRepo|^linkBoard|^addIssue|^setBoardItem/.test(call)
    );
    expect(mutations).toEqual([]);
    expect(existsSync(join(h.storage, 'throwaway'))).toBe(false);
    // rendered to the scratch path instead
    expect(existsSync(join(h.foundryVar, 'dry-run'))).toBe(true);
  });

  it('preflight failures exit 3 naming the subject, before any mutation', async () => {
    const h = await harness();
    rmSync(join(h.options.env.agent_token_dir, 'sarge.token'));
    let caught: FoundryError | null = null;
    try {
      await runBootstrapPipeline(h.options, h.deps);
    } catch (error) {
      caught = error as FoundryError;
    }
    expect(caught!.exitCode).toBe(EXIT.PREFLIGHT);
    expect(caught!.message).toMatch(/crew agent "sarge" has no token file/);
    expect(h.api.calls.filter((call) => /^create/.test(call))).toEqual([]);
    expect(readEventRuns(h.foundryVar)).toEqual([]);
  });

  it('runs standalone — registry skipped with an event — when the environment has no database', async () => {
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
    h.git.cloned.set(mainDir, 'https://github.com/owner-login/throwaway.git'); // origin set → preflight accepts it as a prior run
    h.git.torn.add(mainDir);
    h.api.refs.set('heads/main', 'sha_prior'); // the remote has history — a torn clone of an empty remote is the empty-remote path
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(existsSync(join(mainDir, 'leftover.txt'))).toBe(false);
    expect(h.git.ops.filter((op) => op.startsWith(`clone(`) && op.endsWith(`→ ${mainDir})`)).length).toBe(1);
    const [run] = readEventRuns(h.foundryVar);
    const repair = run!.resources.find((event) => event.resource === 'clone' && event.name === 'main')!;
    expect(repair.drift).toMatch(/torn clone/);
    expect(existsSync(join(mainDir, 'docs', 'charter.md'))).toBe(true);
  });

  it('never redacts a file path — sanitization matches secret segments, not substrings', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline(h.options, h.deps);
    const [run] = readEventRuns(h.foundryVar);
    const file = run!.resources.find((event) => event.resource === 'file')!;
    expect(file.path).toMatch(/^docs\/|^README|^apps\//);
    expect(file.path).not.toBe('***');
    const raw = readFileSync(outcome.eventsPath!, 'utf8');
    expect(raw).toContain('"path":"docs/charter.md"');
  });

  it('without --conducted creates no issue, no lane, no comment — and still registers routes', async () => {
    const h = await harness();
    const outcome = await runBootstrapPipeline({ ...h.options, conducted: false }, h.deps);
    expect(outcome.exitCode).toBe(EXIT.SUCCESS);
    expect(h.api.issues).toEqual([]);
    expect(h.api.comments).toEqual([]);
    expect(h.api.linkedBranches).toEqual([]);
    const [run] = readEventRuns(h.foundryVar);
    expect(run!.finished).toBe(true);
    const inceptionEvent = run!.resources.find((event) => event.resource === 'inception_task')!;
    expect(inceptionEvent).toMatchObject({ created_or_skipped: 'skipped', skipped_reason: 'not conducted' });
    expect(outcome.registry?.routes_created).toBe(14);
    expect(existsSync(join(h.storage, 'throwaway', 'main', 'docs', 'charter.md'))).toBe(true);
    // rulesets still applied
    expect(run!.resources.filter((event) => event.resource === 'ruleset')).toHaveLength(2);
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
