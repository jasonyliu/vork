---
name: TechSpec
description: Write technical specs for software the way an engineer communicates to engineers — three genres (Interface, Process, Data), identifier-first, densest correct notation. Use whenever technical design must be documented for humans or AI agents to build, integrate, or operate against — APIs, services, workers, pipelines, schemas, caches, UIs. Not for policy docs or non-technical writing.
---

# TechSpec

A technical spec is a decision record for implementers who can code. The reader is assumed to hold the mental blueprint of systems; the spec's job is to transfer design decisions at maximum density — a cache key over a paragraph, pseudo-code over prose, a table over a narrative. Anything an implementer could safely infer is noise.

## The model

Software is a predefined set of rules that ingress data, process it, and store or pass it on. Every technical spec is one of three genres:

| Genre | Answers | Examples |
|---|---|---|
| **Interface** | how the product is touched from outside | API endpoints, webhooks, CLI, message intakes, UIs |
| **Process** | how data transforms inside | request processing, workers, queue consumers, cron jobs, model computations |
| **Data** | what data exists and how it is structured | schemas, cache keys, queues, event catalogs, constants |

Read `references/genres/interface.md`, `process.md`, or `data.md` for the genre being written — usually more than one in a sitting: drafting a Process spawns Data entries and touches Interface contracts.

## Foundation — all genres

1. **Identifiers before prose.** Design the identifier system first: key grammars with literal separators, ID taxonomies, name-derivation chains (config field → cache key → table → path). Rules then speak in those identifiers, and shared literals become the cross-reference system — readers navigate by grep, not by link lists. When names derive mechanically, prose shrinks.
2. **One home per fact.** Every behavior, contract, and value is normatively stated in exactly one place across the whole doc system (milestone records and policy included); every other mention is a pointer. Each restatement is a future contradiction.
3. **Delta over clone.** A variant is its base plus differences: "same as X, except …", wildcard rows ("other fields follow banner"), shared blocks, variance absorbed into config (general value + per-case override). Never copy a sibling document and edit it — clones drift, and an agent will faithfully implement the drift.
4. **Terse notation.** Imperative verb-first bullets, one operation each; "for each X" loops; branches as condition bullets with else-fallthrough; non-obvious conditions as *condition → meaning → obligation* ("when X — meaning Y — do Z"). Formulas as inline expressions. Exact literals: keys, event IDs, thresholds, TTLs, status values.
5. **Tables for enumerables, bullets for procedure.** Fields, options, key inventories, event catalogs, constants → tables. Mechanism → bullets. Never DDL dumps or implementation code (one exception: integration-enablement samples in Interface docs).
6. **Failure in place.** An error is an event or exit code raised at the stage that detects it; skip guards, never-clobber rules, and retry-as-next-pass live inline in the step they protect. A systemic mechanism (circuit breaker, lag alarm) earns its own section; a generic failure section never exists.
7. **Rationale is one clause,** fused to the rule it justifies, present only where the rule would otherwise look arbitrary. Keep opening paragraphs short enough to stay true — maintenance accrues to bullets.
8. **Verification per unit.** Every mechanism, contract, and structure closes with a compact list of testable checks — happy path, each branch, each failure. Verification is part of the spec itself; it is what implementers build and test against.

## Workflow

1. **Anchor the why.** Point to the milestone record or problem statement. Write a compact PRD only when no upstream why exists anywhere — never re-narrate one that does.
2. **Design or extend the identifier system** (Data genre) before writing mechanisms.
3. **Model the flow; list the features.** A feature is typically one Process unit plus its Interface and Data deltas — task decomposition cuts along these units.
4. **Write per genre,** concerns in place, spawning Data/Interface entries the moment a process invents them.
5. **Cross-check:** every pointer resolves; no sibling contradicts another; diagrams use exactly the prose's identifiers.
6. **Deletion pass:** remove every sentence whose loss costs no implementation information. If the pass removed nothing, it wasn't run.

## Failure modes

- Ceremonial completion — sections filled because a template names them.
- Restatement drift; clone genealogies.
- Captured-traffic examples — examples are authored, shape-only, minimal; live data, production URLs, and secrets never appear in a spec.
- Review content stranded outside the body (comments, chat) — verdicts and corrections merge into the spec.
- Empty scaffolds shipped — a heading with no body is a decision not yet made; say so or delete it.
- "Smartly", "as needed", "appropriately" — not design. State the rule or delete the sentence.

## Outer shell

When a governing project mandates a fixed section shell, keep the shell and map: contracts and mechanisms under its requirements-like section, non-goals under constraints, per-unit checks under verification. A mandated section with nothing decision-carrying to say is one line.
