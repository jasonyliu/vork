# Kit

Vork is a package of small tools around a harness: the project convention (`rules/PROJECT.md`), the start acts (Foundry), three skills (foundry, release, techspec), and the record templates. Its consumers are deployment surfaces: a harness the operator drives, Claude and Codex, and the operator reading the README. This spec is the package's shape and the installer that deploys it to a surface. Foundry's own contracts: `spec_foundry*.md`. The convention's content: `rules/PROJECT.md`.

## Layout

The Vork clone's tree, which is also a project in the convention's own shape (`foundry verify --against <vork clone>` exits 0):

```text
README.md  LICENSE  CONTRIBUTING.md
rules/PROJECT.md                   # the convention, canonical, no frontmatter
skills/<name>/SKILL.md             # foundry, release, techspec (techspec with references/, evals/)
apps/foundry/                      # the start acts (spec_foundry*.md); var/ and .env machine-local, gitignored
provisions/install                 # the installer (§Install)
provisions/codex/AGENTS.md         # what a surface receives beyond the rule and skills (§Surfaces); a folder per surface that needs one
docs/charter.md  docs/backlog.md
docs/conventions/templates/*.md    # the eleven record templates, the one home (spec_foundry-data.md §Skeleton inventory)
docs/deployments/deploy_<surface>/<surface>.md   # one manual per surface: claude, codex
docs/milestones/  docs/research/  docs/releases/
specs/spec_kit.md  specs/spec_foundry.md  specs/spec_foundry-interface.md  specs/spec_foundry-data.md
```

Identifiers:

- `<surface>`: `claude` | `codex`; names the manual folder, the installer's `--surface` value, and the `provisions/<surface>/` folder where the surface needs more than the rule and skills.
- `<projects-root>`: the storage root, parent of every `<project_key>/` (`rules/PROJECT.md §Storage`); one value per machine, chosen at install, written into Foundry's environment and into the Codex pointer block.
- The Vork account: the second GitHub account, the one every agent session pushes as (`rules/PROJECT.md §Identity`); its token path and its commit identity — the starting identity of every founded clone — are install-time inputs written into Foundry's environment.
- `<vork>`: the Vork clone the installer belongs to, resolved from the script's own location. The clone at a release tag is the deployed release; the installer is how it reaches a surface.
- Managed-block markers: `<!-- vork:start v=<sha> source=<tag> deployed=<YYYY-MM-DD> -->` … `<!-- vork:end -->`. Content between the markers is the kit's; content outside is the operator's and is never touched.

## Surfaces

What each surface reads, and so what the installer lands under `$HOME`:

| Surface | Reads on its own | Landed by the installer |
|---|---|---|
| `claude` | `~/.claude/rules/*.md`, loaded at launch into every session (a rule with `paths:` frontmatter loads instead when a Read, Write or Edit touches a file matching the glob relative to the session's project directory, and never for a file outside it); `~/.claude/skills/<name>/SKILL.md` | `rules/PROJECT.md` → `~/.claude/rules/PROJECT.md` verbatim, no frontmatter, so the rule is present in every session whatever the root and the working directory; `skills/**` → `~/.claude/skills/<name>/…` |
| `codex` | `~/.codex/AGENTS.md` at every session; `~/.codex/skills/<name>/SKILL.md`. Codex reads `~/.codex/rules/` for its own `.rules` execution policies; a markdown file there is inert until a session is told to read it by path | `rules/PROJECT.md` → `~/.codex/rules/PROJECT.md` verbatim; a managed pointer block in `~/.codex/AGENTS.md` from `provisions/codex/AGENTS.md` (§Pointer block); `skills/**` → `~/.codex/skills/<name>/…` |
| operator | `README.md` | nothing; the README is the surface |

A surface added later (an OpenClaw agent, another harness) is one row here, one manual, one installer branch, and a `provisions/<surface>/` folder when it needs more than the rule and skills.

### Pointer block

`provisions/codex/AGENTS.md`, rendered between the markers:

```markdown
Projects under `{{projects_root}}/` follow the Vork convention. When a session touches a file there, read `~/.codex/rules/PROJECT.md` first and work by it. The kit's skills are in `~/.codex/skills/`.
```

`{{projects_root}}` is the one variable a surface file may carry; the installer refuses any other `{{name}}` (exit 2).

## Install

```text
provisions/install --surface <surface> [--projects-root <path>]
                   [--owner-token <path>] [--vork-token <path>] [--name <text>] [--email <text>]
                   [--check]
```

The deployment of Vork to a surface. The operator runs it after the first clone, again for each further surface, and after every `git checkout v<YYYY.MM.DD>` of a newer release; each surface's manual under `docs/deployments/` has this command as its whole Mechanism, `--check` as its Smoke, and "check out the previous tag and install again" as its Rollback. Bash, POSIX tools and `git` alone. Convergent and idempotent: every act makes destination equal source, decided by content comparison; the stamp in a managed block is testimony, never the verdict. The installer writes named files and deletes nothing. Destinations resolve under `$HOME`; the installer's own tests run it with `HOME` set to a scratch directory.

Acts, in order:

1. **Root**: resolve `<projects-root>` (flag, else `~/Vork/projects`, the suggested default); expand `~` to an absolute path; `mkdir -p` it.
2. **Foundry environment**: `<vork>/apps/foundry/.env` is the installer's to write. Absent (the machine's first install): `--owner-token`, `--vork-token`, `--name` and `--email` are required, exit 2 naming the missing one; the file is created from `.env.example` with `FOUNDRY_OWNER_TOKEN_PATH`, `FOUNDRY_VORK_TOKEN_PATH`, `FOUNDRY_VORK_NAME`, `FOUNDRY_VORK_EMAIL` and `FOUNDRY_PROJECT_STORAGE_PATH` set. Present: the four are optional, and each one given replaces its line (`--projects-root` likewise); lines left alone stand. The installer reports any line that still reads a `<placeholder>`.
3. **Foundry dependencies**: `<vork>/apps/foundry/node_modules/` absent → `npm ci` there; the report names it.
4. **Rule**: `rules/PROJECT.md` verbatim to the surface's rules directory; compare, copy atomically (`.tmp.$$` then `mv`).
5. **Skills**: for every file under `<vork>/skills/`, compare, copy to the surface's skills directory at the same relative path. Files the surface already holds under other skill names stand.
6. **Pointer block** (`codex` alone): render; a block present with equal content → unchanged; present and different → replaced between its markers, the rest of the file byte-preserved; absent → appended after a blank line (file created when missing).

