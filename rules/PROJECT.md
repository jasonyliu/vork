# PROJECT - the Principal's project-based work

The Principal is the person whose projects these are: the owner of every repository, the one who directs a founding, previews a design before it is built, approves what lands and reviews what shipped. The Principal organizes all of their work as projects. A project is one folder under the storage root, backed by exactly one git repository, and every project follows the same shape — so any agent, on any device, can open one cold and know where everything is. This rule is the complete picture of that shape and how work moves through it.

## Storage

```
<storage-root>/<key>/         # one project container; <key> is its compact lowercase handle
├── main/                     # the working clone — on a single-actor machine, the only one
└── team/<agent>/             # per-agent clones, present only where agents work the same project concurrently
```

The storage root is chosen when the kit is installed and written into Foundry's environment; `~/Vork/projects/` is the suggested default. The durable rule underneath the layout: **one mutable checkout belongs to one actor.** On a machine where one actor works a project, `main/` is the only clone it carries. On a machine where several agents work the same project concurrently, each agent works its own `team/<agent>/` clone. Which machine plays which part is the Principal's arrangement. Concurrency across machines is already handled by git itself: every actor pushes lanes to the same remote. When it is unclear whether you are the main agent on a project, ask first — then work in `main/`.

- The kit itself — this convention, the record templates, Foundry and the skills every project uses — is Vork, installed once per machine from its own clone; the clone's `README.md` is the map.
- Credentials live outside every project as files, one per account, read by path; Foundry's environment names the two token files the convention needs, the Principal's and the Vork account's.
- The same layout exists on every machine the Principal works from.

## Lifecycle

Every project honors the same lifecycle: founded once at **Inception**, advanced one milestone at a time through the loop, its releases carried live by **Deployment**, run day-to-day by **Operation**, defended by **Hotfix**.

`Inception → ( Draft → Execution → Integration → Review → Release )* → Deployment → Operation`

- **Inception** — once per project. A project is founded from discussion: when a mission the Principal and you are shaping turns fruitful, the Principal directs the founding, Foundry raises the container (repository, skeleton, storage folder), and the charter is authored with the Principal, whose acceptance of it closes Inception.
- **Draft** — opens each milestone, in a causal chain: **research investigates the problem, its findings shape the specs, and the specs define the milestone's scope.** The milestone record and the charter's active-milestone pointer make it Active; fix work promoted from the backlog enters here alongside features. Draft ends at the Principal's **preview**: the specs are explicit enough to build from, and the Principal says go.
- **Execution** — the building, opened by laying down the plan. **Decomposition is an act of execution:** as building begins, `decomposition.md` in the milestone folder itemizes the key steps and their sequence toward the deliverables `milestone.md` sets — every milestone has key steps, so every milestone carries this record. The plan changes over a milestone's course; amend it with dated trail lines as it does, in the same commit as the work — `decomposition.md` doubles as the milestone's ledger, and its Current section is where a fresh session orients. Work then runs on lanes off `dev`, sized to the session — one feature, one lane, one pull request; when a real deadline presses, narrow the milestone honestly and record the narrowing.
- **Integration** — each finished lane lands on `dev` by pull request on green CI. The merge is where conflict judgment happens; leave an integration note when a merge required it.
- **Review** — the milestone judged whole against its Scope, Deliverables, and Verification: the Principal's **review**, hands-on, against the previewed specs. Findings become `fix/**` lanes and the review repeats; the milestone closes when the Principal calls it complete and deployable.
- **Release** — publication: the release notes, the charter close-out (milestone to Past, pointers refreshed), the `dev → main` pull request on release CI, and the version tag sealing it. One release per milestone.
- **Deployment** — beyond the loop: carries a published release into one environment, exactly as that environment's manual directs — mechanism, smoke, rollback, record. Before the first act, the deploying agent lists every act the manuals call for on every target and the Principal confirms the list; deployment is where a release reaches production, and the pause is deliberate. A failed attempt rolls the environment back, is recorded as the invocation's result, and the Principal decides its disposition.
- **Operation** — runs the prepared workflows against deployed releases, in parallel with later milestone loops. A gap a run reveals returns to the loop as milestone work, through a new Draft.
- **Hotfix** — the Principal's call, defending production: a `hotfix/<slug>` lane off `main` carrying fix, release record, and tag in one compressed act — which completes on `dev`, in the same sitting: a `fix/main-sync/<hotfix-slug>` lane off `dev` merges `main` in, the conflict and keep-or-supersede judgment is made now while context is fresh, and lands by pull request on green CI. A hotfix is done when both standing branches carry it.

