# Record Templates

Canonical templates for the Project records defined in `docs/policy/PROJECT.md §Records` and `§Structure`. Instantiate the template — do not restructure it; the sections are the record's contract. Placeholders use `{curly-braces}` (angle brackets appear only inside code spans, matching policy notation); guidance lives in HTML comments and is deleted at instantiation.

| Template | Record | Canonical location |
|---|---|---|
| `charter.md` | Project Charter | `main/docs/charter.md` |
| `milestone.md` | Milestone record | `main/docs/milestones/milestone_v<YYYY.MM.DD>_<slug>/milestone.md` |
| `decomposition.md` | Decomposition record | `<milestone-folder>/decomposition.md` |
| `research.md` | Research record | `main/docs/research/research_<YYYYMMDD>_<slug>/research.md` |
| `release.md` | Release notes | `main/releases/release_v<YYYY.MM.DD>/release.md` |
| `integration.md` | Integration record | `<milestone-folder>/integration_<YYYY.MM.DD.HH.mm.SS>_<branch-slug>.md` |
| `review.md` | Review record | `<milestone-folder>/review_<YYYY.MM.DD.HH.mm.SS>.md` |
| `deployment.md` | Deployment manual | `main/docs/deployments/deploy_<environment>/<environment>.md` |

The agent turn-contract templates (wake message, transition comment) live with their implementation surfaces: `apps/wakery/templates/transition-comment.md` and `apps/wakery/templates/wake-message.json`.
