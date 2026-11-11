# Research: Handoff, fixes, and foundry publish

**Date:** 2026-11-11

## Purpose

The three questions behind `milestone_v2026.11.11_handoff-fixes-publish`: why the project's release tags carry no GitHub Release, and what stands in the way of Foundry creating one; how a milestone's work passes from one session to the next when it runs across many; where a release that closes no milestone keeps its record.

## Conclusion

- **GitHub Releases.** A git tag and a GitHub Release are separate objects: pushing a tag creates no Release, which is made on an existing tag by the web interface, `gh release create`, or the REST API. Vork's four Releases, `v2026.10.13` to `v2026.10.18`, were made by hand under the Vork account; `v2026.10.23` and `v2026.10.24` carry tags alone, because neither the convention nor the release skill names the act. Nothing blocks Foundry from it: the Vork account holds `push` on the repository, which covers tags and Releases; both rulesets target branches, so a tag push passes; Foundry already carries Octokit and reads a clone's origin. Settled in design: the target resolves from the release record on `origin/main`, never from main's tip alone, and the act converges on a re-run; the command is `publish`, since a rollout in the convention's vocabulary is Deployment's; the Release's name comes from the record's heading, which gains a title, as the existing tags' subjects already do (`v2026.10.24 — identity per actor; the vault's readers and apps`); Foundry runs only where a Vork clone is installed, so the release skill keeps the by-hand form beside it.
- **Handoff.** A session's working context ends with it, and its transcript stays on the machine that produced it; `decomposition.md`'s Current orients a fresh session to the milestone, and nothing records where the last session stopped. The handoff record holds that: a Brief rewritten at each wrap-up, and a Trail of one row per session whose session id and transcript path let a later session find a past one. Wrapping up automatically at a context threshold was examined and dropped by the Principal's ruling: the model receives no signal of its own context fill (Claude Code gives `context_window.used_percentage` to the status line alone, and no hook input carries usage), so it would take a hook per harness; the Principal calls the wrap-up instead. An entry rides a lane, so the next session finds the newest with `git log --all --source -1 --format=%S -- <record-folder>/handoff.md`, which names the branch holding it (checked on this repository, 2026-11-11).
- **Fixes.** Three of Vork's releases closed no milestone: `v2026.10.18`, the lockfile hotfix (#28), and `v2026.10.23` and `v2026.10.24`, convention changes landed from the backlog on `fix/backlog/*` lanes. Their records read "Milestone: none", and the convention gave the latter two neither a home nor a lane. Ruling 2026-11-11: both kinds are one, a fix — an immediate bug fix, or a change too small to open a milestone — recorded under `docs/fixes/`, riding `fix/<fix-folder>/<slug>` off `main`, synced to `dev` on `fix/<fix-folder>/sync`; a milestone's own fix lanes stay `fix/<milestone-folder>/<slug>` off `dev`, and the word "hotfix" leaves the convention.

## References

- `gh release list` and `gh api repos/<owner>/vork/rulesets`, 2026-10-24: four Releases, every one authored by the Vork account; rulesets `protect-main` and `protect-dev`, both `target: branch`; the Vork account's repository permissions, `push: true`.
- The tag subjects: `git tag -l --format='%(contents:subject)' v2026.10.18 v2026.10.23 v2026.10.24`.
- The release records without a milestone: `docs/releases/release_v2026.10.18/`, `release_v2026.10.23/`, `release_v2026.10.24/`.
- Claude Code documentation: the status line's input (`context_window.*`), https://code.claude.com/docs/en/statusline.md; hook inputs and `additionalContext`, https://code.claude.com/docs/en/hooks.md.
- Codex session rollouts record `token_count` events carrying `last_token_usage` and `model_context_window` (`~/.codex/sessions/`, observed 2026-11-11).
