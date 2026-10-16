# Release v2026.10.16 — notes for an AI agent

You are reading the Vork kit at a release that runs. This note tells you what the tree assumes exists around it, what every placeholder means, which inputs carry no default, and the order in which an operator brings it up. The README is the operator's view of the same facts; this note is yours.

## Prerequisites

| Need | Detail |
|---|---|
| GitHub | Two accounts: the owner's, which owns every repository and approves pull requests, and the Vork account, which every agent session commits and pushes as. One token per account, saved as a file. Owner token: `repo` (classic) or repository administration, contents, issues and pull requests (fine-grained); `read:user` lets Foundry read the plan before any mutation. Vork token: `repo`. |
| Plan | GitHub Free applies rulesets to public repositories alone: on Free a private repository takes `ruleset: none` in the bundle. A paid plan takes any combination. |
| Node | 22 or later; `git`. |
| Harness | Claude (Claude Code or Claude Desktop, one install path `~/.claude/`) or Codex (`~/.codex/`). |

## Legend

Angle-bracket placeholders in prose, example configuration and the skeleton; curly-brace placeholders in the record templates; double-brace variables in the files Foundry and the installer render. No placeholder stands in code.

| Placeholder | Where | Meaning |
|---|---|---|
| `<keystore>`, `<name>`, `<email>` | `apps/foundry/.env.example` | the directory of the two token files, and the Vork account's commit identity; the installer writes the real values |
| `<project-storage-path>` | the skeleton charter, `docs/charter.md` of every founded project | the storage root, the parent of every `<project_key>/` |
| `<storage-root>`, `<projects-root>` | the specs and the rule | the same root, as the specs and the installer name it |
| `<project_key>` | everywhere | a project's compact lowercase key: the repository name, the folder name, the registry key |
| `<vork>` | `specs/spec_kit.md` | the operator's Vork clone, the one the installer belongs to |
| `<surface>` | `specs/spec_kit.md`, `docs/deployments/` | `claude` or `codex` |
| `{{projects_root}}` | `provisions/codex/AGENTS.md` | the one variable a surface file may carry; the installer renders it |
| `{{project_name}}` … `{{repo_node_id}}` | `apps/foundry/assets/skeleton/` | Foundry's closed template-variable set (`specs/spec_foundry-data.md §Template variables`) |
| `{Project Title}`, `{YYYY-MM-DD}` … | `docs/conventions/templates/` | the record templates' own placeholders, filled when a record is instantiated |

Other angle-bracket tokens in the rule, the skills and the specs, such as `<slug>`, `<key>`, `<path>`, `<environment>` and `<milestone-folder>`, are notation for a value a record or command takes at use; they name no configuration.

## Inputs

Foundry's environment, `apps/foundry/.env` beside the app, written by `provisions/install`; every variable required, no built-in default:

| Variable | Value |
|---|---|
| `FOUNDRY_OWNER_TOKEN_PATH` | path of the owner account's token file |
| `FOUNDRY_VORK_TOKEN_PATH` | path of the Vork account's token file |
| `FOUNDRY_VORK_NAME`, `FOUNDRY_VORK_EMAIL` | the Vork account's commit identity, bound to every founded `main/` |
| `FOUNDRY_PROJECT_STORAGE_PATH` | the storage root; `~/Vork/projects` is the suggested default |
| `FOUNDRY_VAR` | optional; Foundry's runtime directory, default `apps/foundry/var/` |

The installer's first run on a machine takes them as flags: `--owner-token`, `--vork-token`, `--name`, `--email`, `--projects-root`. Later runs take none and change only the lines whose flags are given.

The bundle, one JSON file per founding: `project_name`, `project_key`, `mission`, `description`, `scope`, and optionally `visibility` (`private` default, `public`) and `ruleset` (`standard` default, `none`).

## Order

1. Two accounts, two tokens as files; Node, git, a harness.
2. `git clone`, `git checkout v2026.10.16`.
3. `provisions/install --surface <surface> --owner-token <path> --vork-token <path> --name <text> --email <text> [--projects-root <path>]`; again with the other `--surface` if the machine runs both harnesses.
4. A bundle; `apps/foundry/bin/foundry bootstrap --bundle <file> --dry-run`, then without `--dry-run`; `foundry list`.
5. A harness session in `<projects-root>/<project_key>/main/`: the charter conversation. On Claude the rule is loaded at launch; on Codex the pointer block in `~/.codex/AGENTS.md` tells the session to read it.
6. `foundry kickoff --project <project_key> --milestone <slug>` opens each milestone; the `foundry` and `release` skills carry the acts.

## Works

- Foundry: 79 tests and typecheck clean; `verify` passes on this repository, which follows its own convention; founded and kicked off a throwaway project end to end on 2026-10-16.
- The installer: 26 assertions in `provisions/install.test.sh` over a scratch clone and scratch home.
- A rule placed in `~/.claude/rules/` without frontmatter loads into every Claude Code session on the machine; a path-scoped rule matches paths relative to the session's project directory and never fires for files outside it, which is why the kit ships the rule plain.

## Limits

- Personal accounts only; organizations untested.
- With a free plan and no `read:user` on the owner token, a refused ruleset surfaces at the ruleset stage rather than at preflight; the message names the two ways out and a re-run resumes.
- Interactive bundle capture needs a terminal; a pipe exits 2.
- The installer is Bash, exercised on macOS.

## Records

This repository follows the convention it ships. `docs/charter.md` is the map; `docs/backlog.md` the standing list; `docs/milestones/milestone_v2026.10.14_standalone-kit/` holds the milestone, its decomposition and its review; `docs/research/research_20261014_estate-entanglement/` the research the specs followed from. Release 1, `v2026.10.13`, is the retired conduction framework the kit grew out of, published whole as a reading release with its own agent note at that tag.
