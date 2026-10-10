# Task as Canonical Unit Of Work

## Purpose

This document defines Task as the operational contract for the canonical unit of work across the agentic operating system. It exists to make work explicit, transferable, governable, and executable across humans, agents, and software surfaces without binding the operating model to any single platform.

- Define the platform-agnostic Task model used to represent work across planning, execution, review, delivery, and live operations.
- Establish the control model that governs how Tasks move through their operational lifecycle under explicit authority and risk boundaries.
- Standardize how humans and agents coordinate through Tasks so work can be delegated, resumed, decomposed, and verified without ambiguity.
- Preserve authority, risk control, and operational continuity as work moves across roles, systems, and stages of a project.
- Enable autonomous execution by giving agents a consistent contract for delivering work within explicit governance boundaries.

## Principles

- **Task-first:** No meaningful project work may proceed outside a Task.
- **Scope-explicit:** Every Task must define a clear objective, scope, one primary specification, one expected deliverable, and one verification approach.
- **Self-contained:** Every Task must carry enough bounded context to enter execution without chasing missing Project inputs.
- **Authority-bound:** A Task does not grant authority beyond role, policy, or audit state.
- **State-explicit:** No lifecycle or audit state transition may occur without a recorded comment.
- **Atomic-transition:** Each Task operation performs one transition: a single lifecycle move, a single audit move, or one paired lifecycle-and-audit move.
- **Platform-agnostic:** The Task contract is canonical; tools implement it, not define it.

## Task

A Task is the canonical unit of work used to represent, control, execute, and verify a single operational objective across the agentic operating system. A Task is suitable for execution only when one assignee can complete it from the bounded context provided through one primary specification, one deliverable, and one verification approach. The dominant action should be clear from the Task objective and scope. Every Task must contain the core elements defined in this section, regardless of which platform stores or renders them.

### Core

Core elements define the canonical Task contract. These elements describe the Task contract, not necessarily separate physical fields in an implementation surface.

**Identity**
- **Project:** The project or operational context the Task belongs to.
- **ID:** The identifier of the Task in its implementation surface.
- **Title:** The short human-readable name of the Task.
- **Type:** The primary free-form classification of the Task.

**Description**
- **Objective:** The intended outcome the Task exists to achieve.
- **Scope:** The work included within the Task boundary.
- **Constraints:** The limits or conditions that shape execution.
- **Specification:** The controlling specification or instruction source that governs how the Task should be done.
- **Deliverable:** The concrete outcome expected from completion of the Task.
- **References:** Supporting materials required to understand or execute the Task.

**Responsibility**
- **Owner:** The actor accountable for defining the Task, ensuring its core elements are complete at creation, and maintaining the Task as a valid unit of work.
- **Assignee:** The actor responsible for the current execution of the Task.

**Control**
- **Lifecycle:** The current operational state of the Task within its workflow progression.
- **Audit:** The current audit and approval state governing whether and how the Task may proceed.

**Continuity**
- **Comments:** Recorded transition notes attached to each lifecycle or audit state change.
- **Artifacts:** Outputs or evidence produced through execution of the Task.
- **Verification:** The primary approach used to judge whether the Task's deliverable meets expectations.
- **Contingency:** The planned response if the Task outcome must be reversed, corrected, contained, or safely worked around.

### Granularity

Granularity defines what makes one valid Task and when work must split into more than one. A Task is sized to one feature — the unit of independent verification.

**The One Rule**

To create one Task, achieve one distinctive objective through one contextual assignee performing one dominant action within one bounded scope according to one primary specification to produce one definitive deliverable and validate through one conclusive verification.

A Task derived under this rule should satisfy all of the following:
- **One distinctive objective:** the Task accomplishes one meaningful goal, not a bundle of goals.
- **One contextual assignee:** the Task involves one actor to complete execution within the provided context in one go.
- **One dominant action:** the Task centers on one primary kind of work, even if minor supporting steps are required.
- **One bounded scope:** the Task covers one feature — the unit one assignee owns end-to-end on its one branch and verifies as a whole.
- **One primary specification:** the Task gravitates to one controlling specification or instruction source.
- **One definitive deliverable:** the Task produces one concrete outcome instead of multiple results.
- **One conclusive verification:** the Task validates its outcome through one primary approach with clear expectations.

