# Fix: Identity per actor; the vault's readers and apps (`fix_v2026.10.24_identity-per-actor`)

**Status:** `Completed (2026-10-24)` — released as `v2026.10.24` (`docs/releases/release_v2026.10.24/`)

**Base:** `dev` — landed on `dev` and released at once by its own publishing merge, #38, before fixes had a defined path

Recorded on 2026-11-11 from the release record and its pull requests; the fix predates `docs/fixes/`.

## Problem

Every agent's commits carried the Vork account's one identity, so a commit could not say which actor made it; and the vault left its readers, and apps that run on their own schedule, without a defined checkout. Landed from the backlog on the Principal's call, 2026-10-24.

## Change

- `rules/PROJECT.md §Identity`: every actor signs its commits as itself, in every repository it commits to, with a name and email the Principal assigns per harness and per agent; Foundry's bound identity is a founded clone's starting one. `rules/PROJECT.md §Storage`: every reader holds its own vault checkout, a stand-alone app keeps its own at `vault/apps/<app>/`, and a tool an agent launches takes the vault path as a required flag. Foundry's specs, `spec_kit.md` and `.env.example` follow; Foundry's code is unchanged — lane `fix/backlog/identity-per-actor` off `dev`, #36; the release record, #37.

## Verification

The Principal's read and approval of #36, 2026-10-24.

## Sync

`none` — it came through `dev`.
