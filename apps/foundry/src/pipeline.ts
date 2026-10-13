import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CREW } from '@vork/data';
import { EXIT, FoundryError, localError } from './errors.js';
import type { GitOps } from './gitops.js';
import { RunEventLog, sanitize } from './events.js';
import { openRegistryPool, pingRegistry, registerProject } from './registry.js';
import type { RegistryOutcome } from './registry.js';
import type { Queryable as RegistryDb } from '@vork/data';
import type { PreflightDeps, PreflightResult } from './preflight.js';
import { runPreflight } from './preflight.js';
import { renderSkeleton, writeSkeleton } from './render.js';
import { createInceptionTask } from './github/startacts.js';
import { ensureDevBranch, ensureRulesets, runGitHubBootstrap, type BootstrapContext } from './github/bootstrap.js';
import type { Bundle, FoundryEnv, ResolvedAgent } from './types.js';
import type { VariableValues } from './variables.js';

// The bootstrap staged pipeline (`spec_foundry.md §Bootstrap flow`): preflight
// (no mutation before pass) → GitHub bootstrap → register (the platform
// registry rows incl. routes, through foundry's own DB layer) → local render +
// clone → scaffold commit + push + dev → rulesets + Inception Task + lane →
// crew clones. The audit trail is the append-only run event log — each act is
// recorded as it completes, so a failed run's trail already covers everything
// that ran; re-running resumes state-based.

export interface PipelineDeps extends PreflightDeps {
  git: GitOps;
  foundryVar: string;
  log(message: string): void;
  // injectable registry connection (tests substitute pg-mem); default opens a
  // pg pool from the environment's VORK_DATABASE_* section
  openRegistry?: (config: NonNullable<FoundryEnv['database']>) => Promise<{ db: RegistryDb; close(): Promise<unknown> }>;
}

export interface PipelineOptions {
  bundle: Bundle;
  env: FoundryEnv;
  storagePath: string; // per-run flag override already applied
  dryRun: boolean;
  conducted: boolean; // --conducted: create the Inception Stage Task (+ lane, creation comment)
}

export interface PipelineOutcome {
  exitCode: number;
  eventsPath?: string;
  registry?: RegistryOutcome;
}

