// Dev fixture: one unsigned issue_comment delivery against a local ingress.
// Every identifier is a neutral fixture value; the signature header is a
// placeholder, so this only exercises a server started without a webhook secret.
const payload = {
  action: 'created',
  repository: { full_name: 'owner-login/sample_project', node_id: 'R_sample' },
  issue: {
    number: 42,
    title: 'Demo wake task',
    state: 'open',
    labels: [{ name: 'type:implementation' }],
    assignee: { login: 'worker-login' }
  },
  comment: {
    body: 'Transition\nFrom: Init\nTo: Todo\nActor: owner-login',
    user: { login: 'owner-login' }
  }
};

const response = await fetch('http://127.0.0.1:4311/adapters/github/webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-github-delivery': `dev-${Date.now()}`,
    'x-github-event': 'issue_comment',
    'x-hub-signature-256': 'dev-fill-real-signature'
  },
  body: JSON.stringify(payload)
});
console.log(await response.text());
