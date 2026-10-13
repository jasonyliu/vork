# Genre: Data

What data exists and how it is structured — the top-class design instrument. Software is data moving between surfaces; design the data first and the Interface and Process documents shrink to rules spoken in its names. Explicit schemas, keys, events, and constants are what implementers write against.

Three surfaces, each with its own space and ruleset:

- **Transactional** — the dataset that controls the resources the system manages and defines how data relates to one another. Includes the constants behind every hardcoded value its columns carry.
- **Operational** — the layer providing fast data access irrespective of the system's growth in scale and complexity: caches, configuration stores, queues, notification channels.
- **Analytical** — the event system with an extensible attributive vocabulary, providing observability and traceability of system operations.

## The identifier system — design first, document once

Before any inventory grows, fix the project's identifier grammar in one place:

- **Separators.** One top-level separator for composed keys (stem↔params and param↔param), one namespace binder inside a segment. Chosen once, used everywhere.
- **Name-derivation chains.** How a config field derives its cache key, how a table name derives its API path, how an event family derives its error mirror. When derivation is mechanical, one rule replaces dozens of definitions.
- **ID taxonomies.** Numeric families with published position meanings and allocation rules.

Shared literals are the cross-reference system: producers are named in the inventory, consumers stay implicit — whoever composes the same identifier. A search on the literal finds every origin and reference.

## Transactional

**Naming.** Tables lowercase snake_case, singular. Child/detail tables compound the full ancestry: `advertiser_postback_parameter`. Junction tables concatenate both parents in ownership order (`campaign_creative`); a relationship that is itself an entity with lifecycle appends its own noun (`wake_route_lease`). Tables mirroring an external system carry that system's prefix (`github_agent`).

**Identity.** Flow tables take a surrogate `id` PK (opaque, minted with a table-tag prefix); business identity is a UNIQUE (usually composite) index, each participant marked unique in its description — never the PK. Standalone lookup tables may use the natural key as PK. A derived key states its formula (`id = md5(a + b + c)`).

**References.** FKs are named `<parent_table>_id` and are by-convention by default — add a real constraint only where runtime integrity is load-bearing. The description cell declares the target: `references supply.id` same-schema, fully qualified `<store>.<schema>.<table>.<column>` across schemas — the same notation every other document uses to cite a column. Denormalize id+name in pairs (`agent_id` authoritative, `agent_name` display).

**Status, enums, flags.** Every flow table carries `status` with lowercase single-word values; soft-delete flow rows by status, retire lookup rows by an active flag — never DELETE. Booleans are bare verbs/adjectives (`repeat`, `halt`, `mandatory`) — no `is_` prefix. Small dangerous enums get named CHECK constraints kept aligned with the code type. Value sets are documented per §Constants below.

**Time and audit.** A fixed tail closes every table: `status`, `create_time`, `update_time`(, `operator` when humans mutate rows via an ops surface). Create/update times are epoch-ms bookkeeping only — operational recency gets its own named column. Validity windows: `valid_from`/`valid_to` (nullable = unbounded), plus a bitmask column when hour-of-week granularity is needed.

**Doc shape.** One section per table: the table name plus a one-sentence purpose; pair a human display name with the physical name (`<display name> - <table_name>`) when the two differ. Table sections are ordered parents before children. Fields as a 4-column table (`field | type | description | notes`) with logical types (`string`, `int64`, `json`, `string[]`), never DDL. Description cells pack, in order: meaning → FK target → uniqueness → nullability → units → enum values or pointer. Notes carry requirement IDs and standards. Structure migrations and canonical-row seeds are separate code surfaces (additive, idempotent); the doc is the semantic truth, not a DDL dump.

**Constants.** The lookup tables behind every hardcoded value. One constants home per project — a distinct section or standalone file — holding all status, enum, and flag value sets, each set headed by its owning column (`<table> : <column>`) as a `value | meaning` table; the meaning cell may carry the mechanism the value selects. A column's description states short sets inline as `value - meaning` pairs and points to the constants home for anything longer; the constants home never holds a set without a named owner. A registry-backed set (values seeded from a table the runtime reads) names the registry as authority and marks the doc as its reflection. Supersession by selector field or replacement note in place — silent substitution is drift. Wire-level enums owned by an interface parameter rather than a column live in that interface doc's constants facet; attribute enums live in the vocabulary registry.

**ERD — mandatory.** Every transactional spec carries a Mermaid `erDiagram` (as every process spec carries its flow diagram): full attribute lists with `PK`/`FK`/`UK` markers; ownership chains as edges with behavioral captions ("holds at most one open per turn"), junction tables edged to both parents, logical no-constraint correlations as dotted edges naming their predicate, lookup tables drawn edge-less. Follow it with entity-relationship notes: which table owns which, fallback/wildcard resolution rules, cardinality invariants.

