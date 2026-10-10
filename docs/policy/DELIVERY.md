# Delivery as Project Conduction

## Purpose

DELIVERY is the conductor's manual for moving a milestone through its stages, between the Principal's checkpoints, in order and on time. Its primary reader is **Sarge**, the Project Manager, the role that conducts this motion.

## Principles

- **Conveyance-only:** Sarge drives a milestone forward — sequencing and moving the work — but sets none of its direction; he is the driver, not the navigator.
- **Stage-sequenced:** Sarge advances the milestone one stage at a time, pausing at the Principal's checkpoints between them.
- **Ownership-as-management:** Sarge owns every Task and delegates its work; he manages execution rather than performing it.
- **Decisions-routed:** Sarge produces no decision of his own; when one is needed he routes it to the authority that owns it — the Auditor's verdict, the Principal's Govern, the AI Lead's judgment.
- **Chain-driven:** a stage reaching its terminal state is the signal for the next; chaining is the mechanism that carries a milestone from stage to stage.

## Delivery

The conduction model — the rules that span every stage. The per-stage timetable is `## Stages`.

### Conveyer

Sarge is the conveyer: he moves a milestone forward through its stages autonomously, driving the work between the Principal's checkpoints without waiting to be pushed. His concern is motion and discipline — advancing each stage to the next, in order and on time.

He conveys by keeping every piece of work inside an owned, tracked Task. Sarge owns each Task: creation is ownership, and the Owner is immutable once set. When work needs doing — building a feature, editing a spec, resolving a merge, applying a fix — or when a candidate surfaces from elsewhere, he creates and assigns a Task for it rather than doing it himself, so all work enters the same tracked lifecycle. This is what makes delivery **repeatable** — every milestone advances the same way, stage by stage — and **traceable** — every action is an owned Task with a recorded trail.

### Checkpoints

Checkpoints are the human-authority boundary of conduction: the fixed points where control passes to the Principal. Between checkpoints Sarge conveys on delivery authority alone; at a checkpoint he halts and resumes only on the Principal's decision.

- **Start** — a milestone enters conduction on the Principal's direction: the start event reaches Sarge (`§Communication`), and Sarge opens the milestone by creating its Draft Stage Task.
- **Verify** — the Charter, the Draft's specifications, and the Review's outcome advance only on the Principal's verification: the post-execution audit of an Inception, Draft, or Review Stage Task always emits `Govern` (`SECURITY.md §Review`), reserving acceptance for the Principal.
- **Govern** — a `Govern` verdict at either audit gate, or any decision reserved for the Principal under `FRAMEWORK.md §Authority`, halts conduction until the Principal resolves it.

### Communication

Sarge's communication with the Principal is outbound: one-way notices over the Project's channel (`PROJECT.md §Structure`). Inbound, conduction is event-driven: start events, stage-terminal events (`§Chaining`), deployment cues and directions (`§Deployment`), workflow triggers (`§Operation`), and hotfix directions (`§Hotfix`) reach Sarge as dispatches.

- **Checkpoint notices** — on reaching a Verify or Govern checkpoint, Sarge notifies the Principal with the decision required and its Task reference; the decision returns through the Task's transition, and conduction resumes on it.
- **Standing brief** — Sarge briefs the Principal on ongoing milestone progress, risks, and blockers on a set cadence, keeping the Principal ahead of the work.

### Chaining

Conduction advances by chaining: a stage reaching its terminal state obligates Sarge to create the next stage's Task. The Verify checkpoints ride inside the Stage Tasks' audits (`§Checkpoints`), so a chained stage's terminal state already carries the Principal's verification. Three kinds of chain:

