# Security as Execution Control Protocol

## Purpose

Security defines how the framework controls agent work at the Auditor's two gates: a **pre-execution audit (Preview, `Todo+Gated`)** that classifies what a Task will do, and a **post-execution audit (Review, `Done+Gated`)** that judges what it produced. At both gates the Auditor emits `Approved`, `Revise`, or `Govern`.

- Define the canonical security control model used to classify Tasks and operations at Preview.
- Record each Preview Risk Code in its audit comment so repeated triage stays traceable, and carry the Task's effective Risk Code forward as a `risk:` label for later stages to read.
- Establish primitive classification from `Action × Subject × Zone` before higher-level modifiers or project-specific overlays are applied.
- Ground security judgment in primary effect rather than loose task wording or transport mechanics.
- Extend the Auditor's mandate to a post-execution Review of the work-product against its specification, performed independently of the author.
- Preserve a path for safe autonomy expansion through explicit classification, audit, and later refinement.

## Principles

- **Primitive-first:** Preview classification must begin from low-level operations before higher-level task semantics or workflow narratives.
- **Effect-governed:** Preview classification follows the primary effect of an operation, not merely the tool, implementation, or transport used to perform it.
- **Composite-aware:** Real work may combine multiple primitive operations; the Auditor must classify the meaningful composite rather than forcing everything into one verb.
- **Narrow-first:** Primitive definitions should stay lean and strict; ambiguity should be resolved by revision or later policy refinement rather than semantic expansion.
- **Independent-review:** post-execution Review must be performed by a different model than the work's author; self-review shares the author's blind spots.
- **Spec-governed:** post-execution Review judges the work-product against its governing specification; passing automated checks do not establish correctness.
- **Ambiguity-conservative:** When judgment is unclear, security posture must tighten rather than assume safety.

## Security

Security is the canonical control layer for agent execution. The Auditor runs two symmetric gates: **Preview** (pre-execution, `Todo+Gated`) classifies what a Task will do and assigns its Risk Code; **Review** (post-execution, `Done+Gated`) judges what the Task produced. Each gate emits `Approved`, `Revise`, or `Govern`, and every verdict is recorded in the Task transition comment required by `TASK.md`.

### Principal Fast-Pass

Principal authority carries a Task through both audit gates. Before any other gate processing, the Auditor must check whether the Task Owner or Task Assignee resolves to `role: principal`; if either does, the gate resolves under Principal Fast-Pass:

- At **Preview** (`Todo+Gated`), the Auditor emits `Approved` and assigns `R0`; mandatory Task core validation, primitive extraction, and Resolver are skipped.
- At **Review** (`Done+Gated`), the Auditor emits `Approved` without 5C examination — except a checkpoint Stage Task, which Governs unconditionally (`§Outcome`).

At either gate, Lifecycle is unchanged and Audit moves from `Gated` to `Approved` through the normal Auditor transition. The audit comment must identify which Task role resolved to Principal and state that approval was granted by Principal Fast-Pass.

Principal Fast-Pass applies only when Principal is directly present as Owner or Assignee. It does not apply merely because Principal discussed, requested, or inspired the work outside the Task record.

## Preview

Preview is the Auditor's pre-execution gate (`Todo+Gated`). It classifies the Task through the `Action × Subject × Zone` primitive model, assesses its risk, and emits a Risk Code and verdict before any execution begins.

### Classification

Primitive security classification begins from a three-part operation envelope that allows the auditor to understand the nature of a Task without full project context:

`Action × Subject × Zone`

- **Action:** the primitive operation being performed.
- **Subject:** the thing being acted on.
- **Zone:** the zone where that subject resides.

`Action`, `Subject`, and `Zone` are the primitive components of classification. One normalized `Action × Subject × Zone` tuple is a primitive operation. One or more primitive operations extracted from a Task form an operation chain.

### Actions

Action is the first primitive component. It is organized into Action classes, each containing Action primitives. A primitive operation is classified by its primary effect rather than by the low-level delivery path. Similar operations may correspond to different Action primitives depending on the effect they cause.

