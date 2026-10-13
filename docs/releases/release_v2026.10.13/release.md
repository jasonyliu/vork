# Release v2026.10.13

- **Tag:** `v2026.10.13`
- **Milestone:** `milestone_v2026.10.10_conduction-framework`
- **Review:** `docs/milestones/milestone_v2026.10.10_conduction-framework/review_2026.10.13.14.11.41.md`

## Features

- The conduction framework, published whole and renamed to Vork: the six governing documents in `docs/policy/`, the conventions and record templates, the specs for the data layer, the git model and the four services, the services themselves (`@vork/data`, Wakery, Resolver, Foundry), the GitHub rulesets, the OpenClaw policy hook and the techspec skill. Every file reviewed and read in full; every tie to the original estate removed or made generic.
- The configuration stance: placeholders stand in prose and example configuration only; a value the original estate supplied by default is a required input in code. Seeded registry rows that were the original instance's accounts and mappings ship as empty environment inputs.
- A launchd plist template and the installer that renders it, in place of the originals.
- `README.md` with the reading-release statement, the list of what an operator supplies before the framework runs, and the three lists: works, unbuilt, broken, with the measured conduction cost. `LICENSE` (MIT) and `CONTRIBUTING.md`.
- `agent-notes.md` beside this record: the release note for an AI agent bringing the framework up.

## Fixes

- None. This release carries the framework as it was retired; what is broken at the tag is listed in the README and left as found.
