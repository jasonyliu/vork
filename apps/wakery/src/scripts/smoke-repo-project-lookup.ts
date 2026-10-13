import crypto from 'node:crypto';
import { loadConfig } from '../config/env.js';

// Smoke: two signed issue_comment deliveries against a running ingress — one
// for a repository node id the registry tracks (expected: processed), one for
// an unknown id (expected: ignored). The known id is an operator input.
const knownRepoNodeId = process.argv[2];
if (!knownRepoNodeId) {
  console.error('usage: tsx src/scripts/smoke-repo-project-lookup.ts <tracked_repo_node_id>');
  process.exit(1);
}

const config = loadConfig();
const secret = config.WAKERY_GITHUB_WEBHOOK_SECRET;
if (!secret) {
  console.error('WAKERY_GITHUB_WEBHOOK_SECRET_PATH unset or file empty — cannot sign fixture');
  process.exit(2);
}
const url = `http://${config.WAKERY_HTTP_HOST}:${config.WAKERY_HTTP_PORT}/adapters/github/webhook`;

function makePayload(repoNodeId: string) {
  return {
    action: 'created',
    repository: { full_name: 'owner-login/sample_project', node_id: repoNodeId },
    issue: {
      number: 999999,
      title: 'smoke repo-project lookup',
      state: 'open',
      labels: [{ name: 'type:implementation' }],
      assignee: { login: 'worker-login' }
    },
    comment: {
      body: 'Transition\nFrom: Init\nTo: Todo\nActor: owner-login',
      user: { login: 'owner-login' }
    }
  };
}

async function send(label: string, repoNodeId: string) {
  const body = JSON.stringify(makePayload(repoNodeId));
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': `smoke-${label}-${Date.now()}`,
      'x-github-event': 'issue_comment',
      'x-hub-signature-256': signature
    },
    body
  });
  const text = await response.text();
  console.log(`[${label}] repo_id=${repoNodeId} status=${response.status} body=${text}`);
}

await send('positive-known-repo', knownRepoNodeId);
await send('negative-unknown-repo', 'R_unknown000000');
