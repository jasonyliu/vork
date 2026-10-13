import { loadConfig } from '../config/env.js';
import { fetchIssueState } from '../adapters/github/adapter.js';

const config = loadConfig();
const token = config.WAKERY_GITHUB_TOKEN;
if (!token) {
  console.error('WAKERY_GITHUB_TOKEN not set');
  process.exit(2);
}

// node(id:) addressing — the immutable repository node ID, not owner/repo.
// Both GitHub addresses are operator inputs: the tracked repository's node id
// and the ProjectV2 node id, as held on the project's github_repo_project row.
const issueNumber = Number(process.argv[2] ?? 1);
const repoNodeId = process.argv[3];
const githubProjectId = process.argv[4];
if (!repoNodeId || !githubProjectId) {
  console.error('usage: tsx src/scripts/smoke-issue-fetch.ts <issue_number> <repo_node_id> <github_project_id>');
  process.exit(1);
}

const state = await fetchIssueState(token, repoNodeId, issueNumber, githubProjectId);
console.log(JSON.stringify({ repoNodeId, issueNumber, githubProjectId, state }, null, 2));