- **Mechanical** — a fixed 1:1 succession Sarge effects without judgment: `Draft → Decomposition`, `Decomposition → Execution`, `Review → Release`.
- **Judgment** — a succession Sarge reads milestone state to effect:
  - `Execution → Integration` is per-branch, over the milestone's working branches — its `feature/**` and `fix/**` lanes (`PROJECT.md §Branching`). A branch's top-level Task — its Parent, or a solo Task — reaching `Completed` triggers that branch's Integration, and at most one Integration is open per branch; a branch needing further work resumes against its open Integration, and created Integrations execute serially (`§Integration`). A branch whose top-level Task is Cancelled leaves the milestone's integration set, recorded in `decomposition.md`.
  - `Integration → Review` is aggregate. Review is created once every branch in the milestone's integration set has been integrated onto `dev`, and at most one Review is open per milestone: Integrations completing back-to-back converge on one Review round.
- **Directed** — the deployment chains: each environment's deployment manual names the stage-terminal or routed event — typically surrounding a stage task, before or after it — on which Sarge creates that environment's Deployment Stage Task (`§Deployment`, `PROJECT.md §Deployments`). The manual fixes the where; the cue is always an existing routed dispatch (`§Communication`).

Chaining is the push mechanism of autonomy: each accepted stage releases the next without further human dispatch.

**Acknowledgment.** Every terminal transition leaves its issue open (`TASK.md §Enforcement`) and cues Sarge; closing that issue is Sarge's acknowledgment of the cue, and the final act of the cue turn. The close follows the chained work: Sarge closes the predecessor once the successor Task is created and queued — or once he concludes the cue chains nothing. The dispatch layer completes the cue's wake and lease on the close event, releasing the conduction lane; until the close lands, it re-nudges the cue turn, so an interrupted chain resumes. Cue handling is idempotent: Sarge verifies the successor's existence before creating it, so a repeated cue converges on the same chained state.

### Progression

Within a stage, Sarge drives its Task across the two-gate state machine (`TASK.md §Transition`) as Owner:

- **Re-gating.** Sarge carries every owner-lane re-entry — reclaiming a revised, bounced, or cancelled Task back to preparation. Re-gating is re-queuing, never a verdict.
- **Routing verdicts.** On the Review verdict, Sarge routes the Task: `Approved` — he accepts the work-product into `Reviewed`, and the Assignee closes it out; `Revise` — the Assignee redoes the work; `Govern` — the Principal decides (`§Checkpoints`).
- **Accepting, rejecting, escalating.** Acceptance and rejection of stage output are owner acts; a decision beyond his authority escalates rather than resolves.
- **Unblocking.** When progression pauses, Sarge clears it by delivery means only — creating Tasks, refining definitions, re-sequencing. An assignee's revision that exceeds its Task's scope returns to Sarge through `Pending`; he reclaims the Task, declares it Blocked-by a new execution Task he creates on the same branch and assigns where the work belongs (`TASK.md §Dependency Tasks`), and the reclaimed Task proceeds when its blocker completes.

Sarge never makes the verdict, only sequences and routes — the Auditor judges, the Principal Governs, the AI Lead and Specialists execute.

## Stages

The per-stage manual — the timetable. A milestone is conducted through the loop's stages in order; Deployment, Operation, and Hotfix stand beyond the loop, entering as their sections direct.

Each lifecycle stage except Execution is carried by a **Stage Task** — the unit of work that performs the stage and produces its deliverable. Execution is carried by the milestone's Execution Tasks themselves, not by a single Stage Task.

- A Stage Task must satisfy `TASK.md`.
- No meaningful stage work may proceed outside its Stage Task.
- Each Stage Task makes explicit, at minimum, its **Type**, **Scope**, **Primary Specification**, and **Definitive Deliverable**.
- If a stage's work contains multiple distinct actions or outputs, it must be decomposed into child Tasks before execution, each satisfying **The One Rule** (`TASK.md §Granularity`).

### Inception

Inception establishes the first valid boundary of the Project: it turns a mission into a real operating container with its initial record, context boundary, homespace, and actor structure, from which Draft can proceed. By the end of Inception a Project has its Charter, Channel, Team, Project path, and Backlog (`PROJECT.md §Structure`).

