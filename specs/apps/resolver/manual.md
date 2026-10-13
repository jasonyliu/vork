# Resolver

## Purpose

Resolver is a CLI utility that takes a normalized operation chain (a sequence of primitive operations, each a `(Action, Subject, Zone)` triple) and a Project name and returns the per-primitive-operation Risk Codes plus the aggregate Task Risk Code, drawing from the `project_risk_mapping` table in the project Postgres database (`vork`). Every audit that reaches primitive extraction invokes Resolver per `SECURITY.md §Resolver`; `R0` and `R993`–`R998` remain Auditor-direct and never consult Resolver for the code itself.

The Resolver-emit Risk-Code set is `{R100, R200, R300, R999}`.

## Quick mental model

- JSON in via stdin, JSON out via stdout, one shot per call.
- Looks up each primitive operation against the active mapping set (per cell: project row first, wildcard fallback; cells unmapped in both partitions resolve to `R999`).
- Aggregates per-primitive-operation codes with `max(...)` under `R100 < R200 < R300 < R999`.
- Exits `0` on a successful resolution (which may include `task_risk_code = R999`). Non-zero exits indicate Resolver could not produce a resolution — the audit workflow translates them to `R994` (tooling failure) or `R998` (inbound vocabulary mismatch).

## CLI invocation

The stable Auditor tool path is `~/.local/bin/resolver` (symlink to the active deployment worktree binary). Pipe a JSON document to stdin and read the response from stdout.

```bash
echo '{
  "project": "vork",
  "chain": [
    { "seq": 1, "action": "update", "subject": "file", "zone": "workspace" },
    { "seq": 2, "action": "interpret", "subject": "job", "zone": "workspace" }
  ]
}' | ~/.local/bin/resolver
```

Successful response:

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

Error response (e.g. malformed input):

```json
{
  "error": {
    "class": "input_validation",
    "message": "primitive operation at chain[0] has invalid Action component",
    "detail": { "field": "chain[0].action", "value": "frobnicate", "reason": "not a known Action primitive component" }
  }
}
```

Full envelope shapes are in `spec_resolver-contracts.md §Wire Contracts`.

## Exit codes

| Exit | Meaning | Audit-workflow translation |
|---:|---|---|
| `0` | Successful resolution. `task_risk_code` is in `{R100, R200, R300, R999}`. | Per `task_risk_code` value. |
| `1` | Stdin did not parse as JSON. | `R994` (tooling). |
| `2` | Input failed schema validation (missing field, empty chain, unknown Action / Subject / Zone component, missing or non-contiguous `seq`). | `R994` (tooling). |
| `3` | Required env var unset or password-path file unreadable. | `R994` (tooling). |
| `4` | Postgres connection failed. | `R994` (tooling). |
| `5` | Postgres query failed mid-resolution. | `R994` (tooling). |
| `6` | A mapping row carries an unsupported `risk_code` (inbound vocabulary mismatch). | `R998` (vocabulary). |
| `7` | Uncaught internal exception. | `R994` (tooling). |

Malformed stdout (unparseable JSON regardless of exit code) translates to `R994` per `spec_resolver-audit-integration.md §Procedure Stage 4.g`. A success envelope with a `task_risk_code` outside the audit workflow's recognized set translates to `R998` per §Procedure Stage 4.h (outbound vocabulary mismatch).

## Environment configuration

The `RESOLVER_DATABASE_*` env surface (and the keystore-by-path secret convention) is defined in `specs/data/spec_config.md §Environment contracts §Resolver`. Database name: `vork`.

## DB seeding

The `project_risk_mapping` table is created by the additive Execution-stage migration (no existing Wakery table is altered) and seeded by the Execution-stage seed-data PR. The seed rows come from `docs/research/research_20260527_resolver-survey/research.md`:

- 26 wildcard rows (`project IS NULL`): 17 active R100/R200, 4 destructive R300, 3 designated-R999 (`Delete × Repository × External`, `Revoke × Permission × External`, `Publish × Publication × Public`).
- A small set of project-specific rows (`project = 'vork'`) loosening the four universal-transition cells (`Push × Repository × External`, `Send × Message × External`, `Update × Record × External`, `Read × Record × External`) from R200 → R100, per the research record's overlay candidates. Final overlay set adopted by the seed PR may differ — the research record marks candidates, not mandates.

### Adding or adjusting a row

Mapping rows are operational data, not source-controlled. Add and adjust them via direct DB writes:

```bash
psql "host=$RESOLVER_DATABASE_HOST port=$RESOLVER_DATABASE_PORT user=$RESOLVER_DATABASE_USER dbname=$RESOLVER_DATABASE_NAME"
```

