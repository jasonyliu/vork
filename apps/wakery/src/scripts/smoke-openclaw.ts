// Operator smoke tool: one message through the gateway link, session or run
// delivery, with a smoke-minted lease id as the idempotency key (= runId).
import { loadConfig } from '../config/env.js';
import { GatewayLink } from '../adapters/openclaw/link.js';
import { FileGatewayDeviceIdentityStore } from '../adapters/openclaw/device-auth.js';
import { renderWakeryRunSessionKey } from '../adapters/openclaw/run-session.js';

function usage() {
  console.error('Usage:');
  console.error('  npm run smoke:openclaw -- session <sessionKey> <message>');
  console.error('  npm run smoke:openclaw -- run <sessionKeyTemplate> <message>');
  process.exit(1);
}

const [mode, target, ...messageParts] = process.argv.slice(2);
if (!mode || !target || messageParts.length === 0) usage();
const message = messageParts.join(' ');
const leaseId = `lease_smoke_${Date.now()}`;

const config = loadConfig();
const link = new GatewayLink(config.WAKERY_OPENCLAW_GATEWAY_URL, config.WAKERY_OPENCLAW_GATEWAY_TOKEN, {
  identityStore: new FileGatewayDeviceIdentityStore(config.WAKERY_OPENCLAW_DEVICE_DIR)
});

const connected = new Promise<void>((resolve) => link.onConnected(() => resolve()));
link.start();
await connected;

try {
  if (mode === 'session') {
    const payload = await link.call('chat.send', { sessionKey: target, message, idempotencyKey: leaseId });
    console.log(JSON.stringify({ ok: true, mode, target, leaseId, payload }, null, 2));
  } else if (mode === 'run') {
    const sessionKey = renderWakeryRunSessionKey(target, leaseId);
    const payload = await link.call('agent', { sessionKey, message, idempotencyKey: leaseId, deliver: false });
    console.log(JSON.stringify({ ok: true, mode, sessionKey, leaseId, payload }, null, 2));
  } else {
    usage();
  }
} finally {
  link.stop();
}