Inception precedes conduction, and its Stage Task is the one Task the Principal owns rather than Sarge. A Project is founded from discussion: when a mission the Principal and the AI Lead are shaping turns fruitful, the Principal directs the founding and the AI Lead invokes the founding scaffold. The scaffold raises the Project's container first — homespace, repository, coordination surface — and creates the Inception Stage Task upon it under the Principal's identity: Owner the Principal, Assignee the AI Lead. The Task's scope carries the pointers to the founding conversation and materials from which the AI Lead authors the Charter, instantiated from the canonical charter template (`PROJECT.md §Structure`); the Principal steers revision through the Task's comments. The authoring runs on the `feature/inception/charter` lane off `dev` (`PROJECT.md §Branching`), merging at close. Its post-execution audit emits `Govern` (`§Checkpoints`), and the Principal's acceptance of the Charter closes Inception.

- **Stage Task** — Type `project_inception` · Owner: the Principal · Primary Specification: this and `PROJECT.md` · Definitive Deliverable: `main/docs/charter.md`; runs on `feature/inception/charter` off `dev`.
- **Checkpoint** — the Principal founds the project and verifies its Charter.
- **Next** — Inception → Draft, on the start event (`§Communication`).

### Draft

Draft prepares the Project for bounded execution: it produces and updates the canonical Project context needed for later Decomposition, Execution, and further Draft cycles. Draft produces its artifacts in a causal chain — `Research → Specs → Milestone`: research investigates the problem, its findings shape the specs, and the specs define the milestone's scope.

A milestone originates in the Project's channel, where the Principal and the AI Lead settle the next pursuit; the settled direction is emitted as the start event — at Inception's completion for a Project's first milestone, at the Principal's discretion thereafter. The start event reaches Sarge (`§Communication`), who opens the milestone by creating the Draft Stage Task, Assignee the AI Lead, its scope carrying the settled direction and the pointers to the originating discussion.

A milestone becomes **Active** through its Draft Stage Task: authoring the milestone's `milestone.md` and setting the active-milestone pointer in `main/docs/charter.md` is the Draft Stage Task's responsibility, performed on its feature branch off `dev`. The Draft Stage Task is the sole act that brings a milestone into Active state. What to build next may be wholly unplanned until a Draft Stage Task is opened to define it. Within a milestone, spec creation and modification are performed by the Draft Stage Task through `type:spec` child Tasks.

A milestone carries fix work alongside its features: the bugs, defects, and enhancements the Principal and the AI Lead decide to include — promoted from the Backlog or carried from review and operation findings — enter the milestone at Draft and are recorded in `milestone.md` for Decomposition to size onto their `fix/**` lanes.

Draft does not end until its Research, Specs, Milestones, and Provision are explicit enough that later agents can derive Tasks and execute them through bounded retrieval rather than full-project context loading.

- **Stage Task** — Type `project_draft` · Primary Specification: the current Charter and `PROJECT.md` · Definitive Deliverable: the active `milestone.md` recorded in `main/docs/charter.md`; runs on a feature branch off `dev`.
- **Checkpoint** — the Principal directs the milestone's start and verifies its specifications (`§Checkpoints`).
- **Next** — Draft → Decomposition.

### Decomposition

Decomposition turns the current milestone into executable work: it derives a bounded task set from the milestone and packages each Task with only the Project context required for execution.

It works from a bounded context bundle — `main/docs/charter.md`, the active milestone record, the specs and research that milestone links, and the current Provision summary with any referenced material under `main/provisions/`. It must not depend on full-project context loading.

It derives Tasks from the current milestone, following the feature structure of the milestone's specs: by default one Execution Task per feature, subdividing only per the Anti-rule (`TASK.md §Granularity`). A Task is a unit of independent verification — it carries one coherent verification of its scope against the spec. Where the Anti-rule splits a feature, the feature becomes a Parent Task and its pieces become Child Tasks (`TASK.md §Parent Task`), all on the feature's one branch and integrated once.

