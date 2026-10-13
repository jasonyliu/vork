# Vork Design Conventions

This path stores Vork-specific design grammar: the named values and record shapes every project under the framework shares.

The purpose is consistency. When a system is designed repeatedly without a shared grammar, naming drifts, entity boundaries blur, and later diagnostics become expensive.

## Convention Set

- `constants.md`
  - Canonical named values: task-type and relation labels, risk labels, branch names, integration artifact names.

- `templates/`
  - Canonical record templates per `docs/policy/PROJECT.md §Records`: charter, milestone, decomposition, research, release, integration, review, deployment.

## Notes

These conventions are deliberately independent from the standalone TechSpec skill (`provisions/skills/techspec/`). TechSpec stays reusable outside Vork; these docs are Vork house doctrine.