- Classification follows primary effect rather than transport.
- A Task may involve multiple primitives.
- Subject and Zone refine Action; they do not replace it.
- If Action cannot be classified cleanly, audit must not infer safety.

#### Observe

Observe obtains information without changing the subject or moving payload into or out of its current zone.

- **Search:** discover likely targets by matching, similarity, or relevance.
- **Query:** retrieve from a structured source using explicit selectors, predicates, keys, or field constraints.
- **Enumerate:** reveal which subjects exist within a known scope or container.
- **Inspect:** determine the state, structure, attributes, or appearance of a known subject or representation without recovering a payload it carries.
- **Read:** recover a meaning-bearing payload from a known subject or from a representation of that subject.

#### Ingress

Ingress brings payload into the current zone.

- **Receive:** accept payload delivered into the current zone by another sender, endpoint, or system.
- **Fetch:** retrieve a specific payload or object into the current zone.
- **Pull:** synchronize or propagate state into the current zone from an upstream source.

#### Modify

Modify changes a subject without materially removing it, executing it, or causing ingress or egress as the primary act.

- **Create:** bring a new subject into existence.
- **Append:** add payload to an existing subject while preserving its prior payload.
- **Update:** change an existing subject in place.
- **Move:** change the placement context of an existing subject while preserving its identity and payload.
- **Arrange:** change the order, grouping, ranking, or in-scope precedence of existing subjects without changing their substantive content.

#### Destruct

Destruct materially removes a subject, its payload, or its authority.

- **Delete:** remove a subject from active existence.
- **Truncate:** remove payload from a subject while preserving the subject's identity.
- **Revoke:** remove authority, entitlement, or access while preserving the surrounding subject or system.

#### Execute

Execute causes a program, workflow, service, job, or runtime to run or change runtime state.

- **Invoke:** call a selected entrypoint that encapsulates defined function, feature, or logic.
- **Interpret:** execute logic supplied directly by the agent inside a general-purpose runtime or interpreter.
- **Control:** change the lifecycle or runtime state of a running or managed process, service, worker, container, job, or device runtime.

#### Egress

Egress sends payload out of the current zone.

- **Send:** deliver payload to identified recipients from its current zone.
- **Submit:** hand payload into a remote intake, processing, review, queueing, storage, or decision surface.
- **Push:** propagate state out of the current zone to a managed remote target.
- **Publish:** expose payload to an audience-facing surface.

### Subjects

Subject is the second primitive component. It is organized into Subject classes, each containing Subject primitives. Subject defines what an action is applied to.

#### Data

Data subjects contain meaning-bearing payloads.

- **File:** a discrete payload unit addressed as one object. A File may contain internal structure, but it is not classified by structure-aware member access.
- **Record:** one addressed member of a structured data system. A Record implies structure-aware access, including fields, selectors, schema, or partial retrieval.
- **Store:** a container or system that holds multiple payload-bearing members.
- **Repository:** a versioned store of files, history, and repository state.

#### Control

Control subjects govern behavior, access, or authority.

- **Config:** operational settings that shape system behavior.
- **Policy:** governing rules that constrain behavior or authority.
- **Credential:** secret-bearing material used to prove access.
- **Permission:** an authority grant or access rule.
- **Identity:** a principal to which credentials, permissions, or authority may attach.

#### Interface

Interface subjects are operational surfaces or utility-providing components used by a task.

- **Endpoint:** an entry point of interaction exposed by a capability-bearing system and used by calling it.
- **Surface:** a rendered or interactive representation exposed for observation or interaction.
- **Service:** a runtime entity that provides utility while running or managed.
- **Job:** a bounded executable unit that is inactive until started and ends when finished.

#### Content

Content subjects are consumable meaning-bearing units addressed to recipients or audiences.

- **Message:** a directed content unit addressed to one or more recipients or participants.
- **Publication:** an audience-facing content unit prepared for availability or consumption.

