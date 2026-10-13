# Resolver Spec Set

The governing spec set for Resolver — the deterministic Risk-Code resolution CLI utility Auditor invokes for every audit that reaches primitive extraction. Mapping data lives in the project Postgres database (`specs/data/spec_database.md`); the rest of the surface is in the files below.

## Files

- `prd_resolver.md` — product requirements, authority boundary, v1 scope.
- `spec_resolver.md` — architecture, CLI behavior, chain resolution algorithm.
- `spec_resolver-contracts.md` — JSON wire envelopes + exit codes; DB schema lives in `specs/data/spec_database.md`; env surface in `specs/data/spec_config.md §Environment contracts §Resolver`.
- `spec_resolver-audit-integration.md` — audit-workflow → Resolver invocation contract.
- `manual.md` — operator-facing summary (CLI invocation, DB seeding, symlink rotation).

Mapping-data source: `docs/research/research_20260527_resolver-survey/research.md`.

## Where to start

- **Implementing:** `prd_resolver.md` → `spec_resolver.md` → `spec_resolver-contracts.md` → `spec_resolver-audit-integration.md` → `manual.md`.
- **Operating:** `manual.md`. Self-sufficient for routine operations.
