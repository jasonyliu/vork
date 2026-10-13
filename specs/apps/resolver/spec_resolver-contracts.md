# Resolver — Contracts

## Introduction

This spec defines Resolver v1's data and interface contracts: the `project_risk_mapping` DB schema, the JSON input envelope (stdin), the JSON output envelope (stdout) for both success and error paths, the env-var surface for configuration, and the naming consistency rules across DB columns and JSON fields. The resolution algorithm and CLI process model live in `spec_resolver.md`; the audit-workflow invocation contract lives in `spec_resolver-audit-integration.md`.

## Purpose

Contracts decouple Resolver's surface from its implementation. The DB schema is the durable shape mapping data is seeded into; the JSON envelopes are the wire shapes between Auditor and Resolver. Pinning both — with consistent names across the two surfaces — lets the implementation, the seed-data PR, the audit-integration spec, and any future caller (HTTP wrapper, alternate auditor) build against one fixed contract.

## Scope

### In scope

- `project_risk_mapping` wire-facing column naming — schema owned by `specs/data/spec_database.md §project_risk_mapping`.
- JSON input envelope on stdin: chain, project, primitive-operation field shape (including `seq`).
- JSON output envelope on stdout for the success path: per-primitive-operation `risk_code`, aggregate `task_risk_code`, resolution context, `seq` echo.
- JSON output envelope on stdout for the error path: error class, message, optional diagnostic fields.
- CLI exit-code-to-error-class mapping.
- Environment variable surface for DB connection configuration.
- Naming rules across DB columns and JSON fields.

### Out of scope

- Resolution algorithm, CLI process model, deployment surface — `spec_resolver.md`.
- Mapping data seeding (the actual row values) — Execution stage seed-data PR.
- DB migration script (the SQL to apply the schema) — Execution stage.
- Audit-workflow invocation contract and audit-record output shape — `spec_resolver-audit-integration.md`.
- HTTP API envelope — CLI-only for v1; the JSON shapes here are forward-compatible with an HTTP wrapper but the wrapper is not built.

## Naming Rules

### Cross-surface field-name consistency

Field names are shared across the DB column surface and the JSON envelope surface where the semantic is shared. `action`, `subject`, `zone`, `project`, `risk_code`, and `task_risk_code` carry the same name and meaning on both surfaces. This lets the implementation pass values through without translation and lets the audit record cite the names directly.

### Primitive component naming

The three primitive components from `SECURITY.md §Classification` are referenced by their lowercase names: `action`, `subject`, `zone`. Values are the lowercase primitive names from the policy (e.g. `read`, `file`, `workspace`) — the validator is case-sensitive.

### Risk Code naming

Risk Code values are the literal strings from `SECURITY.md §Risk Codes` — `R100`, `R200`, `R300`, `R999`. Case-sensitive. Resolver never emits `R0` or `R993`–`R998`; those are Auditor-direct per `SECURITY.md §Resolver` and must not appear in the mapping table.

### Time and identity

There are no time fields on the JSON envelopes. The audit record carries the audit-comment timestamp; Resolver itself emits no timestamp. There is no version stamp in the output JSON — mapping data is operational DB content and is not under source-control versioning.

The `project_risk_mapping` table has no `id` surrogate; its identity is the natural key `(project, action, subject, zone)` (`specs/data/spec_database.md §project_risk_mapping`). This avoids both an unused surrogate and a redundant uniqueness constraint.

## Data Entity Contracts

The `project_risk_mapping` schema — columns, the two partial unique indexes, the `risk_code` CHECK, and the FK to the `project` registry — is owned by the project data layer: `specs/data/spec_database.md §project_risk_mapping` (and `§project`). This spec consumes it; the wire contracts below name its columns verbatim per the cross-surface naming rule.

## Wire Contracts

### 1) Input envelope (stdin)

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `project` | string | yes | Project key selecting the overlay partition. Plain text. Matched against `project_risk_mapping.project` literally (it carries the key slug); cells without a matching project row (including a key with no rows at all) resolve against the wildcard partition. |
| `chain` | array | yes | Operation chain — one or more primitive-operation objects. Empty arrays are an input-validation failure. |
| `chain[].seq` | integer | yes | 1-indexed sequence number pinning the primitive operation's position within the chain. Authoritative chain ordering at the document boundary, defensive against array-order normalization through JSONB / serializer / future-transport pipelines. The v1 resolution algorithm does **not** consume `seq` (`max` aggregation is order-independent); the field is recorded for audit-comment rendering, future weighted-aggregation work, and caller-side input/output correlation. Must be unique across the chain and form a contiguous `1..len(chain)` range. |
| `chain[].action` | string | yes | Lowercase Action primitive component per `SECURITY.md §Actions`. |
| `chain[].subject` | string | yes | Lowercase Subject primitive component per `SECURITY.md §Subjects`. |
| `chain[].zone` | string | yes | Lowercase Zone primitive component per `SECURITY.md §Zones`. |