**Anti-rule**

A feature splits into multiple Tasks only where verification scopes are genuinely independent: each piece carries its own external consumers or blast radius and is verified on its own. Changes that verify as one closed end-to-end path stay one Task, even across multiple components or services. Independent verification is the only ground for a finer split.

When the Anti-rule splits a feature, the feature becomes a Parent Task and its pieces become Child Tasks (`§Parent Task`), all on the feature's one branch and integrated once; an unsubdivided feature is a single Task on its branch. Subdivision changes verification granularity, never branch or integration count.

### Extension

Extension elements may be defined by a project or implementation surface to carry additional information through the Task lifecycle. These elements may add local structure or context, but they must not weaken, replace, or redefine the core Task contract defined in this policy.

### Relations

A Task may define structured relations to other Tasks only where those relations affect coordination or execution.

- **Parent:** A higher-level Task composed of Child Tasks and not complete until its Child Tasks are completed.
- **Child:** A lower-level Task derived from and scoped under a Parent Task.
- **Blocked-by:** A Task that must be completed before this Task may proceed.
- **Blocking:** A Task that cannot be completed until this Task is completed.

Relation rules:
- A Task may have at most one **Parent**.
- A Task may have multiple **Child** Tasks.
- A Task may have multiple **Blocked-by** relations.
- A Task may have multiple **Blocking** relations.
- **Parent** and **Child** relations must remain within the same Project.
- **Blocked-by** and **Blocking** relations must remain within the same Project.
- No dependency relation may be defined between a **Parent** and its **Child** in either direction.
- **Parent** / **Child** structure is exactly one level deep. A Task that is a **Parent** must not itself be a **Child** of another Task, and a Task that is a **Child** must not itself be a **Parent** of any other Task. If work requires a deeper hierarchy, restructure it as separate flat Parent + Children groupings rather than nesting.
- Dependency cycles are invalid. A Task dependency graph must not contain circular `Blocked-by` / `Blocking` relations. If a cycle is discovered, the affected Tasks must not proceed until the cycle is broken through correction of the dependency structure.

### Parent Task

A Parent Task represents one **feature** too large to complete within a single Task's bounded context, broken into the Child Tasks that build its pieces. The Children share the feature's one branch and this one Parent; each Child individually satisfies **The One Rule** (`§Granularity`) and verifies its own piece. The Parent contains those Children, and its own work aggregates and packages their pieces into the complete feature on that branch. A Parent is an ordinary Task in every other respect and receives no exemption from audit, lifecycle, primitive extraction, or any other rule in this document.

- **Identification:** A Parent Task must be labeled `task:parent` at creation, and every Child Task must be labeled `task:child` at creation. These labels are the canonical signals across implementation surfaces that the Task is a Parent or a Child respectively. The `task:parent` and `task:child` labels are mutually exclusive on any given Task — Parent/Child structure is exactly one level deep (see §Relations). Implementations must treat both labels as authoritative.
- **Creation:** The Owner must create the Parent in `Init+Gated` with the `task:parent` label, then create every intended Child Task in `Init+Gated` with the `task:child` label and attach each as a Child of the Parent. Only after every intended Child is created and attached, Parent and Children tasks may move onto transition `Init -> Todo`.
- **Transition:** The Parent's `Init -> Todo` transition must precede any Child's `Init -> Todo`. Children may transition `Init -> Todo` in any order after the Parent has reached `Todo+Gated`. This ordering ensures Parent context is captured before any Child execution begins.
- **Structure freeze:** Once a Parent reaches `Todo+Gated`, its Child set is frozen. Children must not be added or detached. If the Child set must change, the Parent must be Cancelled and re-prepared from scratch.
- **Completion gate:** A Parent Task remains at `Todo+Gated` until every Child Task has reached `Lifecycle = Completed` or `Lifecycle = Cancelled`. Cancelled Children count as terminal for this gate. Until the gate is cleared, the Parent's audit must not proceed.
- **Leaf-to-Parent conversion:** A Task that has passed `Init+Gated` may not be retroactively converted into a Parent. To restructure existing work into a Parent/Child shape, the original Task must be Cancelled and replaced with a freshly created Parent and its Children.

