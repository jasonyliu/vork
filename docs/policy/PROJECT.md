# Project as Canonical Mission Context

## Purpose

A Project is the canonical container for a bounded mission. This document defines what a Project is made of — the structure and durable records that hold its mission, so an agent can find what it needs and know what each file means.

- Define the Project core: the mission, artifacts, plans, and control state that make a mission operable.
- Define the Project's structure: its repository, standing branches, environments, homespace, and file skeleton.
- Define the durable records a Project keeps and what each must contain.
- Preserve continuity by keeping Project work legible, resumable, and governable through durable records rather than chat memory.
- Keep the Project model platform-agnostic so implementations can realize it without redefining it.

## Principles

- **Mission-contained:** A Project must carry the mission context, boundaries, and records needed to understand, evaluate, and advance the work without relying on unrelated or scattered context.
- **Homespace-centered:** A Project must maintain one canonical homespace where its materials, structure, and team work areas are organized.
- **Research-grounded:** A Project should be shaped by relevant evidence, existing approaches, and prior lessons before it defines its own method.
- **Decomposition-driven:** Large-scale work must be deliberately broken into bounded Tasks aligned to milestones; decomposition must not rely on model intuition alone.
- **Platform-agnostic:** The Project contract is canonical; tools and platforms implement it, not define it.

## Project

A Project is the bounded operational context for a mission. It defines what the work is, what shapes it, how it is organized, and where it stands.

### Core

These elements define the minimum Project contract. An implementation may store them differently, but it must preserve their meaning.

**Mission**
- **Title:** The short human-readable name of the Project.
- **Key:** A compact canonical project key used where stable concise project naming is required across the system.
- **Description:** The goal the Project exists to achieve.
- **Scope:** The current boundary of work the Project includes.

**Artifacts**
- **Docs:** References, records, and supporting written materials.
- **Specs:** Designs, wireframes, PRDs, and other execution-shaping blueprints.
- **Apps:** Implementation source for the applications the Project builds — code, scripts, packages, services, and other execution artifacts. Each application lives in its own subdirectory and is the canonical home for that application's source.
- **Products:** Records of what the Project has produced and shipped — articles, apps, tools, scripts, and other deliverables. Products is the durable shipping record (what exists, where its source lives, what release state was accepted); it is not a code mirror.
- **Releases:** Records of shippable product states, including what changed, was added, or was fixed.

**Plans**
- **Milestones:** The first layer of decomposition for major outcomes or stages.
- **Tasks:** The canonical units of work derived from Milestones.
- **Operations:** Recurring or standing procedures used to run, measure, maintain, or adapt Project outputs in real conditions.
- **Deployments:** The per-environment definitions of how the Project's work reaches its environments, and the invocations that carry it there.
- **Backlog:** The standing list of unscheduled work — improvements, fixes, and observations tracked before they are promoted into a Milestone.

### Lifecycle

**Inception** stands up the Project once. Everything after it advances one **milestone** at a time through the loop:

`Draft -> Decomposition -> Execution -> Integration -> Review -> Release`

Draft scopes the milestone and specifies its features; Decomposition breaks those features into the Tasks that build them. There the milestone **fans out**: **Execution** builds the work — its features and fixes — across many Tasks running concurrently, and each milestone branch **integrates** onto `dev` as its own Execution completes, one Integration per branch, the integrations landing serially. The fan-out **converges** at **Review**, which runs once the milestone's integration set is built and integrated and evaluates the milestone as a whole; **Release** then publishes the milestone and closes it. Review closes its own gaps: findings become milestone-scoped fixes that execute and integrate through the same lanes while Review holds, and Release follows only on a complete, deployable record.

So a milestone narrows to a single Draft and Decomposition, fans out into concurrent per-branch `Execution -> Integration` lanes, and converges back into a single `Review -> Release`.

Release seals the milestone — a versioned snapshot stamped at publication. **Deployment** carries a repository state — a snapshot of either standing branch — into a named environment, each invocation its own Stage Task chained where the project's deployment manuals direct, typically surrounding a stage's terminal state (`§Deployments`, `DELIVERY.md §Deployment`).

