import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CREW_AGENTS } from '@vork/data';
import { agentTokenPath, expandHome, readToken } from './config.js';
import { preflightError } from './errors.js';
import { lintSkeleton } from './render.js';
import type { Bundle, FoundryEnv, ResolvedAgent } from './types.js';
import type { GitHubApi } from './github/api.js';
import type { TokenIdentity } from './github/octokit.js';

// Preflight per `spec_foundry.md §Preflight`: no state mutates until every
// check passes. Failures exit 3 naming the failing subject.

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
  crew: ResolvedAgent[]; // main, heimdall, sarge — in that order
  specialists: ResolvedAgent[]; // bundle order
  agents: ResolvedAgent[]; // crew ∪ specialists
  grantLogins: string[]; // deduped over crew ∪ specialists
  readWebhookSecret: () => string;
  projectDir: string;
  repoPreExists: boolean;
}

const REQUIRED_CLASSIC_SCOPES = ['repo', 'project'];

function verifyScopes(identity: TokenIdentity, subject: string): void {
  if (identity.scopes === null) return; // fine-grained PAT — scopes not exposed
  for (const scope of REQUIRED_CLASSIC_SCOPES) {
    if (!identity.scopes.includes(scope)) {
      throw preflightError(`${subject} missing required scope "${scope}" (has: ${identity.scopes.join(', ') || 'none'})`);
    }
  }
}

export async function runPreflight(
  bundle: Bundle,
  env: FoundryEnv,
  storagePath: string,
  deps: PreflightDeps
): Promise<PreflightResult> {
  // owner PAT — its authenticated login is the owner
  const ownerToken = readToken(env.owner_token_path);
  const owner = await deps.authIdentity(ownerToken).catch((error: unknown) => {
    throw preflightError(`owner token failed to authenticate (${env.owner_token_path}): ${error instanceof Error ? error.message : String(error)}`);
  });
  verifyScopes(owner, 'owner token');

  // crew + specialists — every name resolves to <agent_token_dir>/<name>.token;
  // the returned login is that agent's GitHub identity (work tokens share one
  // account — logins dedupe)
  const acceptorTokens = new Map<string, string>();
  async function resolveAgent(kind: 'crew' | 'specialist', name: string): Promise<ResolvedAgent> {
    const tokenPath = agentTokenPath(env, name);
    if (!existsSync(tokenPath)) throw preflightError(`${kind} agent "${name}" has no token file at ${tokenPath}`);
    const token = readToken(tokenPath);
    const identity = await deps.authIdentity(token).catch((error: unknown) => {
      throw preflightError(`${kind} agent "${name}" token failed to authenticate (${tokenPath}): ${error instanceof Error ? error.message : String(error)}`);
    });
    acceptorTokens.set(identity.login, token);
    return { name, tokenPath, login: identity.login, nodeId: identity.nodeId };
  }
  const crew: ResolvedAgent[] = [];
  for (const name of CREW_AGENTS) crew.push(await resolveAgent('crew', name));
  const specialists: ResolvedAgent[] = [];
  for (const specialist of bundle.specialists) specialists.push(await resolveAgent('specialist', specialist.name));
  const agents = [...crew, ...specialists];
  const grantLogins = [...new Set(agents.map((agent) => agent.login))];

  // webhook target + secret
  let webhookUrl: URL;
  try {
    webhookUrl = new URL(env.webhook_url);
  } catch {
    throw preflightError(`FOUNDRY_WEBHOOK_URL is not a valid URL: ${env.webhook_url}`);
  }
  if (webhookUrl.protocol !== 'https:') throw preflightError(`FOUNDRY_WEBHOOK_URL must be HTTPS: ${env.webhook_url}`);
  const secretPath = expandHome(env.webhook_secret_path);
  if (!existsSync(secretPath) || readFileSync(secretPath, 'utf8').trim() === '') {
    throw preflightError(`webhook secret unreadable or empty: ${env.webhook_secret_path}`);
  }
  // read at use, never persisted
  const readWebhookSecret = () => readFileSync(secretPath, 'utf8').trim();

  const api = deps.buildApi(ownerToken, acceptorTokens);

  // repo collision: exists under the owner → resume case; foreign owner → abort
  const existingRepo = await api.findRepo(owner.login, bundle.project_key);
  if (existingRepo !== null && existingRepo.ownerLogin !== owner.login) {
    throw preflightError(`repo ${bundle.project_key} exists under foreign owner ${existingRepo.ownerLogin}`);
  }
  // board collision: more than one existing title match → abort
  const boards = await api.findBoardsByTitle(owner.login, bundle.project_name);
  if (boards.length > 1) throw preflightError(`board title "${bundle.project_name}" matches ${boards.length} existing boards`);

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

  // startup lint on the committed skeleton
  lintSkeleton();

  return {
    api,
    ownerToken,
    ownerLogin: owner.login,
    ownerNodeId: owner.nodeId,
    crew,
    specialists,
    agents,
    grantLogins,
    readWebhookSecret,
    projectDir,
    repoPreExists: existingRepo !== null
  };
}
