import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, FoundryError, localError } from './errors.js';
import type { GitOps } from './gitops.js';
import { RunEventLog, sanitize } from './events.js';
import { PLAN_GATE_MESSAGE, runPreflight, type PreflightDeps, type PreflightResult } from './preflight.js';
import { upsertProject, type RegistryOutcome } from './registry.js';
import { renderSkeleton, writeSkeleton } from './render.js';
import { ensureDevBranch, ensureRulesets, runGitHubBootstrap, type BootstrapContext } from './github/bootstrap.js';
import type { Bundle, FoundryEnv } from './types.js';
import type { VariableValues } from './variables.js';

// The bootstrap staged pipeline (`spec_foundry.md §Bootstrap flow`): preflight
// (every check before the first mutation) → GitHub bootstrap → local render +
// clone → scaffold commit + push + dev → rulesets → registry entry. The audit
// trail is the append-only run event log — each act is recorded as it
// completes, so a failed run's trail already covers everything that ran;
// re-running resumes state-based.

export interface PipelineDeps extends PreflightDeps {
  git: GitOps;
  foundryVar: string;
  log(message: string): void;
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
  deps.log(`preflight passed — owner ${preflight.ownerLogin} (plan ${preflight.ownerPlan}), work account ${preflight.work.login}`);

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
    // preflight + render to a scratch path; GitHub, the storage path and the
    // registry stay untouched
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
    visibility: bundle.visibility,
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

  // GitHub bootstrap — repo, labels, grant; resource events stream into the
  // log as each sub-step completes
  const gh = await stage(
    () => runGitHubBootstrap(ctx, log),
    (message) => new FoundryError(EXIT.GITHUB, message)
  );
  values.repo_node_id = gh.repo.nodeId;
  deps.log(`github bootstrap done — repo ${gh.repo.nodeId}`);

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

  // rulesets — both standing branches exist before protection. A refusal the
  // plan gate could not foresee (plan unknown to preflight) is named with its
  // ways out; every other artifact already stands, so a re-run resumes.
  await stage(async () => {
    log.push(...(await ensureRulesets(ctx, env.ruleset)));
    deps.log('rulesets done');
  }, (message) => {
    const hint = bundle.visibility === 'private' && preflight.ownerPlan !== 'pro'
      ? ` — ${PLAN_GATE_MESSAGE}, then re-run: every other artifact is skipped as existing`
      : '';
    return new FoundryError(EXIT.GITHUB, `rulesets failed: ${message}${hint}`);
  });

  // registry entry, last — the project exists in full before it is listed
  const registry = await stage(async () => {
    const outcome = upsertProject(deps.foundryVar, bundle.project_key, {
      name: bundle.project_name,
      owner: preflight.ownerLogin,
      repository: `https://github.com/${preflight.ownerLogin}/${bundle.project_key}`,
      visibility: bundle.visibility,
      ruleset: env.ruleset,
      owner_plan: preflight.ownerPlan,
      path: preflight.projectDir,
      run_id: runId
    }, startedAt.toISOString());
    log.push({ resource: 'registry', path: outcome.path, created_or_updated: outcome.outcome });
    deps.log(`registry: ${outcome.outcome} ${bundle.project_key} in ${outcome.path}`);
    return outcome;
  }, localError);

  log.emit('run_finished', { resources: log.records.length });
  deps.log(log.path);
  return { exitCode: EXIT.SUCCESS, eventsPath: log.path, registry };
}