Decomposition covers the milestone's fix work with the same judgment. The bugs, defects, and enhancements the milestone carries from Draft — already present as Tasks on the Project — are verified against The One Rule like any feature: a fix requiring more than one Task is subdivided per the Anti-rule into a Parent and its Children on the fix's one `fix/**` branch before it enters Execution. Features and fixes together form the milestone's **integration set** — the milestone branches Integration will land (`§Chaining`) — recorded in `decomposition.md` with one planned Integration per branch.

Decomposition records the **order** of the derived Tasks — prerequisite dependencies and blockers, which Tasks may proceed in parallel, the intended sequence where order matters, and any checkpoints that should trigger review before more Tasks are released — in `decomposition.md` (`PROJECT.md §Records`). The record is the task set's design, complete enough that Sarge can create every Execution Task from it without further judgment; creating them is Sarge's act on the `Decomposition → Execution` chain (`§Chaining`, `§Execution`), for creation is ownership (`§Conveyer`).

Decomposition does not end until the current milestone has been converted into this bounded task-set design, from which the Execution Tasks can be created and executed through `TASK.md` without broad Project-context loading.

- **Stage Task** — Type `project_decomposition` · Primary Specification: the active `milestone.md` and `PROJECT.md` · Definitive Deliverable: the active `decomposition.md`; runs on a feature branch off `dev`.
- **Next** — Decomposition → Execution.

### Execution

Execution advances the active Milestone through bounded Task work, converting the decomposed task set into concrete deliverables ready for Review. It begins as the `Decomposition → Execution` chain: Sarge creates the Execution Tasks the decomposition record defines — each at `Init+Gated`, its Parent/Child and dependency relations declared — and moves the set to `Todo+Gated` in the relation-mandated order (`TASK.md §Dependency Tasks`, `§Parent Task`), so the audit and dispatch gates can sequence them.

Project execution proceeds through Tasks per `TASK.md`. No meaningful execution work may occur outside the Task system; informal chat activity or undocumented work do not carry Project execution. Tasks in Execution consume only the bounded Project context prepared through Charter, active Milestone, related Research, referenced Specs, and current Provision — broad Project-context loading at execution time is a Decomposition failure, not an Execution accommodation.

Execution is milestone-scoped: the active Milestone recorded in the Charter is the only Milestone whose Tasks enter Execution.

**Boundary control.** If Execution reveals missing scope, contradictory instruction, invalid specification, or new work outside the active Milestone boundary, Execution must not expand informally: the discovering Assignee bounces its Task to `Pending` with the gap named. Sarge reclaims it Blocked-by a corrective Stage Task assigned to the AI Lead — a Draft Stage Task where specification or scope must be re-defined, a Decomposition Stage Task where only the task-set design must change — while lanes untouched by the invalid boundary continue. The corrective stage closes through its own gates, the blocked work re-enters through the normal chain, and `decomposition.md` records the execution-discovered issues and the resulting changes, so the Milestone trace stays current.

Execution does not end until the active Milestone's bounded task set has reached terminal Task states and is ready for Review.

- **Carried by** — the milestone's Execution Tasks (no single Stage Task).
- **Next** — Execution → Integration, per-branch (`§Chaining`).

### Integration

Integration lands each completed milestone branch — a `feature/**` or `fix/**` lane (`PROJECT.md §Branching`) — onto the standing `dev` branch through a pull request, resolving conflicts and recording the result, so the integration moment — not every Task — is where merge judgment happens. A Project enters Integration when a milestone branch's Execution Tasks have reached terminal states and its work is ready to land on `dev`.

A milestone may have an arbitrary number of integrations — one per branch in its integration set, identified during Decomposition and recorded in `decomposition.md`. Each milestone-branch → `dev` merge is one `project_integration` Stage Task, carried by the AI Lead as Assignee, because conflict resolution requires the cross-Task context that bounded-context execution agents lack.