Example: add a project-specific row.

```sql
INSERT INTO project_risk_mapping
  (project, action, subject, zone, risk_code, create_time, update_time)
VALUES
  ('vork', 'push', 'repository', 'external', 'R100',
   (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
   (EXTRACT(EPOCH FROM now()) * 1000)::bigint);
```

Example: change an existing row's risk_code.

```sql
UPDATE project_risk_mapping
   SET risk_code = 'R300',
       update_time = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
 WHERE project IS NULL
   AND action = 'delete'
   AND subject = 'file'
   AND zone = 'workspace';
```

Example: remove a row (drops it from the active mapping set; the next chain hitting that cell will resolve to `R999`).

```sql
DELETE FROM project_risk_mapping
 WHERE project = 'vork'
   AND action = 'submit'
   AND subject = 'endpoint'
   AND zone = 'external';
```

Wildcard rows are addressed via `project IS NULL` (the partial unique index on `(action, subject, zone) WHERE project IS NULL` enforces single-row-per-cell within the wildcard partition).

`risk_code` must be one of `R100`, `R200`, `R300`, `R999`. Inserting anything else fails at the CHECK constraint; a row bypassing it surfaces as exit `6` / `error.class = invalid_mapping_row` on the next lookup that hits the offending row.

### Verifying a row landed

```sql
SELECT project, action, subject, zone, risk_code
  FROM project_risk_mapping
 ORDER BY project NULLS FIRST, action, subject, zone;
```

Run a Resolver invocation to confirm the new row participates in resolution:

```bash
echo '{
  "project": "vork",
  "chain": [{ "seq": 1, "action": "push", "subject": "repository", "zone": "external" }]
}' | ~/.local/bin/resolver
```

## Symlink rotation

`~/.local/bin/resolver` is the operator-stable invocation path. The symlink resolves to the binary in the active release deployment worktree (`products/deployments/v<YYYY.MM.DD>/apps/resolver/bin/resolver`); releases rotate the symlink, not the path.

### One-time setup (first release)

```bash
mkdir -p ~/.local/bin
ln -s "<project-storage-path>/vork/products/deployments/v<YYYY.MM.DD>/apps/resolver/bin/resolver" ~/.local/bin/resolver
```

Ensure `~/.local/bin` is on `PATH` for the operator's shell.

### Rotating to a new release

Use `-snf` so the symlink is replaced atomically:

```bash
ln -snf "<project-storage-path>/vork/products/deployments/v<YYYY.MM.DD>/apps/resolver/bin/resolver" ~/.local/bin/resolver
```

The Auditor tool reference path stays `~/.local/bin/resolver` across releases; downstream callers do not need to know which worktree is active.

### Verifying the rotation

```bash
readlink ~/.local/bin/resolver
~/.local/bin/resolver < /dev/null
# Expects exit 1 with error.class=input_parse — confirms the binary is reachable and self-aborts on empty input.
```

A successful end-to-end smoke uses a known-good chain (any of the sample test issues per `spec_resolver-audit-integration.md §Deliverables`).

## Resolver vs Auditor — what to remember

- **Resolver determines the Risk Code.** The mapping table, the partial-overlay resolution rule, and the aggregation rule are Resolver's authority. Operators add and adjust rows; they do not adjust Resolver's algorithm.
- **The audit workflow determines the audit outcome.** Translation from a Risk Code to `Approved` / `Govern` / `Revise` is the audit workflow's responsibility per `SECURITY.md §Risk Codes`. Operators correcting mapping data do not touch audit comments.
- **`R0` and `R993`–`R998` are Auditor-direct.** Resolver never emits them. If you see one in an audit comment, it came from the audit workflow's gates (`R0`, `R995`, `R996`, `R997`) or from the audit workflow's translation of Resolver-side failure modes (`R994` for tooling failures, `R998` for vocabulary mismatches in either direction).

## See also

- `docs/research/research_20260527_resolver-survey/research.md` — empirical wildcard set + project overlay candidates; the rows the seed PR loads.
- `prd_resolver.md` — product requirements and authority boundary.
- `spec_resolver.md` — architecture, algorithm, process model.
- `spec_resolver-contracts.md` — DB schema, JSON envelopes, env-var surface, exit-code-to-error-class table.
- `spec_resolver-audit-integration.md` — audit-workflow invocation contract and audit-comment recording.
- `docs/policy/SECURITY.md` — `§Resolver`, `§Risk Codes`, `§Classification`.
