# Memory as Evolving Context Layer

## Purpose

This policy defines how continuity is preserved using Memory.

It exists to:
- define what memory is
- define the canonical memory categories
- define the Memory Keeper's duties across **Persistence** and **Adaptation**
- define how memory is encoded, maintained, retrieved, and stored
- define how memory contributes evidence to the long-term evolution of Policy, Project, Agent, and human-agent coordination

## Principles

1. **Durable:** Memory preserves what remains useful beyond the moment.
2. **Distilled:** Memory is formed from raw materials through extraction, distillation, and organization.
3. **Traceable:** Durable memory preserves source linkage and maintenance lineage.
4. **Scoped:** Memory is kept and recalled within proper project, actor, privacy, and authority boundaries.
5. **Maintainable:** Memory remains proportionate, current, and retrievable over time.
6. **Governed:** Memory contributes evidence through reflection, proposal, and deliberation.
7. **Adaptive:** Memory improves future execution and coordination over time.

## Memory

Memory is the durable, distilled substrate of truth extracted from conversations, operations, decisions, and experience, organized to support later retrieval and provide evidence for improving Policy, Project, and Agent over time.

### Categories

Canonical memory categories are:

- **governance** — durable memory about framework, policy, authority, and governance evolution
- **work** — durable memory about value-producing work, including project-scoped and cross-project learnings that improve future work
- **decision** — durable memory of consequential decisions, their rationale, and their effects on other memory and context surfaces
- **entity** — durable memory about stable high-level entities and their relationships
- **experience** — durable memory of observed human-working patterns, habits, coordination realities, and other experiential truths that improve how agents work with the principal over time

### Persistence

Persistence ensures memory is captured, formed, maintained, and made available for later retrieval.

`Encode -> Maintain -> Retrieve`

#### Encode

Encode is the first stage of Persistence duty. Its purpose is to synthesize durable memory from raw materials.

Encoding is carried out through:

`Capture -> Extract -> Distill -> Organize`

- **Capture:** Work with raw source materials without prior abstraction.
- **Extract:** Provisionally identify and group candidate material into the canonical memory categories.
- **Distill:** Filter noise, infer significance, interpret patterns, summarize methods, and shape extracted material into durable high-signal memory.
- **Organize:** Place distilled memory into the correct category, structure, and storage surface so it remains legible, retrievable, and traceable.

Encoding should follow these requirements:

- **Raw materials:** Encode begins from raw source materials such as conversations, executions, artifacts, logs, issue and PR discussions, review notes, meeting notes, and other observed materials.
- **Durability:** Only materials likely to remain useful beyond the immediate moment should become durable memory.
- **Evidence:** Encoded memory must be grounded in observable source material.
- **Category:** Every encoded memory entry must be assigned one primary category from `governance`, `work`, `decision`, `entity`, or `experience`.
- **Distillation:** Encoded memory must preserve high signal rather than raw volume.
- **Traceability:** Encoded memory must preserve linkage to the materials from which it was synthesized.
- **Experience:** Experience memory must remain limited to repeated working patterns, coordination realities, and other observations that materially improve agent collaboration with the Principal. It must not drift into speculative personal profiling, irrelevant private characterization, or durable memory that has no execution or coordination value.
- **Clarity:** Encoded memory should be legible enough for later retrieval, reflection, and deliberation without reconstructing the entire source history.
- **Deduped:** Encoding should strengthen or refine existing memory when appropriate rather than generating unnecessary duplicate entries.

The output memory of Encode is durable, categorized, traceable, and ready for maintenance and later retrieval.

Raven remains responsible for judging what memory should be created or changed and for producing the actual memory content. Coordinated IO workflows for writing and updating canonical memory files, SQLite entries, LanceDB entries, and memory logs should be carried out through the Memory Utility.

#### Maintain

Maintain is the second stage of Persistence duty. Its purpose is to keep existing memory current, proportionate, traceable, and retrievable over time.

Maintenance should follow these requirements:

- **Salience:** Existing memory entries should not all compete at the same weight. Memory should remain hot, warm, or cold according to current usefulness.
- **Promotion:** Memory that repeatedly matters should be promoted so it becomes easier to retrieve and more likely to influence future work.
- **Demotion:** Memory that still matters but no longer deserves high salience should be demoted rather than forgotten.
- **Consolidation:** Overlapping or fragmented memory entries should be consolidated when redundancy weakens clarity.
- **Supersession:** Older memory should be superseded when newer or stronger evidence replaces previously accepted truth.
- **Contradiction:** Material contradiction between active memory entries, or between active memory and stronger source evidence, must trigger explicit maintenance action. Contradiction must be resolved through correction, supersession, consolidation, archival, or marked dispute; it must not remain silently ambiguous in active memory when sufficient evidence exists to address it.
- **Archive:** Memory that no longer belongs in active surfaces but still deserves preservation should be archived.
- **Purge:** Purge is exceptional and should be used only when memory is false beyond repair, unsafe to retain, encoded in error, or explicitly ordered removed by human authority.
- **Category integrity:** Every maintained memory entry should still preserve one primary category even when it is revised, reclassified, or consolidated.
- **Traceability:** Maintenance must preserve a reconstructable trail of change so it remains possible to inspect what changed, why it changed, what evidence supported it, and how the current memory state was reached.
- **Periodicity:** Maintenance should happen continuously as part of regular memory keeping and periodically through larger review passes.