## Structure

Inside `main/`, every project carries:

```
docs/
├── charter.md               # birth certificate: mission, team, path, products, milestones, provision
├── backlog.md               # known, unscheduled work
├── conventions/templates/   # the record templates, placed at founding
├── milestones/              # milestone_v<YYYY.MM.DD>_<slug>/ — one folder per milestone
├── research/                # research_<YYYYMMDD>_<slug>/ — findings with evidence
├── operations/              # work_<slug>/workflow.md — recurring, unattended work definitions
├── deployments/             # deploy_<environment>/ — how this project reaches each environment
└── releases/                # release_v<YYYY.MM.DD>/ — what shipped, at which tag
specs/                       # spec_<slug>.md — what will be built, and how it is verified
apps/                        # implementation source, one subdirectory per application
provisions/                  # setup material, scripts, deploy tooling
```

`docs/` holds the pure records; `specs/` stands apart as the execution-shaping blueprints; `apps/` holds code; `provisions/` mixes code and docs. Folder and file names are lowercase. `README.md` is **on demand**: the root carries one; a folder gets its own only when it has something important to say that its naming and records do not. New records are instantiated from the templates in the project's own `docs/conventions/templates/`, placed there at founding: copy the template, keep its sections, fill in the actual work, delete its guidance comments.

## Records

Records are how the project stays legible, resumable, and reviewable across sessions, devices, and agents. Each record type has a home, a naming pattern, and expected content.

### Charter — `docs/charter.md`

The project's birth certificate and standing summary, and the first place to read. It records:

- **Mission** — title, the compact `key`, description, and the current scope boundary.
- **Team** — the humans and agents involved, the role each holds, and what each is responsible for.
- **Path** — the project's canonical folder layout, including anything project-specific beyond the standard shape.
- **Products** — what the project has shipped and where each product lives.
- **Milestones** — the milestone table, the active milestone on top; the charter is the single authority on which milestone is active.
- **Provision** — the compact operational summary: the tools, services, environments, repos, and credentials the current project state needs, with pointers into `provisions/` for the detailed setup material.

The charter's Path, Products, and Milestones sections refresh at every release, so the charter always describes what the project now is.

### Backlog — `docs/backlog.md`

The standing list of known, unscheduled work — improvements, fixes, and observations worth tracking before they become milestone work. Every project maintains one from its founding, even when it starts empty. It records:

- **Items** — one titled subsection per open item: a short title and the date it was added, then enough context that a future session picks it up cold — what it is, why it matters, and where the evidence lives. Every later edit appends a dated trail line — new evidence, a scope shift, a decision — so the item carries its own history; the trail grows, and earlier lines stand.
- **Skipped** — items explicitly dropped, each with a date and a one-line reason.
- **Done** — items shipped, each with a date and a one-line outcome: directly from the backlog, or by the milestone that took them in, naming its release.

Add an item the moment it is worth tracking. An item leaves **Items** when it is settled: it ships — directly, or by the milestone that took it in, whose release close-out moves it — and moves to **Done**; or it is explicitly dropped and moves to **Skipped**. While a milestone carries it, the item stays in **Items** with a dated trail line naming the milestone, and the milestone record holds the work. Both trails are kept — the history of what was skipped and shipped is part of the record.

### Research — `docs/research/research_<YYYYMMDD>_<slug>/`

How the project understands a problem before deciding its solution. Each research effort gets its own dated folder; `research.md` is the canonical file, and other supporting materials sit beside it in the folder when needed. `research.md` contains:

