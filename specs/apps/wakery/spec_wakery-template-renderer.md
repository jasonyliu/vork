# Wakery Template Renderer

## Introduction

This spec defines the **template renderer** module that turns a routed wake into the dispatched message text. It is the runtime machinery behind every dispatch template: `spec_wakery-wake-message.md`, `spec_wakery-rewake-message.md`, `spec_wakery-govern-notice-message.md`, `spec_wakery-cap-alert-message.md`, and `spec_wakery-stall-notice-message.md` — the dispatch worker selects among them (`spec_wakery-dispatch-worker.md` Stage 4) and this module renders the selected one.

Wakery v1 carried the wake message inline in `OpenClawAdapter.buildMessage()`. v2 separates the content (governed by `spec_wakery-wake-message.md`) from the rendering machinery (this spec) and the dispatch path (governed by `spec_wakery-openclaw-adapter.md`).

## Purpose

The renderer exists to:
- load template content from a code-friendly file format at startup
- validate that the loaded content satisfies the message's schema
- substitute placeholders at render time, producing the final message string
- pick up operator edits to the template file without a wakery restart
- fail loud on misconfiguration so a half-rendered message never reaches an agent

## Scope

This spec covers:
- the template artifact file format and storage location
- the loader (initial load + hot-reload)
- validation rules
- substitution algorithm
- failure modes and recovery
- events emitted

This spec does not cover:
- the content of the wake message itself (see `spec_wakery-wake-message.md`)
- the OpenClaw dispatch path that consumes the rendered string (see `spec_wakery-openclaw-adapter.md`)

## Definitions

- **Template artifact** — a JSON file under `apps/wakery/templates/<name>.json` containing the renderer's input data.
- **Loaded template** — the in-memory parsed and validated form of the artifact, held by the renderer for the process lifetime.
- **Last-good template** — the most recently loaded template that passed validation. Retained across reloads so a malformed mid-flight edit doesn't break dispatch.
- **Render context** — the per-wake input passed to the renderer: the `wake` row, the selected `route`, and resolved auxiliary data (`github_agent`, `github_repo_project`, derived fields like `agent_homespace`).
- **Placeholder** — a `{{name}}` token in the template content. Substituted at render time.
- **State-block key** — the string `"<actor>/<task_status>/<task_audit>"` used to look up the lane-specific instruction block in the loaded template.

## Upstream / Downstream Context

### Upstream
- the OpenClaw adapter (calls `renderer.render(wake, route)` per dispatch)
- the filesystem (operator edits to the JSON artifact)

### Downstream
- the rendered message string returned to the caller
- JSONL event logs

## Interfaces / Shared Contracts

Depends on:
- `wake`
- `route`
- `github_agent`
- `github_repo_project`
- `event`

Exposes (advisory):
- `renderer.render(wake, route): string` — synchronous; returns the fully-substituted wake message

## Inputs

### Configuration (env)

- `WAKERY_TEMPLATE_DIR` — directory containing the template artifacts. Default: `<wakery-source-root>/templates`. Override is useful for tests; production uses the default.
- `WAKERY_PROJECT_STORAGE_PATH` — root path for `agent_homespace` derivation. Default: `<project-storage-path>`.

The previous v1 draft's `WAKERY_WAKE_MESSAGE_TEMPLATE_PATH` is retired — templates are now resolved by directory + filename, not per-file absolute paths.

### Per-render

- one `wake` row
- one `route` row (with `route.actor` populated)
- the renderer fetches the joined `github_agent` and `github_repo_project` rows itself (the adapter passes wake + route only)

## State Surfaces / Dependencies

- in-memory loaded template (one per template name)
- `fs.watch` handle per template file (for hot-reload)
- JSONL event writer

## Template artifact format

Each template artifact is a JSON object. The schema differs per template name (the wake message carries state blocks and comment-length hints; the notice templates are single-composition). The validator selects the schema by template name.

### `wake-message.json` schema

