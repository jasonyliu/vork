# Cutover — `milestone_v2026.11.11_handoff-fixes-publish`

The one-off acts that carry this release into every existing project that follows the convention, after the release and its standing deployments. Each project takes them as one fix riding its next release (`rules/PROJECT.md §Lifecycle`, Fix); the project's own fix record holds what its copy changed. The acts run from scratch clones — a temporary clone of each project's repository in the working session's scratch directory, outside the storage root, removed once its pull request merges — so no project's working clone changes branch.

## Acts

For each project:

1. Clone it into `<scratch>/<key>/main`, set the actor's identity there, and open the fix: `foundry kickoff --project <key> --project-storage-path <scratch> --fix vork-adoption --base dev --note "<the release> into this project: the new and changed record templates, the hotfix retired from standing files"`.
2. Copy into `docs/conventions/templates/`, from the Vork clone at the release tag: `handoff.md` and `fix.md`, new; `release.md` and `README.md`, changed.
3. Retire the hotfix from the project's standing files — CI tier selection by branch name, deployment manuals, the charter's Provision; records stand as written.
4. Fill `fix.md`: Change listing the files, Verification `foundry verify --against <scratch>/<key>/main` exiting 0, Sync `none`.
5. Pull request → `dev`; the Principal approves; merge; `fix.md` status `On dev`.

## Record

- 2026-11-11 — seven projects took the adoption, one fix off `dev` each, opened by `foundry kickoff --fix --base dev` from scratch clones and merged on the Principal's word; each project's own fix record names what it changed.
- Act 2 took the kit's whole template set rather than the four files this release changed: six projects held templates older than release 2, worded for the retired framework, and one lacked the charter's `vault/` row. `foundry verify` exits 0 for every project after the copy.
- Act 3 changed two projects: their CI runs the focused tier for a fix released on its own, and their production manuals and ruleset notes name the fix. One project also gained the root `README.md` it lacked, the Principal's call.
- The scratch clones were removed once the pull requests merged.