#### Infrastructure

Infrastructure subjects are physical or operational assets that host, connect, or carry system capability.

- **Host:** a compute host that runs or contains runtime components.
- **Device:** an addressable hardware unit managed as one operational object.
- **Network:** a connectivity or routing surface that carries or controls communication.

### Zones

Zone is the third primitive component. It is defined directly as a flat set of zones. Zone defines where a subject resides when acted on. Source Zone does not change merely because a Task intends to move or copy the subject elsewhere. When a Task moves payload or state between zones, extraction must represent that movement through the relevant primitive operation chain rather than collapsing source and destination into one Zone.

- **Workspace:** the bounded Project work area as a logical Project zone, not merely one machine or one physical path.
- **Local:** the current machine or runtime environment outside the workspace.
- **Internal:** a non-public environment or surface inside the current operating perimeter.
- **External:** a non-public environment or surface outside the current operating perimeter.
- **Public:** an audience-exposed environment or surface open to general visibility or access.

### Assessment

At the **pre-execution gate** (`Todo+Gated`), risk assessment determines the Task Risk Code from extracted primitives. Audit decision is then made by translating the Risk Code into the required audit state and audit record defined by this policy.

#### Input

Auditor performs risk assessment from a bounded audit packet rather than from full project context.

The bounded audit packet should contain:
- the mandatory Task core required for audit entry validation
- the relevant Project charter document
- the explicit references required to understand the intended work

#### Audit Entry Validation

If Principal Fast-Pass does not apply, Auditor must validate that the bounded audit packet contains the mandatory Task core required for audit entry before primitive extraction.

Mandatory Task core:
- Project
- ID
- Title
- Type
- Objective
- Scope
- Specification
- Deliverable
- Owner
- Assignee
- Lifecycle
- Audit

If any mandatory Task core element is missing, Auditor must emit `Revise` and assign `R996`.

#### Dependency Declaration Check

If Principal Fast-Pass does not apply, Auditor must verify the Task's dependency structure is consistently declared between the Task body, the canonical labels, and the upstream issue dependencies surface, before extraction begins.

For Tasks whose body or References declare dependencies on other Tasks (by issue reference, narrative phrasing, or enumeration), Auditor must verify all of the following:
- The Task carries the `task:blocked` label.
- Every declared blocker Task appears as a Blocked-by relation on the issue dependencies surface, so the dispatch layer's blocked-by summary captures it.
- Each declared blocker is itself a Task in the same Project (not a casual cross-reference to a non-Task artifact).

If the Task body declares one or more dependencies but the `task:blocked` label or the GitHub Blocked-by relation is missing, Auditor must emit `Revise` and assign `R995`. The Owner reclaims via `TASK.md §Dependency Tasks → Dependency freeze (Blocked-by side)`: while the Task is in `Init+Gated` (after reclaim) or has not yet reached `Todo+Approved`, the Blocked-by set may be modified — add the label, declare the GitHub Blocked-by relation against each blocker, then re-transition `Init -> Todo` for re-audit.

The dependency check is mandatory at audit entry, independent of Resolver outcomes downstream. A Task whose Blocked-by set is properly declared proceeds to extraction and Resolver per the normal flow; the dispatch layer's Blocked gate then suspends the audit dispatch until every declared blocker reaches `Completed` or `Cancelled`.

`task:blocking` is informational and is not checked here.

#### Extraction

Auditor extracts one or more primitive operations from the bounded audit packet.

Each operation is normalized as:

`Action × Subject × Zone`

Extraction should follow these rules:
- extract the smallest complete operation chain that fully covers the intended effects of the Task
- classify by primary effect rather than by tool, implementation, transport, or interface
- split a Task into multiple primitive operations when it performs materially different effects, acts on different subjects, or crosses different zones
- classify the governed subject rather than the intermediate surface used to reach it
- assign Zone from where the subject resides when acted on