A Project's first pass runs the full `Inception -> Draft -> Decomposition -> Execution -> Integration -> Review -> Release`; each later milestone repeats the `Draft -> Release` loop. Once a Deployment has carried a released state into its live environment, **Operation** runs in parallel with later milestone loops, and may feed further Draft cycles when runtime conditions require change.

Each stage is carried by a Stage Task, except Execution — the milestone's many Execution Tasks.

### Branching

A Project is backed by one git repository carrying two standing branches and transient working branches. The merge into a standing branch is the only path in — performed as a pull request at Integration, at Release, per hotfix, or at a repo-changing Stage Task's close, never a direct commit. The model is adopted uniformly across all Projects.

**Standing branches:**
- **`main`** — release-truth. Every commit is a release-tag boundary; `main` never receives in-progress work directly.
- **`dev`** — the integration branch, absorbing all in-progress work for the active milestone.

**Working branches** (transient, slash-named so a name segment carries the milestone):
- **`feature/<full-milestone-name>/<slug>`** — a feature lane off `dev`. The branch unit is the **feature**, not the Task: one feature ↔ one branch ↔ one integration. A subdivided feature is a Parent Task with its pieces as Child Tasks sharing that branch; an unsubdivided feature is a single Task on it (`TASK.md §Granularity`). Subdivision is verification granularity, never branch count. Repo-changing **Stage Tasks** (Inception, Draft, Decomposition, Review, Release) use the same lane and merge to `dev` at close: a milestone-bound Stage Task's lane carries its milestone name (e.g. `feature/<full-milestone-name>/draft`); Release's lane (`feature/<full-milestone-name>/release`) is the exception on timing — it merges to `dev` **before** the `dev -> main` publishing merge, so publication carries the release records (`§Releases`); Inception precedes any milestone, so its lane carries the literal segment `inception` (`feature/inception/charter`).
- **`fix/<full-milestone-name>/<slug>`** — a milestone-scoped corrective lane off `dev` for a bug, defect, or enhancement (including RED-filed findings), distinct from feature work. A milestone carries both features and fixes.
- **`hotfix/<slug>`** — a corrective lane off `main` carrying the hotfix Task's full corrective sequence — fix, release work, records — merged back to `main` via pull request and tagged (`DELIVERY.md §Hotfix`). The fix reaches `dev` by record, not by merge (standing-branch sync below).

**Slash naming.** Working-branch names use `/`-separated segments so the `<full-milestone-name>` segment is the machine key routing a pull request's events to the right Task and milestone. Branch-protection and CI path globs must use `**` (a single `*` does not cross `/`).

**Standing-branch sync.** `dev -> main` syncs by merge, at Release. `main -> dev` syncs **by record**: each hotfix leaves a recorded fix item — a bug, defect, or enhancement carrying the equivalent change — in the active milestone's fix work, or the Backlog when none is active; `dev` receives the fix at milestone pace through normal `fix/**` lanes. Urgency to `main` is not urgency to `dev`. A direct `main -> dev` merge is structurally unmergeable under standing-branch protection and is not attempted.

**Rebase discipline.** Rebase a `feature/**` branch onto `dev`, or a `hotfix/**` branch onto `main`, when it is stale or conflicting; **never rebase `main` or `dev`** — a standing branch is shared truth, and rebasing it rewrites history other clones depend on. After rebasing a pushed working branch, force-update with `--force-with-lease` (safe: one assignee per branch). Integration merges are `--no-ff`.

**Merge-serialization invariant.** Integration *work* — rebase, PR, CI, review — may proceed concurrently across features, but the *merge into a standing branch* must serialize and re-validate against that branch's current tip: each merge rebases onto the latest tip and re-runs CI on the merge result before it lands. This holds whether one integration runs at a time or many; at concurrency the enabling mechanism is a merge queue (rebase-onto-latest + re-CI + ordered merge). The invariant is encoded so raising concurrency is a configuration change, not a redesign. Its rebase-and-revalidate demand applies to **working-branch merges**; the `dev -> main` publishing merge must **not** carry an up-to-date-branch requirement — under by-record standing-branch sync, `dev` is permanently behind `main` after any hotfix, and a git-layer up-to-date rule would demand the very `main -> dev` merge the sync model forbids, staling every publication. CI on the merge result remains the publication's gate.

