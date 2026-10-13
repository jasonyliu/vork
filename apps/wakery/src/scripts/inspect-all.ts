import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const config = loadConfig();
const pool = createPool(config);

try {
  const routes = await pool.query('SELECT id, project_id, task_type, session_key, agent_id, delivery, max_run, status FROM route ORDER BY create_time');
  const agents = await pool.query('SELECT id, github_login, agent_id, agent_name, role, status FROM github_agent ORDER BY create_time');
  const repoProjects = await pool.query('SELECT id, owner_name, repo, repo_id, project_id, project_title, status FROM github_repo_project ORDER BY create_time');
  const wakeCounts = await pool.query(`SELECT status, COUNT(*)::int AS count FROM wake GROUP BY status`);
  const leaseCounts = await pool.query(`SELECT status, COUNT(*)::int AS count FROM wake_route_lease GROUP BY status`);

  console.log(JSON.stringify({
    routes: routes.rows,
    github_agents: agents.rows,
    github_repo_projects: repoProjects.rows,
    wake_counts: wakeCounts.rows,
    lease_counts: leaseCounts.rows
  }, null, 2));
} finally {
  await pool.end();
}
