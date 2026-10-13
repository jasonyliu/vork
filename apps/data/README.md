# @vork/data

The platform's data-layer module — the code home of `specs/data/` the way each app owns its process specs. It owns what changes the database's shape and canonical rows for every app at once; runtime DML stays app-local (wakery's repositories, resolver's queries).

- **Owns:** structure migrations (`src/migrate.ts`), the canonical seed (`src/seed.ts`), the F6/F9 cutover data acts (`src/cutover-platform-keying.ts`), durable-identity key derivation (`src/ids.ts` — apps re-export), the lifecycle connection contract (`src/env.ts`: `VORK_DATABASE_*`, falling back to `WAKERY_DATABASE_*`), and the shared test surface (`src/testing.ts`: pg-mem pool + project fixture seeder).
- **Consumed as:** an npm `file:` dependency (`"@vork/data": "file:../data"`); tsx runs the TypeScript source directly, no build step. Run `npm install` here once — the module resolves its own `pg` from its own `node_modules`.
- **Run:** `npm run migrate` / `npm run seed` / `npm run cutover [-- --dry-run]` — as `vork_owner` (#35 ruling (b): apps never migrate at startup). Wakery's `npm run migrate`/`seed` delegate here so a deployed `.env` in the app dir keeps working.
- **Specs:** `specs/data/spec_database.md` (transactional), `spec_config.md` (operational), `spec_event.md` (analytical).
- **Test:** `npm test` (vitest + pg-mem; includes the cutover dry-check against a pre-F9 live-schema copy).