**Hybrid enforcement.** A merge into a standing branch is gated on two independent checks: the **Auditor gates intent** (risk and policy, before execution — `SECURITY.md` / `TASK.md`), and **CI gates correctness** (build and tests, at the merge — `§Environments`). Both must pass. Enforcement is task-layer *and* git-layer: the Integration Stage Task and divergence detection at the task layer, CI status checks at the git layer.

Working branches are shared, not local: a working branch is pushed to the shared remote before its integration merge, so integration operates on a shared ref and the change stays reviewable before it reaches a standing branch.

**Branch↔Task binding.** A working branch is created *through* its top-level Task — by the Task's Owner, at Task creation — so branch and Task are bound from birth; this holds for feature, fix, hotfix, and repo-changing Stage Task lanes alike. Child Tasks reach the branch through their Parent; an Integration Stage Task reaches it through its Blocked-by relation to the branch's top-level Task. Working branches outlive their merges: deletion is the **Release sweep** — on the milestone's Release Stage Task reaching terminal state, the Owner deletes every working branch fully merged into `dev` and surfaces, never deletes, any unmerged one — so every lane stands inspectable through the whole milestone, and never vanishes automatically at merge. Inception precedes milestones: its lane is created through the Inception Task under the Principal's ownership, and the Principal deletes it on accepting the Charter.

### Environments

A Project that produces a live consumable service, product, or tool runs two environments at minimum, mirroring the two standing branches. Concrete instances — hosts, URLs, deploy targets — are recorded in the Charter, the Provision, and each environment's deployment manual (`§Deployments`).

- **Production** — serves consumers. It runs the released state from `main` and advances by Deployment of a published Release or hotfix.
- **Development** — verifies in-progress work. It runs the latest integrated `dev` and is the test bed CI runs against.

A project may run further environments — a preliminary pre-live mirror, or other project-specific targets — each named and defined by its own deployment manual (`§Deployments`).

**Environment isolation.** In-progress milestone work changes only Development; Production advances only by Deployment of a published Release or hotfix. This is the runtime parallel to git's `dev`/`main` separation: a milestone's service changes are exercised against Development and reach Production through publication and Deployment.

**CI at standing-branch merges.** A merge into a standing branch completes only when its gating CI is green (`§Branching`, hybrid enforcement). Deployment is not CI's act: environments advance through Deployment Stage Tasks chained per the project's deployment manuals (`§Deployments`, `DELIVERY.md §Deployment`). The cadence asymmetry stands — Development refreshes at integration pace, as merges land on `dev` (deploy-then-test: Development is the test bed); Production advances only after a Release or hotfix publishes (test-then-deploy: Production is protected, and publication precedes deployment).

**CI by branch event:**

| Event | CI |
|---|---|
| push to `feature/**` or `fix/**` | fast CI |
| PR `feature/**` \| `fix/**` -> `dev` | full CI on the merge-result ref (the merge gate) |
| PR `dev` -> `main` | release CI — the merge result re-validates `main`'s full suite, so a hotfix-shipped regression test is re-guarded at every release |
| PR `hotfix/**` -> `main` | focused CI |

A project's manual may bind a deployment to automation — a tag-driven pipeline, a vendor's branch-tracking deploy; the Deployment Stage Task then carries the verification of the automated act rather than the act itself.

## Structure

A Project occupies one canonical folder under the project storage path (`§Project storage path`), holding its governing materials, work repos, and mutable team areas so continuity does not depend on any one actor's private runtime. Its boundary elements:

