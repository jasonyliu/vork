# Wakery Wake Message

## Introduction

This spec defines the **wake message** Wakery dispatches to an agent when a wake is selected and routed. It is the content contract: what the message must include, why, what shape it takes, and what placeholders Wakery substitutes per dispatch.

The wake message has two artifacts:

- **This spec** — the human-facing contract. Format, placeholders, state-block matrix, design rationale.
- **`apps/wakery/templates/wake-message.json`** — the machine-facing artifact the renderer parses at runtime. Stripped to the minimum data the renderer needs; operators and humans read this spec, not the JSON.

The renderer machinery (loading, validation, substitution, hot-reload) is governed by `spec_wakery-template-renderer.md`. The OpenClaw adapter (the consumer of the rendered message) is governed by `spec_wakery-openclaw-adapter.md`.

## Purpose

Every wake delivery is the moment an agent transitions from "idle/other work" to "act on this Task." Persistent context (AGENTS.md, MEMORY.md, prior session state) drifts; the wake message does not. Pushing the right reminders **into the wake message itself** guarantees the agent reads them right before acting:

- which agent identity to use
- which project this Task belongs to and where its repo lives
- where the agent's homespace clone is on disk
- the explicit instruction to `git fetch && git rebase @{u}` before any work. `@{u}` is the current branch's own upstream (`origin/dev` for a homespace checked out on `dev`), so the one literal command syncs correctly on any branch. The earlier hardcoded `git rebase origin/main` rebased a `dev`-checked-out homespace onto `main` — rewriting local `dev` and dropping its `--no-ff` integration merge commits (the 2026-06-04 incident, `docs/backlog.md` wake-message defects item; fixed by this revision)
- the issue URL so the agent doesn't have to derive it
- what action the lane expects in the current `(actor, status, audit)` combination

The preamble is constant per `(project, agent)`. The state-instruction block varies per `(actor, task_status, task_audit)` — the agent's lane and the Task's current state determine what action is expected.

## Scope

This spec covers:
- the canonical wake-message composition
- the full placeholder set Wakery substitutes
- the state-block matrix selected by `(actor, task_status, task_audit)`
- comment-length hint strings used by the state blocks
- invariants every dispatched message must satisfy

This spec does not cover:
- the renderer module that does the parsing and substitution (see `spec_wakery-template-renderer.md`)
- the JSON file's specific structural encoding (the renderer spec defines the schema)
- the OpenClaw delivery path (see `spec_wakery-openclaw-adapter.md`)

## Definitions

- **Composition** — the top-level message body, into which all placeholders (including `{{lane_instructions}}`) are substituted.
- **State block** — one of the per-`(actor, task_status, task_audit)` instruction blocks. Selected at render time and substituted into the composition as `{{lane_instructions}}`.
- **Default state block** — the fallback used when no exact `(actor, task_status, task_audit)` match exists.
- **Comment-length hint** — a reusable string keyed by `{{comment_length_<name>}}`, substituted inside the selected state block before the state block is substituted into the composition.
- **Placeholder** — a `{{name}}` token in the composition or in a state block. The renderer substitutes every placeholder before dispatch; an un-substituted placeholder is a render failure.
- **Required placeholder** — every placeholder in this spec is required at render time. Wakery aborts rendering with `wakery.template.render_failed` if any required value is missing. There are no optional placeholders.

## Placeholders

All placeholders below are required at render time. Wakery aborts rendering with `wakery.template.render_failed` if any required value is missing.

