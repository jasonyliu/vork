import { EXIT } from './errors.js';
import { emitError, emitSuccess } from './output.js';
import { defaultDeps, run } from './run.js';

// CLI entrypoint. One-shot per call: read stdin, resolve, write stdout, exit with
// the mapped code. Invoked via `bin/resolver` (tsx, no build step).
const result = await run(defaultDeps);
if ('error' in result.envelope) {
  emitError(result.envelope);
} else {
  emitSuccess(result.envelope);
}
process.exit(result.exitCode ?? EXIT.INTERNAL);