```jsonc
{
  "composition": "string — the top-level message body, including {{placeholders}} (one of which is {{lane_instructions}})",
  "stateBlocks": {
    "<actor>/<task_status>/<task_audit>": "string — the lane-specific instruction block, may contain {{comment_length_<name>}} references",
    "...": "...",
    "default": "string — fallback when no exact key matches"
  },
  "commentLengths": {
    "<name>": "string — substituted into state blocks via {{comment_length_<name>}}"
  }
}
```

Required keys: `composition`, `stateBlocks`, `commentLengths`. `stateBlocks.default` is required (the fallback must always exist). Other state-block keys are optional in count; the validator does not enforce a fixed list of state keys — `spec_wakery-wake-message.md §State-specific instructions` does.

### Notice-template schemas (`rewake-message.json`, `govern-notice-message.json`, `cap-alert-message.json`, `stall-notice-message.json`)

```jsonc
{
  "composition": "string — the single message body, including {{placeholders}}"
}
```

Required keys: `composition`. No state blocks; no comment-length hints — single-composition templates. Placeholder maps are owned by each template's content spec.

### Encoding notes

- Multi-line strings are stored as JSON strings with `\n` line breaks. The artifacts are not intended for human reading; the human-facing sources of truth are the template content specs.
- The artifact files MUST be valid JSON. Comments and trailing commas are not supported.

## Diagrams

### Renderer lifecycle

```mermaid
flowchart TD
    A[Wakery process start] --> B[Loader: read each .json under WAKERY_TEMPLATE_DIR]
    B -->|parse fail| C[Emit template.load_failed; process exits]
    B -->|parse ok| D[Validator: check required keys + types]
    D -->|invalid| C
    D -->|valid| E[Cache as loaded + last-good]
    E --> F[Register fs.watch handle]
    F --> G[Serve render() calls]
    G --> H[fs.watch fires change event]
    H --> I[Debounce 100ms]
    I --> J[Reload: re-read + parse + validate]
    J -->|fail| K[Emit template.reload_failed; keep last-good]
    J -->|ok| L[Swap loaded; update last-good; emit template.loaded]
    K --> G
    L --> G
```

### Per-render substitution flow

```mermaid
flowchart TD
    A[render(wake, route) called] --> B[Resolve placeholder values: utc, agent, project, homespace, derived URLs, wake/route fields]
    B --> C{Any required value null?}
    C -->|yes| D[Emit template.render_failed; throw to caller]
    C -->|no| E[Select state block by actor/status/audit]
    E -->|no exact match| F[Use default block; emit template.state_fallback_used]
    E -->|exact match| G[Use matched block]
    F --> H[Substitute comment_length_* refs inside the selected block]
    G --> H
    H --> I[Substitute {{lane_instructions}} into composition with the result of step H]
    I --> J[Substitute all other placeholders in composition]
    J --> L[Return final string]
```

## Procedure

### Stage 1 — Initial load

**Objective**
- bring every template artifact under `WAKERY_TEMPLATE_DIR` into validated, in-memory form before the process serves any dispatch.

**Rules**
- For each `*.json` file under `WAKERY_TEMPLATE_DIR`:
  - read the file synchronously
  - parse as JSON
  - validate against the schema in §Template artifact format
  - cache as both the **loaded** and **last-good** template under the file's basename (without extension)
- If any file fails to load or validate, emit `wakery.template.load_failed` with the file path and a structured diagnostic, then terminate the process with a non-zero exit code.
- After all files load, register an `fs.watch` handle on the directory (or per-file; implementation choice).
- Emit `wakery.template.loaded` per file with `phase = startup`.

### Stage 2 — Hot reload

**Objective**
- pick up operator edits without a wakery restart, but never serve a partially-written or invalid template.

**Rules**
- An `fs.watch` `change` event on a template file triggers a **100ms debounced** reload.
- Reload steps mirror Stage 1 for the single affected file: read, parse, validate.
- On reload success:
  - swap the loaded template
  - update the last-good template to the new content
  - emit `wakery.template.loaded` with `phase = reload`
- On reload failure:
  - keep the existing loaded template (which is the last-good)
  - emit `wakery.template.reload_failed` with the file path and structured diagnostic
  - do not retry automatically — the next operator save triggers another `change` event
