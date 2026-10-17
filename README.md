# Vork

Vork is a project kit for building software with an AI agent: one project shape, one lifecycle, and the tools that found projects, write specs and close milestones. It is the kit one engineer uses on every project, published so that anyone with two GitHub accounts, Node and a harness can clone it, install it, and found a project the same way.

Looking for the full conduction framework, the autonomous multi-agent crew this kit grew out of? That is release 1, tag [`v2026.10.13`](https://github.com/jasonyliu/vork/tree/v2026.10.13): the policy corpus, the specs, the four services and a note for an AI agent, published whole as a reading release with its own README.

The kit is four things:

| Piece | What it is | Where |
|---|---|---|
| The convention | `PROJECT.md`: how a project is stored, structured, recorded, branched, and moved through its lifecycle. The one document every session works by. | `rules/PROJECT.md` |
| Foundry | The start acts: `bootstrap` founds a project on GitHub and on disk; `kickoff` opens a milestone; `verify` checks a tree against the shape; `list` shows what this machine founded. | `apps/foundry/` |
| The skills | `foundry` (how to drive the start acts), `release` (how to close a milestone), `techspec` (how to write technical specs). | `skills/` |
| The templates | The eleven record templates every project carries: charter, backlog, milestone, decomposition, research, release, integration, review, deployment, workflow, and their index. | `docs/conventions/templates/` |

Two harnesses are supported as deployment surfaces: Claude (Claude Code and Claude Desktop share one install path) and Codex (Codex CLI and Codex Desktop). One installer lands the kit on either.

## Before it runs

Everything below is yours to supply, in the order you need it.

**Two GitHub accounts.** Your own, the owner: it owns every repository and approves every pull request. And a second one, the Vork account: every agent session commits and pushes as it. The separation is the review gate, since an account cannot approve its own pull request, and a layer of protection besides: an agent acting as the Vork account can do no more than that account was granted, whatever it gets wrong. One token per account, each saved to a file with mode `0600`; the owner token needs the `repo` scope (classic) or repository administration, contents, issues and pull requests (fine-grained), the Vork token `repo`. Add `read:user` to the owner token if you want Foundry to check your plan before it creates anything.

**A plan that matches your repositories.** GitHub Free applies branch protection to public repositories alone. On Free, found public repositories, or private ones with `"ruleset": "none"` in the bundle, in which case the review gate holds by convention and nothing enforces it. A paid plan takes any combination.

**Node 22 or later, `git`, and one harness.** Claude Code or Claude Desktop, or Codex.

## Install

```sh
git clone https://github.com/jasonyliu/vork.git
cd vork
git checkout v2026.10.18        # the release tag you are installing
provisions/install --surface claude \
  --owner-token ~/.vork/github/owner.token \
  --vork-token  ~/.vork/github/vork.token \
  --name  "Your Agent" --email "agent@example.com" \
  --projects-root ~/Vork/projects
```

`--surface codex` for Codex; run the installer once per surface. The first run on a machine needs the four identity flags and writes `apps/foundry/.env` from them; every later run takes none. `--projects-root` is where founded projects live, `~/Vork/projects` unless you say otherwise. `--name` and `--email` are the commit identity every founded clone carries, the Vork account's.

What the installer does: creates the projects root, writes `apps/foundry/.env`, installs Foundry's dependencies, lands `rules/PROJECT.md` and the three skills on the surface, and for Codex writes a pointer block into `~/.codex/AGENTS.md`. It compares before every write, deletes nothing, and `provisions/install --surface <s> --check` reports drift without writing. The two manuals under `docs/deployments/` say the same in the convention's own form.

Upgrading is `git checkout <newer tag>` and the installer again. Rolling back is the previous tag and the installer again.

## Found a project

Write a bundle:

```json
{
  "project_name": "Sample Project",
  "project_key": "sample",
  "mission": "One paragraph on why the project exists.",
  "description": "The goal it exists to achieve.",
  "scope": "The current boundary of the work.",
  "visibility": "private",
  "ruleset": "standard"
}
```

`project_key` names the repository and the folder; `visibility` and `ruleset` default to `private` and `standard`. Then, from the clone:

```sh
apps/foundry/bin/foundry bootstrap --bundle sample.json --dry-run
apps/foundry/bin/foundry bootstrap --bundle sample.json
apps/foundry/bin/foundry list
```

The dry run authenticates both tokens, checks names and paths, and renders the skeleton to scratch with zero mutation. The act creates the repository with `main` and `dev`, the `defect` label beside GitHub's defaults, the two rulesets, the Vork account's grant, the clone at `<projects-root>/sample/main/` with the charter, the backlog and the templates, and an entry in `apps/foundry/var/projects.json`. A run that fails is re-run: everything that exists is skipped, and the event log under `apps/foundry/var/runs/` says what happened. `ln -s "$PWD/apps/foundry/bin/foundry" ~/.local/bin/foundry` gives the command a stable path.

Then open your harness in the project and write the charter together. The convention loads into every Claude session on its own; a Codex session reads it when it touches the project, as the pointer block says. A milestone opens with `foundry kickoff --project sample --milestone <slug>`, which pushes the templated record on its draft lane; the `foundry` and `release` skills carry the rest.

## Works

- Foundry's suite: 75 tests, typecheck clean; `verify` passes on this repository, which follows its own convention.
- The installer's tests: 26 assertions over a scratch clone and a scratch home, `provisions/install.test.sh`.
- The convention, the skills and the templates are the ones in daily use by the author, with the author's own machines and accounts taken out.

## Limits

- Foundry founds repositories under a personal account. Organizations are untested.
- GitHub Free: branch protection on private repositories is refused by the plan; Foundry says so before it creates anything when the owner token carries `read:user`, and at the ruleset step otherwise, with the two ways out.
- The installer is Bash and expects a POSIX machine; it is exercised on macOS.
- One surface each for Claude and Codex. Other harnesses are one surfaces table row, one manual and one installer branch away; the author's own third harness is on the backlog.

## History

Release 1, tag `v2026.10.13`, is the multi-agent conduction framework this kit grew out of: an autonomous development crew built and run from February to August 2026, then retired, published whole as a reading release with its policy corpus, its specs, its four services and a note for an AI agent on what it assumed and what broke. The kit replaced it. The framework stays readable at its tag, and its README is the account of it.

Releases are tagged `v<YYYY.MM.DD>`. This repository follows the convention it ships: `docs/charter.md` is the map, `docs/backlog.md` the standing list, `docs/milestones/` the record of each release.

## License

MIT. See `LICENSE` and `CONTRIBUTING.md`.