- **Purpose** — the question the research set out to answer.
- **Conclusion** — the findings, lessons, and rationale worth carrying forward.
- **References** — the evidence, prior approaches examined, and supporting material, kept in the folder when it is worth keeping.

### Specs — `specs/spec_<slug>.md`

The execution-shaping blueprints: what will be built, feature by feature, and how the result is verified. A spec precedes any non-trivial build — it is what the Principal previews before saying go. Specs keep stable, semantic names and are revised in place as understanding improves; each milestone's record lists every spec it created or edited, so spec evolution traces to the milestone that made it. The `techspec` skill carries the authoring method.

### Milestones — `docs/milestones/milestone_v<YYYY.MM.DD>_<slug>/`

A milestone is one bounded outcome the project pursues, and its folder is the record of that pursuit. The leading date is the start date, so folders sort chronologically. The canonical file is `milestone.md`:

- **Scope** — the objective, the boundary, and what is explicitly excluded.
- **Deliverables** — the concrete outputs expected; amended as an open-ended milestone evolves.
- **Verification** — how completion is judged, and by what evidence.
- **Research** — the research records that informed it.
- **Specs** — the governing specs, and **Trail**: one row per spec created or edited, with a short what-changed note — the same Trail heading the decomposition record carries.

**At most one milestone is active per project**, recorded in the charter; between a release and the next milestone there is none. The folder also holds `decomposition.md` — the milestone's execution plan, laid down as building begins and amended as the plan changes (see §Lifecycle, Execution) — plus the working records the milestone produces when they earn their keep: integration notes when a merge required judgment, review records when a review round is formally written down.

### Decomposition — `docs/milestones/<milestone-folder>/decomposition.md`

The milestone's execution plan and running ledger, laid down as an act of execution when building begins — every milestone carries one. It holds three parts:

- **Current** — two or three lines, rewritten in place: where the milestone stands right now and what is next. The ten-second orientation for a fresh session.
- **Plan** — the itemized steps, in sequence, toward the deliverables `milestone.md` sets. Each step carries its status (pending, in progress, done, dropped), the deliverable it serves, and pointers — lane, pull request, record.
- **Trail** — append-only dated lines recording how the plan changed: re-sequencing, added or dropped steps, scope amendments. Earlier lines stand.

**Update it in the same commit as the work it records** — a step's status flip rides the commit that completes the step, and Current stays true. `milestone.md` stays the stable what; this record is the living how and where-we-are. Entries are states and pointers; narrative belongs in the records the pointers name.

### Releases — `docs/releases/release_v<YYYY.MM.DD>/`

A release is a versioned snapshot of the whole project, closing a milestone. Versions are date-based — `v<YYYY.MM.DD>`, with `.r2`, `.r3` suffixes when a day ships more than once — and every release tags the publishing merge on `main` with the version name; the tag is the canonical pointer to the released state. The folder's `release.md` carries lean notes, two lists only: **Features** (new capability) and **Fixes** (what was resolved). In the same act, the closing pointers refresh: the charter moves the milestone from Active to Past with a short shipped-summary, and the milestone's `milestone.md` status reads `Completed` with the release named.

### Deployments — `docs/deployments/deploy_<environment>/`

The per-environment manual for how this project's work reaches an environment — written entirely from the project's own specifics, one folder per environment, `<environment>.md` as the manual. **development** and **production** are the typical pair — development runs the integrated in-progress state, production runs published releases — and a project defines whatever further environments its topology needs under the same convention. A manual makes its deployment executable without prior context:

- **When** — the moment this deployment is performed and what cues it.
- **Mechanism** — the deploy acts, what to wait for, and the signals that confirm them.
- **Smoke** — how the deployed result is verified live.
- **Rollback** — how the environment returns to its previous stable state.
- **Record** — what record an invocation leaves and where.

What gets deployed, from where, and by what means is entirely each `<environment>.md`'s to dictate — this document rules only that the manual exists and covers the parts above. Production advances by deploying a published release; in-progress work stays off it.

### Workflows — `docs/operations/work_<slug>/`