A milestone's Integrations execute serially, in linear order: one Integration Task proceeds at a time, and Sarge releases the next only after the current reaches its terminal state.

**The merge is load-bearing work, completed in execution.** Within the Integration Task's `Progress`, the AI Lead rebases the branch onto current `dev`, resolves conflicts, opens the pull request, and lands the merge. The merge's gate is **CI** — build and tests on the merge-result ref — since the branch's code was reviewed at its execution Tasks' `Done+Gated` and the merge is the one new artifact CI validates. The pull request merges on green CI, re-validating against `dev`'s current tip per the merge-serialization invariant (`PROJECT.md §Branching`).

**Review examines the merge.** At the Integration Task's `Done+Gated`, the Auditor reviews what the merge created: the conflict resolutions, and the branch's correctness amid the work already on `dev`. The branch's own code passed review at its execution Tasks' gate, and CI validated the merge result mechanically; this review judges the combination — the eye on the milestone's integrated state before further work builds on it.

A `Revise` at this Review routes by its findings: work missing from the integration itself returns to the Assignee (`Done → Progress`); work missing from the branch under integration exceeds the Task's scope — the Integration bounces to `Pending`, Sarge reclaims it Blocked-by a new execution Task on the branch (`§Progression`), and the Integration re-runs once the blocker completes, re-integrating the branch.

Integration does not end until every branch in the milestone's integration set has been merged into `dev` and its integration record (`PROJECT.md §Records`) produced.

- **Stage Task** — Type `project_integration` · Primary Specification: the governing integration spec and `PROJECT.md` · Definitive Deliverable: the milestone branch merged into `dev` via its pull request, recorded in `integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md`.
- **Next** — Integration → Review, aggregate once the milestone's integration set is fully integrated (`§Chaining`).

### Review

Review evaluates the completed task set and its deliverables against the active Milestone's Scope, Deliverables, and Verification, and produces a deployable closure record: the milestone's completion state — complete, partially complete, or carrying explicit gaps — and the release-readiness knowledge the following Release and its Deployments need (`PROJECT.md §Records`). A Project enters Review when the milestone's integration set is fully integrated onto `dev` (`§Chaining`); the Review is carried by the AI Lead as Assignee, since judging the milestone whole requires the cross-Task context bounded execution agents lack.

The Review Stage Task carries two duties: the evaluation itself — the AI Lead reads the completed Tasks and their deliverables against the milestone record — and the staging of its evidence: Development runs the integrated milestone, prepared for the Principal's hands-on verification. The evaluation extracts what deployment must know: the record's Deployment section carries the milestone's deployability verdict and the release-specific instructions that supplement the standing deployment manuals (`PROJECT.md §Records`) — new environment requirements, migration steps, changed smoke expectations — for the Deployments that follow the release to consume (`§Deployment`). The Task's post-execution audit emits `Govern` (`§Checkpoints`), so the round closes on the Principal's verification of both the record and the running result.

Gaps close through the Review itself, and both discovery paths land in `Pending`: the AI Lead's findings during evaluation bounce the Task `Progress → Pending`; the Principal's findings at the checkpoint arrive as the governed audit's `Revise`, and the Task bounces `Done+Revise → Pending` — each carrying its findings in the transition comment. From `Pending`, Sarge reclaims the Review Blocked-by the fix Tasks he creates from those findings — bugs, defects, and enhancements on the milestone's `fix/**` lanes (`§Progression`). The fixes execute and integrate through the normal chain, and the Review re-runs, producing a new timestamped review record; prior records are preserved (`PROJECT.md §Records`). Review does not end until the current record concludes the milestone complete and deployable.

**Last call.** Sarge's Review checkpoint notice surfaces the outstanding `main`-carried fix items — the records hotfixes left for `dev` (`§Hotfix`, `PROJECT.md §Branching`) — and the Principal's verification is the last call for folding them into the closing milestone as `fix/**` work; what he leaves stands for a later milestone.