- **Charter:** the first canonical Project record, stating the essential elements of the Project mission. It is the Project's birth certificate, instantiated from the canonical charter template (`docs/conventions/templates/charter.md`). The Charter records the Mission (title, key, description, scope), the Project's channels, the team topology, the Project path, the Products the Project has released, the milestone table (`Active | Completed`, active on top), and the current Provision summary. Its Path, Products, and Milestones sections refresh at every Release (`§Releases`).
- **Channel:** a dedicated Project communication or intake path used to isolate Project context from unrelated work. Project-related context and future memory should be sourced only from this channel.
- **Team:** a team map identifying the humans and durable agents involved in the Project, the role each holds, the responsibilities each owns, and any missing durable agents that must be created before work proceeds.
- **Path:** one canonical Project folder under the designated project storage path, separating governing Project materials, project work repos, and mutable team work areas.
- **Backlog:** the Project's standing list of unscheduled work, present from Inception forward.

Canonical paths under a Project folder use lowercase names. `README.md` is the local index file for each maintained path.

The Project key is a compact lowercase snake_case identifier such as `vork` or `field_notes`. It gives the Project a stable concise handle where full human titles are too long, noisy, or operationally unsuitable.

A Project folder has the following structure:

```text
<project-storage-path>/<project-name>/
- main/                    # canonical project repo holding all governing materials and implementation
  - docs/
    - README.md           # local index for docs
    - charter.md          # project birth certificate
    - backlog.md          # standing list of unscheduled improvements and fixes
    - research/
      - README.md         # index of research records
    - milestones/
      - README.md         # index of milestone records
    - deployments/
      - README.md         # index of deployment manuals by environment
      - deploy_<environment>/
        - <environment>.md  # the environment's deployment manual (§Deployments)
    - operations/
      - README.md         # local index for workflow definitions
      - work_<slug>/      # one folder per workflow; contains workflow.md + supporting material
  - specs/
    - README.md           # local index for specs
  - apps/                  # implementation source — one subdirectory per application the project builds (e.g. apps/wakery/, apps/foundry/)
    - README.md           # local index for the app catalog
  - provisions/
    - README.md           # local index for provisions
  - releases/
    - README.md           # local index for release records keyed by version

- team/                    # actor-specific project homespaces and isolated mutable work areas when needed
  - heimdall/             # clone of the main repo
  - <member-name1>/       # clone of the main repo
  - <member-name2>/       # clone of the main repo
```

`main/` is the primary project repository intended for AI Lead work unless a Project explicitly defines a different operating model. There is exactly one Git repository per Project.

`team/` exists for actor-specific homespaces and isolated mutable working areas when an actor should not modify a canonical checkout directly, when multiple actors need separate mutable clones, or when execution safety and continuity require checkout isolation. `team/` is local-only and not committed to the canonical repo.

Actors must not share a mutable checkout.

## Records

The durable records a Project keeps. Each is a canonical artifact with a defined home and contents, instantiated from its canonical template under `docs/conventions/templates/`: keep the template's sections as the record's contract, fill the placeholders, and delete the guidance comments at instantiation.

### Research

Research establishes how the Project understands the problem before it defines or revises its method.

Research records are stored under `main/docs/research/`. The path maintains a `README.md` index, and each research record lives in its own date-plus-slug folder such as `research_<YYYYMMDD>_<slug>/`. The canonical research file inside that folder is `research.md`.

Each research record should contain:
- **Purpose:** why the research was conducted and what question it was meant to answer
- **Conclusion:** the findings, lessons, and rationale worth carrying forward
- **References:** the relevant evidence, prior approaches examined, and supporting materials needed to understand or reuse the result

### Specs

Specs are the execution-shaping blueprints that turn Project understanding into bounded implementation guidance. Implementation work must not begin before the specs that govern it exist; Decomposition derives Tasks from spec-defined features (`§Milestones`, `§Lifecycle`). A feature is a coherent unit of capability — one named behavior the system delivers, specified, built, and verified as a whole — and is the unit each Task is built around.

Specs are stored under `main/specs/`. The path maintains a `README.md` index, and each canonical spec file uses the naming pattern `spec_<slug>.md`.

How specs are written — their internal shape, sections, and method — is authoring tooling, not policy; this document requires only that specs exist, identify their features, and state how the work they govern will be verified.