`--check` performs no write: each act prints `unchanged | drifted | missing` per path, step 2 prints each environment line beside the flag given for it (values of token paths, never of tokens), step 3 prints whether dependencies are present, and the exit code is 1 on any drift, 0 when clean.

Output: one line per path, `<verdict> <path>`; last line `installed <surface> from <vork> @ <sha> (<tag>) root <projects-root>` or `check: clean | check: DRIFT`.

Exit codes:

| Code | Meaning |
|---:|---|
| 0 | success, or `--check` clean |
| 1 | `--check` found drift |
| 2 | usage: unknown flag, unknown surface, a required first-install flag missing, a surface file carrying an unknown variable, the script outside a Vork clone (`rules/PROJECT.md` absent beside it) |
| 5 | a write failed (named path) |

## Run surface

Foundry runs from the Vork clone (`<vork>/apps/foundry/bin/foundry`) at the release tag the operator checked out; `.env` and `var/` sit beside it and survive checkouts (gitignored). The operator's sequence, which the README states in this order:

1. Two GitHub accounts: the owner's (the operator's own) and the Vork account; a token for each, saved as a file (`rules/PROJECT.md §Identity`). On a free plan a private repository takes no branch protection, so the operator founds public repositories or sets `ruleset: none` in the bundle (`spec_foundry.md §Preflight`).
2. Node 22 or later, `git`, one harness.
3. `git clone` Vork, `git checkout v<YYYY.MM.DD>`.
4. `provisions/install --surface <surface> --owner-token <path> --vork-token <path> --name <text> --email <text> [--projects-root <path>]`: the first install writes `apps/foundry/.env` whole; nothing is edited by hand.
5. Write a bundle (the five mission fields, `visibility`, `ruleset`); `foundry bootstrap --bundle <path> --dry-run`; then without `--dry-run`.
6. Open a session in the harness and start the founded project's charter conversation; the rule loads the moment the session touches the project.

Steps 1 to 4 happen once per machine, step 4 again per further surface; step 5 repeats per project. A stable command path is a symlink: `ln -s <vork>/apps/foundry/bin/foundry ~/.local/bin/foundry`; the entrypoint resolves its own directory.

## Verification

- `foundry verify --against <vork clone>` exits 0 at every release.
- `install --surface claude` on a scratch `HOME` with the four first-install flags: `.claude/rules/PROJECT.md` byte-equals `rules/PROJECT.md`; `.claude/skills/{foundry,release,techspec}/` byte-equal the kit's; `apps/foundry/.env` exists and carries the root, both token paths, the name and the email; a second run prints `unchanged` for every path; `--check` exits 0; editing one landed file makes `--check` exit 1 naming it.
- `install --surface codex` on a scratch `HOME`: `.codex/rules/PROJECT.md` byte-equal; the pointer block present once in `.codex/AGENTS.md` with the root rendered; an existing `AGENTS.md` keeps every byte outside the markers; a second run leaves the file byte-identical; a changed block is replaced in place.
- A first install without one of the four flags exits 2 naming it and writes nothing; `install --surface codex` on a machine already installed for `claude` needs no flags and leaves `.env` byte-identical.
- `--projects-root` given twice with different values: the second run rewrites the pointer block and the `.env` line, and `--check` with the first value reports drift; the same for `--name` or `--email` given again.
- A Claude Code session opened anywhere on the machine after the install shows `PROJECT.md` loaded (`/context`).
- Operator proof (milestone verification): a founding from a clean account pair on the README alone reaches the charter conversation; the consumer project re-points its own deployment to the tag.