If extraction requires guessing, implication beyond the bounded audit packet, or unresolved ambiguity, Auditor must emit `Revise` and assign `R997`. The audit record must identify the extraction gap, record the operation chain extracted up to the blockage, and state what Task context is missing.

#### Routing Coherence Check

After extraction, Auditor must verify the Task's hard routing elements — the `type:<value>` label and the Assignee — are coherent with the Task's objective, scope, and extracted operation chain.

Auditor must verify all of the following:
- The `type:<value>` label matches the dominant work the Task describes and the primary effect of the extracted operation chain.
- The Assignee is consistent with the declared `type:<value>` label.

If the `type:<value>` label clearly contradicts the Task content or the extracted operation chain, Auditor must emit `Revise` and assign `R993`. Routing depends on the `type:<value>` label; a label that misroutes the Task is a routing fault the Auditor must surface before execution.

The routing coherence check addresses clear contradiction, not fine domain judgment. A defensible label is left to the Owner.

#### Resolver

Resolver is the deterministic utility Auditor uses to resolve Risk Code from a normalized operation chain under the applicable policy mapping.

Auditor should use Resolver in the following way:
- extract the operation chain before requesting resolution
- submit the applicable Project together with the operation chain
- receive the resolved Risk Code for each primitive operation and the resolved Task Risk Code
- if Resolver returns no valid mapping path, emit `Govern` and assign `R999`
- if a vocabulary mismatch arises between Resolver and Auditor at the Resolver boundary — either Resolver detects an unsupported Risk Code in the mapping data, or Auditor receives a Risk Code from Resolver that is outside Auditor's recognized set — emit `Govern` and assign `R998`
- if Resolver itself fails to produce a usable result (process failure, malformed output, configuration or connectivity error), emit `Govern` and assign `R994`
- record Resolver output in the audit record before emitting audit outcome

Resolver determines Risk Code. Auditor determines audit outcome.

Resolver implementation, mapping tables, and project-specific overlays belong in specifications and utilities, but they must conform to the primitive model, supported Risk Codes, and authority boundaries defined by this policy.

### Risk Codes

Risk Codes are generated by the Auditor at Preview and recorded as a Preview output.

The following Risk Codes are supported by Security:
- `R0`
- `R100`
- `R200`
- `R300`
- `R993`
- `R994`
- `R995`
- `R996`
- `R997`
- `R998`
- `R999`

Resolver may return only:
- `R100`
- `R200`
- `R300`
- `R999`

Auditor may assign directly:
- `R0`
- `R993`
- `R994`
- `R995`
- `R996`
- `R997`
- `R998`

`Gated` is the pre-audit queue state and is not emitted by Resolver.

#### R0

If Principal Fast-Pass applies, Auditor must:
- emit `Approved`
- record `R0` in the audit comment
- record that approval was granted by Principal Fast-Pass
- identify whether Owner, Assignee, or both resolved to Principal
- skip mandatory Task core validation
- skip primitive extraction and Resolver use

#### R100

If the Task Risk Code is `R100`, Auditor must:
- emit `Approved`
- record `R100` in the audit comment
- record the exact operation chain in the audit comment

#### R200

If the Task Risk Code is `R200`, Auditor must:
- emit `Approved`
- record `R200` in the audit comment
- record the exact operation chain in the audit comment
- record the Risk Code of each primitive operation in the audit comment
- record short reasoning in the audit comment explaining how the operation chain was determined

#### R300

If the Task Risk Code is `R300`, Auditor must:
- emit `Govern`
- record `R300` in the audit comment
- record the exact operation chain in the audit comment
- record the Risk Code of each primitive operation in the audit comment
- record short reasoning in the audit comment
- identify the required human intervention or authority boundary in the audit comment

#### R993

If the Task Risk Code is `R993`, Auditor must:
- emit `Revise`
- record `R993` in the audit comment
- identify the routing element that is incoherent — the `type:<value>` label, the Assignee, or both — in the audit comment
- record the contradiction between the declared routing element and the Task content or extracted operation chain in the audit comment
- identify the corrected routing the Owner should apply before re-audit in the audit comment