### Dependency Tasks

A Task that participates in a dependency edge — either as **Blocked-by** another Task or **Blocking** another Task — declares an ordering constraint between otherwise independent Tasks per §Relations. Dependency relations are distinct from the Parent/Child containment relation; a Task may participate in both, but the two relation types serve different purposes (Parent/Child groups coordinated work; Blocked-by/Blocking orders independent work).

- **Identification:** A Task with one or more **Blocked-by** relations should be labeled `task:blocked`. A Task with one or more **Blocking** relations should be labeled `task:blocking`. Labels may be added or removed per §Dependency freeze; the labels are the canonical identification signal at every point a wake is created or refreshed. A Task may carry both labels when it both depends on others and others depend on it. Implementations must treat both labels as authoritative.
- **Creation:** When all relations are known at Task creation, the Owner creates each Task in `Init+Gated` with the appropriate label and declares relations between them before any participating Task transitions `Init -> Todo`. When a Blocked-by relation is discovered later (e.g., during audit), the dependent Task may be reclaimed from `Revise` back to `Init+Gated` to add the `task:blocked` label and declare the Blocked-by relation, then re-transition `Init -> Todo` for re-audit.
- **Transition:** The **Blocked-by** tasks' `Init -> Todo` transition must precede the **Blocking** tasks' `Init -> Todo`. **Blocking** tasks may transition `Init -> Todo` in any order after the **Blocked-by** tasks have reached `Todo+Gated`. This ordering ensures **Blocked-by** Task's context is captured before any **Blocking** Task execution begins.
- **Dependency freeze (Blocked-by side):** A Task labeled `task:blocked` may have its Blocked-by set modified at any state up to but not including `Todo+Approved`. Once the Task reaches `Todo+Approved`, its Blocked-by set is frozen; subsequent changes require Cancellation and re-prep. Reclaim from `Revise` back to `Init+Gated` re-opens the set for restructure.
- **Dependency freeze (Blocking side):** The `task:blocking` label may be added to or removed from a Task at any point during its pre-terminal lifecycle. `task:blocking` is informational and does not gate dispatch; propagation of "blocker resolved" to dependent Tasks is driven by the blocker reaching a terminal Lifecycle state, independent of the label.
- **Resolution gate:** A **Blocked-by** Task remains at `Todo+Gated` until every related **Blocking** Task has reached `Lifecycle = Completed` or `Lifecycle = Cancelled`. Cancelled **Blocking** tasks count as terminal for this gate. Until the gate is cleared, the **Blocked-by**'s audit must not proceed.
- **Cycle prohibition:** Per §Relations, dependency cycles are invalid. If the graph contains a circular `Blocked-by` / `Blocking` chain, the affected Tasks must not proceed until the cycle is broken through correction of the dependency structure.

## Lifecycle

Lifecycle defines the canonical states a Task occupies as it moves from preparation to completion.

### States

| Status | Lane | Description |
|---|---|---|
| Init | Owner | preparation lane; not yet ready for handoff |
| Todo | Owner ⇄ Assignee | prepared and queued for pre-execution audit; the verdict routes it onward |
| Progress | Assignee | active execution lane |
| Done | Assignee ⇄ Owner | execution complete and queued for post-execution review; the verdict routes it onward |
| Reviewed | Owner | owner accepted the reviewed work; only closeout remains |
| Completed | Terminal | work complete; nothing remains in the lifecycle |
| Pending | Owner | returned to the owner; cannot proceed within current scope |
| Cancelled | Terminal | stopped before completion; may reopen to Init |

`Init` and `Progress` are the two actor work-lanes — the Owner prepares, the Assignee executes. `Todo` and `Done` are the audit queues between them: each straddles both lanes, and the Auditor's verdict hands the Task across to the next lane (`Approved`) or keeps it in the current one (`Revise`).

