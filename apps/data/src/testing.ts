import { newDb } from 'pg-mem';
import { createHash } from 'node:crypto';

// Test-only surface (imported as `@vork/data/testing`): the pg-mem pool the
// data-layer and app suites share, with the platform's SQL surface gaps
// registered, plus the config-plane fixture seeder.

export async function createTestPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: 'current_database', returns: 'text' as any, implementation: () => 'pg_mem' });
  // pg-mem ships no md5(); the cutover's key recompute uses it
  db.public.registerFunction({
    name: 'md5',
    args: ['text' as any],
    returns: 'text' as any,
    implementation: (value: string) => createHash('md5').update(value).digest('hex')
  });
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

// Config-plane FK support (specs/data/spec_database.md §project reference
// planes): route and github_repo_project rows reference project(id), so
// fixtures register their project first.
export async function seedProject(pool: any, id: string, slug: string = id, name: string = slug) {
  await pool.query(
    `INSERT INTO project (id, project, name, status, create_time, update_time)
     VALUES ($1,$2,$3,'active',$4,$4) ON CONFLICT (project) DO NOTHING`,
    [id, slug, name, Date.now()]
  );
}
