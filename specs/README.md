# Specs

This path stores execution-shaping specifications for Vork.

## Records

- `spec_git_integration_model.md`
  - Governing design blueprint for the git-integration model: two-standing-branch topology (`main`/`dev`), feature/hotfix conventions, the `type:project_integration` Stage Task, Heimdall's post-execution integration audit, dated milestone/release naming, and per-clone git identity.
- `data/`
  - The project data layer, one file per genre: `spec_database.md` (transactional — ERD + entities incl. the `project` registry, naming rules, constants ownership), `spec_config.md` (operational — env contracts, config files, template homes, keystore convention), `spec_event.md` (analytical — the event registry). App specs consume them by pointer.
- `apps/`
  - App and support-system specification notes: Wakery, Foundry, Resolver.