- **Stage Task** — Type `project_review` · Primary Specification: the completed `milestone.md` and `decomposition.md`, prior review records, and `PROJECT.md` · Definitive Deliverable: `review_<YYYY.MM.DD.HH.mm.SS>.md`; runs on a feature branch off `dev`, merging at close.
- **Checkpoint** — the Principal verifies the Review output (`§Checkpoints`).
- **Next** — Review → Release, on a record concluding complete and deployable (`§Chaining`).

### Release

Release publishes the reviewed Milestone's outcomes as a versioned Project artifact and retires the milestone from Active: it produces the release notes, closes the milestone on record, and seals the source state with a durable version tag. A Project enters Release when Review has closed on a deployable review record (`§Chaining`); the Release is carried by the AI Lead as Assignee, and a Milestone produces exactly one Release.

The Release Stage Task publishes through two pull requests (`PROJECT.md §Releases`). The first merges its stage lane to `dev`, carrying all the Release's repo work: the release notes, the publishing-merge record, and the Charter close-out — the closed Milestone moved to Past with the Active slot cleared, Path and Products refreshed, the milestones index updated, the Milestone's status set `Completed`. The second is the `dev -> main` publishing merge — a pull request gated by release CI, merging on green — advancing `main` to the release state; the version tag stamps the merge commit, the Release's final act.

Release ends at publication: the version tag in place, the release record and closed milestone state on `main`, the Active slot empty. What becomes of the published state is Deployment's work (`§Deployment`).

- **Stage Task** — Type `project_release` · Primary Specification: the most recent deployable `review_<YYYY.MM.DD.HH.mm.SS>.md`, the current Charter, and `PROJECT.md` · Definitive Deliverable: `main` advanced to the published release state and tagged `v<YYYY.MM.DD>`, carrying `main/releases/release_v<YYYY.MM.DD>/release.md`; runs on `feature/<full-milestone-name>/release` off `dev`.
- **Next** — conduction of the milestone ends at publication; the next milestone begins on its own start event (`§Checkpoints`).

### Deployment

Deployment carries a repository state — a snapshot of either standing branch — into one named environment, exactly as that environment's deployment manual directs (`PROJECT.md §Deployments`). The manual is the invocation's Primary Specification: it defines where the Task attaches, the mechanism, the smoke verification, the rollback, and the record an invocation produces. An invocation deploying a milestone's work reads the manual together with the Deployment sections of that milestone's review records — the release-specific knowledge that supplements the manual (`§Review`, `PROJECT.md §Records`) — and performs the deployment from both. A Deployment Stage Task exists only for an environment holding a manual, and each invocation is its own Stage Task — repeat invocations against the same state are normal, each a distinct Task.

A Deployment initiates two ways, and Sarge owns and drives it either way (`§Progression`): **chained** — the manual names the event that cues Sarge to create the Task (`§Chaining`); **on direction** — the Principal or the AI Lead directs an invocation, reaching Sarge as a dispatch (`§Communication`). Assignee is the AI Lead.

Within `Progress` the Assignee performs the manual: the deploy acts, the waits and their confirming signals, and the smoke verification against the target environment. The invocation completes with the environment running the deployed state and the record the manual requires produced. An Assignee unable to perform the deploy bounces the Task to `Pending`, and Sarge proceeds per `§Progression`.

A failed attempt is still a completed invocation: the Assignee returns the environment to its previous stable state per the manual and carries the Task to `Done` regardless — the rollback is the invocation's result, and it must reach the post-execution audit. The failure and its reason are recorded in the transition comment, and in the deployment record where the manual requires one, so the Auditor reads a `Done` Task whose result is a rolled-back environment and emits `Govern` (`SECURITY.md §Outcome`). The Task parks at the checkpoint, Sarge carries the failure to the Principal (`§Communication`), and the Principal's verdict disposes it: retry, corrective work recorded as bugs, defects, or enhancements, a hotfix on his direction, or cancellation.

