# Resolver — Product Requirements

## Introduction

Resolver is the deterministic Risk-Code resolution utility Auditor invokes for every audit that reaches primitive extraction. It takes a normalized operation chain — a sequence of primitive operations, each one a `(Action, Subject, Zone)` triple per `SECURITY.md §Classification` — and a Project name, and returns the per-primitive-operation Risk Codes together with the aggregate Task Risk Code. v1 ships as a CLI app — JSON-in via stdin, JSON-out via stdout — with mapping data in the project database. The Resolver-emit Risk-Code set is `{R100, R200, R300, R999}`.

## Purpose

`SECURITY.md §Resolver` requires Auditor to obtain Risk Codes through Resolver rather than self-assign them. No Resolver existed during the earlier milestones (the platform migration, Wakery v2), so every audit reaching primitive extraction fell back to `R999 / Govern` ("no valid deterministic mapping path"); the operational symptom — every routine task gated for Principal intervention — is what the v2 retrospective named, and what this PRD's product exists to remove.

Resolver carries one authority boundary that holds across all releases and callers: **Resolver determines the Risk Code; Auditor determines the audit outcome.** The mapping table, the chain-aggregation rule, and the partial-overlay resolution rule live in Resolver; the transition from a Risk Code to `Approved` / `Govern` / `Revise` lives in Auditor per `SECURITY.md §Risk Codes`. Resolver is therefore neutral to who calls it — Heimdall is the v1 instance, but the design surface admits other auditor agents and non-audit callers without changes to the contract.

## Scope

### In scope

- A CLI utility (`resolver`) callable with `JSON-in via stdin / JSON-out via stdout`, deployed via a stable `~/.local/bin/resolver` symlink that re-points across releases.
- The `project_risk_mapping` data table in the project Postgres database, with wildcard rows (`project IS NULL`) and project-specific rows (`project = <key>`).
- Partial-overlay resolution: each primitive operation resolves against its project-specific row first, falling back to the wildcard row for the same cell; operations with no row in either partition resolve to `R999`.
- Aggregation across the chain via `max(risk_code)` under `R100 < R200 < R300 < R999`.
- Caller-neutral input / output surface. v1's first caller is Heimdall via the audit workflow; the surface is identical for any future caller.

### Out of scope

- Architecture, algorithm, error model, and CLI behavior in detail — `spec_resolver.md`.
- DB schema, JSON input/output envelopes, naming rules — `spec_resolver-contracts.md`.
- Audit-workflow integration mechanics (how Heimdall invokes Resolver and records its output) — `spec_resolver-audit-integration.md`.
- HTTP API surface — CLI-only for v1; the JSON-in / JSON-out shape keeps an HTTP wrapping path open for later.
- Weighted aggregation across the chain — `max` only for v1.
- Mapping data administration UI — v1 mappings are managed via direct DB writes.
- Foreign-key reference between `project_risk_mapping.project` and the `project` registry — owned by the data layer: `specs/data/spec_database.md §project`.
- The database name — the data layer's truth is `specs/data/spec_database.md`.

## Requirements

