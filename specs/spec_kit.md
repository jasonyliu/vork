# Kit

Vork is a package of small tools around a harness: the project convention (`rules/PROJECT.md`), the start acts (Foundry), three skills (foundry, release, techspec), and the record templates. Its consumers are deployment surfaces: a harness the operator drives, today Claude Code and Codex, and the operator reading the README. This spec is the package's shape and the installer that lands it on a surface. Foundry's own contracts: `spec_foundry*.md`. The convention's content: `rules/PROJECT.md`.

## Layout

The Vork clone's tree, which is also a project in the convention's own shape (`foundry verify --against <vork clone>` exits 0):

```text
README.md  LICENSE  CONTRIBUTING.md
rules/PROJECT.md                   # the convention, canonical, no frontmatter
skills/<name>/SKILL.md             # foundry, release, techspec (techspec with references/, evals/)
apps/foundry/                      # the start acts (spec_foundry*.md)
provisions/install                 # the installer (§Install)
docs/charter.md  docs/backlog.md
docs/conventions/templates/*.md    # the eleven record templates, the one home (spec_foundry-data.md §Skeleton inventory)
docs/deployments/deploy_<surface>/<surface>.md   # one manual per surface: claude-code, codex
docs/milestones/  docs/research/  docs/releases/
specs/spec_kit.md  specs/spec_foundry.md  specs/spec_foundry-interface.md  specs/spec_foundry-data.md
```

Identifiers:

- `<surface>`: `claude-code` | `codex`; names the manual folder and the installer's `--surface` value.
- `<projects-root>`: the storage root, parent of every `<project_key>/` (`rules/PROJECT.md §Storage`); one value per machine, chosen at install, written into Foundry's environment and into the Claude Code rule's frontmatter.
- `<home>`: the target home directory, default `$HOME`; surfaces land under `<home>/.claude/` and `<home>/.codex/`.
- `<source>`: the Vork clone the installer runs from, default the installer's own clone.
- Managed-block markers: `<!-- vork:start v=<sha> source=<tag> deployed=<YYYY-MM-DD> -->` … `<!-- vork:end -->`. Content between the markers is the kit's; content outside is the operator's and is never touched.

## Surfaces

What each surface reads, and so what the installer lands:

| Surface | Reads on its own | Landed by the installer |
|---|---|---|
| Claude Code | `<home>/.claude/rules/*.md` (a rule with `paths:` frontmatter loads when a Read, Write or Edit touches a matching file; a rule without it loads at launch); `<home>/.claude/skills/<name>/SKILL.md` | `rules/PROJECT.md` → `<home>/.claude/rules/PROJECT.md` with a rendered frontmatter `paths: ["<projects-root>/**"]`, `~` expanded; `skills/**` → `<home>/.claude/skills/<name>/…` |
| Codex | `<home>/.codex/AGENTS.md` at every session; `<home>/.codex/skills/<name>/SKILL.md`. Codex reads `<home>/.codex/rules/` for its own `.rules` execution policies; a markdown file there is inert until a session is told to read it by path | `rules/PROJECT.md` → `<home>/.codex/rules/PROJECT.md` verbatim; a managed pointer block in `<home>/.codex/AGENTS.md` (§Pointer block); `skills/**` → `<home>/.codex/skills/<name>/…` |
| Operator | `README.md` | nothing; the README is the surface |

A surface added later (an OpenClaw agent, another harness) is one row here, one manual, one installer branch.

### Pointer block

The Codex block, rendered with `<projects-root>` and the markers above:

```markdown
Projects under `<projects-root>/` follow the Vork convention. When a session touches a file there, read `~/.codex/rules/PROJECT.md` first and work by it. The kit's skills are in `~/.codex/skills/`.
```

Its home in the kit: `provisions/surfaces/codex/AGENTS.md`, with `{{projects_root}}` as the one variable. The Claude Code frontmatter has the same home: `provisions/surfaces/claude-code/frontmatter.md`.

## Install

```text
provisions/install --surface <surface> [--projects-root <path>] [--home <dir>] [--source <vork clone>] [--check]
```

