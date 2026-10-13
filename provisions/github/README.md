# GitHub Provisioning

Provisioning artifacts for a project's GitHub surface, per `docs/policy/PROJECT.md §Branching` (hybrid enforcement: the git layer guards the standing branches, the task layer guards intent).

## Rulesets

`rulesets/protect-main.json` and `rulesets/protect-dev.json` are the payloads for `POST /repos/{owner}/{repo}/rulesets` — the recreate source for a project's standing-branch protection and the base for Foundry's scaffold.

- **protect-main** — `enforcement: active`: deletion + non-fast-forward blocked, PR required (1 approval), required status check `CI`, merge method `merge` only. Strict up-to-date is **off** by design: the up-to-date rule is structurally unsatisfiable for `dev → main` under by-record `main → dev` sync — after any hotfix `dev` is permanently "behind" `main` and GitHub demands the very update-branch merge the branching policy forbids (`PROJECT.md §Branching`, merge-serialization invariant). CI on the merge result remains the publication gate.
- **protect-dev** — `enforcement: active`: PR required (0 approvals) + `CI` status check (strict) + merge-only + deletion/non-fast-forward blocked. Direct pushes to `dev` are over — the conducted flow (feature/fix PRs through CI) is the only flow. `protect-dev` keeps strict: it is the git-layer merge-serialization enforcement for working-branch lanes. (The update verb for an existing ruleset is **PUT**, not PATCH.)
- **no-delete-standing-branches** — a third ruleset applied by hand, no payload kept here: the single `deletion` rule over `refs/heads/dev` + `refs/heads/main`, **no bypass actors** — the standing branches are undeletable by anyone, GitHub's post-merge "delete branch" button included. Independent of the protect-* rulesets so `dev` stays guarded even while `protect-dev` is disabled for maintenance.

## Repo settings

Merge commits only (`allow_squash_merge=false`, `allow_rebase_merge=false`), `allow_auto_merge=true`, `delete_branch_on_merge=false`.

Head-branch auto-delete on merge is **off**: branch lifetime aligns with **Task lifetime**, not merge time — the two-gate model reviews an Integration *after* its merge (`Done+Gated`), so a `Revise` can send work back to the branch in the merge-to-acceptance window, and the branch's Development link to its Task hard-deletes with the ref. Deleting working branches is the **Release sweep**: on the milestone's Release Stage Task reaching terminal state, Sarge deletes every working branch fully merged into `dev` and surfaces any unmerged one — lanes stand inspectable through the whole milestone (`PROJECT.md §Branching`, `specs/apps/wakery/spec_wakery-conduction-chaining.md`). The Principal deletes Inception's lane at Inception close.

## Admin token

Admin acts (settings PATCH, ruleset POST/PUT) run under the Principal's project token: keystore `github/owner.token`, one token per project under the Principal's account. Agents hold Write via their own tokens and cannot perform these acts.