## Audit

Audit defines the canonical control state governing whether and how a Task may proceed.

### States

| Status | Role |
|---|---|
| Gated | no verdict — awaiting the Auditor (in a `Todo`/`Done` queue) or the actor (in an `Init`/`Progress` lane) |
| Approved | passed audit — proceeds to the next actor |
| Revise | failed audit within policy — returns to the current lane's actor to correct |
| Govern | escalated to the Principal for the final verdict, in place of the Auditor |

## Transition

A Task's control state is the pair `(Lifecycle, Audit)`. A transition moves that pair — both fields advance together as one atomic operation, never separately. Only the transitions below are allowed; `+*` denotes a state that accepts any Audit value (it carries the prior verdict). Each transition is performed by the listed Actor; automation may act only on its behalf.

### Transitions

| From | To | Actor |
|---|---|---|
| Init+Gated | Todo+Gated \| Cancelled+Gated | Owner |
| Todo+Gated | Todo+Approved \| Todo+Revise \| Todo+Govern | Auditor |
| Todo+Govern | Todo+Approved \| Todo+Revise | Principal |
| Todo+Approved | Progress+Gated \| Pending+Approved | Assignee |
| Todo+Revise | Init+Gated \| Cancelled+Revise | Owner |
| Progress+Gated | Done+Gated \| Pending+Gated | Assignee |
| Done+Gated | Done+Approved \| Done+Revise \| Done+Govern | Auditor |
| Done+Govern | Done+Approved \| Done+Revise | Principal |
| Done+Approved | Reviewed+Approved \| Cancelled+Approved | Owner |
| Done+Revise | Progress+Gated \| Pending+Revise | Assignee |
| Reviewed+Approved | Completed+Approved | Assignee |
| Pending+* | Init+Gated \| Cancelled+* | Owner |
| Cancelled+* | Init+Gated | Owner |

### Enforcement

Enforcement constrains when each transition is valid, so a Task's control state cannot advance past a check it has not satisfied.

- **Atomic pairing:** every transition moves the `(Lifecycle, Audit)` pair in one atomic operation — both fields change together or neither does. A lifecycle move and its paired audit reset, or a verdict, are never split across two operations.
- **Init → Todo:** requires the creation-time core elements valid, every Blocked-by/Blocking relation created, and every Child attached.
- **Audit queues:** `Todo+Gated` and `Done+Gated` are the Auditor's queues (pre- and post-execution). `Init+Gated` and `Progress+Gated` are actor lanes — Owner preparing, Assignee working — not audited; they route to the actor.
- **Verdict:** `Gated → Approved | Revise | Govern` must assign Risk and leaves the Lifecycle unchanged.
- **Pre-execution gate (`Todo`):** on the Auditor's `Approved`, the Assignee judges whether the Task's scope and packet are sufficient to execute — accepting into `Progress` (re-gated) or bouncing to `Pending` if insufficient. On `Revise`, the Owner re-defines (`Init`, re-gated) or cancels.
- **Post-execution gate (`Done`):** on the Auditor's `Approved` — the work-product passed review against its spec and deliverable — the Owner accepts into `Reviewed` or cancels. On `Revise`, the Assignee redoes the work (`Progress`, re-gated) or, if the findings exceed the Task's scope, bounces to `Pending`.
- **Progress → Done:** requires Artifacts and Verification present, and any CI the work set in motion observed green — reading the external gates a task started is part of completing the work, not the reviewer's discovery.
- **Re-gate:** entering an actor lane (`Init` or `Progress`) resets `Audit = Gated` in the same atomic operation, carried by the lane's actor (Owner into `Init`, Assignee into `Progress`). Re-gating is re-queuing, not a verdict.
- **Pending:** a Task reaches `Pending` when the Assignee cannot proceed within its current scope — insufficient to start (`Todo+Approved → Pending`), unworkable mid-execution (`Progress → Pending`), or an unresolvable post-execution `Revise` (`Done+Revise → Pending`). It always returns to the Owner, who reclaims (`→ Init`) or cancels, and carries the prior Audit value.
- **Cancellation:** only the Owner cancels. `Cancelled` is reachable only from Owner-routed states (`Init`, `Todo+Revise`, `Done+Approved`, `Pending`); Assignee-routed states bounce to `Pending` instead.
- **Approved persistence:** an `Approved` verdict persists only until the next re-gate; it carries `Done+Approved → Reviewed → Completed`.
- **Govern:** escalates to the Principal, who issues the final verdict (`Approved | Revise`) in place of the Auditor.
- **Reviewed → Completed:** final closeout only — non-substantive logistics that don't change the accepted deliverable, scope, or verification; meaningful work becomes a new Task or a post-execution `Revise`.
- **Terminal:** a transition reaching `Completed` or `Cancelled` completes the Task in its control state — fields and transition comment — and leaves the implementation surface open. The implementation-surface terminal state is set by the terminal event's conduction consumer as its acknowledgment act (`DELIVERY.md §Chaining`).

