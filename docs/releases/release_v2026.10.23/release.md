# Release v2026.10.23

- **Tag:** `v2026.10.23`
- **Milestone:** none; a convention change on `v2026.10.18`, landed from the backlog (#33)
- **Review:** the Principal's read of the change, 2026-10-23

## Features

- `rules/PROJECT.md §Storage` gains the vault: a project's locally managed resources — what it keeps off GitHub — live in one git repository per project, `<key>_vault`, on a git server the Principal runs or as a plain local repository, checked out per actor at `vault/<actor>/`; optional, like `team/`. Actors are named by harness, and by harness and agent where one harness runs several (`openclaw_main`); the same name serves `team/<actor>/` and `vault/<actor>/`. The charter template's Path gains the `vault/` row. Consumers re-pin the Vork clone to this tag and deploy the rule as their manual directs.

## Fixes

- None.