Bash, POSIX tools and `git` alone. Convergent and idempotent: every act makes destination equal source, decided by content comparison; the stamp in a managed block is testimony, never the verdict. The installer writes named files and deletes nothing.

Acts, in order:

1. **Root**: resolve `<projects-root>` (flag, else `~/Vork/projects`, the suggested default); expand `~`; `mkdir -p` it.
2. **Foundry environment**: `<source>/apps/foundry/.env` absent → copy `.env.example`; then set `FOUNDRY_PROJECT_STORAGE_PATH=<projects-root>` (replace the line, or append it). Token paths stay the operator's to fill; the installer reports them when they still read the example's placeholders.
3. **Foundry dependencies**: `<source>/apps/foundry/node_modules/` absent → `npm ci` there; the report names it.
4. **Rule**: render for the surface (frontmatter prepended for `claude-code`, verbatim for `codex`), compare, copy atomically (`.tmp.$$` then `mv`).
5. **Skills**: for every file under `<source>/skills/`, compare, copy to the surface's skills directory at the same relative path. Files the surface already holds under other skill names stand.
6. **Pointer block** (`codex` alone): render; a block present with equal content → unchanged; present and different → replaced between its markers, the rest of the file byte-preserved; absent → appended after a blank line (file created when missing).

`--check` performs no write: each act prints `unchanged | drifted | missing` per path, step 2 prints the root the environment holds beside the requested one, step 3 prints whether dependencies are present, and the exit code is 1 on any drift, 0 when clean.

Output: one line per path, `<verdict> <path>`; last line `installed <surface> from <source> @ <sha> (<tag>) root <projects-root>` or `check: clean | check: DRIFT`.

Exit codes:

| Code | Meaning |
|---:|---|
| 0 | success, or `--check` clean |
| 1 | `--check` found drift |
| 2 | usage: unknown flag, unknown surface, `<source>` without `rules/PROJECT.md` |
| 5 | a write failed (named path) |

## Run surface

Foundry runs from the Vork clone (`<source>/apps/foundry/bin/foundry`), at the release tag the operator checked out; `.env` sits beside it and survives checkouts (gitignored). The operator's sequence, which the README states in this order:

1. Two GitHub accounts: the owner's (the operator's own) and one work account; a token for each, saved as a file (`rules/PROJECT.md §Identity`).
2. Node 22 or later, `git`, one harness.
3. `git clone` Vork, `git checkout v<YYYY.MM.DD>`.
4. `provisions/install --surface <surface> [--projects-root <path>]`; fill the two token paths in `apps/foundry/.env`.
5. Write a bundle; `foundry bootstrap --bundle <path> --dry-run`; then without `--dry-run`.
6. Open a session in the harness and start the founded project's charter conversation; the rule loads the moment the session touches the project.

A stable command path is a symlink: `ln -s <source>/apps/foundry/bin/foundry ~/.local/bin/foundry`; the entrypoint resolves its own directory.

## Verification

- `foundry verify --against <vork clone>` exits 0 at every release.
- `install --surface claude-code` on a clean `<home>`: `.claude/rules/PROJECT.md` equals `rules/PROJECT.md` with the rendered frontmatter prepended; `.claude/skills/{foundry,release,techspec}/` byte-equal the kit's; `apps/foundry/.env` exists and carries the root; a second run prints `unchanged` for every path; `--check` exits 0; editing one landed file makes `--check` exit 1 naming it.
- `install --surface codex` on a clean `<home>`: `.codex/rules/PROJECT.md` byte-equal; the pointer block present once in `.codex/AGENTS.md` with the root rendered; an existing `AGENTS.md` keeps every byte outside the markers; a second run leaves the file byte-identical; a changed block is replaced in place.
- `--projects-root` given twice with different values: the second run rewrites the frontmatter, the pointer block and the `.env` line, and `--check` with the first value reports drift.
- A Claude Code session that reads a file under `<projects-root>/` shows `PROJECT.md` loaded (`/context`); a session that reads a file elsewhere shows it absent.
- Operator proof (milestone verification): a founding from a clean account pair on the README alone reaches the charter conversation; the consumer project re-points its own deployments to the tag.
