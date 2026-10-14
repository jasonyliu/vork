# Research: Estate entanglement in the kit

**Date:** 2026-10-14

## Purpose

Release 2 moves the Principal's working kit out of the project that built it and into Vork, where anyone with a GitHub account, Node and one harness can clone it, follow the README and found a project. The kit was written for one estate: one owner, one shared work account, one storage root, one keystore, one LAN database, one deployment model. This record inventories every place that estate reaches into the kit's six pieces, states the generic form each one takes, and gives the evidence the two questions left open at handoff need. The specs of this milestone follow from it.

Sources read in full, at the consumer project's tag `v2026.10.12.r2`: the rule `docs/agents/rules/PROJECT.md` (180 lines, byte-identical to the rule deployed on the build machine); the three skills `docs/agents/skills/{foundry,release,techspec}/` (techspec with its three genre references and its evals); the eleven templates `docs/conventions/templates/`; Foundry `apps/foundry/` (54 files: 20 source modules, 11 test files, assets, README, env example, package files); the two installers `provisions/{claude,codex}/deploy`; and the four Foundry specs `specs/apps/foundry/{spec_foundry,spec_foundry-interface,spec_foundry-data,manual}.md`, which the handoff left out of its list of five and which move with the code. Foundry at that tag is byte-identical to the production clone that founded Vork on 2026-10-10 and kicked off this milestone, so the code under study is the code in use.

## Conclusion

### Shape

The estate enters the kit through nine threads, each threading through several pieces. Untangling is done per thread, across pieces, so that one decision settles every occurrence:

