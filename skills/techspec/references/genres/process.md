# Genre: Process

How data transforms inside the system — one bounded mechanism per document: request processing behind an interface, a daemon worker, a queue consumer, a cron job, a model computation, a UI's population mechanics. Anything standalone enough to be called or integrated is a process.

## Shape

- **Definition opener** — 1–4 sentences: the duty, the trigger context, at most one why-clause. This is all the ceremony there is. Tiny mechanisms may put the steps directly beneath it with no further headers.
- **Flow diagram** — when branching or sequencing is hard to hold in prose (Mermaid; exactly the identifiers the prose uses). Not decoration: if the diagram and the bullets ever disagree, the spec is broken.
- **Stage sections** — one header per processing stage, **named for the mechanism itself** (parameter processing, identity normalization, template matching, budget control — never a generalized title set). Header order carries execution order; connectives ("after the above completes", "otherwise continue") carry the rest.

## Stage rules

- **Trigger first.** The first bullet states the trigger exactly: "consume queue `<name>`, filter events to id `<N>`" / a cron line ("hourly at :04, then every 5 minutes") / "on notification key `<key>`" / the endpoint.
- Bullets are the algorithm: read → compose key → decide → write/emit, one operation per bullet, each naming its exact reads and writes inline (keys, tables, queues, event IDs) — no separate reads/writes scaffolding.
- Loops as "for each X"; branches as condition bullets with else-fallthrough; a non-obvious condition states its meaning: "when X — meaning Y — do Z".
- Arithmetic inline: `granula_volume -= period_volume_change`; probabilistic behavior as an explicit draw ("compute a 0–100 random value; ≤ sample_rate → continue").
- **Failure at the point of detection:** raise the error event / exit code in the stage that detects it; skip guards ("absent → skip"), never-clobber ("existing value wins"), retry = the next pass. A systemic protection (circuit breaker, lag alarm, with exact thresholds and alert text) is its own stage section.

## Versioned mechanisms

When a mechanism evolves in deployable variants (models, algorithms, tuned strategies): each version is a bounded unit **selected by a config value** — the spec states "fills config slot `<field>`" and the live version is wherever the pointer points. A new version is a new unit plus a pointer move; old units freeze without deprecation edits. Sibling variants are deltas off the shared base ("same as X except …"), never clones — so tuning history reads as explicit deltas.

## Spawn rule

The moment a process invents a key, event, constant, or field, that identifier lands in its Data home (and the Interface contract, if exposed) — this document references it from there. A Process doc that hoards definitions becomes a hidden contract.

## Verification

Closes every mechanism: happy path, each branch, each failure path, each emitted event — as testable statements ("a duplicate start event while one is open updates the row, no second mint"), not restated behavior.
