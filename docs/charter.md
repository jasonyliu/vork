# Vork — Project Charter

## Mission

Publish how one engineer builds software with AI: the kit in daily use, and the multi-agent framework that came before it.

- **Title:** Vork
- **Key:** `vork`
- **Description:** Vork is a project kit for building software with an AI agent: one project shape, one lifecycle, and the tools that found projects, write specs and close milestones. Its first release preserves the multi-agent conduction framework it grew out of, with what works, what was never built and what broke stated plainly.
- **Scope:** The project convention (PROJECT), Foundry, the release and techspec skills, and the conduction framework as a tagged historical release.

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

## Products

| Product | Description | Source |
|---|---|---|
| Conduction framework, release 1 | The retired multi-agent framework as a reading release: policy, conventions, specs, the four services, provisions | tag `v2026.10.13`; `docs/releases/release_v2026.10.13/` |

## Milestones

| Key | Description | Status | Date | Release | Path |
|---|---|---|---|---|---|
| `milestone_v2026.10.10_conduction-framework` | Conduction framework — the first release: the retired multi-agent framework published whole, reviewed file by file in eleven batches, renamed to Vork, with the README's three lists and a release note written for an AI agent | Completed | 2026-10-10 → 2026-10-13 | `v2026.10.13` | `docs/milestones/milestone_v2026.10.10_conduction-framework/` |

## Provision

- Provisions follow project creation — recorded as the project takes shape.