## Comments

Every lifecycle or audit state transition requires a recorded comment, regardless of whether the transition is performed by a human, agent, bot, or automation. An agent's lifecycle/audit transition is the final operational act of its turn. After completing the atomic transition, the agent ends the turn without further substantive work by leaving a transition comment. This invariant is the near-real-time turn-end signal, letting follow-up processes schedule without colliding with the prior turn's outbound tail.

Each transition comment must include:
- **From:** prior lifecycle state
- **To:** new lifecycle state
- **Actor:** role performing the transition
- **Reason:** direct cause for the transition
- **Rationale:** brief explanation of why the transition is correct
- **Relevant changes / outcome:** material updates, results, or next state context

Transition comments must remain lean and direct. They are transition records, not discussion threads.

### Verbosity

Comments must remain lean **by default** — From/To/Actor lines plus a one-sentence Reason, approximately 100 tokens or less for routine happy-path transitions. The Rationale and Relevant changes/outcome fields are optional on routine transitions and should be omitted when the transition is straightforward.

Verbosity is warranted — a proper paragraph of Rationale and Relevant changes/outcome is **expected** — for transitions that carry a substantive decision or signal an off-path event:

- All **audit transitions** performed by the Auditor (`Gated -> Approved`, `Gated -> Revise`, `Gated -> Govern`). The verdict, Risk classification, and reasoning are the audit trail and cannot be compressed.
- Transitions **into Pending** (`Todo+Approved -> Pending`, `Progress -> Pending`, `Done+Revise -> Pending`). The bounce-back must specify why the Task cannot proceed within scope so the Owner can act on it.
- Transitions **into Cancelled** (`Init -> Cancelled`, `Todo+Revise -> Cancelled`, `Done+Approved -> Cancelled`, `Pending -> Cancelled`). The cancellation reasoning must explain why work will not continue.
- **Owner reclaim** transitions (`Pending -> Init`, `Todo+Revise -> Init`, `Cancelled -> Init`). The Owner explains what was changed and why.

The principle: terse on the happy path, verbose where the transition encodes a decision or off-path event. Downstream agents reading the comment chain on each turn pay for verbosity in context window; default to brevity unless the transition itself is decision-bearing.

## Commits

Task execution lands in the Project's Git repository under explicit attribution and branch discipline, per `PROJECT.md §Branching` and `DELIVERY.md §Stages` (Integration).

- **Per-clone identity.** Each agent's clone sets a distinct `user.name` / `user.email`, so `git log` author stays legible even when agents share one push credential. Author identity — independent of the push credential — is how the AI Lead attributes conflicting hunks at integration.
- **Commit trailers.** Each commit carries a machine-parseable footer attributing the work: `Agent: <id>`, `Task: <task-ref>`, and `Co-Authored-By:` where applicable. The trailers recover per-agent attribution under a shared push credential and survive a migration to a different implementation surface.
- **Working-branch-only push.** An execution Assignee commits on its Task's milestone branch (`feature/**` or `fix/**`) and never pushes to a standing branch (`main`, `dev`). Landing work onto `dev` is the Integration Stage Task's job.
- **AI Lead executes all Integrations** The `project_integration` Stage Task — the milestone-branch → `dev` merge — is carried by the AI Lead as Assignee, because conflict resolution needs the cross-Task context that bounded-context execution agents lack.

