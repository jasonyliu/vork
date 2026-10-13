---
name: vork-policy
description: "Inject Vork policy documents into bootstrap context for agents by id"
metadata:
  {
    "openclaw":
      {
        "emoji": "🧩",
        "events": ["agent:bootstrap"]
      },
  }
---

# Vork Policy Hook

Injects Vork policy documents into bootstrap context at agent bootstrap time.

## Purpose

Guarantee that agents working on a Vork project receive the policy documents intended for their role, without relying on ad-hoc tool reads or a single monolithic policy file.

## Config file

This hook is driven by `config.json` in the same folder.

```json
{
  "default": ["docs/policy/FRAMEWORK.md"],
  "excludeAgentIds": [],
  "agents": {
    "main": [
      "docs/policy/FRAMEWORK.md",
      "docs/policy/PROJECT.md",
      "docs/policy/TASK.md",
      "docs/policy/SECURITY.md",
      "docs/policy/DELIVERY.md"
    ],
    "heimdall": [
      "docs/policy/FRAMEWORK.md",
      "docs/policy/TASK.md",
      "docs/policy/SECURITY.md"
    ],
    "visor": [
      "docs/policy/FRAMEWORK.md",
      "docs/policy/PROJECT.md",
      "docs/policy/TASK.md",
      "docs/policy/SECURITY.md"
    ],
    "sarge": [
      "docs/policy/FRAMEWORK.md",
      "docs/policy/PROJECT.md",
      "docs/policy/TASK.md",
      "docs/policy/DELIVERY.md"
    ]
  }
}
```

## Resolution rules

- If `agents.<agentId>` exists, use that policy list.
- Otherwise use `default`.
- `excludeAgentIds` always wins.
- Policy paths are resolved relative to the policy root: `releaseRoot` from `config.json` when it is set and its `docs/policy/` exists (a release deployment, typically a `current` symlink a deploy advances), otherwise the clone root the hook sits in (`<key>/main/`).
- Missing files are skipped; the hook does not fail bootstrap.

## Injection target

The hook upserts a single policy block into the agent's bootstrap `AGENTS.md`, on **two surfaces**:

1. **In-memory `context.bootstrapFiles[AGENTS.md].content`** — feeds providers that consume openclaw's assembled system prompt directly (providers that take the assembled prompt).
2. **On-disk `<workspace>/AGENTS.md`** — feeds providers that read `AGENTS.md` from the workspace at spawn time (CLI providers that read the file from disk). Written atomically (`<file>.vork-policy.tmp` then `rename`).

Without the on-disk write, claude-cli sessions silently miss policy injection — the in-memory mutation never reaches Claude Code, which reads `AGENTS.md` from its workspace cwd.

## Block format

```md
<!-- vork-policy:start v=<short-sha> -->
<!-- vork-policy: do not edit content between markers — managed by vork-policy hook -->
## Vork Policy Context (injected)


### Policy source: `docs/policy/FRAMEWORK.md`

…contents as raw markdown…


### Policy source: `docs/policy/PROJECT.md`

…contents as raw markdown…

…
<!-- vork-policy:end -->
```

- The start marker carries `v=<short-sha>`, the short SHA of the most recent commit touching any of the agent's resolved policy files (`git log -1 --format=%h -- <files>`, evaluated from the policy root).
- A do-not-edit warning sits between the start marker and the block content. The hook owns everything between the start and end markers.
- The end marker is unversioned and stable.
- Policy contents are written as **raw markdown**, not wrapped in ` ```md ` code fences. Code-fenced wrapping makes models read the body as an illustrative snapshot rather than authoritative instructions; raw inclusion lets the policy land as live operating rules.

## Actions

On each bootstrap fire, the hook performs an `upsertBlock` against each surface and logs the result:

| Action | Condition |
|---|---|
| `noop` | Marker present and `v=` matches the current version → no change |
| `append` | No marker present → append the new block at end of file |
| `replace` | Marker present but `v=` differs from current version → swap the block in place |
| `create` | (memory-only) Bootstrap had no `AGENTS.md` entry → synthesize one |

The disk surface additionally reports `skip-no-target` when there is no real target file path to write to, or `error` when the read/write fails (the hook logs the error and continues — bootstrap is never failed).

Log line format:

```
[vork-policy] agent=<id> v=<sha> memory=<action> disk=<action> (<files…>)
```

Memory and disk actions can diverge — e.g. `memory=replace disk=noop` happens when a different session has already refreshed the disk surface, while this session's per-`sessionKey` bootstrap-files cache still holds the stale in-memory copy. Each surface is upserted independently.

## Version-bump semantics

The version stamp anchors the block to a specific commit of the policy files. Any commit that touches any of the agent's resolved policy files (`docs/policy/FRAMEWORK.md`, `PROJECT.md`, `TASK.md`, `SECURITY.md`, `DELIVERY.md`) produces a new short SHA, and the next bootstrap will refresh the block via `replace`. If `git log` fails or there are no resolved files, the version is recorded as `unknown` and the next bootstrap will not match — i.e. it re-injects on every fire rather than silently skipping.

## Safety

- The temp-file + `rename` pattern ensures the on-disk `AGENTS.md` is never observed in a partial state.
- Orphan start-markers (start without matching end) are treated as not-found, so the next upsert appends a clean block instead of corrupting the file further.
- `excludeAgentIds` agents are bypassed entirely.
- The disk write is skipped when the bootstrap target's `missing` flag is set or its `path` field is absent.

## Registration

Registered with OpenClaw via `~/.openclaw/openclaw.json`:

```jsonc
"hooks": {
  "vork-policy": { "enabled": true },
  // ...
},
"load": {
  "extraDirs": [
    "<project-storage-path>/vork/main/provisions/openclaw/hooks"
  ]
}
```

## Excluded agents

`excludeAgentIds` lists agents that receive no policy injection. Use it for agents sharing the OpenClaw installation that are not part of the project crew — an assistant serving an unrelated purpose should not carry the full policy set into its bootstrap. Excluded agents keep their own context documents under `docs/agents/<id>/`, which ride releases like any other agent docs. A narrower, purpose-scoped injection can be added per agent later; until then exclusion is total.

## Design notes

- **No code fences around injected policy.** Wrapping each policy file's content in a fenced block made models treat the policy as an illustrative snapshot rather than as authoritative instructions. Section headings carry the source path as provenance metadata — `### Policy source: \`docs/policy/FRAMEWORK.md\`` — rather than as a heading the agent might mistake for a section of its own context.
- **On-disk write alongside the in-memory mutation.** Mutating `context.bootstrapFiles` in memory alone silently fails for `claude-cli` sessions, which read `AGENTS.md` from the workspace at spawn time rather than from OpenClaw's assembled context. The hook does both, with a version-stamped marker (`v=<short-sha>`) and `upsert` semantics (`noop` / `append` / `replace`).
