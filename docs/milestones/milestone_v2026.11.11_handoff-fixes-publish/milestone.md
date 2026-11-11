# Milestone: Handoff, fixes, and foundry publish (`milestone_v2026.11.11_handoff-fixes-publish`)

**Status:** `Completed (2026-11-11)` — released as `v2026.11.11` (`docs/releases/release_v2026.11.11/`)

## Scope

Three changes to the convention and its kit, released together:

- **Handoff** — one `handoff.md` per milestone and per fix: an entry per session, added at its wrap-up, newest on top, each complete on its own, its session id and transcript path the way back to a past session. The Principal calls the wrap-up; the entry joins the working lane, or the record's handoff lane off `dev` when none is open.
- **Fixes** — every change outside a milestone is a fix: an immediate bug fix, or a change too small to open a milestone, recorded in `docs/fixes/fix_v<YYYY.MM.DD>_<slug>/fix.md`. Released on its own, it rides `fix/<fix-folder>/<slug>` off `main` and syncs to `dev` on `fix/<fix-folder>/sync`; riding the next release, it rides the same lane name off `dev`. `foundry kickoff --fix <slug> --base <main|dev>` opens one. The hotfix leaves the convention, folded into the fix.
- **Publish** — `foundry publish` tags a release's publishing merge and creates its GitHub Release from `release.md`; the release skill calls it, and states the by-hand form where Foundry is absent.

After the release, every existing project that follows the convention takes the change once, as a fix riding its next release: the new and changed templates copied into its `docs/conventions/templates/`, and the hotfix retired from its standing files (CI branch patterns, deployment manuals) — its records stand as written. `rules/PROJECT.md` reaches every surface by the standing deployment, as at every release.

Excluded: automatic wrap-up at a context threshold (dropped by the Principal's ruling, 2026-11-11; `docs/research/research_20261111_handoff-fixes-publish/`).

## Deliverables

1. `rules/PROJECT.md`: §Lifecycle Fix, §Structure `fixes/`, §Records Fixes and Handoff, the Releases record closing a milestone or a fix and carrying a GitHub Release, §Branches fix lanes, §Startup reading the newest handoff; no mention of the hotfix.
2. Templates in `docs/conventions/templates/`: `handoff.md` and `fix.md` added; `release.md` with a titled heading and a Record line; the index listing both.
3. `skills/release/SKILL.md`: a milestone's close and a fix's, both ending with Publish and Deploy.
4. `foundry publish` per `specs/spec_foundry.md §Publish`, with tests.
5. Fix records for the three releases that closed no milestone: `v2026.10.18`, `v2026.10.23`, `v2026.10.24`.
6. GitHub Releases for `v2026.10.23` and `v2026.10.24`, made by `foundry publish --version` on the Principal's word.
7. README and `spec_kit.md` describing the kit as it ships: thirteen templates, `docs/fixes/`, Foundry's `publish`.
8. The one-off adoption in every existing project that follows the convention, one fix off `dev` in each, its acts recorded in this milestone's `cutover.md`.
9. `foundry kickoff --fix <slug> --base <main|dev>` per `specs/spec_foundry.md §Kickoff`, with tests; the foundry skill drives it.

## Verification

- `git grep -i hotfix` outside `docs/releases/`, `docs/fixes/`, `docs/milestones/` and `docs/research/`, whose records stand as written, finds nothing.
- `foundry verify --against <vork clone>` exits 0, the thirteen templates in place.
- Foundry's test suite green, every check in `specs/spec_foundry.md §Publish — Verification` and the Kickoff checks of `spec_foundry.md` and `spec_foundry-interface.md` among it.
- `foundry publish --project vork --dry-run` against this repository prints the plan for the newest release and refuses nothing.
- At this milestone's release, `foundry publish` makes its tag and its GitHub Release, Latest; `gh release list` shows Releases for `v2026.10.23` and `v2026.10.24`.
- After the adoption, `foundry verify --against <project>/main` exits 0 for every existing project.
- The pre-push checks: `gitleaks` clean; the retired-term search clean.

## Research

- `docs/research/research_20261111_handoff-fixes-publish/research.md` — GitHub Releases and what blocks Foundry from them; the handoff and the context meter; the three releases outside any milestone.

## Specs

- `specs/spec_foundry.md`, `specs/spec_foundry-interface.md`, `specs/spec_foundry-data.md` — `foundry publish`.
- `specs/spec_kit.md` — the kit's layout and pieces.

### Trail

| Spec | Change | Note |
|---|---|---|
| `spec_foundry.md` | edited | §Publish: resolve, tag, Release, verification; the opening names `publish`; §Kickoff opens a milestone or a fix |
| `spec_foundry-interface.md` | edited | `publish` in the CLI, exit code 6, the Vork token's acts; `kickoff --fix --base`; verification |
| `spec_foundry-data.md` | edited | `<version>` grammar and order; §Release artifacts; `docs/fixes/` among the folders made at first use; `kickoff` takes `fix.md` |
| `spec_kit.md` | edited | thirteen templates, `docs/fixes/`, Foundry carrying `publish` |
