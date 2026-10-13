import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { WakeRepository } from '../db/wake-repository.js';

const pool = createPool(loadConfig());
const wakeRepo = new WakeRepository(pool);
const candidates = await wakeRepo.findSelectionCandidates(0);
console.log('selection candidates:', candidates.map((w) => ({ id: w.id, task_id: w.task_id, status: w.status, wake_attempts: w.wake_attempts })));
await pool.end();