#### R995

If the Task Risk Code is `R995`, Auditor must:
- emit `Revise`
- record `R995` in the audit comment
- identify each dependency the Task body declares
- identify whether the `task:blocked` label, the GitHub Blocked-by relation, or both are missing in the audit comment
- identify what must be added before audit can proceed in the audit comment

#### R996

If the Task Risk Code is `R996`, Auditor must:
- emit `Revise`
- record `R996` in the audit comment
- identify which Task core elements are missing in the audit comment
- identify what must be added before primitive extraction can begin in the audit comment

#### R997

If the Task Risk Code is `R997`, Auditor must:
- emit `Revise`
- record `R997` in the audit comment
- record the operation chain extracted up to the blockage in the audit comment
- identify where extraction or audit preparation got stuck in the audit comment
- identify what Task context is missing in the audit comment

#### R994

If the Task Risk Code is `R994`, Auditor must:
- emit `Govern`
- record `R994` in the audit comment
- record the exact operation chain submitted to Resolver in the audit comment
- record the Resolver tooling failure condition (process failure, malformed output, configuration or connectivity error) in the audit comment
- identify the operator action required to restore Resolver functionality in the audit comment

#### R998

If the Task Risk Code is `R998`, Auditor must:
- emit `Govern`
- record `R998` in the audit comment
- record the exact operation chain submitted to Resolver in the audit comment
- record which side detected the vocabulary mismatch — Resolver detecting an unsupported Risk Code in the mapping data, or Auditor receiving a Risk Code from Resolver outside Auditor's recognized set — and the offending value in the audit comment
- identify the contract divergence between Resolver and Auditor that must be reconciled in the audit comment

#### R999

If the Task Risk Code is `R999`, Auditor must:
- emit `Govern`
- record `R999` in the audit comment
- record the exact operation chain in the audit comment
- identify the unmappable operation, mapping failure, or policy insufficiency in the audit comment

### Preview Record

Each Preview verdict is recorded in the Task transition comment required by `TASK.md`, at the `Todo+Gated` transitions `Gated -> Approved | Revise | Govern`. The record carries the Risk Code and the exact operation chain per §Risk Codes. For Principal Fast-Pass, it must explicitly state that the approval bypassed core validation and primitive extraction under Principal authority.

## Review

Review is the Auditor's post-execution gate (`Done+Gated`). It judges whether the work-product a Task produced is correct and sound against its governing specification. The Auditor emits `Approved`, `Revise`, or `Govern` per `TASK.md §Transition`.

### Independence

The Reviewer must be a different model or agent than the author of the work under review. A model reviewing its own output shares its own blind spots; independent perspective is the value of the gate. This is why post-execution Review is an Auditor duty, not an Assignee self-check.

### Criteria

Review is a fitness judgment: it assures the work-product is acceptable against the Task's requirements, constraints, and risks on the available evidence. It detects what is unacceptable while preserving the author's own approach — the standard is acceptability for the Definition of Done, not taste or preference.

The work-product is judged on five criteria — the **5C** — in descending order of significance:

- **Conformance** — the deliverables are produced against the Task's governing specification.
- **Completeness** — every required acceptance criterion is addressed and the full scope of work is delivered.
- **Compliance** — execution stayed within the scope, authority, policy, security, and other constraints the Task defines.
- **Correctness** — the work is coherent and sound — factually, logically, technically, and procedurally — free of errors, contradictions, and gaps.
- **Confirmation** — the Task's outcomes can be independently verified as proof of work.

### Depth

Depth scales how rigorously the 5C are examined. It is set by the Task's `risk:<code>` label — the carried-forward Risk Code. Preview stamps this label with each verdict and always overwrites it with the most recent: a re-audit after a `Pending` bounce or a Govern downgrade replaces it, and Review reads only this final value. Four levels:

