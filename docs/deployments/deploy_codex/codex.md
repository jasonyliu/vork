# Deployment Manual: codex — Vork

## Environment

A machine where the operator drives Codex. Codex reads `~/.codex/AGENTS.md` at every session and discovers `~/.codex/skills/<name>/SKILL.md`; it reads `~/.codex/rules/` for its own `.rules` execution policies, so a markdown file placed there reaches a session only when the session is told to read it by path. The consumers are every Codex session on the machine. The source is the operator's Vork clone checked out at a release tag; Foundry runs from that clone, and this deployment lands the convention, the skills and the pointer that makes Codex read the convention.

## When

After the first clone of Vork on the machine, once; after every `git checkout v<YYYY.MM.DD>` of a newer release in that clone, again. On a machine already deployed for Claude, the first Codex deployment needs no flags.

## Mechanism

1. In the Vork clone, `git describe --tags --exact-match` prints the release being deployed.
2. First deployment on the machine, with the Foundry environment still to be written:

   ```
   provisions/install --surface codex --owner-token <path> --vork-token <path> --name "<name>" --email "<email>" [--projects-root <path>]
   ```

   Every later deployment, and the first on a machine already deployed for another surface: `provisions/install --surface codex`.
3. The installer creates the projects root, writes `apps/foundry/.env`, installs Foundry's dependencies when absent, lands `rules/PROJECT.md` verbatim at `~/.codex/rules/PROJECT.md` and the three skills under `~/.codex/skills/`, and writes the pointer block into `~/.codex/AGENTS.md` between `<!-- vork:start … -->` and `<!-- vork:end -->`: the operator's own content outside the markers stays byte for byte; the file is created when absent. The block names the projects root and tells a session to read the rule when it touches a project there.
4. A Codex session already open keeps what it read; the next session reads the new block.

## Smoke

- `provisions/install --surface codex --check` prints `check: clean` and exits 0.
- `~/.codex/AGENTS.md` holds the block once, naming the projects root; a new Codex session asked what convention projects under the root follow answers from `~/.codex/rules/PROJECT.md`.

## Rollback

In the Vork clone, `git checkout <previous tag>` and `provisions/install --surface codex` again. The landed copy and the block are the whole state, so redeploying the previous release is the rollback; `.env` survives the checkout untouched.

## Record

None of its own. The block's stamp carries the commit, tag and date deployed; the installer's closing line says the same; the Vork release record names the tag.
