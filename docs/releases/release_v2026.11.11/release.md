# Release v2026.11.11 — handoff, fixes, and foundry publish

- **Tag:** `v2026.11.11`
- **Record:** `milestone_v2026.11.11_handoff-fixes-publish`
- **Review:** the Principal's call of the milestone complete and deployable, 2026-11-11; pull requests #39, #40, #41, #42

## Features

- `rules/PROJECT.md`, the handoff: one `handoff.md` per milestone and per fix, an entry per session added at its wrap-up, newest on top, each complete on its own, its session id and transcript locator the way back to a past session. The entry joins the lane being worked on, or the record's handoff lane off `dev` when none is open; Startup reads the newest entry on whichever branch holds it.
- `rules/PROJECT.md`, fixes: every change outside a milestone is a fix, recorded in `docs/fixes/fix_v<YYYY.MM.DD>_<slug>/fix.md`. A fix released on its own rides `fix/<fix-folder>/<slug>` off `main`, is tagged, and syncs to `dev` on `fix/<fix-folder>/sync`; a fix riding the next release rides the same lane name off `dev` and completes at the next milestone's close-out. The hotfix folds into the fix. Templates are read as `dev` carries them, a lane off `main` included.
- `rules/PROJECT.md`, releases: a release closes a milestone or a fix released on its own, and its tag carries a GitHub Release — the record's heading, `Release ` dropped, names both, and the file below it is the notes.
- `foundry publish --project <key> [--version <version>] [--dry-run]`: tags a release's publishing merge and creates its GitHub Release from the release record on `origin/main`; a refusal exits 6 naming its cause, and a re-run converges.
- `foundry kickoff --project <key> --fix <slug> --base <main|dev>`: opens a fix record on `fix/<folder>/change` off the chosen base.
- Templates: `handoff.md` and `fix.md`, new; `release.md` with a titled heading and a Record line — thirteen in all. The release skill closes a milestone or a fix and publishes; the foundry skill opens a fix.
- Fix records for the three earlier releases outside a milestone: `v2026.10.18`, `v2026.10.23`, `v2026.10.24`.

## Fixes

- Tags `v2026.10.23` and `v2026.10.24` carried no GitHub Release; both are published with this release, by `foundry publish --version`.
- `foundry kickoff` reports a record already on `main` or on its pushed lane, where before it looked at `dev` alone and would re-create it.

Consumers re-pin the Vork clone to this tag and deploy the rule and skills as their manual directs. Each existing project then copies the new and changed templates into `docs/conventions/templates/` once, as a fix riding its next release; `foundry verify` names the drift until it does.