| Placeholder | Source | Notes |
|---|---|---|
| `{{utc_timestamp}}` | Wakery (render time) | ISO-8601 with seconds; e.g. `2026-05-22T17:48:00Z`. |
| `{{agent_role}}` | DB: `github_agent.role` | Display mapping of the role enum: `agent` → the agent's display name context, `auditor` → `Auditor`, `principal` → `Principal` (`specs/data/spec_database.md §4`). |
| `{{agent_id}}` | DB: `github_agent.agent_id` | e.g. `heimdall`, `main`, `visor`. |
| `{{agent_name}}` | DB: `github_agent.agent_name` | e.g. `Sarge`, `Heimdall`, `Visor`. |
| `{{agent_github_login}}` | DB: `github_agent.github_login` | e.g. `<worker-login>`. |
| `{{project_name}}` | DB: `github_repo_project.github_project_title` | e.g. `Vork`. |
| `{{project_url}}` | derived | `https://github.com/users/<owner>/projects/<number>` (owner + number resolved from `github_repo_project`). |
| `{{repo_full_name}}` | derived: `github_repo_project.github_owner_name + '/' + github_repo` | e.g. `<owner>/vork`. |
| `{{agent_homespace}}` | derived | Filesystem path to the agent's clone. For `role = AI Lead`: `<WAKERY_PROJECT_STORAGE_PATH>/<repo>/main`. For other roles: `<WAKERY_PROJECT_STORAGE_PATH>/<repo>/team/<agent_id>`. |
| `{{issue_url}}` | derived | `https://github.com/<repo_full_name>/issues/<task_id>`. |
| `{{wake_id}}` | `wake.id` | |
| `{{actor}}` | `route.actor` | `owner` / `assignee` / `auditor`. |
| `{{project_id}}` | `wake.project_id` | Platform `project.id`. |
| `{{task_id}}` | `wake.task_id` | GitHub issue number. |
| `{{task_type}}` | `wake.task_type` | e.g. `project_draft`, `spec`, `coding`. Required at dispatch — Feature 4's type-label filter at ingest guarantees this is set; Feature 2's migration backfills any pre-v2 rows. |
| `{{task_status}}` | `wake.task_status` | current lifecycle state. |
| `{{task_audit}}` | `wake.task_audit` | current audit state. Required at dispatch — every wake reaching dispatch has an audit value; a missing value is an upstream bug, not a renderable case. |
| `{{route_id}}` | `route.id` | |
| `{{task_title}}` | `wake.task_title` | GitHub issues always carry a title; adapter populates from `repository.issue.title`. |
| `{{task_payload_json}}` | `JSON.stringify(wake.task_payload)` | Always non-null; adapter populates `task_payload` from issue body + labels + author. |
| `{{lane_instructions}}` | this spec | the state block selected by `(actor, task_status, task_audit)` — see §State-specific instructions below. |

## Composition

Wakery composes the full message in this order:

```
[{{utc_timestamp}}] Wakery dispatch

Hi {{agent_name}}, you are {{agent_role}} working under github account ({{agent_github_login}}).
Project: {{project_name}}  (board: {{project_url}}, repo: {{repo_full_name}})
Your homespace: {{agent_homespace}}
Issue: {{issue_url}}

Required first action: cd {{agent_homespace}} && git fetch && git rebase @{u}
(Abort if your homespace is dirty. Do not pile new work on top of uncommitted changes.)

Transition comment format: must follow the canonical structure defined in `{{agent_homespace}}/apps/wakery/templates/transition-comment.md`, comments that don't match this shape will not register as transitions and will not produce a wake.

{{lane_instructions}}

Wake context:
wake_id={{wake_id}}
actor={{actor}}
project_id={{project_id}}
task_id={{task_id}}
task_type={{task_type}}
task_status={{task_status}}
task_audit={{task_audit}}
route_id={{route_id}}
task_title={{task_title}}
task_payload_json={{task_payload_json}}
```

All lines are always rendered. Every placeholder is required.

## State-specific instructions

The `{{lane_instructions}}` block is selected by the tuple `(actor, task_status, task_audit)`. The renderer:

1. Looks up the exact `(actor, task_status, task_audit)` key.
2. Falls back to the **default** block if no exact match exists, emitting `wakery.template.state_fallback_used` so operators can audit.
3. Substitutes any `{{comment_length_*}}` references inside the selected block before substituting the block into the composition.

Each block below ends with a comment-length hint pulled from §Comment length hints (or omits the hint where SECURITY.md mandates a fixed comment structure).

### `assignee` / `Todo` / `Approved` — acceptance wake

```
You are receiving this wake as the Assignee.
This is an acceptance wake, not the execution wake.
Inspect the task packet only.
If context is sufficient, transition the task from Todo to Progress and leave the required transition comment.
If context is insufficient, transition the task from Todo to Pending and explain the missing execution packet.
Stop after the transition comment; do not do the substantive task work in this turn.

{{comment_length_contingent_pending_bounce}}
```

### `assignee` / `Progress` / `Gated` — execution wake

```
You are receiving this wake as the Assignee.
This is an execution wake.
Do the substantive task work now.
If your work pushes commits or opens a pull request, the CI it sets in motion is part of the work: the task is Done only when you have observed the suite green (and the PR merged, where the task requires the merge). Either wait briefly for a fast suite and transition, or end your turn now — wakery holds this task while the external work runs and re-wakes you when it settles; if the re-wake reports the hold timed out, verify the external state yourself before proceeding.
When the deliverable is complete, transition Progress to Done — the paired atomic re-gate into the post-execution audit queue (Done+Gated) — and include Artifacts and Verification in the transition comment.
If execution becomes blocked by missing context, transition Progress to Pending with the missing packet details.

{{comment_length_contingent_pending_bounce}}
```

