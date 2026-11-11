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

{one line per act once run: the projects taken, their pull requests, the date; each project's own fix record names its own}
