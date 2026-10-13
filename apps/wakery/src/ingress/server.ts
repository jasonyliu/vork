import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { EventWriter } from '../events/writer.js';
import { buildServer } from './app.js';
import { log } from '../log.js';

const config = loadConfig();
const pool = createPool(config);
// no DDL at startup (#35 ruling (b)) — migrations are the data module's act
const schemaProbe = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'wake' LIMIT 1`);
if (schemaProbe.rowCount === 0) {
  throw new Error('database schema absent — run `npm run migrate` (as vork_owner) first');
}
const app = buildServer({
  pool,
  eventWriter: new EventWriter(config.WAKERY_EVENT_LOG_DIR),
  githubSecret: config.WAKERY_GITHUB_WEBHOOK_SECRET,
  githubToken: config.WAKERY_GITHUB_TOKEN
});
await app.listen({ host: config.WAKERY_HTTP_HOST, port: config.WAKERY_HTTP_PORT });
log('api', `listening on ${config.WAKERY_HTTP_HOST}:${config.WAKERY_HTTP_PORT}`);
