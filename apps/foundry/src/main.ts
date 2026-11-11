import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadBundle, validateBundle } from './bundle.js';
import { APP_DIR, expandHome, loadDotenv, loadEnv, readToken } from './config.js';
import { EXIT, FoundryError, localError, preflightError, usageError } from './errors.js';
import { buildGitOps, buildReleaseGit } from './gitops.js';
import { authIdentity, buildGitHubApi, buildReleaseApi } from './github/octokit.js';
import { fixFolderName, milestoneFolderName, openFixRecord, openMilestoneRecord, type FixBase } from './milestones.js';
import { runBootstrapPipeline } from './pipeline.js';
import { formatPublishOutcome, githubCoordinates, parseVersion, runPublish } from './publish.js';
import { formatRegistry, readRegistry } from './registry.js';
import { templateSource } from './skeleton.js';
import type { Bundle } from './types.js';
import { formatVerifyReport, verifyAgainst } from './verify.js';

// CLI entrypoint (`spec_foundry-interface.md §CLI`). Per-run flags override the
// environment. Invoked via `bin/foundry`.

// Foundry var: `apps/foundry/var/` beside the app, or FOUNDRY_VAR
const FOUNDRY_VAR = process.env['FOUNDRY_VAR'] ?? join(APP_DIR, 'var');

interface Flags {
  bundle?: string;
  interactive: boolean;
  dryRun: boolean;
  storagePath?: string;
  verbose: boolean;
  quiet: boolean;
  against?: string;
  project?: string;
  note?: string;
  milestone?: string;
  title?: string;
  version?: string;
  fix?: string;
  base?: string;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { interactive: false, dryRun: false, verbose: false, quiet: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const valued = (name: keyof Flags & string): string => {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw usageError(`flag --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} requires a value`);
      return value;
    };
    switch (arg) {
      case '--bundle': flags.bundle = valued('bundle'); break;
      case '--interactive': flags.interactive = true; break;
      case '--dry-run': flags.dryRun = true; break;
      case '--project-storage-path': flags.storagePath = valued('storagePath'); break;
      case '--verbose': flags.verbose = true; break;
      case '--quiet': flags.quiet = true; break;
      case '--against': flags.against = valued('against'); break;
      case '--project': flags.project = valued('project'); break;
      case '--note': flags.note = valued('note'); break;
      case '--milestone': flags.milestone = valued('milestone'); break;
      case '--title': flags.title = valued('title'); break;
      case '--version': flags.version = valued('version'); break;
      case '--fix': flags.fix = valued('fix'); break;
      case '--base': flags.base = valued('base'); break;
      default: throw usageError(`unknown flag: ${arg}`);
    }
  }
  return flags;
}

// Interactive bundle capture: the mission core; visibility defaults to private,
// ruleset to standard. Needs a terminal: with stdin a pipe or a file the
// prompts never settle, so that case exits 2 and points at --bundle.
async function promptBundle(): Promise<Bundle> {
  if (!process.stdin.isTTY) throw usageError('--interactive needs a terminal; pass --bundle <path> instead');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const raw: Record<string, unknown> = {};
    for (const field of ['project_name', 'project_key', 'mission', 'description', 'scope'] as const) {
      raw[field] = (await rl.question(`${field}: `)).trim();
    }
    const visibility = (await rl.question('visibility [private]: ')).trim();
    if (visibility !== '') raw['visibility'] = visibility;
    const ruleset = (await rl.question('ruleset [standard]: ')).trim();
    if (ruleset !== '') raw['ruleset'] = ruleset;
    return validateBundle(raw);
  } finally {
    rl.close();
  }
}

