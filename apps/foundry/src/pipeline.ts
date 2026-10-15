import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, FoundryError, localError } from './errors.js';
import type { GitOps } from './gitops.js';
import { RunEventLog, sanitize } from './events.js';
import { openRegistryPool, pingRegistry, registerProject } from './registry.js';
import type { RegistryOutcome } from './registry.js';
import type { Queryable as RegistryDb } from '@psyphix/data';
import type { PreflightDeps, PreflightResult } from './preflight.js';
import { runPreflight } from './preflight.js';
import { renderSkeleton, writeSkeleton } from './render.js';
import { ensureDevBranch, ensureRulesets, runGitHubBootstrap, type BootstrapContext } from './github/bootstrap.js';
import type { Bundle, FoundryEnv } from './types.js';
import type { VariableValues } from './variables.js';

// The bootstrap staged pipeline (`spec_foundry.md §Bootstrap flow`): preflight
// (every check before the first mutation) → GitHub bootstrap → register (the
// `project` row) → local render + clone → scaffold commit + push + dev →
// rulesets. The audit trail is the append-only run event log — each act is
// recorded as it completes, so a failed run's trail already covers everything
// that ran; re-running resumes state-based.

export interface PipelineDeps extends PreflightDeps {
  git: GitOps;
  foundryVar: string;
  log(message: string): void;
  // injectable registry connection (tests substitute pg-mem); default opens a
  // pg pool from the environment's PSYPHIX_DATABASE_* section
  openRegistry?: (config: NonNullable<FoundryEnv['database']>) => Promise<{ db: RegistryDb; close(): Promise<unknown> }>;
}

export interface PipelineOptions {
  bundle: Bundle;
  env: FoundryEnv;
  storagePath: string; // per-run flag override already applied
  dryRun: boolean;
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
  deps.log(`preflight passed — owner ${preflight.ownerLogin}, work account ${preflight.work.login}`);

  const values: VariableValues = {
    project_name: bundle.project_name,
    project_key: bundle.project_key,
    mission: bundle.mission,
    description: bundle.description,
    scope: bundle.scope,
    owner_login: preflight.ownerLogin,
    utc_now: startedAt.toISOString(),
    utc_now_compact: utcCompact(startedAt),
    run_id: runId
  };

  if (options.dryRun) {
    // preflight + render to a scratch path; GitHub, the registry, and the
    // storage path stay untouched
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
    workLogin: preflight.work.login
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

  // GitHub bootstrap — repo, board, link, labels, grants; resource events
  // stream into the log as each sub-step completes
  const gh = await stage(
    () => runGitHubBootstrap(ctx, log),
    (message) => new FoundryError(EXIT.GITHUB, message)
  );
  values.project_node_id = gh.board.id;
  values.repo_node_id = gh.repo.nodeId;
  deps.log(`github bootstrap done — repo ${gh.repo.nodeId}, board ${gh.board.id}`);

  // register — a `project` row IS the project's creation (spec_database.md
  // §11); written through foundry's own DB layer, idempotently. A missing
  // database in the environment → standalone mode, skipped with an event.
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
        const outcome = await registerProject(db, { projectKey: bundle.project_key, projectName: bundle.project_name });
        log.push({ resource: 'registry', ...outcome });
        deps.log(`registry: project ${outcome.project} (${outcome.project_id})`);
        return outcome;
      } finally {
        await close();
      }
    }, localError);
  } else {
    log.push({ resource: 'registry', project_id: null, project: 'skipped', skipped_reason: 'standalone mode — PSYPHIX_DATABASE_HOST absent' });
    deps.log('registry: skipped (standalone mode — PSYPHIX_DATABASE_HOST absent)');
  }

  // local render + clone + the empty team/. The scaffold is the repository's
  // first commit, so on a fresh founding the remote is empty: the clone lands
  // on an unborn branch named by the machine's default, pinned to main here.
  // A prior run interrupted mid-clone leaves main/ with an unresolvable HEAD;
  // preflight accepted it as a prior run of this project — repaired here:
  // removed and re-cloned, recorded as drift.
  const mainDir = join(preflight.projectDir, 'main');
  const remoteUrl = `https://github.com/${preflight.ownerLogin}/${bundle.project_key}.git`;
  const remoteMain = await ctx.api.getRef(preflight.ownerLogin, bundle.project_key, 'heads/main');
  await stage(async () => {
    mkdirSync(preflight.projectDir, { recursive: true });
    mkdirSync(join(preflight.projectDir, 'team'), { recursive: true, mode: 0o755 });
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
  // hand main/ to the work identity — from here on it is the working clone
  await stage(async () => {
    deps.git.setIdentity(mainDir, preflight.ownerLogin, `${preflight.ownerLogin}@${bundle.project_key}.localhost`);
    const sha = deps.git.commitAll(mainDir, 'Foundry: initial project scaffold');
    if (sha !== null) {
      deps.git.push(mainDir, 'main', preflight.ownerToken);
      deps.log(`scaffold commit pushed — ${sha}`);
    }
    const head = sha ?? (await ctx.api.getRef(preflight.ownerLogin, bundle.project_key, 'heads/main'));
    if (head === null) throw localError('main has no head after scaffold — the render produced zero commits and the remote holds zero refs');
    log.push(await ensureDevBranch(ctx, head));
    deps.git.setIdentity(mainDir, preflight.work.login, `${preflight.work.login}@${bundle.project_key}.localhost`);
    return head;
  }, localError);

  // rulesets, last — both standing branches exist before protection
  await stage(async () => {
    log.push(...(await ensureRulesets(ctx, env.ruleset)));
    deps.log('rulesets done');
  }, (message) => new FoundryError(EXIT.GITHUB, message));

  log.emit('run_finished', { resources: log.records.length });
  deps.log(log.path);
  return { exitCode: EXIT.SUCCESS, eventsPath: log.path, ...(registry !== undefined ? { registry } : {}) };
}
