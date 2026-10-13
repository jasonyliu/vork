# resolver

CLI that resolves an operation chain + Project name to per-operation Risk Codes and an aggregate Task Risk Code, against `project_risk_mapping` in the Wakery Postgres DB.

## Where to start

- Operator usage, env vars, exit codes, DB seeding: `specs/apps/resolver/manual.md`
- Architecture, algorithm, lock-in + aggregation rules: `specs/apps/resolver/spec_resolver.md`
- DB schema, JSON envelopes, exit-code table: `specs/apps/resolver/spec_resolver-contracts.md`

## Layout

- `bin/resolver` — CLI entrypoint (tsx, no build step).
- `src/config.ts` — env-driven DB config loader.
- `src/db.ts` — connection + query helpers.
- `src/validate.ts` — stdin parse + input validation.
- `src/resolve.ts` — chain resolution algorithm.
- `src/output.ts` — success / error envelope emission.
- `src/run.ts` — three-stage orchestration (dependency-injected).
- `src/vocabulary.ts` — Action/Subject/Zone primitives, pinned from `SECURITY.md §Classification`.
- `test/` — unit + integration tests.

## Develop

```bash
npm install
npm test
npm run typecheck
```