- **R0 — Fast-Pass:** no 5C examination — the Review resolves under Principal Fast-Pass (`§Principal Fast-Pass`); a checkpoint Stage Task is the exception (`§Outcome`).
- **R100 — Light:** deliverable-focused. Conformance, Completeness, and Confirmation are hard gates; Compliance and Correctness are soft, failing only on surface-obvious defects.
- **R200 — Earnest:** the default. The full 5C examined within the Task's context, with the assignee's evidence verified rather than trusted.
- **R300 — Deep:** the full 5C extended beyond the Task boundary, applied adversarially. The added effort concentrates on Completeness, Compliance, and Confirmation; this level is the readiest to escalate `Done+Govern`.

Each criterion deepens across the levels:

| Criterion | R100 · Light | R200 · Earnest | R300 · Deep |
|---|---|---|---|
| **Conformance** | the deliverable exists and matches the spec's required form, by inspection | reads into content and intent to confirm the work is what was asked | R200, applied with adversarial scrutiny |
| **Completeness** | every required deliverable is present | the deliverable covers all the spec requires | surfaces and justifies objectives the spec only implies |
| **Compliance** | flags surface-obvious breaches | full scope, authority, policy, security, and constraint check | hunts loopholes beyond the stated constraints, including leaked credentials and security holes |
| **Correctness** | flags surface-obvious defects | full soundness — logical, technical, and factual, against documented best practice | R200, applied with adversarial scrutiny |
| **Confirmation** | accepts the declared Verification on its produced evidence | reproduces the declared Verification rather than trusting the evidence | devises verifications the Task did not define and attempts to break the result, including effects on adjacent and previously stable features |

Depth is an enforced setting, not a disposition: the carried Risk Code routes the Review to an Auditor bounded for that level — examination scope, thinking budget, and token ceiling scaled R100 < R200 < R300 — so a Light review cannot spend Deep effort. The concrete model and budget mapping is a provisioning concern; the levels and what they examine are defined here.

### Outcome

The Review verdict routes the Task per `TASK.md §Transition`:
- **`Approved`** — the work-product passes the 5C at the required Depth; the Owner accepts it (`Done -> Reviewed`).
- **`Revise`** — the work-product fails one or more of the 5C; the record names the failed criteria and the findings so the Assignee can redo the work (`Done -> Progress`) or, where the findings exceed scope, bounce it to the Owner (`Done -> Pending`).
- **`Govern`** — the verdict is reserved for the Principal: an R300 escalation, a criterion the Auditor cannot adjudicate, or a spec ambiguity. The Principal issues the final verdict.

**Checkpoint Tasks always Govern.** The Review of an Inception, Draft, or Review Stage Task (`type:project_inception`, `type:project_draft`, `type:project_review`) emits `Govern` unconditionally, taking precedence over Principal Fast-Pass: their work-products — the Charter, the milestone's specifications, and the milestone's closure record — are the Principal's Verify checkpoints (`DELIVERY.md §Checkpoints`), and their acceptance is reserved for the Principal. The review still runs at its required Depth; its findings accompany the `Govern` record as the brief the Principal verifies against.

**Failed Deployments Govern.** The Review of a Deployment Stage Task (`type:project_deployment`) whose attempt failed — reported by the Assignee with the environment rolled back to its previous stable state (`DELIVERY.md §Deployment`) — emits `Govern`: the failure's disposition — retry, corrective work recorded, a hotfix on the Principal's direction, or cancellation — is reserved for the Principal. A succeeded deployment reviews as any Task.

### Review Record

Each Review verdict is recorded in the Task transition comment required by `TASK.md`, at the `Done+Gated` transitions `Gated -> Approved | Revise | Govern`. The record states the Depth applied, the criteria examined, and the findings supporting the verdict; a `Revise` or `Govern` record must be specific enough to act on without re-deriving the review.

## GitHub

In the GitHub implementation surface, audit records live in GitHub issue comments. The dispatch layer implementing the Blocked gate is wakery (`specs/apps/wakery/spec_wakery-task-relations.md §Blocked gate`).