JSON example:

```json
{
  "project": "vork",
  "chain": [
    { "seq": 1, "action": "update", "subject": "file", "zone": "workspace" },
    { "seq": 2, "action": "interpret", "subject": "job", "zone": "workspace" }
  ]
}
```

### 2) Output envelope (stdout, success)

| Field | Type | Notes |
|---|---|---|
| `task_risk_code` | string | Aggregate Task Risk Code (`R100` / `R200` / `R300` / `R999`). Computed per `spec_resolver.md §Procedure Stage 2`. |
| `resolution_context` | string | Either `wildcard` (no primitive matched a project-specific row) or `project:<name>` (at least one primitive resolved from the project's overlay; cells the overlay does not cover fall back to wildcard rows per the partial-overlay rule). |
| `chain` | array | Array of per-primitive-operation resolution results, in the same `seq` order as the input chain. |
| `chain[].seq` | integer | Echoed verbatim from the input — callers correlate output results to input operations via `seq`. |
| `chain[].action` | string | Echoed from input. |
| `chain[].subject` | string | Echoed from input. |
| `chain[].zone` | string | Echoed from input. |
| `chain[].risk_code` | string | Resolved Risk Code for this primitive operation. `R999` when no row matches in the active mapping set. |

JSON example:

```json
{
  "task_risk_code": "R200",
  "resolution_context": "wildcard",
  "chain": [
    { "seq": 1, "action": "update", "subject": "file", "zone": "workspace", "risk_code": "R200" },
    { "seq": 2, "action": "interpret", "subject": "job", "zone": "workspace", "risk_code": "R200" }
  ]
}
```

### 3) Output envelope (stdout, error)

The error path emits a single error object instead of the success envelope above. The audit-integration spec defines how the audit record uses this object.

| Field | Type | Notes |
|---|---|---|
| `error.class` | string | One of the documented error classes (see Exit-Code-to-Error-Class table below). |
| `error.message` | string | Human-readable diagnostic suitable for inclusion in the audit comment. |
| `error.detail` | object | Optional structured payload. Shape depends on the error class — e.g. for `input_validation` carries `{ "field": "chain[0].action", "value": "...", "reason": "not a known Action primitive" }`; for `invalid_mapping_row` carries `{ "project": "...", "action": "...", "subject": "...", "zone": "...", "risk_code": "<unsupported>" }`. |

JSON example:

```json
{
  "error": {
    "class": "input_validation",
    "message": "primitive operation at chain[0] has invalid Action component",
    "detail": { "field": "chain[0].action", "value": "frobnicate", "reason": "not a known Action primitive component" }
  }
}
```

### 4) Exit-Code-to-Error-Class mapping

The Resolver process exits with one of the following codes. Code `0` indicates a successful resolution (which may still yield `task_risk_code = R999`); any non-zero exit indicates a failure to resolve. Each non-zero code maps to one `error.class` value.

| Exit code | `error.class` | Trigger |
|---:|---|---|
| `0` | — | Successful resolution (`task_risk_code ∈ {R100, R200, R300, R999}`). Output is the success envelope. |
| `1` | `input_parse` | Stdin did not parse as JSON. No DB connection opened. Surfaces to the audit record per `SECURITY.md §R994` (Resolver tooling could not produce a result). |
| `2` | `input_validation` | Stdin parsed but failed schema validation (missing field, empty chain, unknown Action / Subject / Zone component value, missing or non-contiguous `seq`). No DB connection opened. Surfaces to the audit record per `SECURITY.md §R994`. |
| `3` | `config` | Required env var unset or password-path file unreadable. Surfaces to the audit record per `SECURITY.md §R994`. |
| `4` | `db_connect` | Postgres connection failed before any query. Surfaces to the audit record per `SECURITY.md §R994`. |
| `5` | `db_query` | Postgres query failed mid-resolution. Partial work is discarded. Surfaces to the audit record per `SECURITY.md §R994`. |
| `6` | `invalid_mapping_row` | A row in the active mapping set carries an unsupported `risk_code` (anything outside `{R100, R200, R300, R999}`). Inbound vocabulary mismatch — surfaces to the audit record per `SECURITY.md §R998`. |
| `7` | `internal` | Uncaught exception. The error message carries the exception class and message; details may be opaque. Surfaces to the audit record per `SECURITY.md §R994`. |

## Invariants

- The `project_risk_mapping.risk_code` column carries only `R100`, `R200`, `R300`, or `R999`. Other values are an inbound vocabulary mismatch and trigger exit code `6` at lookup time.
- The wildcard partition (`project IS NULL`) and the per-project partition (`project = <key>`) are mutually exclusive at the row level. A given `(action, subject, zone)` tuple may have at most one wildcard row and at most one row per project.
- JSON field names and DB column names match where the semantic is shared (`action`, `subject`, `zone`, `project`, `risk_code`, `task_risk_code`).
- The input envelope's `chain[].seq` values are 1-indexed, unique across the chain, and form a contiguous `1..len(chain)` range. The v1 algorithm does not consume `seq`; validators check it; the output echoes it verbatim so callers can correlate output operations to input operations.
- No primary-key value carries leading or trailing whitespace; the validator rejects malformed primitive operations at input parse time.
- The output JSON envelope on the success path carries no time field and no version stamp. The audit record records its own timestamp per `SECURITY.md §Risk Codes`.
- The output JSON envelope on the error path always carries `error.class` and `error.message`; `error.detail` is optional and shape-varied per class.
- Resolver opens and closes the DB connection within one invocation. No connection pool persists between invocations.

## Deliverables

This spec governs the contracts of:

- The `project_risk_mapping` table — created by an additive DB migration in the Execution stage (the migration script is governed by that stage's task, not this spec).
- The Resolver input / output JSON envelopes — consumed by the implementation (`main/apps/resolver/`) and by the audit-integration layer per `spec_resolver-audit-integration.md`.
- The `RESOLVER_DATABASE_*` env-var surface — consumed by the implementation's config loader.
- The exit-code-to-error-class mapping — consumed by the audit-integration layer when translating Resolver failures into audit-record outputs.

The mapping data seed values (wildcard rows + project-specific rows) are governed by the seed-data PR in the Execution stage, sourced from `research_20260527_resolver-survey/research.md`.

## Verification

The contracts are judged satisfied when:

- The `project_risk_mapping` table exists per `specs/data/spec_database.md §project_risk_mapping`, with both partial unique indexes in place.
- A `risk_code` value outside `{R100, R200, R300, R999}` cannot be inserted (DB CHECK per `specs/data/spec_database.md §project_risk_mapping`).
- Resolver's success-path output JSON matches the success envelope shape documented above for every successful invocation, including the `resolution_context` field.
- Resolver's error-path output JSON matches the error envelope shape and carries an `error.class` value that maps one-to-one with the process exit code per the table above.
- Field names `action`, `subject`, `zone`, `project`, `risk_code`, `task_risk_code` appear consistently on both the DB column surface and the JSON envelope surface — no semantic-equivalent renames.
- Input envelope `chain[].seq` values are validated as a contiguous 1-indexed range; output envelope echoes each `seq` verbatim.
- Resolver loads DB config from `RESOLVER_DATABASE_*` env vars at startup; a missing required env var aborts Resolver with exit code `3` and the `config` error envelope.
- The migration governed by the Execution stage applies cleanly on a fresh test DB and on a Wakery v2 smoke copy.

## References

- `docs/research/research_20260527_resolver-survey/research.md` — the empirical wildcard set + project overlay candidates; the rows this spec's table will hold once seeded.
- `specs/apps/resolver/prd_resolver.md` — product requirements; the contracts here implement the surface contracts the PRD requires.
- `specs/apps/resolver/spec_resolver.md` — architecture; defines what algorithm reads this table and produces these envelopes.
- `specs/apps/resolver/spec_resolver-audit-integration.md` — defines how the audit record consumes Resolver's success and error envelopes, including the symmetric vocabulary-mismatch (`R998`) handling and the Resolver-tooling-failure (`R994`) handling.
- `specs/apps/wakery/spec_wakery-contracts.md` — convention reference for table layout, naming rules, ERD, and per-entity tables.
- `docs/policy/SECURITY.md` — `§Classification` (Action / Subject / Zone vocabulary), `§Resolver` (the Resolver-emit / Auditor-direct boundary), `§Risk Codes` (the supported Risk Code set and Auditor's per-code response).
- `docs/policy/PROJECT.md` — `§Specs` (the section shape this document conforms to).
