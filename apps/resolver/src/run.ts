import { loadConfig as realLoadConfig, type ResolverConfig } from './config.js';
import { connect as realConnect, createPool, type Queryable } from './db.js';
import { EXIT, type ExitCode, ResolverError } from './errors.js';
import { resolveChain } from './resolve.js';
import type { ErrorEnvelope, SuccessEnvelope } from './types.js';
import { parseInput, validateInput } from './validate.js';

// An opened connection plus its teardown. `close` runs on every exit path.
export interface OpenedClient {
  db: Queryable;
  close: () => Promise<void>;
}

// Injectable dependencies so the full three-stage orchestration — and every one of
// the eight exit-code paths — is unit-testable in-process. `main.ts` wires the real
// implementations via `defaultDeps`.
export interface RunDeps {
  readStdin: () => Promise<string>;
  loadConfig: () => ResolverConfig;
  openClient: (config: ResolverConfig) => Promise<OpenedClient>;
}

export interface RunResult {
  exitCode: ExitCode;
  envelope: SuccessEnvelope | ErrorEnvelope;
}

// Orchestrate the three stages: parse + validate (exit 1/2, no DB opened) → load
// config (exit 3) → open connection (exit 4) → resolve (exit 5/6) → emit (exit 0).
// Any non-ResolverError becomes exit 7 / internal. The connection is always closed.
export async function run(deps: RunDeps): Promise<RunResult> {
  let close: (() => Promise<void>) | undefined;
  try {
    const raw = await deps.readStdin();
    const parsed = parseInput(raw);
    const input = validateInput(parsed);
    const config = deps.loadConfig();
    const opened = await deps.openClient(config);
    close = opened.close;
    const envelope = await resolveChain(opened.db, input);
    return { exitCode: EXIT.SUCCESS, envelope };
  } catch (err) {
    const re =
      err instanceof ResolverError
        ? err
        : new ResolverError(
            EXIT.INTERNAL,
            `internal error: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
          );
    return { exitCode: re.exitCode, envelope: re.toEnvelope() };
  } finally {
    if (close) {
      try {
        await close();
      } catch {
        // Teardown failures never change the resolution outcome.
      }
    }
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// Real dependencies for production invocation.
export const defaultDeps: RunDeps = {
  readStdin,
  loadConfig: realLoadConfig,
  openClient: async (config) => {
    const pool = createPool(config);
    const client = await realConnect(pool); // exit 4 on connection failure
    return {
      db: client,
      close: async () => {
        client.release();
        await pool.end();
      }
    };
  }
};