The output of Maintain is a memory surface that remains current, non-duplicative, traceable, and ready to be maintained through the Memory Utility for later retrieval and reflection.

Memory Keeper remains responsible for judging what maintenance action is needed and for producing the revised memory content or maintenance intent. Coordinated IO workflows for updating canonical memory files, archives, SQLite entries, LanceDB entries, and maintenance logs should be carried out through the Memory Utility.

#### Retrieve

Retrieve is the final stage of Persistence duty. Its purpose is to make encoded memory available for later bounded use.

Memory retrieval should be facilitated through a dedicated memory recaller utility or service. This utility is responsible for providing bounded access to encoded memory and its supporting retrieval substrates.

The detailed behavior, search strategy, ranking, logging, and implementation of the memory recaller belong in specifications rather than in this policy.

Agent-facing guidance for when and how to use the memory recaller should be recorded in the relevant `TOOLS.md` surfaces.

### Adaptation

Adaptation ensures memory contributes evidence to improve future operations over time through reflection, proposal and deliberation.

`Reflect -> Propose -> Deliberate`

#### Reflect

Reflect is the first stage of Adaptation duty. Its job is to periodically examine accumulated memory and supporting materials, find meaningful patterns, and turn those patterns into bounded findings that are worth proposing for change.

Reflection is a scheduled and accumulative practice. It is not triggered by every small event and it is not performed casually in the middle of unrelated work.

`Accumulate -> Inspect -> Identify -> Comprehend`

- **Accumulate:** Reflection works over accumulated evidence to detect patterns, and should run on a **weekly basis** by default. It may also be intentionally initiated by the Principal on significant occasions when meaningful accumulation exists, such as a policy revamp, project close, or milestone completion.
- **Inspect:** Timely bounded inspection examines materials generated within the recent review window and gathers target-aware materials before analysis begins: 
  - Per-agent daily files: `main/docs/agents/<agent>/memory/daily/`
  - Categorized memory files: `main/docs/memory/<governance|work|decision|entity|experience>/`
  - Governance and Decision memory often lead to possible amendments in **Policy**
  - Per-agent daily files and Work memory often lead to **Project**-related changes
  - Entity and Experience memory usually relate to **Agent** behavioral adjustments
  - Other pathways to produce viable proposals may also exist
- **Identify:** Identification of patterns should focus on repeated, durable, and consequential signals instead of isolated incidents, one-off emotional swings, and weak impressions of noise. Generalized candidate patterns in each contributing area may include:
    - **Policy:** repeated occurrence of difficulty applying rules, need for authority-boundary clarification, workflow friction, decision-pattern problems, etc.
    - **Project:** recurring milestone-scoping failures, ambiguous specification of features, task audit blockers, coordination problems, etc.
    - **Agent:** continued examples of tool misuse, wasted execution runs, implementation mistakes, and habits or preferences that should be reinforced or corrected, etc.
- **Comprehend:** Comprehension turns identified patterns into bounded reflective findings. The Memory Keeper should interpret the underlying meaning of patterns, explain why they matter, infer what may need improvement in **Policy**, **Project**, or **Agent**, and collect those findings toward corresponding proposals.

#### Propose

Propose is the second stage of Adaptation duty. Its job is to turn reflective findings into bounded proposals, submit them to the correct destination, and record them in a way that allows later deliberation.

Proposal is not a hidden side effect of reflection. A proposal is a recorded proposal folder, placed in the correct destination, linked to its supporting reflection and evidence, and ready to wait for deliberation.

A proposal must declare one primary target:
- **Policy**
- **Project**
- **Agent**
  
All proposals should be stored under:

```text
main/docs/proposals/
- README.md
- policy/
- project/
- agent/
```

The detailed structure is:

```text
main/docs/proposals/
- README.md

- policy/
  - README.md
  - proposal_YYYYMMDD_<slug>/
    - proposal.md
    - deliberation.md
  - archive/
    - proposal_YYYYMMDD_<slug>/
      - proposal.md
      - deliberation.md

- project/
  - README.md
  - <project_name>/
    - README.md
    - proposal_YYYYMMDD_<slug>/
      - proposal.md
      - deliberation.md
    - archive/
      - proposal_YYYYMMDD_<slug>/
        - proposal.md
        - deliberation.md

- agent/
  - README.md
  - <agent_name>/
    - README.md
    - proposal_YYYYMMDD_<slug>/
      - proposal.md
      - deliberation.md
    - archive/
      - proposal_YYYYMMDD_<slug>/
        - proposal.md
        - deliberation.md
```

