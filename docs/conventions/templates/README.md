# Record Templates

Canonical templates for the project records defined in `rules/PROJECT.md §Records` and `§Structure`. Instantiate the template — do not restructure it; the sections are the record's contract. Placeholders use `{curly-braces}` (angle brackets appear only inside code spans); guidance lives in HTML comments and is deleted at instantiation.

| Template | Record | Canonical location |
|---|---|---|
| `charter.md` | Project Charter | `main/docs/charter.md` |
| `backlog.md` | Backlog | `main/docs/backlog.md` |
| `workflow.md` | Workflow definition | `main/docs/operations/work_<slug>/workflow.md` |
| `milestone.md` | Milestone record | `main/docs/milestones/milestone_v<YYYY.MM.DD>_<slug>/milestone.md` |
| `decomposition.md` | Decomposition record | `<milestone-folder>/decomposition.md` |
| `research.md` | Research record | `main/docs/research/research_<YYYYMMDD>_<slug>/research.md` |
| `release.md` | Release notes | `main/docs/releases/release_v<YYYY.MM.DD>/release.md` |
| `integration.md` | Integration record | `<milestone-folder>/integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md` |
| `review.md` | Review record | `<milestone-folder>/review_<YYYY.MM.DD.HH.mm.SS>.md` |
| `deployment.md` | Deployment manual | `main/docs/deployments/deploy_<environment>/<environment>.md` |