## Operational

**Key grammar.** `{sys}_{ownership-chain}_{value-suffix}` + separator + parameter segments. The system prefix appears on every key in the store, singletons included. The ownership chain runs broad→narrow; parameter segments are the **source column names verbatim**, mirroring the stem's chain in the same order, cross-cutting dimensions after the entities they qualify. Bind a domain-ambiguous param with the namespace binder inside its segment. A negation/complement variant inserts its marker right after the prefix (`sys_no_…`). Multiple granularities of one stem are separate inventory rows, coarsest first. A derived key states its derivation formula.

**Suffix vocabulary.** The suffix declares the value's shape. The project defines its suffix vocabulary once and reuses it across every domain: e.g. `_info` = full entity record as a struct, `_list` = id collection, bare metric nouns = numeric ratios. A new suffix enters the vocabulary with a declared value shape before any key uses it; two suffixes never mean the same shape.

**Types and lifecycle.** Type column from a closed set (`string`, `json`, `json[]`, `string[]`, `int`, `double`, `hash` — hash declaring its `k=` / `v=` fields on their own lines). Every key family states its lifecycle explicitly: a TTL, a delete rule, or the word permanent. Store-wide behavior — refresh cadence, incremental-selection rule, value-compression marker — is stated once per store, inherited by every key.

**Producer attribution.** Two mutually exclusive forms: mirror keys list their fully qualified source tables and carry the fixed mini-procedure skeleton (query/join with named edges → status-exclusion chain walking the ownership hierarchy → key assembly from exact source columns → transform → overwrite write → mirrored delete of evicted keys); runtime keys state `produced by <process>` naming the Process doc, description otherwise near-empty.

**Store shape.** One doc per store: global rules opener → deployment roster (endpoints per environment, never credentials) → bare key index grouped by partition and business section → per-partition detail tables (`key | type | producer | description`). Partitions are allocated per producer/lifecycle class, never per entity: a new write-path earns a new partition; a new entity in an existing process joins that process's partition.

**New-key checklist.** Pick the partition by producing process; name stem = prefix + ownership chain + value suffix from the vocabulary; params = exact source columns broad→narrow, namespace-bound if ambiguous; declare type; state lifecycle; attribute the producer; procedure only for mirror keys.

## Analytical

**Event registry.** One registry is the source of truth; every event definition carries `id`, `name`, `description`, `type`, `validity`, `severity` — and each field names its downstream consumer (severity → the alerting system's alarm selection; validity → the log analyzer's freshness judgment; type → the chaining rule). A registry field with no named consumer doesn't exist.

**ID grammar.** The leading digit names the producing system (publish the digit map once); remaining positions encode function family, then sequence. Give parallel systems parallel family layouts so funnels align across systems. Errors prefix the normal code with the error digit — error is a modifier, not a system — so every family gets its error mirror for free. Cite whole families with positional wildcards (`80XXX`).

**Chaining.** A correlation/serial id rides every event, unconditionally; its generation rule is defined per event `type`. Two canonical uses: lifecycle chaining across events, and request/response pairing on interface events.

**Attribute vocabulary.** One vocabulary registry; every parameter name anywhere in the platform is a registered attribute. Grammar: `namespace~name` or `namespace~group~name`, 2–3 levels, all lowercase, snake_case within a level. Names reveal the value's meaning. When a field ships in derived forms (hashed twin, bucketed twin, display twin), fix one suffix per derivation and reuse it vocabulary-wide. Types from a closed set, arrays marked on the type (`string[]`), never in the name; units and enums in the description, never in the name.

**Vocabulary architecture.** Two kinds of families: **generic** (shared world nouns — device, geo, network, app, event envelope) and **system-specific** (one namespace per system's own business nouns). An event's payload composes: universal envelope + applicable generic families + the producer's own family. Never re-mint a generic concept inside a system namespace. Each family's doc carries an applicability matrix — which system or event carries which field, grouped under lifecycle-stage headers — so one wide analytical table serves every system: generic columns align cross-system, system columns are sparse and collision-free by prefix, event id + serial id select and chain rows.

## Verification

Structural checks close each surface: registry and reflection in sync; key patterns lint against the grammar; event ids unique within family and their attributes registered; every FK target exists; the ERD names every table the field tables define; every constant set has a named owner and covers every value the code emits; no secrets or live credentials anywhere in the inventories.