async function commandBootstrap(flags: Flags): Promise<number> {
  if (flags.bundle !== undefined && flags.interactive) throw usageError('--bundle and --interactive are mutually exclusive');
  if (flags.bundle === undefined && !flags.interactive) throw usageError('bootstrap requires --bundle <path> or --interactive');
  const env = loadEnv();
  let bundle: Bundle;
  if (flags.interactive) {
    bundle = await promptBundle();
    // written beside the run for replay
    const replayPath = join(FOUNDRY_VAR, 'runs', bundle.project_key, `bundle_${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`);
    mkdirSync(dirname(replayPath), { recursive: true });
    writeFileSync(replayPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    process.stderr.write(`bundle written for replay: ${replayPath}\n`);
  } else {
    bundle = loadBundle(flags.bundle!);
  }
  const log = flags.quiet ? () => {} : (message: string) => process.stderr.write(`${message}\n`);
  const outcome = await runBootstrapPipeline(
    {
      bundle,
      env,
      storagePath: flags.storagePath ?? env.project_storage_path,
      dryRun: flags.dryRun
    },
    {
      authIdentity,
      buildApi: (ownerToken, acceptorTokens) => buildGitHubApi({ mainToken: ownerToken, acceptorTokens }),
      originUrl: (repoDir) => buildGitOps().originUrl(repoDir),
      git: buildGitOps(),
      foundryVar: FOUNDRY_VAR,
      log
    }
  );
  if (outcome.eventsPath !== undefined) process.stdout.write(`${outcome.eventsPath}\n`);
  return outcome.exitCode;
}

function commandVerify(flags: Flags): number {
  if (flags.against === undefined) throw usageError('verify requires --against <project-path>');
  if (flags.bundle !== undefined) loadBundle(flags.bundle); // validates; structure checks are bundle-independent
  if (!existsSync(flags.against)) throw usageError(`--against path not found: ${flags.against}`);
  const result = verifyAgainst(flags.against);
  process.stdout.write(`${formatVerifyReport(flags.against, result)}\n`);
  return result.clean ? EXIT.SUCCESS : EXIT.VERIFY_DRIFT;
}

// `foundry kickoff --project <key> (--milestone <slug> | --fix <slug> --base
// <main|dev>) [--title] [--note]`: a milestone record on its draft lane, or a
// fix record on its lane, in main/, committed under the clone's configured
// identity, pushed (`spec_foundry.md §Kickoff`).
async function commandKickoff(flags: Flags): Promise<number> {
  if (flags.project === undefined) throw usageError('kickoff requires --project <project_key>');
  if ((flags.milestone === undefined) === (flags.fix === undefined)) throw usageError('kickoff requires exactly one of --milestone <slug> and --fix <slug>');
  if (flags.milestone !== undefined && flags.base !== undefined) throw usageError('--base applies to --fix alone');
  if (flags.fix !== undefined && flags.base === undefined) throw usageError('--fix requires --base <main|dev>: main for a fix released on its own, dev for one riding the next release');
  if (flags.base !== undefined && flags.base !== 'main' && flags.base !== 'dev') throw usageError(`--base must be main or dev (got "${flags.base}")`);
  const env = loadEnv();
  const now = new Date();
  const slug = (flags.milestone ?? flags.fix)!;
  const folder = flags.milestone !== undefined ? milestoneFolderName(now, slug) : fixFolderName(now, slug);
  const title = flags.title ?? slug;
  const vorkToken = readToken(env.vork_token_path);
  await authIdentity(vorkToken).catch((error: unknown) => {
    throw new FoundryError(EXIT.PREFLIGHT, `Vork token failed to authenticate (${env.vork_token_path}): ${error instanceof Error ? error.message : String(error)}`);
  });
  const mainDir = join(expandHome(flags.storagePath ?? env.project_storage_path), flags.project, 'main');
  const result =
    flags.fix === undefined
      ? openMilestoneRecord(buildGitOps(), { mainDir, folder, title, date: now, note: flags.note, template: templateSource('milestone.md'), workToken: vorkToken })
      : openFixRecord(buildGitOps(), { mainDir, folder, title, date: now, note: flags.note, base: flags.base as FixBase, template: templateSource('fix.md'), workToken: vorkToken });
  process.stdout.write(`${result.lane} ${result.recordPath}\n`);
  if (result.existing) process.stderr.write(`${flags.fix === undefined ? 'milestone' : 'fix'} record already exists — reported as found\n`);
  return EXIT.SUCCESS;
}

// `foundry publish --project <key> [--version <version>] [--dry-run]`: the tag
// on a release's publishing merge and its GitHub Release, from the release
// record on origin/main, under the Vork token (`spec_foundry.md §Publish`).
async function commandPublish(flags: Flags): Promise<number> {
  if (flags.project === undefined) throw usageError('publish requires --project <project_key>');
  if (flags.version !== undefined && parseVersion(flags.version) === null) {
    throw usageError(`--version must read v<YYYY.MM.DD> or v<YYYY.MM.DD>.r<n> with n ≥ 2 (got "${flags.version}")`);
  }
  const env = loadEnv();
  const vorkToken = readToken(env.vork_token_path);
  await authIdentity(vorkToken).catch((error: unknown) => {
    throw new FoundryError(EXIT.PREFLIGHT, `Vork token failed to authenticate (${env.vork_token_path}): ${error instanceof Error ? error.message : String(error)}`);
  });
  const mainDir = join(expandHome(flags.storagePath ?? env.project_storage_path), flags.project, 'main');
  if (!existsSync(join(mainDir, '.git'))) throw localError(`main/ clone missing at ${mainDir}`);
  const origin = buildGitOps().originUrl(mainDir);
  const coordinates = origin === null ? null : githubCoordinates(origin);
  if (coordinates === null) throw preflightError(`the origin of ${mainDir} is no GitHub repository over https: ${origin ?? 'none'}`);
  const outcome = await runPublish(buildReleaseGit(), buildReleaseApi(vorkToken), {
    mainDir,
    owner: coordinates.owner,
    repo: coordinates.repo,
    version: flags.version,
    dryRun: flags.dryRun,
    token: vorkToken
  });
  process.stdout.write(`${formatPublishOutcome(outcome)}\n`);
  return EXIT.SUCCESS;
}

// `foundry list`: the machine's project registry (`spec_foundry.md §List`).
function commandList(): number {
  process.stdout.write(`${formatRegistry(readRegistry(FOUNDRY_VAR))}\n`);
  return EXIT.SUCCESS;
}

async function main(): Promise<number> {
  loadDotenv();
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'bootstrap':
      return commandBootstrap(flags);
    case 'verify':
      return commandVerify(flags);
    case 'kickoff':
      return commandKickoff(flags);
    case 'list':
      return commandList();
    case 'publish':
      return commandPublish(flags);
    case undefined:
      throw usageError('usage: foundry <bootstrap|verify|kickoff|publish|list> [flags]');
    default:
      throw usageError(`unknown command: ${command}`);
  }
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof FoundryError) {
    process.stderr.write(`foundry: ${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write(`foundry: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(EXIT.RUNTIME);
}
