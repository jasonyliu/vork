// Exit-code surface per `spec_foundry-interface.md §CLI`. Code 0 is success;
// 6 is publish refused and 7 verify-drift (findings, not runtime failures —
// the caller decides).
export const EXIT = {
  SUCCESS: 0,
  RUNTIME: 1,
  USAGE: 2,
  PREFLIGHT: 3,
  GITHUB: 4,
  LOCAL: 5,
  PUBLISH_REFUSED: 6,
  VERIFY_DRIFT: 7
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

// A failure carrying the process exit code and a message naming the failing
// field, check, or path — every error surface in the spec names its subject.
export class FoundryError extends Error {
  readonly exitCode: ExitCode;

  constructor(exitCode: ExitCode, message: string) {
    super(message);
    this.name = 'FoundryError';
    this.exitCode = exitCode;
  }
}

export function usageError(message: string): FoundryError {
  return new FoundryError(EXIT.USAGE, message);
}

export function preflightError(message: string): FoundryError {
  return new FoundryError(EXIT.PREFLIGHT, message);
}

export function githubError(message: string): FoundryError {
  return new FoundryError(EXIT.GITHUB, message);
}

export function refusedError(message: string): FoundryError {
  return new FoundryError(EXIT.PUBLISH_REFUSED, message);
}

export function localError(message: string): FoundryError {
  return new FoundryError(EXIT.LOCAL, message);
}