- **Risk-Code boundary.** Resolver returns one of `R100`, `R200`, `R300`, `R999`. `R0`, `R993`, `R994`, `R995`, `R996`, `R997`, `R998` remain Auditor-direct per `SECURITY.md §Risk Codes` and are emitted without consulting Resolver. `R994` (Resolver tooling failure) and `R998` (vocabulary mismatch in either direction at the Resolver boundary) are emitted by Auditor in response to Resolver-side failure modes — never by Resolver itself.
- **Chain input.** The caller submits a normalized operation chain (one or more primitive operations, each a `(Action, Subject, Zone)` triple with a 1-indexed `seq`) together with a Project name as the active resolution context.
- **Per-primitive-operation plus aggregate output.** Resolver returns a `risk_code` for each primitive operation in the chain (with the input's `seq` echoed) and a `task_risk_code` computed as `max` over the per-primitive-operation codes.
- **Partial-overlay rule.** A primitive operation matching a `project = <project>` row resolves to that row; a primitive without a project row resolves against the wildcard set (`project IS NULL`). A project overlay carries only its deltas — it never forces a mirror of the wildcard set.
- **Unmapped resolves to `R999`.** Any primitive operation with no row in either partition returns `R999`. The resulting `Govern` audits are the signal that the mapping set should next absorb the cell.
- **Caller-neutral.** Resolver does not inspect or branch on the caller identity; it does not record who invoked it. The audit-record side of the workflow records caller identity per `SECURITY.md §Risk Codes`; the Resolver-emit side records only the Risk Codes and the chain.
- **Deterministic.** Given the same chain, Project, and current mapping data, Resolver returns the same output. Mapping data changes are an operational DB write, not a Resolver release.
- **Stable invocation path.** The Auditor tool reference path is `~/.local/bin/resolver` and remains stable across releases. The symlink rotates to the active deployment worktree binary.
- **Operationally additive.** The Resolver-v1 deployment introduces an additive DB migration only; no existing Wakery table is altered. Wakery v1 + v2 test suites remain green after the migration.

## Constraints

- Risk Codes restricted to `{R100, R200, R300, R999}` on the Resolver-emit side per `SECURITY.md §Risk Codes`.
- CLI-only for v1. No HTTP API, no daemon mode.
- `max` aggregation only. Weighted aggregation is deferred.
- No version stamps in the Resolver output JSON. Mapping data is operational DB content and is not under source-control versioning; audits record the timestamp of the resolution instead.
- No mapping-data administration tooling in v1. Mappings are managed via direct DB writes.
- The wildcard set is the practical set identified by `research_20260527_resolver-survey/research.md`, sized to ship v1, not exhaustive. The set grows over time as new chains surface and `R999` outcomes accumulate.
- Project-specific rows are added selectively on top of the wildcard set wherever the project's nature justifies easing the default strictest verdict — never to introduce cells the wildcard set itself does not cover.
- Resolver does not lookup or branch on agent identity, runtime state, or upstream task fields beyond what the chain itself carries.

## Deliverables

The product delivered by Resolver-v1 — enumerated for the PRD at non-architectural granularity; sibling specs define the *how*:

- The Resolver CLI app (`main/apps/resolver/`).
- The `project_risk_mapping` DB table (additive migration) in the project database.
- Mapping data seed: the practical wildcard set from the research record, plus project-specific overlay rows where adopted.
- Audit-workflow integration: Heimdall's tool surface and audit runtime invoke Resolver for every audit reaching primitive extraction; the audit record carries Resolver's output verbatim per `SECURITY.md §Risk Codes`.
- Deployment via `~/.local/bin/resolver` symlink rotating across release worktrees.
- Sample test issues on `<owner>/vork` exercising the outcome paths (`R100`, `R200`, `R300`, `R999` against a designated-`R999` cell, `R999` against a cell unmapped in both partitions, and `R994` against a simulated Resolver-tooling failure).
- Release artifact under `releases/release_v<YYYY.MM.DD>/release.md` covering the platform-wide release that bundles Resolver alongside any concurrent Wakery revision per `PROJECT.md §Release`.

## Verification

The product is judged satisfied when:

- Every Heimdall audit reaching primitive extraction goes through Resolver — no audit comment self-assigns `R100`, `R200`, `R300`, or `R999`.
- Auditor-direct codes (`R0`, `R993`–`R998`) continue to be emitted by Heimdall directly per `SECURITY.md §Risk Codes`, without consulting Resolver for the code itself (`R994` and `R998` cite Resolver's error envelope or success envelope in the audit comment, but the code is Auditor-assigned).
- The sample test issues complete their lifecycle end-to-end, with Resolver's per-primitive-operation Risk Codes and the aggregate Task Risk Code captured verbatim in each audit comment, rendered in `seq` order.
- The partial-overlay rule is exercised: a chain with one project-specific primitive resolves that cell from the overlay while a sibling operation without a project row falls back to its wildcard row.
- The wildcard-side `R999` test verifies a designated-`R999` cell aggregates correctly into the chain verdict.
- The Wakery v1 + v2 test suite continues to pass after the additive `project_risk_mapping` migration.
- `~/.local/bin/resolver` resolves to the binary inside the active release deployment worktree, and the Auditor tool reference path is stable across releases.

## References

- `docs/research/research_20260527_resolver-survey/research.md` — the empirical chain survey, the practical wildcard primitive set with assigned Risk Codes, and the project-specific overlay candidates this PRD's mapping-data deliverable consumes.
- `docs/policy/SECURITY.md` — `§Classification`, `§Extraction`, `§Resolver`, `§Risk Codes`. The authority on primitive vocabulary, the audit-direct Risk-Code boundary, and the Resolver-emit set.
- `docs/policy/PROJECT.md` — `§Specs` (the section shape this PRD conforms to), `§Release`.
- `docs/policy/TASK.md` — the lifecycle and audit state machine Resolver participates in via the audit workflow.
- `docs/charter.md` — the project charter.
- `specs/apps/resolver/spec_resolver.md` — architecture, algorithm, partial-overlay resolution rule, aggregation rule, error model.
- `specs/apps/resolver/spec_resolver-contracts.md` — DB schema, JSON envelopes (including the `seq` field on chain entries), naming rules.
- `specs/apps/resolver/spec_resolver-audit-integration.md` — audit-workflow invocation contract and audit-record output shape.
- `specs/apps/wakery/prd_wakery.md` — adjacent app PRD; the section-shape reference for this document.