### `assignee` / `Done` / `Revise` — redo wake

```
You are receiving this wake as the Assignee.
This is a redo wake — the post-execution Review returned Revise with findings within the task's scope.
Address the review findings, then transition Done to Progress (the paired atomic re-gate) to start the redo pass.
If the findings exceed the task's scope, transition Done to Pending instead, naming what exceeds it.

{{comment_length_contingent_pending_bounce}}
```

### `assignee` / `Reviewed` / `Approved` — final closeout wake

```
You are receiving this wake as the Assignee.
This is a final-closeout wake.
Perform only non-substantive logistics (cleanup, artifact organization). Any meaningful work must become a new Task or a post-execution Revise.
When closeout is complete, transition Reviewed to Completed AND close the GitHub issue with state_reason completed — the Task is done, the issue must reflect that. Closing the issue is part of the Completed transition, not a separate step.

{{comment_length_lean}}
```

### `owner` / `Init` / `Gated` — owner preparation wake

```
You are receiving this wake as the Owner.
This is an Owner preparation wake.
Populate the task body against the canonical Task template, then transition Init to Todo so Heimdall can audit.

{{comment_length_lean}}
```

### `owner` / `Pending` / `Approved` | `Gated` | `Revise` | `Govern` — owner reclaim from Pending (four keys, one content)

Pending carries the prior audit value (`TASK.md §Transition` `Pending+*`), so all four tuples select this block:

```
You are receiving this wake as the Owner.
This is an Owner reclaim wake — the task returned to you as Pending: the Assignee could not proceed within its current scope (insufficient packet at acceptance, blocked mid-execution, or post-execution findings exceeding scope).
Read the bounce reason in the latest comments. Either reclaim — resolve the gap by delivery means (enhance the packet, or declare Blocked-by a new task where the gap is real work), transition Pending to Init (the paired atomic re-gate), then Init to Todo to re-enter audit — or cancel per TASK.md if the work will not continue.

The Pending → Init transition is decision-bearing: include a full paragraph of Rationale and Relevant changes/outcome explaining what was resolved. The follow-up Init → Todo can be lean per TASK.md.
```

### `owner` / `Done` / `Approved` — owner acceptance wake

```
You are receiving this wake as the Owner.
This is an Owner acceptance wake — the post-execution Review approved the work-product against its spec and deliverable.
Accept: transition Done to Reviewed; the Assignee then closes the task out. Or cancel per TASK.md if the accepted work is moot.

Comment length contingent on outcome: Done → Reviewed (acceptance) should be lean — one-sentence Reason. Done → Cancelled is decision-bearing — include a full paragraph explaining why accepted work will not continue.
```

### `owner` / `Todo` / `Revise` — owner reclaim from failed audit

```
You are receiving this wake as the Owner.
This is an Owner reclaim wake from a failed audit. The Auditor returned Revise.
Address the Auditor findings in the task body, then perform the atomic transition Audit: Revise -> Gated paired with Lifecycle: Todo -> Init per TASK.md.

{{comment_length_verbose}}
```

### `auditor` / `Todo` / `Gated` — pre-execution audit wake (first gate)

```
You are receiving this wake as the Auditor.
This is a pre-execution audit wake (Preview).
Audit the Task per SECURITY.md Preview and the TASK.md auditor responsibilities: classify the operation chain, assign the Risk Code, stamp the risk: label. Perform exactly one of Audit: Gated -> Approved, Gated -> Revise, or Gated -> Govern.
Discipline for this turn: every mutating GitHub call (comment, label, Project field) targets task_id={{task_id}} — re-read it at each call site; never reuse an id from an issue you inspected during dependency or sibling checks (live mispost incident, 2026-08-06). The Action/Subject/Zone vocabulary is closed (SECURITY.md §Actions/§Subjects/§Zones): extraction always selects from it, never coins new primitives.
```

### `auditor` / `Done` / `Gated` — post-execution review wake (second gate)

```
You are receiving this wake as the Auditor.
This is a post-execution review wake (Review).
Review the work-product per SECURITY.md Review, at the Depth selected by the task's carried risk: label, against its governing specification and deliverable. Checkpoint Stage Task types and failed Deployments Govern unconditionally per SECURITY.md Outcome. Perform exactly one of Audit: Gated -> Approved, Gated -> Revise, or Gated -> Govern.
Discipline for this turn: every mutating GitHub call (comment, label, Project field) targets task_id={{task_id}} — re-read it at each call site; never reuse an id from an issue you inspected during dependency or sibling checks (live mispost incident, 2026-08-06). The Action/Subject/Zone vocabulary is closed (SECURITY.md §Actions/§Subjects/§Zones): extraction always selects from it, never coins new primitives.
```

