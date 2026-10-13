import type { ErrorEnvelope, SuccessEnvelope } from './types.js';

// Stage 3 — emit the resolution result. Both the success and error envelopes are
// written to stdout per `spec_resolver-contracts.md §Wire Contracts`; the process
// exit code (not the stream) signals success vs failure.
export function emitSuccess(envelope: SuccessEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export function emitError(envelope: ErrorEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
