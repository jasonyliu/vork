# Release v2026.10.18

- **Tag:** `v2026.10.18`
- **Milestone:** none; a hotfix on `v2026.10.16.r2` (`rules/PROJECT.md §Lifecycle`, Hotfix)
- **Review:** issue #28, surfaced at the first consumer install on a second machine, 2026-10-17

## Features

- None.

## Fixes

- `apps/foundry/package-lock.json` listed one optional esbuild platform package, the one installed on the machine that regenerated it, and npm 11 refuses `npm ci` against a lock that omits the others. The lockfile is regenerated from a clean tree and carries every optional platform package; `npm ci` verified under npm 10.9.8 and npm 11.21.1. Consumers re-pin the Vork clone to this tag and run `npm ci`, or the installer, once.
