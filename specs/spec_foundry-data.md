# Foundry Data

The identifier system and artifact inventory for project bootstrap: everything `foundry bootstrap` names and produces, in one place. Mechanisms live in `spec_foundry.md`; invocation contracts in `spec_foundry-interface.md`.

Foundry's durable outputs are GitHub artifacts, a rendered file tree, one entry in the machine's project registry, and an append-only run event trail.

## Identifier system

- `project_key`: `[a-z][a-z0-9_]*`; names the repo, the local project folder `<storage-root>/<project_key>/`, and the registry entry. The scaffold commit's owner identity is `<owner_login>` with `<owner_login>@<project_key>.localhost`; the bound identity after it is the Vork account's from the environment.
- `project_name`: human title, rendered into the charter and the README.
- Branch names, milestone folder naming: owned by the project convention (`rules/PROJECT.md`); Foundry consumes them as defined.
- Foundry var: `apps/foundry/var/` under the Vork clone, gitignored; `FOUNDRY_VAR` relocates it. Run event log: `<foundry-var>/runs/<project_key>/run_<YYYYMMDDTHHMMSSZ>_<run_id first 8 hex>.jsonl`, unique by construction. Dry-run scratch: `<foundry-var>/dry-run/<project_key>_<YYYYMMDDTHHMMSSZ>/`. Registry: `<foundry-var>/projects.json`.
- `run_id`: UUID v4 per invocation, stamped on every run event.
- Template variables: `{{name}}`, closed set below; a template referencing any other name fails the startup lint with `TEMPLATE_UNKNOWN_VARIABLE`.

## Template variables

| Variable | Source | Notes |
|---|---|---|
| `project_name`, `project_key`, `mission`, `description`, `scope` | bundle | verbatim |
| `owner_login` | owner token identity | the authenticated login of `FOUNDRY_OWNER_TOKEN_PATH` |
| `utc_now` / `utc_now_compact` | run start | ISO-8601 / `YYYYMMDDTHHMMSSZ` |
| `run_id` | run | run events only |
| `repo_node_id` | derived, GitHub bootstrap | |

The charter's Provision section renders as a placeholder, provisions coming after the project exists; its Team section renders the Principal's row, the rest left to the charter conversation. Substitution is verbatim, no escaping; a required variable resolving empty aborts render before any file is written.

## Skeleton inventory

Every file rendered under `<storage-root>/<project_key>/main/`; READMEs are on demand (`rules/PROJECT.md §Structure`), so the skeleton ships one:

| Path | Mode | Source |
|---|---|---|
| `README.md` | render | `apps/foundry/assets/skeleton/README.md`: `project_name`, `description` |
| `docs/charter.md` | render | `apps/foundry/assets/skeleton/docs/charter.md`: the charter template instantiated, bundle fields filling the placeholders, guidance comments gone, Provision a placeholder |
| `docs/backlog.md` | render | `apps/foundry/assets/skeleton/docs/backlog.md`: the backlog template instantiated (Items / Skipped / Done) |
| `docs/conventions/templates/*.md` | verbatim | the kit's canonical record-template set, `docs/conventions/templates/` at the Vork clone's root, copied byte-verbatim |

The template set has one home, the Vork clone's own `docs/conventions/templates/`; Foundry reads it from there at run time (`<app dir>/../../docs/conventions/templates/`) and `kickoff` takes `milestone.md` from the same place. Adding a canonical template is one file drop; the inventory follows the directory. Other folders (`docs/milestones/`, `docs/releases/`, `docs/research/`, `docs/operations/`, `docs/deployments/`, `specs/`, `apps/`, `provisions/`) materialize at first use. `main/` and the empty `team/` are pipeline products on the machine; the repo carries the skeleton.

## GitHub artifacts