function utcCompact(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function runBootstrapPipeline(options: PipelineOptions, deps: PipelineDeps): Promise<PipelineOutcome> {
  const { bundle, env } = options;
  const startedAt = new Date();
  const runId = randomUUID();

  const preflight: PreflightResult = await runPreflight(bundle, env, options.storagePath, deps);
  deps.log(`preflight passed — owner ${preflight.ownerLogin}, agents [${preflight.agents.map((agent) => agent.name).join(', ')}], grants [${preflight.grantLogins.join(', ')}]`);

  const values: VariableValues = {
    project_name: bundle.project_name,
    project_key: bundle.project_key,
    mission: bundle.mission,
    description: bundle.description,
    scope: bundle.scope,
    channel: bundle.channel,
    owner_login: preflight.ownerLogin,
    team: preflight.agents.map((agent) => agent.name),
    team_resolved: preflight.agents.map((agent) => ({ name: agent.name, github_login: agent.login, github_node_id: agent.nodeId })),
    utc_now: startedAt.toISOString(),
    utc_now_compact: utcCompact(startedAt),
    run_id: runId
  };

  if (options.dryRun) {
    // preflight + render to a scratch path; no GitHub mutation, no registry
    // write, no final tree
    const scratch = join(deps.foundryVar, 'dry-run', `${bundle.project_key}_${utcCompact(startedAt)}`);
    const written = writeSkeleton(renderSkeleton(values), scratch);
    deps.log(`dry-run: rendered ${written.length} skeleton files to ${scratch}`);
    return { exitCode: EXIT.SUCCESS };
  }

  const log = new RunEventLog(deps.foundryVar, bundle.project_key, runId, utcCompact(startedAt));
  log.emit('run_started', { input_bundle: sanitize(bundle) as object });

  const ctx: BootstrapContext = {
    api: preflight.api,
    ownerLogin: preflight.ownerLogin,
    projectKey: bundle.project_key,
    projectName: bundle.project_name,
    webhookUrl: env.webhook_url,
    readWebhookSecret: preflight.readWebhookSecret,
    grantLogins: preflight.grantLogins
  };

  // a stage failure lands in the event trail, then propagates its exit code
  async function stage<T>(fn: () => Promise<T>, wrap: (message: string) => FoundryError): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const wrapped = error instanceof FoundryError ? error : wrap(error instanceof Error ? error.message : String(error));
      log.emit('run_failed', { message: wrapped.message, exit_code: wrapped.exitCode });
      throw wrapped;
    }
  }

  // GitHub bootstrap — repo, board, fields, link, labels, forms, webhook,
  // grants; resource events stream into the log as each sub-step completes
  const gh = await stage(
    () => runGitHubBootstrap(ctx, log),
    (message) => new FoundryError(EXIT.GITHUB, message)
  );
  values.project_node_id = gh.board.id;
  values.repo_node_id = gh.repo.nodeId;
  deps.log(`github bootstrap done — repo ${gh.repo.nodeId}, board ${gh.board.id}`);

  // register — a `project` row IS the project's creation (spec_database.md
  // §11); written through foundry's own DB layer, idempotently, right after
  // the GitHub coordinates exist so webhook deliveries during later stages
  // already resolve and dispatch. No database in the environment → standalone
  // mode, skipped with an event (the extraction seam).
  let registry: RegistryOutcome | undefined;
  if (env.database !== undefined) {
    const database = env.database;
    registry = await stage(async () => {
      const dbFactory = deps.openRegistry ?? (async () => {
        const pool = openRegistryPool(database);
        return { db: pool, close: () => pool.end() };
      });
      const { db, close } = await dbFactory(database);
      try {
        await pingRegistry(db);
        const outcome = await registerProject(db, {
          projectKey: bundle.project_key,
          projectName: bundle.project_name,
          githubRepoId: gh.repo.nodeId,
          githubOwnerId: gh.repo.ownerNodeId,
          githubOwnerName: preflight.ownerLogin,
          githubRepo: bundle.project_key,
          githubProjectId: gh.board.id,
          githubProjectNumber: gh.board.number,
          githubProjectTitle: gh.board.title,
          agents: preflight.agents,
          specialists: bundle.specialists
        });
        log.push({ resource: 'registry', ...outcome });
        deps.log(`registry: project ${outcome.project} (${outcome.project_id}), mapping ${outcome.mapping}, routes ${outcome.routes_created} created / ${outcome.routes_existing} existing${outcome.routes_drift.length > 0 ? ` / ${outcome.routes_drift.length} drift` : ''}`);
        return outcome;
      } finally {
        await close();
      }
    }, localError);
  } else {
    log.push({ resource: 'registry', project_id: null, project: 'skipped', skipped_reason: 'no VORK_DATABASE_HOST — standalone mode' });
    deps.log('registry: skipped (no VORK_DATABASE_HOST — standalone mode)');
  }

  // local render + clone. The scaffold is the repository's first commit, so
  // on a fresh founding the remote is empty: the clone lands on an unborn
  // branch named by the machine's default, pinned to main here. A prior run
  // interrupted mid-clone leaves main/ with an unresolvable HEAD (origin set,
  // no refs); preflight accepted it as a prior run of this project, so it is
  // repaired here: removed and re-cloned, recorded as drift — its only
  // possible content was foundry's own render.
  const mainDir = join(preflight.projectDir, 'main');
  const remoteUrl = `https://github.com/${preflight.ownerLogin}/${bundle.project_key}.git`;
  const remoteMain = await ctx.api.getRef(preflight.ownerLogin, bundle.project_key, 'heads/main');
  await stage(async () => {
    mkdirSync(preflight.projectDir, { recursive: true });
    if (remoteMain === null) {
      // empty remote: whatever main/ holds is a prior run's unpushed render — re-clone clean
      if (existsSync(mainDir)) {
        rmSync(mainDir, { recursive: true, force: true });
        log.push({ resource: 'clone', name: 'main', path: mainDir, probe_result: 'ok', drift: 'main/ from a run that never pushed — removed and re-cloned' });
      }
      deps.git.clone(remoteUrl, mainDir, preflight.ownerToken);
      deps.git.setUnbornBranch(mainDir, 'main');
    } else if (existsSync(mainDir) && !deps.git.headResolves(mainDir)) {
      rmSync(mainDir, { recursive: true, force: true });
      deps.git.clone(remoteUrl, mainDir, preflight.ownerToken);
      log.push({ resource: 'clone', name: 'main', path: mainDir, probe_result: 'ok', drift: 'torn clone from an interrupted run — removed and re-cloned' });
      deps.log('main/ was a torn clone — re-cloned');
    } else if (!existsSync(mainDir)) {
      deps.git.clone(remoteUrl, mainDir, preflight.ownerToken);
    }
    const written = writeSkeleton(renderSkeleton(values), mainDir);
    log.push(
      ...written.map((file) => ({ resource: 'file' as const, path: file.path, created_or_skipped_or_drift: file.outcome }))
    );
    deps.log(`rendered skeleton — ${written.filter((f) => f.outcome === 'created').length} created, ${written.filter((f) => f.outcome === 'skipped').length} skipped`);
  }, localError);

  // scaffold commit under the owner's identity + push main + create dev, then
  // hand main/ to the AI Lead — from here on it is his working clone
  const aiLead = preflight.crew.find((agent) => agent.name === CREW.ai_lead)!;
  const headSha = await stage(async () => {
    deps.git.setIdentity(mainDir, preflight.ownerLogin, `${preflight.ownerLogin}@${bundle.project_key}.localhost`);
    const sha = deps.git.commitAll(mainDir, 'Foundry-v1: initial project scaffold');
    if (sha !== null) {
      deps.git.push(mainDir, 'main', preflight.ownerToken);
      deps.log(`scaffold commit pushed — ${sha}`);
    }
    const head = sha ?? (await ctx.api.getRef(preflight.ownerLogin, bundle.project_key, 'heads/main'));
    if (head === null) throw localError('main has no head after scaffold — nothing committed and no remote ref');
    log.push(await ensureDevBranch(ctx, head));
    deps.git.setIdentity(mainDir, aiLead.name, `${aiLead.login}@${bundle.project_key}.localhost`);
    return head;
  }, localError);

  // rulesets + (conducted) Inception Task + inception lane. Without
  // --conducted the rendered Charter is the founding record: no issue, no
  // lane, no comment — the Principal proceeds in conversation.
  await stage(async () => {
    log.push(...(await ensureRulesets(ctx, env.ruleset)));
    if (options.conducted) {
      log.push(
        await createInceptionTask({
          api: ctx.api,
          ownerLogin: preflight.ownerLogin,
          aiLeadLogin: aiLead.login,
          projectKey: bundle.project_key,
          projectName: bundle.project_name,
          boardId: gh.board.id,
          statusField: gh.statusField,
          auditField: gh.auditField,
          repoNodeId: gh.repo.nodeId,
          headSha
        })
      );
      deps.log('rulesets + inception task done');
    } else {
      log.push({ resource: 'inception_task', issue_number: null, node_id: null, linked_branch: null, created_or_skipped: 'skipped', skipped_reason: 'not conducted' });
      deps.log('rulesets done; inception task skipped (not conducted)');
    }
  }, (message) => new FoundryError(EXIT.GITHUB, message));

  // crew clones — team/<name>/ for every crew agent but the AI Lead (main/ is
  // his) and every specialist: full-history clone, per-clone identity,
  // ls-remote probe; a probe failure exits 5 naming the agent
  await stage(async () => {
    for (const agent of preflight.agents) {
      if (agent.name === CREW.ai_lead) continue;
      const cloneDir = join(preflight.projectDir, 'team', agent.name);
      if (!existsSync(cloneDir)) {
        deps.git.clone(`https://github.com/${preflight.ownerLogin}/${bundle.project_key}.git`, cloneDir, readTokenFor(agent));
        deps.git.setIdentity(cloneDir, agent.name, `${agent.login}@${bundle.project_key}.localhost`);
      }
      const probeOk = deps.git.probeRemote(cloneDir, readTokenFor(agent));
      log.push({ resource: 'clone', name: agent.name, path: cloneDir, probe_result: probeOk ? 'ok' : 'failed' });
      if (!probeOk) {
        throw localError(`clone probe failed for agent "${agent.name}" — indicates a broken invite acceptance upstream`);
      }
    }
  }, localError);

  log.emit('run_finished', { resources: log.records.length });
  deps.log(log.path);
  return { exitCode: EXIT.SUCCESS, eventsPath: log.path, ...(registry !== undefined ? { registry } : {}) };
}

// Clones authenticate with the agent's own token (resolved and validated at
// preflight; re-read by path here).
function readTokenFor(agent: ResolvedAgent): string {
  try {
    const token = readFileSync(agent.tokenPath, 'utf8').trim();
    if (token === '') throw new Error('empty token');
    return token;
  } catch (error) {
    throw localError(`token became unreadable mid-run: ${agent.tokenPath} (${error instanceof Error ? error.message : String(error)})`);
  }
}