No comment-length hint on either auditor block: the audit comment structure (verdict + risk + reasoning paragraph) is required by SECURITY.md and is not subject to the lean default.

### `owner` / `Completed` / `Approved` and `owner` / `Cancelled` / `Gated` | `Revise` | `Approved` | `Govern` — chain cues (five keys, one content)

`Completed` arrives only as `Completed+Approved`; `Cancelled` carries its source lane's audit value — all five tuples select this block (`spec_wakery-conduction-chaining.md` Stage 4):

```
You are receiving this wake as the Owner.
This is a chain cue — a task reached terminal state ({{task_status}}). You create what follows; wakery decides nothing.
Read the milestone state, then conduct per DELIVERY.md Chaining:
- Mechanical chain (a stage task completed): create the next Stage Task.
- Judgment chain (a branch's top-level task completed): create that branch's Integration Stage Task, Blocked-by this task; Integrations run serially. A Child task's cue, or a stage already chained, is a no-op — stand down.
- Directed chain (a Release or hotfix task completed): create the Deployment Stage Task per the environment's deployment manual.
- On the Release Stage Task's cue, also run the branch sweep: delete every working branch fully merged into dev; surface, never delete, any unmerged one.
- On a Cancelled cue, conduct the consequence: a cancelled branch top-level task leaves the milestone's integration set (record it in decomposition.md); a cancelled Integration or Stage Task needs your conduction judgment per DELIVERY.md so the milestone does not stall.

{{comment_length_lean}}
```

### Default (any unmatched `(actor, task_status, task_audit)` key)

```
You are receiving this wake as the {{actor}}.
Follow TASK.md for the current lifecycle/audit state and perform exactly one valid transition for your role.
Do not ask for confirmation unless you are actually blocked by missing authority, missing spec, missing dependency, or unsafe ambiguity.

{{comment_length_lean}}
```

When the default block is selected, the renderer must also emit `wakery.template.state_fallback_used` with the full `(actor, task_status, task_audit)` tuple so operators can decide whether to add an explicit block.

## Comment length hints

Three reusable strings appended to instruction blocks per `TASK.md` "Length and verbosity":

### `{{comment_length_lean}}`

```
Keep the transition comment lean per TASK.md: From/To/Actor + one-sentence Reason, ~100 tokens. Omit Rationale and Relevant changes/outcome unless the decision is non-obvious.
```

### `{{comment_length_verbose}}`

```
This transition is decision-bearing per TASK.md "Length and verbosity": include a full paragraph of Rationale and Relevant changes/outcome — the downstream actor will read the reasoning.
```

### `{{comment_length_contingent_pending_bounce}}`

```
Comment length contingent on outcome: the routine transition (to Progress or to Done) should be lean per TASK.md — From/To/Actor + one-sentence Reason. A bounce to Pending is decision-bearing — include a full paragraph specifying the exact gap in the execution packet so the Owner can act on it.
```

## Invariants

- Every wake message includes the checklist preamble. No exceptions for "experienced" agents.
- Every wake message includes the `Required first action` line literally. The exact recipe matters because agents may execute it programmatically.
- Wake-context fields appear at the end so the agent-facing instructions land in the agent's immediate attention window without being buried under structured data.
- Placeholders missing required values cause render to abort with a clear diagnostic; Wakery never emits a message with un-substituted `{{placeholders}}`.
- The composition and state-block content live in this spec; the JSON artifact mirrors them mechanically. Drift between this spec and `apps/wakery/templates/wake-message.json` is a code-review concern (the spec is the source of truth; the JSON is the build of that source).

## References

- `spec_wakery-template-renderer.md` — the renderer module that consumes the JSON artifact
- `spec_wakery-openclaw-adapter.md` — the dispatch path that emits the rendered message
- `specs/data/spec_database.md` — data entities behind the placeholder sources (`wake`, `route`, `github_agent`, `github_repo_project`)
- `spec_wakery-v2.md` — the v2 scope that drove the move from inline message to file-based template
- `docs/policy/TASK.md` — the lifecycle and audit state machine the state blocks encode
- `docs/policy/SECURITY.md` — auditor comment structure and the two-gate Preview/Review duties (referenced by both auditor blocks)
- `spec_wakery-conduction-chaining.md` — the chain-cue blocks' conduction contract
- `apps/wakery/templates/transition-comment.md` — the canonical transition-comment shape referenced by the composition
