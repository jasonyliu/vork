# Genre: Interface

How the product is touched from outside — by other software (API, webhook, message intake, CLI) or by humans (UI). An interface doc outlives the build: once the mechanism ships, it is the reference its consumers integrate against, so it is optimized for the consumer, not the author.

## Programmatic interfaces

Shape, in order (sections present only when they carry decisions):

- **Invocation** — method/transport and the address roster per environment (test/regions). Endpoints only; credentials and secret values are never written — point to the keystore or the provisioning contact.
- **Validation** — the server's validation groups, front-loaded before the tables when consumers must satisfy them ("at least one of A, B must be present").
- **Parameter tables** — `field | type | required | description | notes`, organized by the data structure's own hierarchy (`request.device.did …`). `required` is a validation DSL, not a boolean: "at least one of", "required when <condition>". Response tables mirror with must-return semantics.
- **Constants** — enumerable value domains as `value | meaning` tables, or a pointer to their Data home when shared.
- **Examples** — authored, shape-only, minimal; included only when the tables cannot convey a shape (nesting, encodings). Never captured traffic, never live IDs or URLs.
- **Enablement samples** — runnable snippets (the one place code is allowed) when a consumer needs them to integrate (e.g. a signing or encryption sample).
- **Changelog** — a versioned field-diff table (`version | date | changes`, entries as "removed X / added Y") attached here only when external integrators need a handover artifact; otherwise change history belongs to the project's release records. Consumer convenience decides, not genre law.

**Facets.** A growing interface doc splits by facet — params, examples, constants — one file per facet, the main doc composing by pointer (never by pasted duplication).

**Internal overlay.** Fields the outside party must not see or send go in one additive overlay section/file repeating only the extra fields under the same dotted paths — never a diverged internal copy.

**Variants.** A sibling interface is a delta: "identical to X, except …" plus only the differing sections.

## Human interfaces (UI)

The wireframe lives in its design tool and is read by agents through the tool's API/MCP; the spec never re-hosts it. The doc carries:

- **Wireframe pointer** — the design-tool reference for the screens in scope.
- **Binding table** — every displayed element bound to a named data path or interface field; every input bound to the field it writes. Dropdowns and filters are defined as queries over named tables ("options: `category` where `status != deleted`").
- **Interaction rules** — verbatim user-facing copy is normative (toasts, confirms, error strings, with their consequences: "delete does not affect creatives already using this image"); cascade behavior; merge semantics per action (overwrite/append/edit); defaults (sort order, page size); async actions surfaced with latency estimates.
- **Population mechanics live in a Process doc,** referenced — how data gets to the surface is a mechanism, not an interface property.

The list-as-query shape is a data-binding *precision* discipline, not a design philosophy — the interaction design itself is a design task.

## Verification

Each contract closes with checks: request/response shapes round-trip against the tables; each validation group accepts/rejects as stated; examples parse; UI bindings resolve against the named data paths.
