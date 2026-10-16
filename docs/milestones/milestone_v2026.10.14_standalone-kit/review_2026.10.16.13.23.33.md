# Review: milestone_v2026.10.14_standalone-kit — 2026.10.16.13.23.33

## Summary

Complete. Every deliverable the milestone record names is in `dev`: the tree the kit spec drew, Foundry standalone, the installer with its two manuals, the three skills, the README with the kit as subject, and the framework tree gone from `main` for its tag. The throwaway founding ran end to end and the Principal called its structure good.

## Evaluation

Scope: Foundry, the convention, the foundry, release and techspec skills and the eleven templates are Vork's own, with every estate thread the research named untangled: the database registry out and a JSON registry in, the storage root a parameter, the two accounts named the owner's and the Vork account's with the commit identity an install-time input, the project board dropped for the repository's issues, the free plan covered by `visibility` and `ruleset` in the bundle and a preflight gate, the installer the deployment to two surfaces. The framework tree left `main` in step 4 and stays readable at `v2026.10.13`.

Deliverables: D1 landed as the rule, templates and skills (PR #19) with the Principal's review applied (PR #20) and the framework exit (PR #22). D2 is Foundry standalone (PR #18) with the findings of the throwaway founding fixed (PR #23): 79 tests, typecheck clean, `verify` passing on the Vork tree itself. D3 is `provisions/install`, `provisions/codex/AGENTS.md`, the two manuals and the installer's 26 assertions (PR #21). D4 is `skills/`. D5 is the README and CONTRIBUTING (PR #22) and the agent note on this release lane. D6 is this release.

Verification: on 2026-10-16 the agent, on the Principal's word and with the Principal's account pair, cloned `dev` into staging, installed both surfaces into a scratch home (`--check` clean), founded `test_vork` (private, standard) from the README alone, kicked off a milestone, re-ran the founding (every artifact skipped, registry updated), verified the founded tree (14 paths clean), listed the registry, exercised every usage and bundle error path and the interactive capture on a terminal, and inspected the GitHub side: settings, branches, both rulesets, the `defect` label, the Vork account's grant, the two commit identities, zero boards. The Principal inspected the founded project and the staging tree and called its structure good. Over the whole tree the retired-term search returns three accepted hits (the LICENSE copyright line, the charter's owner row, the clone URL in the README), the strict `.ts` placeholder check is clean, and the secret scanner is clean.

## Incomplete

none

## Deployment

Deployable. Vork's deployments are its two surface manuals, `docs/deployments/deploy_claude/` and `deploy_codex/`, and the act on any machine is `provisions/install --surface <s>` from the clone at the tag. On the Principal's machines the surfaces today carry the consumer project's copies of the rule and skills; replacing them with Vork's is the consumer project's re-pointing milestone, so this release deploys to no machine of the Principal's at its close. Publication is the `dev → main` merge, the tag `v2026.10.16`, and the repository turning public.

## Reference

- `docs/milestones/milestone_v2026.10.14_standalone-kit/milestone.md`, `decomposition.md`
- `docs/research/research_20261014_estate-entanglement/research.md`
- `specs/spec_kit.md`, `specs/spec_foundry.md`, `specs/spec_foundry-interface.md`, `specs/spec_foundry-data.md`
- Pull requests #17 to #23 into `dev`
- `docs/releases/release_v2026.10.16/release.md`, `agent-notes.md`
- The throwaway founding: repository `test_vork` under the Principal's account, the staging tree under `~/Vork/staging/vork-test/` on the build machine, both the Principal's to remove.
