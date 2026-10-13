# Wakery v2 — Consolidated Scope

## Status

**Shipped 2026-05-25.** All five features completed via the wakery-v2 milestone (`docs/milestones/milestone_20260524_wakery-v2/`); release record at `releases/v2026.05.25/release.md` (tag `v2026.05.25`). This document is now the v2 release record — each feature's `§Affected specs (unfolded)` table is the per-feature change log; `§Decided` records the design-time judgment calls; `§Roll-out → Cutover sequence` was executed cleanly. Future wakery work targets the per-feature spec set directly, not this consolidated doc.

## Why v2

Wakery v1 shipped under the project's earlier name (2026-05-13, completed milestone) and ran in production through the project's rename migration (2026-05-21). The post-migration E2E test on `<owner>/vork` (issues #2 and #3) surfaced a coherent set of gaps in v1:

- Agents had no deterministic in-the-moment reminder of their identity, project context, homespace, sync requirement, or transition-comment format. Heimdall miss-fired comment format multiple times and stalled on issue #2 because he couldn't see the project board (collaborator setup gap, addressed separately) and his dispatch payload didn't contain the repo or issue URL.
- Principal-owned tasks dropped entirely at the eligibility check (`responsible owner resolves to principal role`) instead of flowing through Heimdall's existing Principal Fast-Pass for a clean audit trail.
- Wakery had no filter for "is this issue actually a Task?" — relevant because the project monorepo will hold non-Task issues alongside Task issues, and v1's `issue_comment`-fires-on-everything behavior would create noise.
- Probe messages are hardcoded in the probe worker; symmetry with the new template-based wake message is missing.

v2 addresses these as a connected set. None individually is large; together they make wakery operationally ready for day-to-day use.

## Scope

| # | Feature | Affects |
|---|---|---|
| 1 | File-based wake message template loader | new `spec_wakery-wake-message.md`, new `spec_wakery-template-renderer.md`, `spec_wakery-openclaw-adapter.md`, `spec_wakery.md`, `specs/data/spec_database.md`; removes `templates/wake-message.md` |
| 2 | Dispatch payload enrichment | `spec_wakery-contracts.md` (`project_number` column), `spec_wakery-template-renderer.md` (placeholder derivation rules) |
| 3 | Principal-handled drop with dedicated audit-trail event | `spec_wakery-ingress-api.md`, `specs/data/spec_event.md` |
| 4 | Type-label filter at ingest | `spec_wakery-github-adapter.md`, `specs/data/spec_database.md` |
| 5 | Probe message templating | new `spec_wakery-probe-message.md`, `spec_wakery-template-renderer.md`, `spec_wakery-probe-worker.md`, `spec_wakery.md`; retroactive cleanup of `spec_wakery-wake-message.md` |

Out of scope for v2 (deferred or already addressed elsewhere):
- Multi-project routing redesign — v1 model stays
- Replacing the existing GraphQL/REST GitHub access pattern — stays
- Webhook signature contract change — stays (we just consolidated keystore secrets in Phase B)
- Self-hosting acceptance test — covered by the migration retrospective
- Renaming env vars beyond what already shipped post-migration

## Design principles

- **Templates are runtime data, not code.** Operators edit markdown templates without rebuilding wakery. Wakery's code parses + substitutes; never embeds copy.
- **The dispatch payload is the contract.** Every value an agent needs to act deterministically must be present in the wake message. No "the agent should look it up" placeholders.
- **Fail loud on misconfiguration.** Missing template, missing required placeholder, missing DB column → wakery refuses to start (or refuses to render) with a clear diagnostic. Better than emitting a half-rendered message.
- **Don't break v1 contracts in flight.** Existing wake/route/lease tables stay compatible; new fields are additive.
- **Eligibility decisions are events.** Every drop or fast-pass emits an event with the reason. Operators can grep the event log to understand routing behavior.

## Feature 1 — File-based wake message template loader

### What

Wakery v1's `OpenClawAdapter.buildMessage()` and `buildStateInstructions()` carry the wake message text inline. v2 separates the wake message into three artifacts:

- **Content spec** — `spec_wakery-wake-message.md` (new): the human-facing contract describing composition, placeholders, the state-block matrix, and design rationale. This is the source of truth.
- **Machine artifact** — `apps/wakery/templates/wake-message.json` (new): a stripped-down JSON file containing only what the renderer parses. Operators do not read this file; humans read the spec.
- **Renderer module** — `spec_wakery-template-renderer.md` (new): the runtime module that loads the JSON artifact, validates it, substitutes placeholders, and supports hot-reload.

The previous v2 draft placed the template under `specs/apps/wakery/templates/wake-message.md` and parsed markdown sections at runtime. That blurred the spec/runtime boundary and made hot-reload awkward. The decisions in §Decided collapse the design to: rich descriptive spec **plus** machine-only JSON, with templates physically co-located with the app under `apps/wakery/templates/`.

### File location and format

- Template artifacts live under `apps/wakery/templates/` (not `specs/`). Templates are runtime data the app consumes; the spec set is for humans.
- Format is JSON. Chosen for: zero-dep parsing (`JSON.parse`), trivial hot-reload (re-read on file change without module-cache invalidation), and the fact that no human reads the file (the spec carries the human-readable form).
- The schema is defined in `spec_wakery-template-renderer.md §Template artifact format`. Top-level keys: `composition`, `stateBlocks` (keyed by `<actor>/<task_status>/<task_audit>` plus `default`), `commentLengths`.

### Loader logic

Governed by `spec_wakery-template-renderer.md §Procedure`. Summary:
- At startup, load every `*.json` file under `WAKERY_TEMPLATE_DIR` (default `<wakery-source-root>/templates`). Validate. Cache.
- Startup load failure → `wakery.template.load_failed` + non-zero exit. Wakery does not start with a broken template.
- Register an `fs.watch` handle. File changes trigger a 100ms-debounced reload.
- Reload failure → `wakery.template.reload_failed`. Last-good template stays in service; dispatch unaffected.

Hot-reload is **in scope** for v2 (revised from the prior "out of scope" position). The decision flipped because JSON makes re-reading cost-free and the cache-invalidation problem that motivated the original decision does not exist.

### Render logic

Governed by `spec_wakery-template-renderer.md §Procedure Stage 3`. Summary:
- Resolve all placeholder values per `spec_wakery-wake-message.md §Placeholders` (sources defined in Feature 2).
- Select the state block by exact `(actor, task_status, task_audit)` tuple; fall back to `stateBlocks.default` when no exact match exists, emitting `wakery.template.state_fallback_used`.
- Substitute `{{comment_length_<name>}}` references inside the selected block.
- Substitute `{{lane_instructions}}` into the composition.
- Substitute all remaining placeholders.
- Omit lines for null optional placeholders (`task_title`, `task_payload_json`).

### Required vs optional placeholders

Per the §Decided settlement: `task_type` and `task_audit` are required at dispatch. The wakery operating model treats them as MUST-HAVE — a missing value is a data invariant violation, not a renderable case. Feature 2's migration backfills any pre-v2 rows lacking these values; Feature 4's ingest filter guarantees forward-going wakes carry `task_type`. Wakery stays offline during the v2 rollout, so the renderer never sees the partial-state edge case.

Optional: `task_title`, `task_payload_json` only. All other placeholders are required and trigger `wakery.template.render_failed` if null.

### Failure modes

- Startup load failure → `wakery.template.load_failed`, wakery exits non-zero.
- Hot-reload failure → `wakery.template.reload_failed`, last-good stays in service, dispatch unaffected.
- Required placeholder null at render → `wakery.template.render_failed` (renderer); `openclaw.dispatch.failed reason=render_failed` (adapter). Lease released; wake left in queued for re-dispatch; operator intervention expected per `spec_wakery-openclaw-adapter.md §Stage 3a`.
- Unmatched `(actor, status, audit)` → default block used; `wakery.template.state_fallback_used` emitted. Not a failure.

### Code shape

New module `apps/wakery/src/templates/` (advisory layout in `spec_wakery-template-renderer.md §Deliverables`):
- `loader.ts` — file I/O + JSON parse
- `validator.ts` — schema check
- `store.ts` — in-memory loaded + last-good cache, fs.watch lifecycle, debounce
- `substituter.ts` — placeholder substitution
- `renderer.ts` — orchestrator exposing `render()`

`OpenClawAdapter.buildMessage()` shrinks to a single call `renderer.render(wake, route)`.

### Verification

- Unit: malformed JSON artifact rejected at startup with clear diagnostic.
- Unit: valid artifact loads and validates.
- Unit: rendering with a known wake + agent + project fixture produces the expected message string.
- Unit: missing required placeholder triggers `wakery.template.render_failed`.
- Unit: unmatched state-block tuple uses default block + emits fallback event.
- Integration: operator edit to the file is picked up within the debounce window without restart.
- Integration: a real wake dispatch carries the expected outbound message text matching the spec.

### Affected specs (unfolded)

| Spec | Change | Commit |
|---|---|---|
| `spec_wakery-wake-message.md` (new) | Content contract for the wake message — composition, placeholders, state-block matrix, comment-length hints, invariants. Replaces `templates/wake-message.md`. | (this commit) |
| `spec_wakery-template-renderer.md` (new) | Renderer module spec — file location, JSON schema, loader, hot-reload, substitution, failure modes, events. | (this commit) |
| `spec_wakery-openclaw-adapter.md` | `Stage 3 — Build wake message` collapses to a renderer-delegation rule; new `Stage 3a — Handle render failure`; observability and references updated. | (this commit) |
| `spec_wakery.md` | Deliverables list adds the template renderer; references list updated. | (this commit) |
| `specs/data/spec_event.md` | New 5000-series **Template lifecycle** code block: `5001 wakery.template.loaded`, `5002 wakery.template.load_failed`, `5003 wakery.template.reload_failed`, `5004 wakery.template.render_failed`, `5005 wakery.template.state_fallback_used`. | (this commit) |
| `templates/wake-message.md` (removed) | Content moves into `spec_wakery-wake-message.md`; the file is removed because runtime templates relocate to `apps/wakery/templates/`. | (this commit) |

## Feature 2 — Dispatch payload enrichment

### What

The wake message template (Feature 1) introduces placeholders that don't exist in v1's hardcoded message. Wakery v2 must source values for every one, derive what isn't directly stored, and add the one column the placeholder set requires.

The full placeholder source map is now governed by `spec_wakery-wake-message.md §Placeholders`; the per-placeholder derivation algorithm is governed by `spec_wakery-template-renderer.md §Placeholder derivation`. Feature 2's own scope is the schema add, the backfill, and the env-var for storage-path resolution.

### Schema changes

Additive only:

- `github_repo_project.project_number` (integer, NOT NULL after backfill) — the GitHub Project V2 dashboard number that supports the `{{project_url}}` placeholder. Resolved from `project_id` via one GraphQL `node(id: $project_id) { ... on ProjectV2 { number } }` call per row.

Migration sequence (atomic during the v2 cutover offline window):

1. `ALTER TABLE github_repo_project ADD COLUMN project_number INTEGER` (nullable)
2. Run `apps/wakery/src/scripts/backfill-project-number.ts` against all rows
3. `ALTER TABLE github_repo_project ALTER COLUMN project_number SET NOT NULL`

The backfill script lives at `apps/wakery/src/scripts/backfill-project-number.ts` and is run as part of the v2 cutover (see the Deployment section of `docs/milestones/milestone_20260524_wakery-v2/review_2026.05.26.04.00.46.md`). Future inserts into `github_repo_project` are responsible for resolving and writing `project_number` at insert time — the column carries no default.

No new columns on `github_agent` — `agent_id`, `agent_name`, `role`, `github_login` already exist.

No `task_type` backfill on `wake`: the current DB has no wake rows with empty `task_type`, so the MUST-HAVE invariant (§Decided) is already satisfied for existing data. Forward-going wakes carry `task_type` from Feature 4's ingest filter.

### Configuration

One new env var:

- `WAKERY_PROJECT_STORAGE_PATH` — root path under which projects live on disk. Default `<project-storage-path>` (expanded at env-load time). Used in `agent_homespace` derivation.

The previously-named `WAKERY_WAKE_MESSAGE_TEMPLATE_PATH` is retired in favor of the directory-based `WAKERY_TEMPLATE_DIR` introduced in Feature 1.

### Derivation rules

Specified in `spec_wakery-template-renderer.md §Placeholder derivation`. Summary for the four derived placeholders Feature 2 introduces or refines:

- `repo_full_name = owner_name + "/" + repo`
- `project_url = "https://github.com/users/" + owner_name + "/projects/" + project_number` (user-owned projects only; org-owned needs a new `owner_type` column — out of scope for v2)
- `agent_homespace`: `<storage_path>/<repo>/main` for `role = AI Lead`, else `<storage_path>/<repo>/team/<agent_id>`. The renderer assumes the on-disk repo dir name matches the GitHub repo name; a divergence escape hatch is deferred (YAGNI) until divergence first appears.
- `issue_url = "https://github.com/" + repo_full_name + "/issues/" + task_id`

### Verification

- Migration unit: `project_number` populated for the existing `<owner>/vork` row after the backfill script runs; subsequent `SET NOT NULL` succeeds.
- Backfill script unit: a row with NULL `project_number` is resolved to the correct numeric via GraphQL; a row that already has a non-null value is left unchanged (idempotent).
- Renderer unit: `agent_homespace` resolves correctly for `role = AI Lead` (→ `…/main`) and `role = Auditor` (→ `…/team/heimdall`).
- Renderer unit: `project_url` derives correctly for the seed mapping.
- Integration: a real wake dispatch carries the expected substituted message including all derived values matching the spec.

### Affected specs (unfolded)

| Spec | Change | Commit |
|---|---|---|
| `spec_wakery-contracts.md` | Adds `project_number` (integer, NOT NULL after backfill) to the `github_repo_project` ER diagram and table; documents the migration sequence and backfill script reference. "Known mappings" table updated to include the `project_number` column. | (this commit) |
| `spec_wakery-template-renderer.md` | New `§Placeholder derivation` section enumerates derivation algorithms for `repo_full_name`, `project_url`, `agent_homespace`, `issue_url`, `utc_timestamp`, `task_payload_json`, plus the database-lookup rules. Documents the `WAKERY_PROJECT_STORAGE_PATH` env var (already noted under `§Inputs` in Feature 1's commit). | (this commit) |
| `spec_wakery-v2.md` (this file) | Feature 2 section rewritten to reflect the settled decisions (NOT NULL, standalone backfill script, no `task_type` backfill, divergence deferred). `§Decided` extended; `§Roll-out order` rewritten for the single-cutover model. | (this commit) |

## Feature 3 — Principal-handled drop with dedicated audit-trail event

### Why the original framing was wrong

The original v2 draft proposed routing principal-owned wakes to the auditor lane so Heimdall could "fast-pass per his existing rule." Investigation surfaced that this is incorrect:

- Heimdall's Principal Fast-Pass (`SECURITY.md §Principal Fast-Pass`, `heimdall/AGENTS.md §Intake`) is scoped to **`Gated → Approved`** transitions only. There is no fast-pass rule for non-Gated states.
- The wakes currently dropped are non-Gated owner/assignee-responsible states (`Pending:Approved`, `Done:Approved`, `Todo:Revise`, `Progress:Approved`, etc.) where the resolved owner/assignee is the principal. Routing these to Heimdall would land him a wake whose state has no audit transition to make.
- The case the original framing meant to fix — `Todo:Gated` with owner/assignee = principal — already works correctly today: wakery routes to the auditor lane (the responsible actor for `Todo:Gated` is auditor regardless of owner/assignee identity), Heimdall sees the wake, applies fast-pass.

The actual gap is purely **audit trail**: principal-handled drops emit the generic `wake.request.dropped_ineligible` reason today, indistinguishable from genuine policy-violation drops. Operators can't grep cleanly for "what work did the principal handle directly."

### What

Keep dropping principal-handled wakes — the current behavior is correct. But emit a dedicated event `wake.request.principal_handled` so the audit trail is queryable as a distinct outcome.

### Change

Eligibility logic stays the same. The change is in event emission and outcome categorization:

| Case | Before | After |
|---|---|---|
| State-based principal (`Todo:Govern`) | `wake.request.dropped_ineligible reason=responsible actor is principal` | `wake.request.principal_handled reason=state_based` |
| Identity-based principal (e.g., `Pending:Approved` with owner = principal) | `wake.request.dropped_ineligible reason=responsible owner resolves to principal role` | `wake.request.principal_handled reason=identity_based` |

Both cases continue to: (a) not store a wake row, (b) not dispatch any message, (c) emit a structured event with the lifecycle, audit, resolved actor identity, and disambiguating reason.

Heimdall policy is unchanged. His `Todo:Gated` fast-pass rule is the only fast-pass surface and was never in scope for this feature.

### Events

- Existing `wake.request.dropped_ineligible reason=responsible_owner_resolves_to_principal_role` is retired (replaced by `wake.request.principal_handled reason=identity_based`).
- Existing `wake.request.dropped_ineligible reason=responsible actor is principal` (for `Todo:Govern`) is retired (replaced by `wake.request.principal_handled reason=state_based`).
- New event code: `1009 wake.request.principal_handled` (info severity). Two reason values: `state_based`, `identity_based`.

### Verification

- A wake for `Pending:Approved` with owner = principal → `wake.request.principal_handled reason=identity_based` emitted; no wake row created; no dispatch.
- A wake for `Todo:Govern` → `wake.request.principal_handled reason=state_based` emitted; no wake row created; no dispatch.
- A wake for `Todo:Gated` with owner = principal → flows through to Heimdall as before; Heimdall applies fast-pass; audit transitions `Gated → Approved`. No `principal_handled` event emitted (this is normal audit flow, not a drop).
- A grep over the event log for `wake.request.principal_handled` returns exactly the principal-handled outcomes, distinct from genuine policy drops.

### Affected specs (unfolded)

| Spec | Change | Commit |
|---|---|---|
| `spec_wakery-ingress-api.md` | Stage 4 eligibility section restructured: principal-handled is its own outcome category (state-based and identity-based), distinct from generic `dropped_ineligible`. The audit-entry note clarifies Heimdall's Principal Fast-Pass is scoped to `Todo:Gated` only. | (this commit) |
| `specs/data/spec_event.md` | New 1009 `wake.request.principal_handled` in the 1000-series with `reason` values `state_based` and `identity_based`. | (this commit) |
| `spec_wakery-v2.md` (this file) | Feature 3 section rewritten under Option A (drop with dedicated event, no Heimdall changes). Scope table row 3 updated. §Decided extended. | (this commit) |

## Feature 4 — Type-label filter at ingest

### Problem

In the single-repo project shape, the same repo holds Task issues alongside non-Task issues (random discussion, PR-comment-as-issue-comment events, bot chatter). Today the GitHub adapter builds a `WakeRequest` for every `issue_comment.created` event on a managed repo, deriving `task_type` from the "first `type:<value>` label" (`spec_wakery-github-adapter.md:232`). Two consequences:

- A non-Task issue produces a `WakeRequest` with an empty or undefined `task_type`. Feature 2 made `task_type` MUST-HAVE; the renderer would drop these as render failures, but only after they reach dispatch. Wasteful and noisy.
- Issues with multiple `type:*` labels produce non-deterministic `task_type` resolution (whichever label GraphQL happened to return first).

### What

Add a Stage 6 to the GitHub adapter: validate the issue's `type:*` labels before building the `WakeRequest`. Exactly one canonical `type:*` label is required.

### Change

After fetching issue state via GraphQL (current Stage 5), and before identity resolution (renumbered Stage 7) and `WakeRequest` construction (renumbered Stage 8):

1. Extract all label names starting with `type:`.
2. Evaluate against the canonical Task-type set, code-pinned in `apps/wakery/src/shared/types.ts` (mirroring `docs/conventions/constants.md §Task types`).

Four outcomes:

| Observed `type:*` labels | Outcome |
|---|---|
| zero | drop with `wake.request.dropped_not_a_task_issue` |
| one, canonical | proceed; `task_type` = the value portion (no `type:` prefix) |
| one, non-canonical | drop with `wake.request.dropped_unknown_task_type`; payload includes the offending label |
| more than one (any combination) | drop with `wake.request.dropped_ambiguous_task_type`; payload includes the full list of `type:*` labels observed |

Ambiguous-drop rationale: picking silently from multiple `type:*` labels is "infer intent from partial data." Operator must remove duplicates for clarity. Applies whether the duplicates are all canonical (e.g. `type:bug` + `type:enhancement`) or mixed (e.g. `type:bug` + `type:foo`).

A non-`type:*` label co-existing with a single canonical `type:*` label does not affect the outcome — only `type:*` labels participate in this filter.

### Constants source

The canonical Task-type set is code-pinned in `apps/wakery/src/shared/types.ts`, per §Decided (2026-05-22). The TS constant mirrors `docs/conventions/constants.md §Task types`. Drift is a code-review concern, not a runtime concern — wakery never parses the markdown file at startup.

### Events

Three new codes in the 1000-series:

- `1010 wake.request.dropped_not_a_task_issue` (info)
- `1011 wake.request.dropped_unknown_task_type` (info)
- `1012 wake.request.dropped_ambiguous_task_type` (info)

All info severity — these are expected outcomes on a project monorepo, not errors.

### Verification

- An issue with no `type:*` label → no `WakeRequest` built; `dropped_not_a_task_issue` emitted with full label list in payload.
- An issue with exactly `type:project_draft` → `WakeRequest` built with `task_type = "project_draft"`.
- An issue with exactly `type:nonsense` → `dropped_unknown_task_type` emitted, label logged.
- An issue with `type:bug` + `type:enhancement` → `dropped_ambiguous_task_type` emitted, both labels logged.
- An issue with `type:coding` + `type:legacy` → `dropped_ambiguous_task_type` emitted, both labels logged.
- An issue with `type:coding` + `priority:high` → `WakeRequest` built with `task_type = "coding"` (only `type:*` labels participate).

### Affected specs (unfolded)

| Spec | Change | Commit |
|---|---|---|
| `spec_wakery-github-adapter.md` | New Stage 6 (validate type label and extract `task_type`). Existing Stages 6 and 7 renumbered to 7 and 8. `task_type` mapping line updated to reflect the filter guarantee. Notes section updated. | (this commit) |
| `specs/data/spec_event.md` | Three new codes in the 1000-series: `1010 dropped_not_a_task_issue`, `1011 dropped_unknown_task_type`, `1012 dropped_ambiguous_task_type`. | (this commit) |
| `spec_wakery-v2.md` (this file) | Feature 4 section rewritten to reflect settled decisions (drop on ambiguity, code-pinned constants list). Scope table row 4 updated. §Decided extended. | (this commit) |

## Feature 5 — Probe message templating

### Problem

`probe-worker.ts` builds the probe message inline (`buildProbeMessage(wake, route, lease)`, ~20 lines of string assembly). The current output is bare — no identity preamble, no homespace reminder, no `git fetch && git rebase` recipe, no transition-comment format pointer. Asymmetric with the wake message Feature 1 just built. The agent receiving a probe gets less context than the agent receiving the initial wake.

### What

Mirror Feature 1's templating machinery for probes. Three artifacts:

- **New content spec** — `spec_wakery-probe-message.md`: composition, placeholders, design rationale.
- **New machine artifact** — `apps/wakery/templates/probe-message.json`: stripped JSON the renderer parses (planned; lands during implementation).
- **Renderer extension** — `renderer.renderProbe(wake, lease)`: shared loader, shared substituter, separate schema. The renderer's hot-reload covers the new file automatically.

The composition shares the wake-message's identity/project/homespace/git-fetch preamble (so every agent dispatch — wake or probe — reminds them of context), then diverges into a probe-specific body asking for status or a transition. No per-state branching, no comment-length hints.

### Retroactive cleanup of `task_title` and `task_payload_json`

While unfolding the probe-message spec, surfaced that the "Optional, line omitted when null" handling for `task_title` and `task_payload_json` in Feature 1 was speculative defense-in-depth that doesn't reflect adapter reality:

- GitHub issues always carry a title; the adapter populates `task_title` from `repository.issue.title`. Always non-null.
- The adapter always builds `task_payload` from issue body + labels + author. `JSON.stringify({...})` always returns a string.

Both are made **required** in this commit. The line-omission rule is dropped from `spec_wakery-wake-message.md` and from `spec_wakery-template-renderer.md`'s Stage 3 render procedure. Net effect: every wake-message and probe-message placeholder is required, no optional handling anywhere. Symmetric with the MUST-HAVE rule we set for `task_type`/`task_audit`.

### Schema split between wake and probe

The two templates have different structural needs, so the validator picks a schema per template name:

- `wake-message.json`: `{ composition, stateBlocks, commentLengths }`
- `probe-message.json`: `{ composition }`

Cleaner than reusing one schema with everything optional — strict validation catches missing required keys per template type.

### Placeholder set

Probe message shares the wake-message identity/project/repo/homespace placeholders (same source map, same derivation rules in `spec_wakery-template-renderer.md §Placeholder derivation`). Three new lease-specific placeholders:

- `{{lease_id}}` — `lease.id`
- `{{lease_age_minutes}}` — `Math.round((Date.now() - lease.create_time) / 60000)`
- `{{probe_attempts}}` — `lease.probe_attempts`

`task_payload_json` is **not** included in the probe — probe is a status check, not a re-dispatch.

### Events

No new event codes. The renderer's existing 5000-series codes (`template.loaded`, `template.load_failed`, `template.reload_failed`, `template.render_failed`) cover the probe template too — the renderer module is generic over template names. Probe worker's existing 4000-series codes (`probe.dispatch.attempted`, `probe.dispatch.failed`, etc.) stay unchanged.

### Render failure handling

A `renderer.renderProbe(...)` throw is caught by the probe worker, which emits `probe.dispatch.failed`, does **not** increment `lease.probe_attempts` (no nudge went out), and does **not** mark the lease completed (per worker invariants). Next scan re-evaluates the candidate; persistent failures are visible in event logs.

### Verification

- The probe-message template loads alongside wake-message at startup.
- A `renderProbe(wake, lease)` call with a known fixture produces the expected probe message string.
- A render with a missing required value throws and emits `wakery.template.render_failed`; the probe worker emits `probe.dispatch.failed` and does not increment `probe_attempts`.
- An operator edit to `probe-message.json` is picked up within the debounce window without restart.
- A real stale-lease probe dispatches a message matching the spec.

### Affected specs (unfolded)

| Spec | Change | Commit |
|---|---|---|
| `spec_wakery-probe-message.md` (new) | Content contract for the probe message — composition, placeholders, invariants. Mirrors the wake-message structure with the probe-specific body and lease-context footer. | (this commit) |
| `spec_wakery-template-renderer.md` | Template artifact format split into per-template schemas (wake-message vs probe-message). Stage 4 (`renderProbe`) procedure added. Placeholder derivation extended with `lease_age_minutes`. Deliverables and references updated. Stage 3 render simplified by dropping the optional-line handling. | (this commit) |
| `spec_wakery-probe-worker.md` | "Probe message requirements" section replaced with "Probe message" delegation rule (calls `renderer.renderProbe(wake, lease)`). New "Render failure handling" subsection. Deliverables and references updated. | (this commit) |
| `spec_wakery-wake-message.md` | Retroactive cleanup: `task_title` and `task_payload_json` flipped from optional to required. Line-omission rule dropped. Notes updated. | (this commit) |
| `spec_wakery.md` | References list adds `spec_wakery-probe-message.md`. | (this commit) |
| `spec_wakery-v2.md` (this file) | Feature 5 section rewritten to reflect machinery sharing with Feature 1, retroactive cleanup, and per-template schemas. Scope table row 5 updated. §Decided extended. | (this commit) |

## Roll-out

Wakery v2 ships as a single atomic release behind one offline window. Wakery stays offline through the full implementation and comes back online only after all five features are merged and the v2 cutover migrations have run. This avoids the risk windows the original incremental plan created (e.g., Features 1+2 live before Feature 4 means renders fail on missing `task_type`).

### Development sequence

The order in which feature commits land in `main` during the offline window. Each feature is a separate commit; ordering reflects implementation dependencies, not deployment milestones.

1. **Feature 1 (Template loader)** + **Feature 2 (Payload enrichment)** — paired. Feature 2 alone doesn't help without the template renderer; Feature 1 needs the placeholder values Feature 2 sources. Schema migration scaffolding for `project_number` lands here (the migration runs at cutover).
2. **Feature 4 (Type-label filter)** — small, independent; protects forward-going wakes from carrying null `task_type`.
3. **Feature 3 (Principal-handled drop)** — small, independent; one-line eligibility refinement plus the new event.
4. **Feature 5 (Probe message templating)** — symmetry pass after Features 1+2 are in place.

Each feature gets its own commit. Spec edits and code changes for a feature land together.

### Cutover sequence

A single online-bringing-back operation after all feature commits have landed:

1. Wakery LaunchAgent stopped (if not already stopped at start of v2 work).
2. SQL migrations applied atomically:
   - `github_repo_project.project_number` added (nullable initial state)
3. Backfill scripts run:
   - `apps/wakery/src/scripts/backfill-project-number.ts` — populates `project_number` for all `github_repo_project` rows
4. NOT NULL tightening:
   - `github_repo_project.project_number SET NOT NULL`
5. Template artifacts placed:
   - `apps/wakery/templates/wake-message.json` mirroring `spec_wakery-wake-message.md`
   - `apps/wakery/templates/probe-message.json` mirroring `spec_wakery-probe-message.md`
6. Smoke verification:
   - Wakery starts and loads both templates without `wakery.template.load_failed`
   - A test webhook fires a wake against a fixture issue; the dispatched message contains every expected substitution
   - A `type:nonsense` issue is dropped at ingest (Feature 4)
7. Wakery LaunchAgent brought online; production traffic resumed.

After cutover, this file is split into per-feature change-log entries (already structured under each feature's `§Affected specs (unfolded)` table) and becomes the v2 release note. The spec is repurposed as the historical record; new wakery work targets the per-feature spec set.

## Success conditions

Wakery v2 is shippable when:
- All five features behave per spec under unit and integration tests.
- Issue lifecycle on `<owner>/vork` flows end-to-end without operator nudge: Owner files Task → Heimdall audits → Assignee accepts/executes → Owner reviews → Assignee completes (and closes the issue).
- Principal-owned Tasks at `Todo:Gated` flow through Heimdall's fast-pass; principal-owned non-Gated states record `wake.request.principal_handled` with the disambiguating reason.
- A `type:bug`-only issue creates a wake; an unlabeled, unknown-type, or ambiguously-labeled issue creates none with the corresponding drop event.
- The dispatch message contains every placeholder the wake message template defines.

## Decided

- **`{{project_title}}` placeholder dropped, use `{{project_name}}` everywhere.** Decision 2026-05-22. The DB column `github_repo_project.project_title` stays; only the duplicate template-placeholder name is collapsed.
- **Auditor-lane `max_run` stays at `1` per project.** Decision 2026-05-22. Single-laned audit workflow while wakery is still maturing; revisit if real throughput pressure emerges.
- **Canonical `type:*` label set is code-pinned in wakery, not parsed from `docs/conventions/constants.md` at runtime.** Decision 2026-05-22. The set lives as a TypeScript constant in `apps/wakery/src/shared/types.ts`. Drift between code and docs is a code-review concern, not a runtime concern. Broader principle (recorded as durable feedback): **apps must never depend on the content of specs/docs at runtime**; runtime needs config files or code constants, never markdown documentation as a data source. The earlier "with consistency check" sub-proposal is dropped because the check would itself parse the docs file — same violation in a quieter form.
- **Template artifacts live under `apps/wakery/templates/`, not `specs/apps/wakery/templates/`.** Decision 2026-05-24. Templates are runtime data the app consumes; the spec set is for humans. The descriptive content (placeholders, state-block matrix, rationale) moves into a new spec `spec_wakery-wake-message.md`. The runtime artifact is a stripped-down JSON file the renderer parses.
- **Template artifact format is JSON.** Decision 2026-05-24. Chosen for: zero-dep parsing, trivial hot-reload (re-read on file change, no module-cache invalidation problem), and the fact that no human reads the file (the spec carries the human-readable form). TypeScript-module and YAML alternatives were evaluated; JSON wins because it unlocks hot-reload essentially for free.
- **Hot-reload is in scope for v2.** Decision 2026-05-24, revising the prior "out of scope, restart required" position. With JSON, hot-reload collapses to `fs.watch` + 100ms debounce + re-read + validate + last-good fallback on failure. The cache-invalidation problem that motivated the original deferral does not exist for JSON.
- **`task_type` and `task_audit` are MUST-HAVE at dispatch.** Decision 2026-05-24. A missing value is a data invariant violation, not a renderable case. Feature 4's ingest filter guarantees forward-going wakes carry `task_type`. The current DB has no wake rows with empty `task_type`, so no backfill is needed. Wakery stays offline during the v2 rollout, so the renderer never sees the partial-state edge case. Only `task_title` and `task_payload_json` remain optional.
- **`github_repo_project.project_number` is NOT NULL after the v2 cutover backfill.** Decision 2026-05-24. Symmetric with the `task_type`/`task_audit` MUST-HAVE rule — invariants enforced at the schema layer fail fast rather than at first dispatch. Migration sequence: `ADD COLUMN nullable` → run backfill script → `ALTER COLUMN SET NOT NULL`.
- **The `project_number` backfill ships as a standalone script.** Decision 2026-05-24. `apps/wakery/src/scripts/backfill-project-number.ts` runs once at the v2 cutover, lives in the v2 release artifacts alongside the SQL migration. Easier to retry, test, and audit than an inline migration call.
- **The `agent_homespace` divergence escape hatch is deferred.** Decision 2026-05-24. YAGNI — no current project has on-disk-dir vs repo-name divergence. The renderer assumes they match. An `on_disk_path` column on `github_repo_project` lands when divergence first appears, not pre-emptively.
- **v2 ships as a single atomic release behind one offline window.** Decision 2026-05-24. Wakery stays offline through the full v2 implementation; it comes back online only after all five features are merged and the v2 cutover migrations have run. The original incremental "each step independently shippable" plan is retired — it created risk windows (e.g., Features 1+2 live before Feature 4 means renders fail on missing `task_type`) that the atomic model avoids. `§Roll-out order` is rewritten as a development sequence + a cutover sequence.
- **Feature 3 ships as Option A (drop with dedicated event), not the original audit-lane routing proposal.** Decision 2026-05-24. Investigation surfaced that Heimdall's Principal Fast-Pass is scoped to `Gated → Approved` only; routing principal-owned wakes for non-Gated states to him is incoherent because those states have no audit transition to make. The actual gap is audit-trail clarity, not Heimdall involvement. Option A keeps the current drop behavior and adds a dedicated `wake.request.principal_handled` event with `state_based` / `identity_based` reasons. Heimdall policy unchanged.
- **Exactly one canonical `type:*` label per Task issue.** Decision 2026-05-24. The type-label filter (Feature 4) drops on ambiguity rather than picking silently — multiple `type:*` labels in any combination (all canonical, all unknown, or mixed) produce `wake.request.dropped_ambiguous_task_type`. Rationale: inferring intent from ambiguous data breeds subtle bugs. Operator hygiene is the cost of clarity. Foundry creates exactly the canonical labels on each new repo so the well-trodden path produces single-canonical issues by construction.
- **All wake-message and probe-message placeholders are required.** Decision 2026-05-24. The earlier "Optional, line omitted when null" handling for `task_title` and `task_payload_json` was speculative defense-in-depth that doesn't reflect adapter reality — both are always populated when the adapter builds a `WakeRequest`. Symmetric with the MUST-HAVE rule for `task_type`/`task_audit`. The renderer no longer has any optional-line handling code path.
- **Per-template JSON schemas.** Decision 2026-05-24. `wake-message.json` and `probe-message.json` have different structural needs (wake has `stateBlocks` + `commentLengths`; probe has just `composition`). The validator picks a schema by template name rather than relaxing one shared schema to accommodate both. Strict validation surfaces missing required keys per template type.
- **Capacity-contention recovery (originally Feature 6) retired from v2.** Decision 2026-05-24. The motivating incident (Heimdall stuck on issue #2, blocking issue #3) was a dev/test-phase artifact, not a design or implementation bug. `max_run = 1` for the auditor lane is the right setting while wakery is maturing; raising it after v2 is in production will shrink contention naturally. Lease auto-expiry and operator manual-release surfaces belong in the future operator-tooling app (current placeholder name: Wake Radar, likely renamed) per the established v1 deferral position — building them in wakery proper duplicates work that has a better home. Direct DB intervention is the acknowledged hack until that tool ships.
- **Issue-close verification on Completed (originally Feature 7) retired from v2.** Decision 2026-05-24. The "close the GitHub issue on `Reviewed → Completed`" requirement is already enforced at three layers: `TASK.md §Surface-aligned` makes it policy law; Feature 1's wake-message `assignee / Reviewed / Approved` state block carries the instruction in every dispatch; per-agent context docs reiterate it. Real-world verification: issues #2 and #3 on `<owner>/vork` were closed automatically by agents on 2026-05-22 immediately after their `Reviewed → Completed` transitions. Wakery shouldn't own a fourth enforcement layer for a concern policy + dispatch instruction + agent discipline already cover. If divergence becomes recurring (the Foundry-Draft 6-issue case noted in `docs/backlog.md` is the only observed instance), the observation belongs in the future operator-tooling app, not wakery. The original v2 spec listed seven features; v2 now ships five.

## References

- `specs/apps/wakery/spec_wakery.md` — v1 top-level spec
- `specs/apps/wakery/prd_wakery.md` — v1 PRD
- `specs/apps/wakery/spec_wakery-github-adapter.md` — github adapter (touched by Feature 4)
- `specs/apps/wakery/spec_wakery-openclaw-adapter.md` — openclaw adapter (touched by Feature 1)
- `specs/apps/wakery/spec_wakery-ingress-api.md` — ingress eligibility (touched by Feature 3)
- `specs/apps/wakery/spec_wakery-probe-worker.md` — probe worker (touched by Feature 5)
- `specs/apps/wakery/spec_wakery-contracts.md` — DB contracts (touched by Feature 2's `project_number` add)
- `specs/apps/wakery/spec_wakery-wake-message.md` — wake-message content contract (new, introduced by Feature 1)
- `specs/apps/wakery/spec_wakery-template-renderer.md` — renderer module spec (new, introduced by Feature 1)
- `apps/wakery/templates/wake-message.json` — runtime artifact rendered at dispatch (new, populated during Feature 1 implementation)
- `apps/wakery/templates/transition-comment.md` — agent-authored comment format (referenced by wake messages)
- `docs/policy/TASK.md` — lifecycle and audit state machine
- `docs/policy/SECURITY.md` — auditor responsibilities + Risk Code mapping
- `docs/conventions/constants.md` — canonical `type:*` label set (consumed by Feature 4)
- the 2026-05-22 migration retrospective research record — surface findings that drove this v2 scope
