import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { inspectRunSession, renderWakeryRunSessionKey } from '../adapters/openclaw/run-session.js';
import { shouldCompleteRunLease } from '../adapters/openclaw/run-lease-reconcile.js';

function usage(): never {
  console.error('Usage:');
  console.error('  npm run reconcile:run-lease -- <wakeId> [--apply]');
  process.exit(1);
}

const [wakeId, ...flags] = process.argv.slice(2);
if (!wakeId) usage();
const apply = flags.includes('--apply');

const config = loadConfig();
const pool = createPool(config);

try {
  const leaseResult = await pool.query(
    `SELECT l.id, l.status, l.route_id, l.wake_id, r.delivery, r.session_key
     FROM wake_route_lease l
     JOIN route r ON r.id = l.route_id
     WHERE l.wake_id = $1`,
    [wakeId]
  );

  if (leaseResult.rowCount === 0) {
    console.log(JSON.stringify({ ok: false, reason: 'lease_not_found', wakeId }, null, 2));
  } else {
    const lease = leaseResult.rows[0] as { id: string; status: string; route_id: string; wake_id: string; delivery: string; session_key: string | null };
    const runSessionKey = lease.delivery === 'run' && lease.session_key ? renderWakeryRunSessionKey(lease.session_key, lease.id) : null;
    const session = runSessionKey ? inspectRunSession(runSessionKey) : { exists: false, userMessage: null, lastAssistantMessage: null, assistantMessageCount: 0 };
    const eligible = lease.delivery === 'run' && lease.status === 'active' && shouldCompleteRunLease(session);

    if (apply && eligible) {
      await pool.query(`UPDATE wake_route_lease SET status='completed', update_time=$2 WHERE id=$1`, [lease.id, Date.now()]);
    }

    console.log(JSON.stringify({
      ok: true,
      apply,
      eligible,
      run_session_key: runSessionKey,
      lease,
      session
    }, null, 2));
  }
} finally {
  await pool.end();
}
