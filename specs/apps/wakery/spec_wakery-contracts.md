# Wakery Contracts

The wakery ingress envelopes — the request/response shapes handled by the REST/webhook surface. Everything durable that Stage 1 produces from these envelopes — entities and value sets in `specs/data/spec_database.md`, env surfaces in `specs/data/spec_config.md`, the event registry in `specs/data/spec_event.md`.

## Naming rules (envelopes)

Time fields on ingress payloads use unix-millisecond precision and are named `timestamp` ("time this thing happened or arrived"); durable-entity time naming (`create_time`/`update_time`) and identity rules (`request_id` vs `wake.id`, `task_key`, `state_key`) are defined in `specs/data/spec_database.md §Naming Rules`.

## Router Ingress API Contracts

### 1) `WakeRequest`

| Field | Type | Required | Notes |
|---|---|---:|---|
| `request_id` | string | yes | Inbound request identifier. Useful for tracing and communication, but not the durable identity of the local wake. |
| `source` | enum/string | yes | Source identifier such as `github`, `scheduler`, `operator`, `rest`. |
| `project_id` | string | yes | The platform project key (`project.id` — `specs/data/spec_database.md §11`); the GitHub adapter resolves it from the repo mapping before building the request. |
| `project_name` | string | no | Informational display name. |
| `task_id` | string | yes | Canonical task id carried by the request. For GitHub sources, this is the issue number. |
| `task_type` | string | yes | Task type used for routing and task-specific handling. For GitHub sources, derived from the `type:<value>` label. |
| `task_title` | string | no | Human-readable task title for later debugging and diagnostics. |
| `task_priority` | integer | no | Used for sorting/ordering once normalized into `wake`. |
| `task_status` | string | yes | Task lifecycle status carried by the request, observed from the upstream source of truth. For GitHub sources, this comes from the GitHub Project custom field `Status`, not from issue open/closed state. |
| `task_status_expected` | string | no | Lifecycle status that the upstream signal *claims* will materialize, supplied by the source adapter when it has reason to believe the source-of-truth fields lag the signal (e.g. a GitHub transition comment whose `To:` value disagrees with the freshly fetched ProjectV2 Status). Optional. When present and disagreeing with `task_status`, Stage 5 stores the wake as `pending` and persists this value into `wake.task_status_expected`. Never used as a substitute for `task_status`. |
| `task_audit` | string | yes | Task audit/security status carried by the request, observed from the upstream source of truth. For GitHub sources, this comes from the GitHub Project custom field `Audit`, not from labels. |
| `task_audit_expected` | string | no | Audit status the upstream signal claims will materialize. Same semantics as `task_status_expected`. |
| `task_labels` | array | no | JSON array of all label name strings attached to the upstream Task (e.g. `["task:parent","priority:high"]`). Empty array `[]` when no labels are present. For GitHub sources, captured from the issue's `labels.nodes[].name` array at intake. Carried forward into `wake.task_labels` for label-driven routing decisions (see `wake.task_labels`). |
| `task_relations` | object | no | Structured capture of the upstream Task's relations to other Tasks. Each entry is gated on its corresponding label: `parent: { task_id: <string> }` when the Task is labeled `task:child`; `children: { total: <int>, completed: <int> }` when the Task is labeled `task:parent`; `blocked_by: { total: <int>, completed: <int> }` when the Task is labeled `task:blocked`; `blocking: { total: <int>, completed: <int> }` when the Task is labeled `task:blocking`. Null when none applies. For GitHub sources, captured from the issue's `parent { number }`, `subIssuesSummary { total completed }`, and `issueDependenciesSummary { blockedBy blocking totalBlockedBy totalBlocking }` GraphQL fields. Carried forward into `wake.task_relations`. |
| `task_payload` | object | no | Extra task data not central to routing but worth carrying forward. |
| `assignee_id` | string | conditional | Upstream identity id for the task assignee. For GitHub sources, this is the GitHub user node ID (e.g. `U_kgDOxxxxxxxx`). Required unless `assignee_name` is used as a temporary fallback. |
| `assignee_name` | string | conditional | Upstream identity name for the task assignee. For GitHub sources, this is the GitHub login (e.g. `<worker-login>`). |
| `owner_id` | string | no | Upstream identity id for the task owner. For GitHub sources, this is the GitHub user node ID. |
| `owner_name` | string | no | Upstream identity name for the task owner. For GitHub sources, this is the GitHub login of the issue author. |
| `timestamp` | long | yes | WakeRequest arrival time in unix milliseconds. |

### 2) `WakeResponse`

| Field | Type | Required | Notes |
|---|---|---:|---|
| `request_id` | string | yes | Echoed request id. |
| `status` | string | yes | Compact status such as `accepted`, `updated`, `dropped`, `rejected`. |
| `message` | string | yes | Semantic communication for the caller. |

## Notes

- `request_id` is for request tracing and communication, not the durable wake identity.
- once Stage 1 stores or updates `wake`, later stages should refer to the wake entity rather than to the request.

## References

- `specs/data/spec_database.md` — entities and value sets
- `specs/data/spec_config.md` — env contracts
- `specs/data/spec_event.md` — the event registry
- `specs/apps/wakery/spec_wakery-ingress-api.md` — the processing pipeline behind these envelopes
- `specs/apps/wakery/spec_wakery-github-adapter.md` — the adapter that builds `WakeRequest`s from webhooks
