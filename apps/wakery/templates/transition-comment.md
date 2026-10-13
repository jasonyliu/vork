# Transition Comment Template

The canonical structure of a state-change comment that an agent posts on a GitHub issue to signal a Task transition. This is the **format Wakery's GitHub adapter parses**; comments that don't match this shape are not recognized as Transitions and won't produce wakes.

This file is the agent-facing contract. Wakery's parser (`apps/wakery/src/adapters/github/adapter.ts → parseTransitionTargets`) reads only the `To:` line to derive the transition target; the rest of the comment exists for human and downstream-agent comprehension.

## Detection contract

A comment is recognized as a transition comment iff it contains all three field markers (case-insensitive, any order, with optional markdown formatting like `**From:**` or `> From:`):

- `From:`
- `To:`
- `Actor:`

Comments missing any one of these markers are treated as ordinary discussion and never produce a wake.

## Canonical structures

### Lifecycle transition (Status field changes)

```
Transition
From: <current_lifecycle_state>
To: <target_lifecycle_state>
Actor: <github_login>
Reason: <one-sentence reason — required>
```

Valid lifecycle states: `Init`, `Todo`, `Pending`, `Progress`, `Done`, `Reviewed`, `Completed`, `Cancelled`.

### Canonical From/To grammar — exact, both forms (2026-08-06)

The `From:`/`To:` lines are **machine-parsed**; render them in exactly one of these two forms — never improvise a third:

**Paired transition** (lifecycle and audit move together — the common case):
```
From: Todo (Audit: Approved)
To: Progress (Audit: Gated)
```

**Audit-only transition** (lifecycle unchanged — an Auditor verdict or a Principal Govern resolution):
```
From: Audit Gated
To: Audit Govern
```

**One-comment atomicity (live incident, a sibling project's #36, 2026-08-04):** a paired transition is ONE comment in the paired form above — never two comments splitting the lifecycle move and its audit re-gate. `TASK.md §Transition`: the `(Lifecycle, Audit)` pair advances as one atomic operation; two comments two seconds apart are two webhooks, two wakes' worth of parsing, and a policy violation. The audit-only form is legal ONLY for genuinely audit-only transitions (an Auditor's verdict, a Principal's Govern resolution) — never for the audit half of a paired move.

**Canonical Actor grammar:** `Actor: <Role> (<AgentName>)` — Role is one of `Owner`, `Assignee`, `Auditor`, `Principal` (per `TASK.md §Comments`, Actor records the role performing the transition), and the agent name in parentheses identifies who acted, because the shared `<worker-login>` login cannot (bounded identity set — all non-auditor agents post under it). Examples: `Actor: Assignee (Visor)`, `Actor: Owner (Sarge)`, `Actor: Auditor (Heimdall)`, `Actor: Principal (<owner>)`. A bare login (`Actor: <worker-login>`) is nonconforming.

**Prose rule:** state words (`Approved`, `Revise`, `Govern`, lifecycle names) must never appear in your Reason/Rationale prose in a `To:`-like construction — the parser reads the `To:` line, and loose state words near field markers have produced phantom expectations (live incidents, 2026-08-06). Keep the field lines exact and the prose free of state vocabulary where possible.

### Audit transition (Audit field changes)

```
Transition
From: Audit <current_audit_state>
To: Audit <target_audit_state>
Actor: <github_login>
Reason: <one-sentence reason — required>
```

Valid audit states: `Gated`, `Approved`, `Revise`, `Govern`.

The `Audit ` prefix on the value side is what tells the parser to interpret the `To:` value as an audit state rather than a lifecycle state. Without the prefix, the parser interprets the value against the lifecycle vocabulary.

### Decision-bearing transitions (extra sections)

For transitions flagged decision-bearing per `TASK.md §Verbosity` — all Auditor verdicts at both gates, transitions into `Pending`, transitions into `Cancelled`, and Owner reclaims (`Pending → Init`, `Todo+Revise → Init`, `Cancelled → Init`) — include:

```
Transition
From: <current>
To: <target>
Actor: <github_login>
Reason: <one-sentence summary>

Rationale: <paragraph explaining the why>
Relevant changes/outcome: <paragraph naming concrete artifacts touched and downstream impact>
```

For Auditor verdicts specifically, SECURITY.md additionally requires:

```
Transition
From: Audit Gated
To: Audit <Approved|Revise|Govern>
Actor: <auditor_github_login>
Reason: <one-sentence verdict summary>

Risk Code: <code from SECURITY.md>
Rationale: <paragraph applying the Risk Code mapping to the Task's operation chain>
```

## Atomic paired transitions

When TASK.md requires a paired atomic transition — every entry into an actor lane resets `Audit = Gated` in the same operation: the Owner into `Init` (`Todo+Revise → Init+Gated`, `Pending → Init+Gated`, `Cancelled → Init+Gated`) and the Assignee into `Progress` (`Todo+Approved → Progress+Gated`, `Done+Revise → Progress+Gated`) — post **two separate transition comments back-to-back**, one for the lifecycle change and one for the audit change. Wakery's parser reads one `To:` per comment; the back-to-back pair is the GitHub-surface carrier of the policy's single atomic operation under the current parser. A parser update to single-comment pairs is wakery-extension scope.

Order the comments such that the second-posted reflects the final consistent state — typically post the lifecycle change first, then the audit change.

## Examples

### Lean lifecycle transition

```
Transition
From: Init
To: Todo
Actor: <worker-login>
Reason: Task body populated against the canonical template; sub-issues drafted; ready for audit.
```

### Lean audit transition

```
Transition
From: Audit Gated
To: Audit Approved
Actor: <auditor-login>
Reason: Task scope is bounded; deliverable is concrete; operation chain resolves R100.

Risk Code: R100
Rationale: Reviewed per SECURITY.md §Preview. Extracted chain: Create×File×Workspace — a single canonical research note as the deliverable, with a fixed scope ("the migration we just completed"). Resolver returned R100; approved with the chain recorded.
```

### Decision-bearing assignee bounce-back

```
Transition
From: Todo
To: Pending
Actor: <worker-login>
Reason: Execution packet missing the canonical reference inputs.

Rationale: The Definitive Deliverable expects citations to the wakery charter and the wakery v1 release notes, but the task body cites neither — Owner needs to enrich the packet with explicit pointers before execution can proceed.
Relevant changes/outcome: No artifacts modified. Returning to Owner.
```

## Formatting tolerances (what the parser accepts)

- `From:` / `To:` / `Actor:` markers are matched case-insensitively.
- Leading whitespace, blockquote markers (`>`), and list-item markers (`-`, `*`) are stripped before parsing.
- `**bold**` and backtick-fenced values are stripped.
- Empty lines between fields are allowed.
- Field order does not strictly matter for detection, but the `Transition` header on its own line as the first line is conventional and recommended.

## Formatting things to avoid

- Don't put multiple `To:` lines in one comment expecting both to be parsed — only the first matching `To:` line is consumed.
- Don't use `Status:` or `Audit:` as field markers in the leading position; the parser keys on `From:` / `To:`, not on `Status:` / `Audit:`. The `Audit ` prefix appears on the value side (e.g., `To: Audit Approved`), never as a separate field marker.
- Don't omit `Reason:` even on lean transitions. The audit trail depends on every state change carrying a one-sentence rationale.

## References

- `docs/policy/TASK.md` — Length and verbosity policy; full lifecycle state machine.
- `docs/policy/SECURITY.md` — Auditor responsibilities; Risk Code mapping.
- `apps/wakery/src/adapters/github/adapter.ts` — the parser implementation (`isTransitionComment`, `parseTransitionTargets`).
