# Release v2026.10.24

- **Tag:** `v2026.10.24`
- **Milestone:** none; a convention change on `v2026.10.23`, landed from the backlog (#36)
- **Review:** the Principal's read and approval of #36, 2026-10-24

## Features

- `rules/PROJECT.md §Identity`: every actor signs its commits as itself, in every repository it commits to, with a name and email the Principal assigns per harness and per agent, set in each checkout; the Vork account stays the one agents push as, and Foundry's bound commit identity is a founded clone's starting identity, which the actor working it sets its own over.
- `rules/PROJECT.md §Storage`, the vault: every reader holds its own checkout; a stand-alone app — one that runs on its own schedule with no operator — keeps its own at `vault/apps/<app>/`; a tool an agent launches takes the vault path as a required flag. Foundry's specs, the kit spec and `.env.example` follow; Foundry's code is unchanged.

## Fixes

- None.
