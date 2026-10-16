# Vork — Project Charter

## Mission

Publish the kit one engineer uses to build software with an AI agent, in the shape anyone can install and found a project with.

- **Title:** Vork
- **Key:** `vork`
- **Description:** Vork is a project kit for building software with an AI agent: one project shape, one lifecycle, and the tools that found projects, write specs and close milestones. The convention, Foundry, three skills and the record templates, deployed to a harness by one installer. Its first release preserved the multi-agent conduction framework it grew out of; the kit replaced it.
- **Scope:** The convention (`rules/PROJECT.md`), Foundry, the foundry, release and techspec skills, the eleven record templates, the installer and its deployment surfaces (Claude, Codex). The conduction framework stays at its tag as history.

## Team

| Member | Role | Responsibilities |
|---|---|---|
| jasonyliu | Principal | Mission framing, preview and review, scope boundary |

## Path

```text
<project-storage-path>/vork/
├── main/                # the working clone
├── products/            # local-only outcome surface
└── team/                # per-agent clones, where concurrency arises
```

Inside `main/`, beside the convention's own records: `rules/PROJECT.md`, `skills/`, `apps/foundry/`, `provisions/install` with `provisions/codex/`, `docs/conventions/templates/`, `docs/deployments/deploy_claude/` and `deploy_codex/`, `specs/`.

## Products

| Product | Description | Source |
|---|---|---|
| The kit, release 2 | The convention, Foundry standalone, the three skills, the eleven templates, the installer for Claude and Codex | tag `v2026.10.16`; `docs/releases/release_v2026.10.16/` |
| Conduction framework, release 1 | The retired multi-agent framework as a reading release: policy, conventions, specs, the four services, provisions | tag `v2026.10.13`; `docs/releases/release_v2026.10.13/` |

## Milestones

| Key | Description | Status | Date | Release | Path |
|---|---|---|---|---|---|
| `milestone_v2026.10.14_standalone-kit` | Standalone kit — release 2: Foundry, the convention, the three skills and the templates became Vork's own, untangled from the estate, deployed to Claude and Codex by one installer; the framework tree left `main` and stays at `v2026.10.13` | Completed | 2026-10-14 → 2026-10-16 | `v2026.10.16` | `docs/milestones/milestone_v2026.10.14_standalone-kit/` |
| `milestone_v2026.10.10_conduction-framework` | Conduction framework — the first release: the retired multi-agent framework published whole, reviewed file by file in eleven batches, renamed to Vork, with the README's three lists and a release note written for an AI agent | Completed | 2026-10-10 → 2026-10-13 | `v2026.10.13` | `docs/milestones/milestone_v2026.10.10_conduction-framework/` |

## Provision

- Two GitHub accounts with one token file each: the owner's and the Vork account's (`rules/PROJECT.md §Identity`).
- Node 22 or later and `git` on the machine; one harness, Claude or Codex.
- The clone at a release tag is the run surface; `provisions/install --surface <surface>` deploys the kit to the harness and writes `apps/foundry/.env` (`docs/deployments/`).