## GitHub

GitHub Issues and GitHub Projects together form the current implementation surface for Tasks. GitHub implements the Task contract defined in this policy; it does not redefine it.

### Mapping

Task fields map to GitHub as follows.

**Native**
- **Project:** A Task issue must belong to a GitHub Project.
- **ID:** The GitHub issue number.
- **Title:** The GitHub issue title.
- **Owner:** The GitHub issue author. In this implementation, Task Owner is immutable after issue creation.
- **Assignee:** The GitHub issue assignee. A **scheduled** Task issue must have exactly one assignee. An open issue with **no assignee is parked**: it records that work exists for a future milestone and is not yet scheduled into conduction — no conduction machinery may act on it (no board-reconcile mint, no stall accounting), and no agent may adopt it. Assigning the issue is the act of scheduling; a parked issue entering conduction starts from `Init + Gated` under an assignee.
- **Comments:** GitHub issue comments.
- **Milestone:** For a Task belonging to an active framework Milestone, the GitHub `Milestone` field is set to that Milestone's GitHub Milestone (title = the milestone folder slug). This is a grouping tag only and carries no authority; `milestone.md` remains the single source of truth (see `PROJECT.md §Milestones`).

**Labels**
- **Type:** The Task primary classification must be represented by exactly one label using the form `type:<value>`.
- **Risk:** The Task's effective Preview Risk Code is represented by a label of the form `risk:<code>`, set by the Auditor at Preview and overwritten with the most recent verdict. It carries the Risk Code forward to the post-execution Review, which reads it to set review Depth (see `SECURITY.md §Depth`).

**Project fields**
- **Status:** Maps to the canonical `Lifecycle` state using the exact same values.
- **Audit:** Maps to the canonical `Audit` state using the exact same values.

**Issue body**
- Objective
- Scope
- Constraints
- Primary Specification
- Deliverable
- References
- Artifacts
- Verification
- Contingency

These elements must be maintained in the issue body as canonical Task content. Links are allowed.

### Templates

GitHub Task issues must use a template with sections for:
- Objective
- Scope
- Constraints
- Primary Specification
- Deliverable
- References
- Artifacts
- Verification
- Contingency

Sections may be omitted when unnecessary for readability, but required Task content must still be present when applicable.

Lifecycle and Audit transition comments must use a template with sections for:
- From
- To
- Actor
- Reason
- Rationale
- Relevant changes / outcome

### Workflow

The GitHub Project field `Status` must use the exact canonical `Lifecycle` values:
- Init
- Todo
- Pending
- Progress
- Done
- Reviewed
- Completed
- Cancelled

The GitHub Project field `Audit` must use the exact canonical `Audit` values:
- Gated
- Approved
- Revise
- Govern

Canonical Task state lives in the Project `Status` and `Audit` fields. The GitHub issue stays open through every Lifecycle state, the terminal transition included: the actor performing `-> Completed` or `-> Cancelled` sets the fields, posts the transition comment, and ends its turn with the issue open. The issue close is the terminal event's acknowledgment, performed by its conduction consumer on the cue turn after the chained work is done (`DELIVERY.md §Chaining`) — with `state_reason = completed` for `Completed` and `state_reason = not_planned` for `Cancelled`. The dispatch layer completes the terminal wake and its lease on the close event, releasing the conduction lane.

### Atomic

GitHub Task creation and Task operations must remain atomic.

A GitHub issue becomes a valid executable Task only when it is created as one atomic operation including:
- issue title
- issue body using the Task template
- attachment to the GitHub Project
- `Status = Init`
- `Audit = Gated`
- exactly one assignee
- exactly one `type:<value>` label

A GitHub issue transition is valid only when it is performed as one atomic operation including:
- issue body update when required
- one allowed transition — a single `Status` move, a single `Audit` move, or a paired re-gate setting both `Status` and `Audit = Gated`
- transition comment provided using the template
