# Fix: Foundry lockfile with every optional esbuild platform (`fix_v2026.10.17_foundry-lockfile`)

**Status:** `Completed (2026-10-18)` — released as `v2026.10.18` (`docs/releases/release_v2026.10.18/`)

**Base:** `main` — released on its own

Recorded on 2026-11-11 from the release record and its pull requests; the fix predates `docs/fixes/`.

## Problem

`apps/foundry/package-lock.json` listed one optional esbuild platform package, the one installed on the machine that regenerated it, and npm 11 refuses `npm ci` against a lock that omits the others. It surfaced at the first consumer install on a second machine, issue #28, 2026-10-17.

## Change

- `apps/foundry/package-lock.json` regenerated from a clean tree, carrying every optional platform package; the README's install tag moved to `v2026.10.18`; the release record — lane `hotfix/foundry-lockfile-esbuild` off `main`, #29.

## Verification

`npm ci` from a clean tree under npm 10.9.8 and npm 11.21.1.

## Sync

Clean: `fix/main-sync/foundry-lockfile-esbuild` merged `main` into `dev` with no conflict, #30, 2026-10-17.
