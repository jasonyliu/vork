import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CREW } from '@vork/data';
import { loadBundle, validateBundle } from './bundle.js';
import { agentTokenPath, APP_DIR, expandHome, loadDotenv, loadEnv, readToken } from './config.js';
import { EXIT, FoundryError, usageError } from './errors.js';
import { buildGitOps } from './gitops.js';
import { authIdentity, buildGitHubApi } from './github/octokit.js';
import { kickoff } from './github/startacts.js';
import { milestoneFolderName, openMilestoneRecord } from './milestones.js';
import { readFileSync } from 'node:fs';
import { runBootstrapPipeline } from './pipeline.js';
import type { Bundle } from './types.js';
import { formatVerifyReport, verifyAgainst } from './verify.js';

// CLI entrypoint (`spec_foundry-interface.md §CLI`). Per-run flags override the
// environment; the environment overrides built-in defaults. Invoked via
// `bin/foundry`.

// Foundry var — dev: main/apps/foundry/var; deployed: the active worktree's copy
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
  conducted: boolean;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { interactive: false, dryRun: false, verbose: false, quiet: false, conducted: false };
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
      case '--conducted': flags.conducted = true; break;
      default: throw usageError(`unknown flag: ${arg}`);
    }
  }
  return flags;
}

// Interactive bundle capture: the mission core, then specialists as
// `name:task,task; name:task` (empty for crew only).
async function promptBundle(): Promise<Bundle> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const raw: Record<string, unknown> = {};
    for (const field of ['project_name', 'project_key', 'mission', 'description', 'scope', 'channel'] as const) {
      raw[field] = (await rl.question(`${field}: `)).trim();
    }
    const specialistsRaw = (await rl.question('specialists (name:task,task; name:task — empty for crew only): ')).trim();
    raw['specialists'] = specialistsRaw === ''
      ? []
      : specialistsRaw.split(';').map((entry) => {
          const [name, tasks] = entry.split(':');
          return { name: (name ?? '').trim(), tasks: (tasks ?? '').split(',').map((task) => task.trim()).filter((task) => task !== '') };
        });
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
      dryRun: flags.dryRun,
      conducted: flags.conducted
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
  if (flags.against === undefined) throw usageError('verify requires --against PATH');
  if (flags.bundle !== undefined) loadBundle(flags.bundle); // validates; structure checks are bundle-independent
  if (!existsSync(flags.against)) throw usageError(`--against path not found: ${flags.against}`);
  const result = verifyAgainst(flags.against);
  process.stdout.write(`${formatVerifyReport(flags.against, result)}\n`);
  return result.clean ? EXIT.SUCCESS : EXIT.VERIFY_DRIFT;
}

// `foundry kickoff --project <key> --milestone <slug> [--title] [--note] [--conducted]`.
// Conducted: the Draft Stage Task under the project manager's identity — he
// owns every milestone — assigned to the AI Lead, with its creation comment.
// Unconducted: the milestone record opened on a draft lane in main/, pushed.
async function commandKickoff(flags: Flags): Promise<number> {
  if (flags.project === undefined) throw usageError('kickoff requires --project <project_key>');
  if (flags.milestone === undefined) throw usageError('kickoff requires --milestone <slug>');
  const env = loadEnv();
  const now = new Date();
  const folder = milestoneFolderName(now, flags.milestone);
  const title = flags.title ?? flags.milestone;
  const aiLeadTokenPath = agentTokenPath(env, CREW.ai_lead);
  const aiLeadToken = readToken(aiLeadTokenPath);
  const aiLead = await authIdentity(aiLeadToken).catch((error: unknown) => {
    throw new FoundryError(EXIT.PREFLIGHT, `AI Lead "${CREW.ai_lead}" token failed to authenticate (${aiLeadTokenPath}): ${error instanceof Error ? error.message : String(error)}`);
  });

  if (!flags.conducted) {
    const mainDir = join(expandHome(flags.storagePath ?? env.project_storage_path), flags.project, 'main');
    const template = readFileSync(join(APP_DIR, 'assets', 'skeleton', 'docs', 'conventions', 'templates', 'milestone.md'), 'utf8');
    const result = openMilestoneRecord(buildGitOps(), { mainDir, folder, title, date: now, note: flags.note, template, aiLeadToken });
    process.stdout.write(`${result.lane} ${result.recordPath}\n`);
    if (result.existing) process.stderr.write(`milestone record already exists — reported, not duplicated\n`);
    return EXIT.SUCCESS;
  }

  // the repo owner is the owner token's identity; the act runs under the project manager's
  const owner = await authIdentity(readToken(env.owner_token_path));
  const managerTokenPath = agentTokenPath(env, CREW.project_manager);
  const managerToken = readToken(managerTokenPath);
  await authIdentity(managerToken).catch((error: unknown) => {
    throw new FoundryError(EXIT.PREFLIGHT, `project manager "${CREW.project_manager}" token failed to authenticate (${managerTokenPath}): ${error instanceof Error ? error.message : String(error)}`);
  });
  const api = buildGitHubApi({ mainToken: managerToken, acceptorTokens: new Map() });
  try {
    const result = await kickoff({ api, ownerLogin: owner.login, aiLeadLogin: aiLead.login, projectKey: flags.project, milestoneFolder: folder, title, note: flags.note });
    process.stdout.write(`${result.issueNumber}\n`);
    if (result.existing) process.stderr.write(`open project_draft task already exists — reported, not duplicated\n`);
    return EXIT.SUCCESS;
  } catch (error) {
    if (error instanceof FoundryError) throw error;
    throw new FoundryError(EXIT.GITHUB, error instanceof Error ? error.message : String(error));
  }
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
    case undefined:
      throw usageError('usage: foundry <bootstrap|verify|kickoff> [flags]');
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
