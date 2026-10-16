# Deployment Manual: claude — Vork

## Environment

A machine where the operator drives Claude: Claude Code and Claude Desktop share one install path, `~/.claude/`, so they are one surface. The consumers are every Claude session on the machine, which reads `~/.claude/rules/*.md` at launch and discovers `~/.claude/skills/<name>/SKILL.md`. The source is the operator's Vork clone checked out at a release tag; Foundry runs from that clone, and this deployment lands the convention and the skills beside it.

## When

After the first clone of Vork on the machine, once; after every `git checkout v<YYYY.MM.DD>` of a newer release in that clone, again. The same command, both times.

## Mechanism

1. In the Vork clone, `git describe --tags --exact-match` prints the release being deployed.
2. First deployment on the machine, with the Foundry environment still to be written:

   ```
   provisions/install --surface claude --owner-token <path> --vork-token <path> --name "<name>" --email "<email>" [--projects-root <path>]
   ```

   Every later deployment: `provisions/install --surface claude`.
3. The installer creates the projects root, writes `apps/foundry/.env`, installs Foundry's dependencies when absent, and lands `rules/PROJECT.md` verbatim at `~/.claude/rules/PROJECT.md` and the three skills under `~/.claude/skills/`. It prints one verdict per path and ends with `installed claude from <clone> @ <sha> (<tag>) root <path>`.
4. A Claude Code session already open keeps the rule it loaded; the next session loads the new one.

## Smoke

- `provisions/install --surface claude --check` prints `check: clean` and exits 0.
- A new Claude Code session opened anywhere on the machine shows `PROJECT.md` among its loaded rules (`/context`), and `/skills` lists foundry, release and techspec.

## Rollback

In the Vork clone, `git checkout <previous tag>` and `provisions/install --surface claude` again. The landed copy is the whole state, so redeploying the previous release is the rollback; `.env` survives the checkout untouched.

## Record

None of its own. The installer's closing line carries the clone, commit and tag deployed; the Vork release record names the tag.
