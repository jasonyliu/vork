# Fix: The vault in the convention (`fix_v2026.10.23_vault-in-storage`)

**Status:** `Completed (2026-10-23)` — released as `v2026.10.23` (`docs/releases/release_v2026.10.23/`)

**Base:** `dev` — landed on `dev` and released at once by its own publishing merge, #35, before fixes had a defined path

Recorded on 2026-11-11 from the release record and its pull requests; the fix predates `docs/fixes/`.

## Problem

The convention named no home for a project's locally managed resources — personal data, working records, run output — the material a project keeps off GitHub, and no name for an actor's folder in a project's container. Landed from the backlog on the Principal's call, 2026-10-23.

## Change

- `rules/PROJECT.md §Storage`: the vault, one git repository per project, `<key>_vault`, checked out per actor at `vault/<actor>/`; actors named by harness, and by harness and agent where one harness runs several, for `team/` and `vault/` alike. The charter template's Path gains the `vault/` row — lane `fix/backlog/vault-in-storage` off `dev`, #33; the release record, #34.

## Verification

The Principal's read of the change, 2026-10-23.

## Sync

`none` — it came through `dev`.