- SIGHUP-based reload is not supported in v2. File-watch is the only reload mechanism.

### Stage 3 — Render

**Objective**
- produce the dispatched message string from a routed wake and the loaded template.

**Rules**
- Look up the wake-message template by name (`wake-message`).
- Resolve placeholder values per the source map in `spec_wakery-wake-message.md §Placeholders` and the derivation rules in §Placeholder derivation below. The renderer is responsible for fetching `github_agent` and `github_repo_project` rows and computing derived values (`project_url`, `repo_full_name`, `agent_homespace`, `issue_url`).
- If any required placeholder resolves to null, emit `wakery.template.render_failed` with the wake id, the missing placeholder name, and the full context; throw to the caller. The dispatch worker renders **before** creating the lease and parks the wake on render failure (`spec_wakery-dispatch-worker.md` Stage 4) — one un-renderable wake never aborts the dispatch cycle.
- Select the state block by exact `(actor, task_status, task_audit)` key. If no exact match exists, use `stateBlocks.default` and emit `wakery.template.state_fallback_used` with the missing tuple.
- Substitute `{{comment_length_<name>}}` references inside the selected state block before substituting the block into the composition.
- Substitute `{{lane_instructions}}` in the composition with the result of the previous step.
- Substitute all remaining placeholders in the composition. Every placeholder is required — there is no optional-line handling.
- Return the final string. Validate that no `{{`-prefixed token survives substitution; an un-substituted placeholder is a render bug — emit `wakery.template.render_failed` with the surviving token.

### Database lookups

Per render, the renderer fetches:

1. The `github_agent` row joined on the wake's responsible-agent identity (the agent the route's actor maps to for this wake). Used to source `agent_role`, `agent_id`, `agent_name`, `agent_github_login`.
2. The `github_repo_project` row joined on `wake.project_id` (platform key). Used to source `project_name` (from `github_project_title`), `github_project_number`, `github_owner_name`, `github_repo`.

### `repo_full_name`

```
repo_full_name = github_repo_project.github_owner_name + "/" + github_repo_project.github_repo
```

Example: `<owner>/vork`.

### `project_url`

The owner-vs-org URL prefix depends on the owner type. GitHub's user projects live under `/users/<owner>/projects/<number>`; org projects live under `/orgs/<owner>/projects/<number>`. The owner type is not stored on `github_repo_project` currently; for Wakery v2 (a single user-owned project) the renderer uses `/users/`:

```
project_url = "https://github.com/users/" + github_owner_name + "/projects/" + github_project_number
```

If an org-owned project is later added, the renderer needs to distinguish via a new `owner_type` column on `github_repo_project`. Out of scope for v2.

### `agent_homespace`

```
if github_agent.role == "agent" and the agent operates in main/ (the project's lead working clone):
    agent_homespace = <WAKERY_PROJECT_STORAGE_PATH>/<project.project>/main
else:
    agent_homespace = <WAKERY_PROJECT_STORAGE_PATH>/<project.project>/team/<agent_id>
```

Where `<project.project>` is `github_repo_project.repo`. The renderer assumes the on-disk repo directory name matches the GitHub repo name. A divergence config (e.g., an `on_disk_path` column on `github_repo_project`) is **deferred** — no current project has divergence, and adding the column now is YAGNI. Document this as the operative assumption; revisit when divergence first appears.

Tilde expansion of `<project-storage-path>` happens at env-load time, not at render time.

### `issue_url`

```
issue_url = "https://github.com/" + repo_full_name + "/issues/" + wake.task_id
```

### `utc_timestamp`

```
utc_timestamp = new Date().toISOString()
```

ISO-8601 with seconds precision (the default for `Date.prototype.toISOString`), e.g. `2026-05-24T13:00:00.000Z`.

### `task_payload_json`

```
task_payload_json = JSON.stringify(wake.task_payload)
```

`wake.task_payload` is always populated by the upstream adapter (e.g., GitHub adapter sources it from issue body + labels + author). `JSON.stringify` always returns a string.