| Thread | What it is | Where it reaches | Generic form |
|---|---|---|---|
| Storage root | `~/Vork/projects/` as the parent of every project folder | rule (load trigger, §Storage ×3), Foundry (`config.ts` default, `.env.example`, one test), foundry skill, specs | one default stated once; Foundry already takes it from `FOUNDRY_PROJECT_STORAGE_PATH` and `--project-storage-path` (§Storage root, below) |
| Registry | the platform database row Foundry writes at founding | Foundry (`registry.ts`, the register stage of `pipeline.ts`, `RegistryRecord` in `events.ts`, `types.ts`, `config.ts`, five env vars, `package.json` dependency on the data package and `pg`, `registry.test.ts`, registry assertions in `pipeline.test.ts` and `bundle-config.test.ts`), specs, foundry skill, Foundry README | leaves with the framework (§Registry, below) |
| Keystore | credentials as `0600` files under one repo, read by path, named by account | rule §Storage and §Identity, Foundry `.env.example` (two token paths named after the Principal's accounts), specs, foundry skill | the mechanism stays (a token is a file path the operator names); the repo, its location and the file names leave |
| Owner and work account | two GitHub accounts: the owner's for approval, a shared work account every session acts through | Foundry preflight, grants, identity binding, kickoff; rule §Identity; specs; tests with the two real logins | the two-account model is the convention's mechanism and stays; the logins become fixtures (§Identity, below) |
| Estate documents | `rules/TOOLS.md` as the authority for machines, the cockpit, token files and commit identity | rule (four pointers: §Storage ×3, §Identity), the installers (deploy `rules/*.md` whole) | the rule states its own mechanisms and leaves machine facts to the operator; the installer carries the kit's rule alone |
| Cockpit | one project holding conventions, templates, agent contexts, Foundry and provisions for every other | rule §Storage and §Structure; the consumer project's charter | Vork is the kit's home and installs per machine; every founded project carries its own template copy, so the rule points there |
| Production clone | the deployment model: a clone pinned at the release tag on every machine, Foundry run from it, `.env` beside it | foundry skill (a literal `cd`), Foundry README and specs, both installers (`SOURCE` default), the manual | the operator's Vork clone at a tag, `npm ci` once, `.env` from the example (§Run surface, below) |
| Framework residue | words and pointers from the conducted era | rule §GitHub (the RED filer); foundry skill (`--conducted`, a flag the CLI no longer parses, and the parked dispatcher); three templates (§Templates, below); specs pointing at the data layer | deleted or rewritten to the current design |
| Persona surfaces | per-principal `CLAUDE.md` and `AGENTS.md` blocks, the harness memory and curated-memory roots | both installers (step 1 writes a persona block), rule §Storage (the memory repo bullet) | the persona stays with its owner; the installer places rules and skills, and for Codex a pointer block (§Installers, below) |

### Rule

`PROJECT.md` is the kit's governing text and loads itself in Claude Code through its frontmatter `paths: "**/Vork/projects/**"`. Its estate content, by section:

- **Frontmatter.** The load trigger is the storage root. Whatever §Storage root decides, the trigger must name the same path, or the rule stays silent in every project.
- **§Storage.** The literal root in the opening paragraph and the layout block; "Which machine plays which part is estate fact — `rules/TOOLS.md`" and "`rules/TOOLS.md` says which machine does what"; the cockpit bullet; the keystore bullet naming `~/Vork/projects/keystore/`; the memory bullet naming the household's curated memory repo and the memory-sync act. Generic form: the layout with its default root; "one mutable checkout belongs to one actor" stands as the rule and the operator decides which machine carries which clone; a keystore is "a directory of credential files read by path, one per account", location the operator's; the memory bullet leaves.
- **§Structure.** "instantiated from the templates in the cockpit's `docs/conventions/templates/`" points at the cockpit. Foundry renders the template set into every project it founds (`docs/conventions/templates/`, byte-verbatim), so the project's own copy is the home: the sentence points there.
- **§GitHub.** "standing adversarial QA (RED) joins as a filer when it returns to attack the products" is framework residue (the red team was specified and never built, per release 1's README).
- **§Identity.** "Commit under the agent identity the estate defines — its name, email, and token file are stated in `rules/TOOLS.md`" and "GitHub tokens live in the keystore repo, under its `github/` folder, one token file per agent, saved under the agent's name". Generic form: commit under the work account's identity; tokens are files the operator names, one per account, read by path; the owner approves under the owner's account. The mechanism is unchanged; the authority moves from an estate document into the rule itself.
- **Everything else** (§Lifecycle, §Records, §Branches, §Startup) is already generic. The word "the Principal" is the convention's name for the owner; it stays and the rule defines it once at the top.

The consumer project's `CLAUDE.md` and `AGENTS.md` point at the rule; the rule points at nothing of theirs. Removing the four `TOOLS.md` pointers and the memory bullet makes it stand alone.

### Templates

The eleven templates carry zero estate terms. Three carry framework vocabulary that the current rule no longer defines, and one carries a source-layout path:

| Template | Residue |
|---|---|
| `integration.md` | "Execution Tasks and this Integration Stage Task", decomposition keys `E#`/`I#`, "its row in the milestone's `decomposition.md` §Features / §Fixes" (the current decomposition template has one Plan table), task states `Completed \| Cancelled` |
| `deployment.md` | "the Primary Specification of every Deployment Stage Task (DELIVERY.md §Deployment)", "the Task's transition comment", "PROJECT.md §Environments" (the section is §Deployments) |
| `review.md` | "the state of Development staged for the Principal's hands-on verification", "the Release Stage Task" |
| `README.md` (the index) | `docs/agents/rules/PROJECT.md §Records` as the rule's path |
| `charter.md` | "List any missing durable agents that must be created before work proceeds"; `products/` described as "deployments/, jobs/" |
| `milestone.md` | "the Principal and the AI Lead decided" — the AI Lead is the framework's name for the working agent |

Foundry's committed skeleton copy is byte-identical to the canonical set at the tag (verified file by file). In Vork the canonical set and Foundry's copy are the same files or one is derived from the other; the spec picks one home. Vork's own `docs/conventions/templates/` today holds release 1's nine; release 2 replaces them with the eleven.

### Skills

- **foundry** — the only skill with estate in it: a literal `cd` into the consumer project's production clone; "Tokens resolve from the machine's keystore clone"; a pointer into the source project's spec tree (`specs/data/spec_config.md §Foundry`); `gh api repos/<owner>/<key>` written with the Principal's login; "registry" in the bootstrap list; "`--conducted` is dormant while Wakery is parked" (the CLI at the tag parses no such flag). Generic form: run from the operator's Vork clone, `.env` per the example, verification by `foundry verify` and `gh api repos/<owner>/<key>`.
- **release** — generic throughout; steps 9 and 10 (deployment preview and deployments) name the consumer project's two environments "production, then workstation" as an example order. Reword to "per target, in the order the manuals state".
- **techspec** — clean: `SKILL.md`, the three genre references and `evals/evals.json` carry no estate and no framework residue. Moves verbatim.

### Foundry

Of 54 files, 36 are already generic: `bundle.ts`, `errors.ts`, `artifacts.ts`, `variables.ts`, `render.ts`, `skeleton.ts`, `preflight.ts`, `gitops.ts`, `milestones.ts`, `verify.ts`, `main.ts`, the three `github/` modules, `bin/foundry`, `tsconfig.json`, `.gitignore`, `labels.json`, both rulesets, the three rendered skeleton files (the skeleton charter already writes `<project-storage-path>`), the eleven verbatim templates, and five of the eleven test files. The entangled 18:

| File | Entanglement | Generic form |
|---|---|---|
| `.env.example` | two token paths named after the Principal's accounts; the storage root; registry host as a LAN address, database and role named after the consumer project, password path | `<keystore>/github/owner.token`, `<keystore>/github/work.token`; the storage root default; registry lines gone |
| `config.ts` | `DEFAULT_PROJECT_STORAGE_PATH`; the optional database section with the consumer project's env prefix and defaults | the root default per §Storage root; database section gone |
| `types.ts` | `DatabaseConfig`, `FoundryEnv.database`, the comment naming the platform contract | gone |
| `registry.ts` | the whole module (pool, ping, `registerProject` through the data package's `mintId`) | gone |
| `pipeline.ts` | the register stage (about 25 lines), `openRegistry` dependency, `RegistryOutcome` in the outcome, the import of the data package's `Queryable` | the pipeline runs preflight → GitHub → render and clone → scaffold → rulesets |
| `events.ts` | `RegistryRecord` and the comment on registry state | gone |
| `package.json` | the `file:../data` dependency on the data package (drags the whole data layer into the tree), `pg`, `@types/pg`; `"private": true` | Octokit, dotenv, tsx, TypeScript, vitest |
| `README.md` | registry, the source project's tree as fixture, the spec paths | rewritten with the kit as subject |
| `test/bootstrap.test.ts`, `test/fakes.ts`, `test/helpers.ts`, `test/pipeline.test.ts`, `test/render.test.ts` | the owner's and work account's real logins as fixtures; `pipeline.test.ts` also migrates a pg-mem registry through the data package and asserts registry rows | `owner-login` / `work-login` fixtures; registry assertions gone |
| `test/registry.test.ts` | the whole file | gone |
| `test/bundle-config.test.ts` | the storage root literal; three registry env tests | root per decision; registry tests gone |
| `test/verify.test.ts` | the standing fixture is the source project's tree, three directories up | Vork's own tree (§Fixture, below) |

Code comments cite `spec_foundry.md`, `spec_foundry-interface.md` and `spec_foundry-data.md` by section; those three specs move with the code and the pointers stay valid. Two comments cite the data layer (`spec_config.md §Foundry`, `spec_database.md §11`); both describe the registry and leave with it.

The specs themselves (299 lines) carry the same threads in prose: the register stage and its row, the storage root, the keystore token names, the production clone as run surface, the source tree as verify fixture, and the sentence "Schema lifecycle belongs to the data package; Foundry rides the schema as it stands." After the registry leaves, Foundry's durable outputs are GitHub artifacts, a rendered tree and a run event trail; the Data spec shrinks to those three. `manual.md` is an operator document and becomes README material.

### Installers

Two scripts exist, `provisions/claude/deploy` and `provisions/codex/deploy`, near-identical (about 110 lines each): parse `--check --source --home --set`; write a managed persona block into `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md` between markers that carry the consumer project's name; copy `rules/*.md`; copy `skills/**` replace-by-name, deleting nothing; `--check` diffs every surface and exits non-zero on drift. Estate: the `SOURCE` default (the production clone path), the `--set` default naming the Principal, the marker text, the `docs/agents/<harness>/<set>/` layout, and the fact that `rules/*.md` includes the estate document.

Generic form, per harness:

- **Claude Code** reads `~/.claude/rules/*.md` and loads a rule by its `paths:` frontmatter, and discovers `~/.claude/skills/<name>/SKILL.md`. The installer copies the rule and the three skills. A persona block is the operator's own and stays out of the kit.
- **Codex** reads `~/.codex/AGENTS.md` at every session, reads `~/.codex/rules/` only when told to by path, and discovers `~/.codex/skills/<name>/SKILL.md` by the same frontmatter. The installer copies the rule and the skills and writes one short managed block into `AGENTS.md` whose content is a pointer: read `~/.codex/rules/PROJECT.md` when a project is touched. The consumer project's `AGENTS.md` already carries that sentence; the kit supplies it to operators who have none.
- One script with a harness switch, or two thin scripts over one shared body, both with `--check`, `--source` defaulting to the script's own clone, and `--home`. Markers carry the kit's name.

### Storage root

Evidence for the open question "literal default or variable throughout":

- Foundry already treats the root as configuration: `FOUNDRY_PROJECT_STORAGE_PATH` in `.env`, overridden per run by `--project-storage-path`, defaulting to the literal in `config.ts`. Preflight checks the path exists and is writable. Changing the default is one constant and one example line.
- The rule is text read by a model; it has no variable mechanism. It can state a default and say the operator may choose another, but Claude Code's load trigger (`paths:`) must match the real root. An installer that renders the frontmatter from a chosen root, or a rule that triggers on the project shape (`**/main/docs/charter.md`) rather than the root, are the two ways to keep the rule true under a chosen root.
- The skeleton charter already renders the root as `<project-storage-path>`, so founded projects carry no literal.
- Twelve occurrences in all: four in the rule (trigger, paragraph, layout block, keystore bullet), three in Foundry (`config.ts`, `.env.example`, one test), one in the foundry skill, four in the specs.

Recommendation: keep `~/Vork/projects/` as the stated default, named once in the rule and once in `config.ts`, with the operator's override through Foundry's environment; make the rule's load trigger follow the project shape so the rule holds under any root. "Vork" naming the kit's own default root reads as the product's convention rather than the Principal's estate.

### Registry

Evidence for the open question "does the registry stay as an option":

- What it writes: one row in the `project` table (key, name, status `active`), idempotent, through the data package's `mintId`. Nothing else.
- Who reads it: Wakery, the parked dispatcher, through its route and lease tables. At the tag, no code outside the four framework apps reads the `project` table. Vork's own founding on 2026-10-10 wrote `existing`: the row was already there from an earlier run.
- What it costs the kit: the `pg` dependency, a `file:` dependency on the data package that pulls the whole data layer (migrations, seed, test pool) into the published tree, five environment variables, a module, a pipeline stage, an event type, a test file and registry assertions in three others, and the sentence in every spec that says Foundry rides the schema. Keeping it as an option keeps `apps/data` on `main`, which contradicts the ruling that the framework tree leaves `main`.
- What the Principal keeps if it leaves: the registry row is reproducible by hand or by a one-line script in the consumer project after any founding; the run event log already records the project key and names.

Recommendation: the registry leaves Foundry whole. Standalone becomes the only mode, as the scope already states; the consumer project owns any registration it still wants, outside the kit.

### Identity

The kit needs two GitHub accounts: the owner's, whose token creates and approves, and a work account, whose token accepts the grant, commits and pushes. This is the convention's gate (an account cannot approve its own pull request, so `protect-main`'s one required review is only satisfiable by a second account). The handoff's phrasing "someone with a GitHub account" meets this constraint at the README: the operator supplies two tokens, or runs with `FOUNDRY_RULESET=none` and loses the gate. A single-account mode (work token absent, grants skipped, `main/` bound to the owner) is a design choice for the Draft, with the ruleset consequence stated. Today's code requires both tokens and exits 2 without them.

### Fixture

`foundry verify` compares a tree against the skeleton inventory: `README.md`, `docs/charter.md`, `docs/backlog.md` present, and `docs/conventions/templates/*` byte-identical. Vork's own tree holds every one of those paths. Once Vork's templates are the eleven, `verify --against <vork clone>` passes, and Vork's own tree replaces the source project's as the standing fixture: the kit's home follows the kit's shape, and release 1's "verify fails against this repository" closes.

### Run surface

The production-clone model reduces, for an operator, to: clone Vork, check out the release tag, `npm ci` in `apps/foundry/`, copy `.env.example` to `.env` and fill the token paths and the root, run `bin/foundry` from anywhere (the entrypoint resolves its own directory, and a symlink into `~/.local/bin/` is the documented stable path). The consumer project's two deployment manuals describe its own estate's version of this and stay there.

### Leaves

What leaves `main` for the tag `v2026.10.13`, per the handoff: `docs/policy/`, `docs/conventions/constants.md` and release 1's nine templates, `specs/` whole (the framework's Foundry specs included, replaced by the current three), `apps/data`, `apps/wakery`, `apps/resolver`, release 1's `apps/foundry`, `provisions/openclaw/`, `provisions/github/` (its rulesets duplicate Foundry's assets), `provisions/skills/techspec/` (superseded by the skills home), `provisions/foundry/README.md`. The README and the agent note are rewritten with the kit as subject and the framework as history at its tag.

### Specs

The findings call for three specs, written against this record: the kit's layout and installers (Interface: what lands where on each harness, the `--check` contract, the Codex pointer block); Foundry standalone (Process and Data, revised in place from the three source specs with the registry removed, the fixture and run surface restated); and the rule and templates (the rewritten `PROJECT.md` sections above, the three templates' residue, one template home). The Draft settles the storage-root form, the registry's departure, and the single-account question before the first lane is cut.

## References

- Handoff: `docs/backlog.md` §Items, "Release 2 — the standalone kit (handoff, 2026-10-14)".
- Sources: the consumer project at tag `v2026.10.12.r2` — `docs/agents/rules/PROJECT.md`; `docs/agents/skills/{foundry,release,techspec}/`; `docs/conventions/templates/` (eleven); `apps/foundry/`; `provisions/{claude,codex}/deploy`; `specs/apps/foundry/`. Foundry's `apps/foundry/` at that tag is byte-identical to the production clone pinned at `v2026.10.03` on the build machine, the copy that founded Vork and kicked off this milestone.
- Release 1 of Vork, tag `v2026.10.13`: `README.md` §Broken ("`foundry verify` fails against this repository"), §Unbuilt (the red team); `docs/releases/release_v2026.10.13/agent-notes.md` for the placeholder legend the extraction discipline carries forward.
- Term search over the six pieces, case-insensitive, for the owner's login, the consumer project's name, machine names, LAN and tailnet addresses, the storage root, keystore, registry, the dispatcher, the database, webhooks and the crew personas: every hit is accounted for in §Rule, §Skills, §Foundry and §Installers above; the templates and the techspec skill returned none.
