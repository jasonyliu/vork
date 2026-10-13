import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { WakeRepository } from '../db/wake-repository.js';
import { GithubRepoProjectRepository } from '../db/github-repo-project-repository.js';
import { EventWriter } from '../events/writer.js';
import { GitHubTaskRelationsRefresher } from '../adapters/github/task-relations-refresher.js';

const projectId = process.argv[2];
const taskId = process.argv[3];
if (!projectId || !taskId) {
  console.error('usage: manual-refresh-task-relations.ts <projectId> <taskId>');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);
const wakeRepo = new WakeRepository(pool);
const repoProjRepo = new GithubRepoProjectRepository(pool);
const events = new EventWriter(config.WAKERY_EVENT_LOG_DIR);
const refresher = new GitHubTaskRelationsRefresher(config.WAKERY_GITHUB_TOKEN, repoProjRepo, wakeRepo, events);

const result = await refresher.refreshTask(projectId, taskId, 'periodic.stale_refresh', null);
console.log('refreshed:', JSON.stringify(result));
await pool.end();