Specs remain stable execution-shaping records rather than dated log-style artifacts. They may be revised over time, but their identity remains semantic and durable. Spec evolution traces through milestones: the milestone record's Specs section carries every spec created or edited within it (`§Milestones`).

### Milestones

A milestone defines a bounded intermediate outcome the Project pursues.

Milestone records are stored under `main/docs/milestones/`. The path maintains a `README.md` index, and each milestone record lives in its own date-plus-slug folder named `milestone_v<YYYY.MM.DD>_<slug>/`, where the leading date is the milestone start date so milestones sort chronologically. The canonical milestone file inside that folder is `milestone.md`. The folder also holds the milestone's `integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md` records, its `decomposition.md`, and its `review_<YYYY.MM.DD.HH.mm.SS>.md` records.

There must be **at most one** active Milestone — exactly one while a milestone is in flight, and none in the interval between a Release and the next milestone's Draft Stage Task. The current active Milestone, or its absence, must be recorded explicitly in `main/docs/charter.md`. Agents must not infer it from folder order, timestamps, or naming alone.

Each milestone record should contain:
- **Scope:** the objective, boundary, and excluded areas of the milestone
- **Deliverables:** the concrete outputs expected from the milestone
- **Verification:** the success criteria and how completion will be judged
- **Research:** the related research that informed the milestone
- **Specs:** the governing `spec_<slug>.md` files required to decompose and execute the milestone, and the milestone's **spec trail** — every spec the milestone creates or edits, one row per spec with a short what-changed note

Each Milestone must explicitly identify the governing spec files it depends on and record every spec change it makes: a spec created or edited within a milestone appears in that milestone's Specs section, so spec evolution traces to the milestone that made it.

### Provision

Provision is the compact operational summary of what must be available for agents to work effectively on the current Project state.

Provision is summarized in `main/docs/charter.md` as compact self-explanatory statements. Detailed setup materials, manuals, scripts, and configuration references are stored under `main/provisions/` and referenced from the Charter when needed.

Provision should state or point to:
- the tools, services, environments, repos, datasets, and resources required for the current Project state
- where agents should look for the detailed setup materials they need

### Decomposition

A decomposition record preserves the result of decomposing a milestone into its executable task set — the durable output of a Decomposition Stage Task.

The record is stored alongside the active milestone under `main/docs/milestones/<milestone-folder>/`. The canonical file is `decomposition.md`.

It should preserve:
- how the milestone was split
- the designed task set and, once created on the `Decomposition → Execution` chain, which Tasks were produced and where they live in the execution system
- the milestone's integration set — its `feature/**` and `fix/**` branches — and the planned `project_integration` Stage Task for each
- the order, dependencies, and rationale worth carrying forward

### Integration

An integration record is the post-merge receipt of one milestone branch — a `feature/**` or `fix/**` lane — landing on `dev`.

Each integration produces `main/docs/milestones/<milestone-folder>/integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md`, finalized after the merge lands. The record is lean by default and verbose on conflict: a clean merge gets a one-line record; a merge requiring judgment between two agents' edits records what collided, whose intent each side carried, how it was resolved, and why.

### Review

A review record captures a milestone's completion state at the time of one Review round and the release-readiness knowledge the following Release and its Deployments need.

Each review record is stored under `main/docs/milestones/<milestone-folder>/review_<YYYY.MM.DD.HH.mm.SS>.md`, where the timestamp marks when the review was created (UTC, second precision). Subsequent rounds produce new timestamped records rather than overwriting prior ones.

Each review record should contain:
- **Summary:** the overall completion state of the Milestone at the time of this review, expressed as an honest percentage or descriptive completeness. Partial completion is acceptable provided the gaps are explicit in §Incomplete.
- **Evaluation:** how the produced artifacts measure against the Milestone's Scope, Deliverables, and Verification — including, for code-producing milestones, the automated test results — plus the verification process used to reach the verdict.
- **Incomplete:** the gaps preventing satisfaction; for a complete-and-deployable review, this section states `none`.
- **Deployment:** the milestone's deployability verdict, plus anything a Deployment of the resulting release must know beyond the standing deployment manuals (`§Deployments`) — new environment requirements, migration steps, changed smoke expectations. The per-environment how lives in the manuals, not here; a milestone that changes how an environment deploys updates that environment's manual as milestone work. If the milestone is found incomplete by this review, this section states `undeployable`.
- **Reference:** the produced artifacts, completed Tasks, governing specs, and supporting evidence underlying the verdict — the pointers a later Release Stage Task will need.

