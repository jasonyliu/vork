# {Project Title} — Project Charter

## Mission

- **Title:** {human-readable Project name}
- **Key:** `{compact_snake_case_key}`
- **Description:** {the goal the Project exists to achieve}
- **Scope:** {the current boundary of work the Project includes}

## Channel

| Channel | Purpose |
|---|---|
| `{session key / board / group id}` | {the component or context it isolates} |

## Team

| Member | Role | Responsibilities |
|---|---|---|
| {name} | {role} | {owned responsibilities} |

<!-- List any missing durable agents that must be created before work proceeds. -->

## Path

<!-- Refreshed at every Release (PROJECT.md §Releases, Pointers). -->

```text
<project-storage-path>/<project-name>/
├── main/                # canonical project repo (clone of <remote>)
├── products/            # local-only outcome surface: deployments/, jobs/
└── team/                # local-only per-actor clones
```

## Products

<!-- Key products this Project has released. Refreshed at every Release (PROJECT.md §Releases, Pointers). -->

| Product | Description | Source |
|---|---|---|
| {name} | {what it is} | {source path or deployment} |

## Milestones

<!-- The active milestone stays at the top. Status: Active | Completed, matching milestone.md's Status field. Refreshed at every Release (PROJECT.md §Releases, Pointers). -->

| Key | Description | Status | Date | Release | Path |
|---|---|---|---|---|---|
| `milestone_v<YYYY.MM.DD>_<slug>` | {one-line description} | Active | {started YYYY-MM-DD} | — | `docs/milestones/{folder}/` |
| `milestone_v<YYYY.MM.DD>_<slug>` | {one-line description} | Completed | {completed YYYY-MM-DD} | `v<YYYY.MM.DD>` | `docs/milestones/{folder}/` |

## Provision

<!-- Compact self-explanatory statements of what must be available for agents to work on the current Project state: tools, services, environments, repos, datasets. Point to main/provisions/ for detailed setup materials. -->

- {provision statement}