Each recorded proposal should live in its own proposal folder. The canonical proposal file inside that folder is `proposal.md`. The canonical deliberation artifact for that proposal is `deliberation.md`, stored beside `proposal.md`.

Each `proposal.md` should include:
- **Title**
- **Target**
- **Author**
- **Date**
- **Source**
- **Findings**
- **Proposal**
- **Outcome**

`Outcome` must record the deliberation result as either:
- **Accepted** Accepted proposals should include the list of altered artifacts.
- **Rejected** Rejected proposals should include the reason for rejection.

#### Deliberate

Deliberate is the third and final stage of Adaptation duty. The Memory Keeper's jurisdiction ends once a proposal folder has been written, stored in the correct proposal path, and linked to its supporting findings and evidence.

Final deliberation belongs to:
- **AI Lead**
- **Principal**

The AI Lead is responsible for:
- looking for active proposals created by the Memory Keeper
- selecting proposals worth bringing forward
- presenting them to the Principal for discussion and deliberation
- reasoning through the proposal together with the Principal
- reaching a final decision on the proposal
- recording the final outcome in the proposal record

The Principal is responsible for:
- reviewing the proposal with the AI Lead
- challenging, refining, or rejecting the proposal where needed
- making the final authority decision on whether the proposal should be applied or rejected

A deliberated proposal must record its final outcome in `proposal.md` as:
- **Accepted**
- **Rejected**

Rejected proposals must include the reason for rejection.

The deliberation result for a proposal should be recorded in `deliberation.md` stored beside `proposal.md` in the same proposal folder.

Once a proposal has been deliberated, the full proposal folder should be moved from its active proposal path into the corresponding `archive/` path with its `Outcome` completed.

The output of Deliberate is a closed proposal record with a final outcome and rationale. Any actual changes to Policy, Project, or Agent must then be carried out through the proper workflow of the affected target.

## Storage

Storage defines the concrete blueprint for keeping source material, canonical memory, and retrieval support.

### Daily

Per-agent daily source capture lives under:

```text
main/docs/agents/<agent>/memory/daily/
- README.md
- YYYY_MM_DD.md
```

These files are append-friendly daily source ledgers. They preserve captured material and observations before or alongside later distillation.

### Root

Canonical distilled memory lives under:

```text
main/docs/memory/
- README.md
- governance/
- work/
- decision/
- entity/
- experience/
- archive/
- maintenance/
```

Files directly under each category folder should use the naming pattern:

`memory_YYYY_MM_DD_<slug>.md`

These are distilled record entries that summarize what has been extracted and distilled from source material and preserve traceability.

Canonical memory categories remain flat by default. Differentiation should rely on naming conventions and metadata rather than nested category subfolders.

Cold canonical memory lives under `main/docs/memory/archive/` and should mirror the active category model closely enough to remain legible.

```text
main/docs/memory/archive/
- README.md
- governance/
- work/
- decision/
- entity/
- experience/
- archive/
- maintenance/
```

Human-readable maintenance records live under:

```text
main/docs/memory/maintenance/
- README.md
- maintenance_YYYY_MM_DD_<slug>.md
```

These explain major reshaping passes, supersession waves, archival decisions, and other changes that affect the memory state.

### Operational

Derived retrieval support and machine logs live under:

```text
workspace/.vork/memory/
- search/
  - memory.sqlite
- vector/
  - lancedb/
- logs/
  - encode/
    - encode_YYYY_MM_DD.jsonl
  - maintenance/
    - maintenance_YYYY_MM_DD.jsonl
  - retrieval/
    - retrieval_YYYY_MM_DD.jsonl
- cache/
```

`search/memory.sqlite` is the structured and lexical search substrate. It stores indexed records and metadata for deterministic search, filtering, and exact lookup.

`vector/lancedb/` is the semantic retrieval substrate. It stores chunk text, embeddings, and enough metadata to resolve back to canonical markdown truth.

Both SQLite and LanceDB are derived retrieval substrates. Canonical markdown memory remains the truth surface.

`logs/encode/` records the formation path of new memory entries.

`logs/maintenance/` records machine-readable maintenance actions over existing memory.

`logs/retrieval/` records memory retrieval behavior when a centralized retrieval service or equivalent retrieval mechanism exists.

`cache/` stores temporary working data such as query caches, embedding caches, temporary retrieval results, and other short-lived memory-operation data.

### Rebuildability

Operational stores such as SQLite, LanceDB, caches, and machine logs should be rebuildable from canonical memory, preserved source material, and necessary maintenance history. Canonical markdown remains the truth surface.