### Releases

A Release is a versioned snapshot of the entire Project at a point in time, sealed at publication with its notes and source tag.

**Versioning.** Releases are project-scoped, not app-scoped: each Release represents a snapshot of the whole Project, regardless of which specific apps, specs, or policies the underlying Milestone touched. Releases use date-based version names: `v<YYYY.MM.DD>`. If a Project produces more than one release in a single day, subsequent releases append a re-release suffix: `v<YYYY.MM.DD>.r2`, `v<YYYY.MM.DD>.r3`, etc. Every Release marks the Project's main Git repository with a tag matching the version name; the tag marks the publishing merge on `main` and is the canonical source pointer for the released state.

**Publication boundary.** A Release ends at publication and publishes through two pull requests. The first merges the Release's stage lane to `dev`, carrying all the Release's repo work: the release notes, the publishing-merge record, and the Charter close-out (`§Pointers` below). The second is the `dev -> main` publishing merge, advancing `main` to the release state — sealed by the version tag, an act on the merge commit and the Release's final one. Environments then advance through Deployment Stage Tasks per the project's deployment manuals (`§Deployments`, `DELIVERY.md §Deployment`).

**Release notes.** A Release produces `main/releases/release_v<YYYY.MM.DD>/release.md` containing the lean release notes — two lists only:
- **Features:** new capabilities introduced in this release.
- **Fixes:** bugs and defects resolved in this release.

Detailed deployment, rollback, and verification material does not belong in the release notes; that information lives in the environments' deployment manuals (`§Deployments`) and the Milestone's review record. The Release's `dev -> main` publishing merge is recorded as `main/releases/release_v<YYYY.MM.DD>/integration.md` — lean when `main` has not diverged, verbose when a hotfix did — citing the version tag as its canonical pointer: the tag resolves to the merge commit, whose sha is unknowable before the merge. Other release-time artifacts (verification snapshots, signed checksums, etc.) may also be stored under `main/releases/release_v<YYYY.MM.DD>/` alongside `release.md`. No product binaries, deployed code, or running artifacts belong here — `main/releases/` is part of the Project Git repository and records what shipped, not the running artifact itself.

**Pointers.** A Release leaves the Project's canonical pointers in this state: `main/docs/charter.md` shows the closed Milestone moved from Active to Past with a short shipped-summary and the active-milestone pointer cleared; `main/docs/milestones/README.md` reflects the Past state and the empty Active slot; the closed Milestone's `milestone.md` Status field reads `Completed (YYYY-MM-DD)` and references the release record. The Charter's Path and Products sections refresh in the same act — new products listed, path changes recorded — so the Charter tracks what the Project now is. These updates are release work: authored on the Release lane and merged to `dev` before the publishing merge (`§Publication boundary`), so `main` carries the closed state at the tag.

### Deployments

A deployment manual is the durable per-environment definition of how this Project deploys: policy defines that Deployment exists and how it is conducted (`DELIVERY.md §Deployment`); the manual defines how this Project deploys to one environment, written entirely from the project's own specifics. A Deployment Stage Task exists only for an environment holding a manual, and the manual is produced by the first milestone that requires its deployment.

Manuals are stored under `main/docs/deployments/`, one folder per environment:

```text
main/docs/deployments/deploy_<environment>/
- <environment>.md
- [supporting text material]
```

Environment names follow the project's own topology under the `deploy_<environment>` convention. **development** and **production** name the two standing environments (`§Environments`); beyond them, a project defines whatever environments its topology needs under the same convention, such as **preliminary**, a pre-live mirror of Production — the suggested name for that common case.

