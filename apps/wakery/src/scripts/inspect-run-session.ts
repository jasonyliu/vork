import { inspectRunSession } from '../adapters/openclaw/run-session.js';

function usage(): never {
  console.error('Usage:');
  console.error('  npm run inspect:run-session -- <sessionKey>');
  process.exit(1);
}

const [sessionKey] = process.argv.slice(2);
if (!sessionKey) usage();

const summary = inspectRunSession(sessionKey);
console.log(JSON.stringify(summary, null, 2));