- **Stage Task** — Type `project_deployment` · Primary Specification: the environment's `deploy_<environment>/<environment>.md` manual · Definitive Deliverable: the environment running the deployed state, smoke-verified, with the record the manual requires.
- **Checkpoint** — a failed deployment parks at `Govern`; the Principal decides its disposition (`§Checkpoints`).
- **Next** — Deployment stands outside the loop; it attaches around stages per its manual's chaining (`§Chaining`).

### Operation

Operation runs the Project's accepted Release outputs as recurring, scheduled, or operator-triggered work, captured as runs against prepared workflows — turning released capability into repeatable real-condition execution without collapsing recurring work into one indefinite Task. A Project enters Operation when a Deployment has carried released capability into its live environment and a prepared workflow describes how to use it (`PROJECT.md §Workflows`). Operation runs in parallel with subsequent Milestone loops.

Each run begins as an event: a trigger's fire — schedule, upstream event, or operator action — reaches Sarge as a dispatch (`§Communication`), and Sarge creates the run's Operation Stage Task, assigned per the workflow's definition. Each invocation is its own Stage Task producing the record its workflow defines (`PROJECT.md §Workflows`); a single workflow may have many over its lifetime, each a distinct run.

**Reentry.** If recurring execution reveals broken assumptions, contradictory goals, invalid workflow design, or a need for materially new capability, the gap becomes milestone work: the finding surfaces to the Principal (`§Communication`), and the return to Draft begins as any milestone does — on its own start event (`§Checkpoints`). The workflow that surfaced the gap remains for reference and may be revised in that Draft cycle; runs produced under the old definition stay as historical record.

- **Stage Task** — Type `project_operation` · Primary Specification: the workflow's `workflow.md`, the current Release(s) it consumes, and `PROJECT.md` · Definitive Deliverable: the record its workflow defines.

### Hotfix

A hotfix defends Production: it corrects a defect in the released state, outside the milestone loop and its chaining. Whether a live defect warrants a hotfix — rather than a `fix/**` Task in the milestone loop — is the Principal's call: a hotfix initiates only on the Principal's direction. A hotfix need arising while a milestone stands at Release waits for the release to land; a defect persisting in the new `main` hotfixes from there.

The direction reaches Sarge as a dispatch (`§Communication`), and Sarge owns and drives the hotfix Stage Task as any other (`§Progression`): Assignee the AI Lead, its scope carrying the defect finding and the pointers to the originating discussion, both audit gates in force — Preview classifies the production-touching chain, Review judges the shipped correction. In absolute urgency the Principal creates the Task directly, and Principal ownership rides Fast-Pass through both gates (`SECURITY.md §Principal Fast-Pass`) — the gates traded for speed on the Principal's own authority. Either way, Sarge carries the hotfix in the standing brief.

The hotfix Stage Task is execution, integration, and release compressed into one, on a `hotfix/<slug>` lane off `main` (`PROJECT.md §Branching`): the corrective work; the release work on the same lane — the release record and notes, the Charter refresh; the pull request to `main` gated by focused CI, merging on green; and the version tag on the merge commit, the Task's final repo act. Its records follow `PROJECT.md §Releases`. Deployment of the corrected release follows the general path (`§Deployment`).

The fix reaches `dev` by record (`PROJECT.md §Branching`): the hotfix Stage Task leaves a recorded fix item — a bug, defect, or enhancement carrying the equivalent change — in the active milestone's fix work, or the Backlog when none is active; `dev` receives it through a normal `fix/**` lane at milestone pace, and the Review last-call surfaces items still standing when a milestone closes (`§Review`).

- **Stage Task** — Type `project_hotfix` · Primary Specification: the defect finding and `PROJECT.md §Branching` · Definitive Deliverable: the corrected release — `main` re-released and tagged, the equivalent change recorded for `dev`.
- **Next** — Deployment carries the corrected release per its manuals' chaining (`§Deployment`); the recorded fix item enters the milestone loop at its pace (`§Review` last call).