**Repository**: name `project_key`, visibility per the bundle (`private` by default); auto-init off (the scaffold is the first commit); issues on, projects, wiki and discussions off; merge method: merge commits alone (convention merges are `--no-ff`). Standing branches `main` (the scaffold commit, the repository's first) and `dev` (created at it). The repository's issues are the project's bugs, enhancements and defects queue (`rules/PROJECT.md §GitHub`).

**Labels**: GitHub's auto-generated defaults stand, whatever set GitHub ships at creation time (`bug` and `enhancement` among them); Foundry adds exactly one, `defect` (`#e99695`), completing the queue vocabulary beside those two. Inventory: `apps/foundry/assets/labels.json`.

**Rulesets**: committed payload shapes under `apps/foundry/assets/rulesets/`:

| Ruleset | Branch | Rules |
|---|---|---|
| `protect-main` | `refs/heads/main` | deletion blocked, force-push blocked, PR required with 1 approving review, merge method `merge` alone |
| `protect-dev` | `refs/heads/dev` | deletion blocked, force-push blocked, PR required with 0 reviews, merge method `merge` alone |

Both rulesets gain `required_status_checks` when the project's CI lands; until then pull requests merge on review alone, since a required check before any workflow exists would deadlock every PR. A free plan applies rulesets to public repositories alone (`spec_foundry-interface.md §Environment`, plan matrix).

**Collaborator grant**: the Vork account (`FOUNDRY_VORK_TOKEN_PATH`'s login): repo `push`, invited by the owner and accepted in-run with the Vork token. Two accounts total: the owner's, reserved for the Principal's acts, and the Vork account every session acts through.

## Registry

`<foundry-var>/projects.json`, the machine's inventory of projects founded from this clone, written whole and atomically at each bootstrap's close, read by `foundry list`, and the seed for anything built on it later:

```json
{
  "projects": {
    "<project_key>": {
      "name": "<project_name>",
      "owner": "<owner_login>",
      "repository": "https://github.com/<owner_login>/<project_key>",
      "visibility": "private | public",
      "ruleset": "standard | none",
      "owner_plan": "<plan.name from GET /user, or unknown>",
      "vork_login": "<the Vork account's login>",
      "vork_name": "<FOUNDRY_VORK_NAME>",
      "vork_email": "<FOUNDRY_VORK_EMAIL>",
      "path": "<storage-root>/<project_key>",
      "founded_at": "<ISO-8601, first run>",
      "updated_at": "<ISO-8601, this run>",
      "run_id": "<this run's UUID>"
    }
  }
}
```

Keys sort lexically; the file ends with a newline; an absent file is an empty registry. Idempotency key: `project_key`; an existing entry is refreshed in every field except `founded_at`.

## Run events

The audit trail of one bootstrap run, runtime output under Foundry's own var: the JSONL file at the identifier system's run-event path. Each line: `{ ts, run_id, event, ...payload }`. Events: `run_started` (sanitized input bundle) · `resource` (one per artifact act, streamed as it completes) · `run_failed` (message + exit code) · `run_finished`.

Resource payloads: `repo` (name, node_id, visibility, created_or_skipped, settings_applied) · `label` (name, created_or_updated_or_skipped) · `collaborator` (github_login, repo_invite_status, error?) · `ruleset` (name, enforcement, rules_applied, drift) · `clone` (name, path, probe_result, drift?) · `file` (path, created_or_skipped_or_drift) · `branch` (name, sha, created_or_skipped) · `registry` (path, created_or_updated).

Sanitization: a field whose name, split into segments on `_`, `-` and case boundaries, carries one of `token|password|passwd|secret|key|pat|bearer|auth|authorization|credential(s)` (case-insensitive) is written as `"***"`, matching whole segments rather than substrings: `path` stays in the clear, `project_key` always redacts (the run file name carries the key).

## Verification

- Startup lint: every `{{variable}}` in the render-mode skeleton files resolves against the variable table.
- A rendered tree contains exactly the skeleton inventory; `docs/conventions/templates/` byte-matches the kit's set; the charter and backlog follow their templates' section contracts.
- The label pass adds `defect` alone; rulesets match the committed shapes, the status-check rule reserved for CI's arrival; the repository's visibility matches the bundle.
- Registry: one entry per founded key after any number of re-runs; `founded_at` stable across re-runs, `updated_at` and `run_id` from the last; the file parses and its keys are sorted.
- Every secret-pattern field in every run event reads `"***"`.
- Two runs, same bundle → byte-identical local output modulo `utc_now`, `run_id`, derived node IDs.