Each `<environment>.md` makes its deployment executable without prior context:
- **Chaining:** where the Deployment Stage Task attaches — the stage-terminal or routed event that cues its creation (`DELIVERY.md §Chaining`)
- **Mechanism:** the deploy acts, what to wait for, and the signals that confirm them
- **Smoke:** how the deployed result is verified live
- **Rollback:** how the environment returns to its previous stable state on failure
- **Record:** what record an invocation produces and where it lives — the manual's own requirement, from none to one per invocation

Scripts and tooling the manual invokes live under `main/provisions/`, referenced from the manual.

### Workflows

A workflow is the durable definition of a unit of recurring or repeatable Project work. It describes what a run should do, which Release outputs it consumes, and what supporting material a run needs. Workflows are prepared once and run many times.

Workflow definitions are stored under:

```text
main/docs/operations/work_<slug>/
- workflow.md
- [supporting material]
```

The `main/docs/operations/` directory lives with the Project's other docs records and is committed to the canonical repo. Each `work_<slug>/` folder holds the canonical `workflow.md` plus any supporting material — input schemas, configuration templates, reference documents — that an Operation Stage Task needs, or none when the definition alone is sufficient.

Each `workflow.md` should describe:
- **Purpose:** what the workflow accomplishes and why the Project needs it
- **Inputs:** the Release outputs the workflow consumes (deployed apps, services, configuration), plus any per-run inputs the operator must provide
- **Trigger:** how runs are initiated — schedule, event, or operator-triggered
- **Procedure:** the steps a run follows
- **Deliverables:** what a successful run produces
- **Verification:** how a run's outcome is judged
- **Record:** what record a run produces and where it lives — the workflow's own requirement

A workflow is not a Task; each invocation becomes an Operation Stage Task that produces the record its workflow defines.

### Backlog

The Backlog is the Project's standing record of work it has identified but not yet scheduled — improvements, fixes, and observations surfaced during execution, review, or operation, worth tracking before they become Milestone-scoped work.

The Backlog lives at `main/docs/backlog.md`. Every Project maintains one from Inception onward, even when it begins empty.

Items enter the Backlog as they surface, leave when promoted into a Milestone or shipped directly, and are recorded as done or skipped with a short retention trail. An item lives in the Backlog only while it remains unscheduled; once it enters a Milestone, the Milestone record becomes its home.

## GitHub

GitHub is the current implementation surface for Project coordination. It binds the agnostic Project model onto GitHub Projects, Issues, and Milestones; the Project's Git repository and folder structure are the agnostic core defined above (`§Branching`, `§Structure`).

### Mapping

**GitHub Project**
- A Project should have one GitHub Project as its coordination and execution surface under the same name.
- Both Stage Tasks (`DELIVERY.md §Stages`) and the Execution Tasks produced by Decomposition are represented as GitHub Issues attached to that GitHub Project.

**Development binding**
- The branch↔Task binding (`§Branching`) rides GitHub's Development section: the Owner creates the branch through the Task issue (the `createLinkedBranch` mutation — create-and-link in one act, the one form the public API offers; linking an existing branch, or one branch to a second issue, is UI-only).
- Pull-request bodies never carry closing keywords (`Closes`/`Fixes`/`Resolves`); plain `#N` mentions only. With no PR↔issue closing references, GitHub's default-branch auto-close never fires behind the Task state machine.

**GitHub Milestone**
- Each framework Milestone maps one-to-one to a native GitHub Milestone used purely as a grouping tag carrying no authority. The GitHub Milestone's title is the milestone folder slug (`milestone_v<YYYY.MM.DD>_<slug>`, exact — no translation), and its description holds only a pointer to the canonical `milestone.md` path. It provides issue grouping, filtering, and the native completion progress bar; `milestone.md` remains the single source of truth.
- The GitHub Milestone is created for the active framework Milestone, and that Milestone's Task issues set their GitHub `Milestone` field accordingly (see `TASK.md §GitHub`).

## Project storage path

The root project storage path is set by the operator; this policy writes it as `<project-storage-path>`:

```text
<project-storage-path>/
```

Each first-level subfolder under this path is treated as a Project folder and is expected to follow the canonical structure defined in this policy.