### Pass-through fields

- Wake-message: `wake_id`, `actor`, `project_id`, `task_id`, `task_type`, `task_status`, `task_audit`, `route_id`, `task_title` — direct column reads from `wake` or `route`. No derivation.

## Invariants

- The renderer never emits a message string containing an un-substituted `{{placeholder}}`.
- Startup load failure terminates the process. Wakery does not start with a broken template.
- Hot-reload failure does not affect dispatch. The last-good template stays in service until a valid replacement is loaded.
- Reload failures emit an event; they do not silently fall back.
- The renderer treats the loaded template as opaque content. It does not execute, transform, or interpret state-block strings beyond placeholder substitution.

## Failure / Recovery

| Failure | Behavior |
|---|---|
| Startup: template file missing | `wakery.template.load_failed`; process exits non-zero. |
| Startup: template file malformed JSON | `wakery.template.load_failed` with parser error position; process exits non-zero. |
| Startup: required key missing (validator) | `wakery.template.load_failed` with the missing key path; process exits non-zero. |
| Hot reload: parse fail or validate fail | `wakery.template.reload_failed`; last-good remains live; dispatch unaffected. |
| Render: required placeholder null | `wakery.template.render_failed`; renderer throws; the dispatch worker parks the wake — render precedes lease creation, so no lease exists to release. |
| Render: state-block fallback used | `wakery.template.state_fallback_used`; render proceeds with the default block. |
| Render: un-substituted token survives | `wakery.template.render_failed`; renderer throws. This is a programmer bug (placeholder not in the source map). |

## Observability

Must emit at minimum:
- `wakery.template.loaded` (startup load + every successful reload)
- `wakery.template.load_failed` (startup only — terminal)
- `wakery.template.reload_failed` (hot reload only — recoverable)
- `wakery.template.render_failed` (per-render — single wake affected)
- `wakery.template.state_fallback_used` (per-render — informational)

Event codes are defined in `specs/data/spec_event.md §Event code appendix` (5000 series).

## Deliverables

Implementation under this spec must produce:
- a templates module under `apps/wakery/src/templates/` (advisory layout):
  - `loader.ts` — file I/O + JSON parse
  - `validator.ts` — schema check (template-name-aware)
  - `store.ts` — in-memory loaded + last-good cache, fs.watch lifecycle, debounce
  - `substituter.ts` — placeholder substitution
  - `renderer.ts` — orchestrator exposing `render(wake, route)` and `renderProbe(wake, lease)`
- TypeScript interfaces describing the template artifact schemas (used by the validator and consumed by tests)
- the wake-message artifact at `apps/wakery/templates/wake-message.json`, content mirroring `spec_wakery-wake-message.md`
- the notice-template artifacts at `apps/wakery/templates/{rewake,govern-notice,cap-alert,stall-notice}-message.json`, content mirroring their template content specs

## Verification

The module is acceptable when it can demonstrate:
- a malformed JSON artifact prevents wakery startup with a clear diagnostic
- a valid wake-message artifact and each valid notice-template artifact load and validate
- an operator edit to either file (atomic save) is picked up within the debounce window without restart
- a mid-flight malformed save is rejected, the last-good template stays in service, and the reload-failure event fires
- a `render()` call with all required values populated produces the expected wake message for a known fixture
- a render with a missing required value throws and emits `wakery.template.render_failed`
- a wake render with an unmatched state-block key uses the default block and emits `wakery.template.state_fallback_used` (notice templates have no state blocks; this case is wake-only)
- the resulting messages have no `{{...}}` tokens

## References

- `spec_wakery-wake-message.md` — the wake-message content contract (the source of truth the wake-message JSON artifact mirrors)
- `spec_wakery-openclaw-adapter.md` — the wake dispatch path that calls `render()` and handles render failures
- `specs/data/spec_event.md` — event-code definitions including the 5000-series template-lifecycle codes
- `specs/data/spec_database.md` — the data entities the renderer reads (`wake`, `route`, `github_agent`, `github_repo_project`)
- `spec_wakery-v2.md` — the v2 scope that introduced this module