The durable definition of recurring or unattended work — the shape the Principal delegates to always-on agents. Each workflow folder holds `workflow.md` plus whatever supporting material a run needs:

- **Purpose** — what the workflow accomplishes and why the project needs it.
- **Inputs** — what a run consumes: deployed apps, configuration, per-run input.
- **Trigger** — schedule, event, or operator start.
- **Procedure** — the steps a run follows.
- **Deliverables** — what a successful run produces.
- **Verification** — how a run's outcome is judged mechanically.
- **Record** — what record each run leaves and where.

A workflow is prepared once and run many times. A run that meets anything its definition leaves out stops, leaves its state in the run's record, and raises it to the Principal through the running agent's own notification path — notification belongs to the agent's context, with the workflow record staying the source of truth.

## GitHub

A project maps onto GitHub as one repository — the project's single repo, carrying the standing branches, every pull request, and the issues. The issues are the glanceable surface: bugs, enhancements and defects in flight, visible from any device, a phone included, with the repo's records staying the truth underneath.

The issues' standing use is **recording bugs, enhancements, and defects** — concrete faults and small improvements, filed the moment they surface, labeled for what they are with the stock `bug` and `enhancement` and the `defect` label Foundry adds. These are findings too small to deserve a backlog item and too important to go unrecorded. The Principal and the working agent file them. A fix that ships closes its issue; an issue that grows enough context and judgment to need curation moves to the backlog or straight into a milestone's fix work.

The issues and the backlog serve different purposes: the backlog carries work intentions — curated in the repo, with context, dates, and trails, feeding milestones; the issues carry the fault queue — atomic, labeled, closeable, open to any filer. The issues show state; the record holds truth.

## Branches

- Two standing branches. **`main`** carries release truth — every commit on it is a release boundary. **`dev`** carries integration — in-progress milestone work lands there as it completes. Both advance by pull request, and the Principal's approval — under the Principal's own account — is what merges one.
- Work happens on lanes off `dev`: **`feature/<milestone-folder>/<slug>`** for milestone features, **`fix/<milestone-folder>/<slug>`** for milestone-scoped corrections. The milestone segment in the lane name ties every lane to its record. A **`hotfix/<slug>`** lane comes off `main` for an urgent production fix, merges back to `main` by pull request, and is tagged — and the act completes on `dev`: immediately after the tag, open `fix/main-sync/<hotfix-slug>` off `dev`, merge `main` into it, resolve what surfaces while the context is fresh — the conflicts, and the judgment of what `dev`'s newer work still needs from the fix — and land it by pull request on green CI. A hotfix is done when **both** standing branches carry it; `git branch --contains <tag>` verifies.
- Push a lane to the remote and open its pull request there — shared lanes keep the work reviewable from any device before it reaches a standing branch.
- Rebase a stale lane onto `dev` (a hotfix lane onto `main`), then push with `--force-with-lease`; standing branches move forward only, and their history stands.
- CI gates the merge: a pull request into a standing branch lands green. Merged lanes are swept at release; a lane with unmerged work is surfaced and resolved, and survives every sweep until it is.

## Identity

- Two GitHub accounts carry a project: the Principal's own, which owns every repository and approves every pull request, and the Vork account, which every agent session commits and pushes as. Foundry binds the Vork account's commit identity, the name and email the kit was installed with, to `main/` at founding; commit under it.
- Pull requests and GitHub API writes authenticate with the Vork account's token, a file read by path and bound per command; remote URLs stay clean. The Principal reviews and approves under the Principal's own account; keeping the two identities separate is what makes that approval a real gate.

## Startup

1. Read the project's `docs/charter.md`, `docs/backlog.md`, and the active milestone record — in that order.
2. `git status` the clone; land on `dev` and pull before new work; a dirty tree gets resolved before it gets added to.
3. Branch a lane for the work, do it, record it, commit as you go, and open the pull request for the Principal.
4. After the pull request merges, the lane stands — lanes are deleted only at the milestone's close, in the release sweep. `dev` and `main` alone persist beyond it.
