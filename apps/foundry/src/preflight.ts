import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome, readToken } from './config.js';
import { preflightError } from './errors.js';
import { lintSkeleton } from './render.js';
import type { Bundle, FoundryEnv, ResolvedIdentity } from './types.js';
import type { GitHubApi } from './github/api.js';
import type { TokenIdentity } from './github/octokit.js';

// Preflight per `spec_foundry.md §Preflight`: every check passes before the
// first mutation. Failures exit 3 naming the failing subject.

export interface PreflightDeps {
  authIdentity(token: string): Promise<TokenIdentity>;
  buildApi(ownerToken: string, acceptorTokens: Map<string, string>): GitHubApi;
  originUrl(repoDir: string): string | null;
}

export interface PreflightResult {
  api: GitHubApi;
  ownerToken: string;
  ownerLogin: string;
  ownerNodeId: string;
  ownerPlan: string; // `plan.name`, or `unknown` when the token's scope withholds it
  vork: ResolvedIdentity; // the Vork account
  projectDir: string;
  repoPreExists: boolean;
}

const REQUIRED_CLASSIC_SCOPES = ['repo'];

export const PLAN_GATE_MESSAGE =
  'a free plan takes no branch protection on a private repository: set visibility public, or ruleset none, in the bundle';

function verifyScopes(identity: TokenIdentity, subject: string): void {
  if (identity.scopes === null) return; // fine-grained token — scopes stay unexposed
  for (const scope of REQUIRED_CLASSIC_SCOPES) {
    if (!identity.scopes.includes(scope)) {
      throw preflightError(`${subject} missing required scope "${scope}" (has: ${identity.scopes.join(', ') || 'none'})`);
    }
  }
}

// The plan matrix (`spec_foundry-interface.md §Environment`): one refused
// combination, free + private + standard. An unknown plan passes; a ruleset the
// plan refuses then fails at its own stage, named.
export function planGate(plan: string, visibility: Bundle['visibility'], ruleset: Bundle['ruleset']): void {
  if (plan === 'free' && visibility === 'private' && ruleset === 'standard') {
    throw preflightError(PLAN_GATE_MESSAGE);
  }
}

export async function runPreflight(
  bundle: Bundle,
  env: FoundryEnv,
  storagePath: string,
  deps: PreflightDeps
): Promise<PreflightResult> {
  // owner token — its authenticated login is the owner
  const ownerToken = readToken(env.owner_token_path);
  const owner = await deps.authIdentity(ownerToken).catch((error: unknown) => {
    throw preflightError(`owner token failed to authenticate (${env.owner_token_path}): ${error instanceof Error ? error.message : String(error)}`);
  });
  verifyScopes(owner, 'owner token');
  const ownerPlan = owner.plan ?? 'unknown';
  planGate(ownerPlan, bundle.visibility, bundle.ruleset);

  // Vork token — the Vork account: accepts the invite, holds main/'s bound identity
  const vorkToken = readToken(env.vork_token_path);
  const vorkIdentity = await deps.authIdentity(vorkToken).catch((error: unknown) => {
    throw preflightError(`Vork token failed to authenticate (${env.vork_token_path}): ${error instanceof Error ? error.message : String(error)}`);
  });
  const vork: ResolvedIdentity = { tokenPath: env.vork_token_path, login: vorkIdentity.login, nodeId: vorkIdentity.nodeId };
  const acceptorTokens = new Map<string, string>([[vork.login, vorkToken]]);

  const api = deps.buildApi(ownerToken, acceptorTokens);

  // repo collision: exists under the owner → resume case; foreign owner → abort
  const existingRepo = await api.findRepo(owner.login, bundle.project_key);
  if (existingRepo !== null && existingRepo.ownerLogin !== owner.login) {
    throw preflightError(`repo ${bundle.project_key} exists under foreign owner ${existingRepo.ownerLogin}`);
  }

  // storage path writable; <project_key>/ may pre-exist only as a prior run of
  // the same project — its main/ clone's git origin points at the owner's repo
  const storage = expandHome(storagePath);
  if (!existsSync(storage) || !statSync(storage).isDirectory()) throw preflightError(`project storage path missing: ${storagePath}`);
  try {
    accessSync(storage, constants.W_OK);
  } catch {
    throw preflightError(`project storage path not writable: ${storagePath}`);
  }
  const projectDir = join(storage, bundle.project_key);
  if (existsSync(projectDir)) {
    const origin = deps.originUrl(join(projectDir, 'main'));
    const expected = `https://github.com/${owner.login}/${bundle.project_key}`;
    if (origin === null || (origin !== expected && origin !== `${expected}.git`)) {
      throw preflightError(
        `project folder ${projectDir} pre-exists but is not a prior run of this project (main/ origin: ${origin ?? 'absent'})`
      );
    }
  }

  // startup lint on the skeleton
  lintSkeleton();

  return {
    api,
    ownerToken,
    ownerLogin: owner.login,
    ownerNodeId: owner.nodeId,
    ownerPlan,
    vork,
    projectDir,
    repoPreExists: existingRepo !== null
  };
}
