# Milestone: Conduction framework — the first release (`milestone_v2026.10.10_conduction-framework`)

**Status:** `Completed (2026-10-13)` — released as `v2026.10.13`, `docs/releases/release_v2026.10.13/release.md`

## Scope

Vork's first release publishes the multi-agent conduction framework the Principal built and ran through mid-2026: the six-document policy corpus, the specs, the four services (Wakery, Foundry, Resolver, the data layer), the OpenClaw policy hook, the provisions, and the techspec skill — as that software stood when it was retired, renamed to Vork, and carrying nothing of the estate it ran on.

The purpose of this release is the record. The framework is the first serious attempt behind the kit Vork ships next; it is published whole, at its own tag, so the lineage can be read in the open. It is not maintained and it is not expected to run as cloned: what works, what was specified but never built, and what is known broken are stated plainly, and a release note written for an AI agent explains what is missing and how to make it work.

Excluded: the Principal's current kit (the next milestone); making the framework run; the historical records of the project it came from (its milestones, research, releases and agent context documents belong to that project and are not published); any history before this repository's first commit.

## Deliverables

1. **The framework tree, reviewed file by file.** Every file read and comprehended before it lands, shallow to deep: policy, conventions, provisions, specs, then the four services. Whatever ties a file to a person, a machine, a credential or a household is removed or made generic; whatever is meaningless outside the original estate is said so. The rename to Vork applies in full: the framework's former name in every form — the identifier, the `VORK_*` environment-variable prefix, the `@vork/data` package scope, token filenames, the database name.
2. **The configuration stance.** Placeholders stand only in prose and in example configuration, each named in one configuration legend. Code carries no placeholder: a value the original estate supplied by default becomes a required input, explained in the release note.
3. **Authored material.** `README.md` — what Vork is, why this release exists, the provenance note (no inherited history), and the three lists: what works, what is specified but unbuilt, what is known broken, with the measured cost of conduction stated; `LICENSE` (MIT); the stance on contributions; a generic LaunchAgent plist and installer in place of the originals.
4. **The release note for an AI agent** — `docs/releases/release_v<date>/agent-notes.md`, written last: the prerequisites (OpenClaw, Postgres, a public ingress, a GitHub account and token per agent), the configuration legend, every required input, what is missing from the tree and why, what works and what does not, and the order in which an agent would bring it up. Linked from the README.
5. **The release** — `release_v<date>`, tagged on `main`, this record closed with the release named; the repository stays private until the next milestone ships.

## Verification

- Every file in the tree has been read in review, batch by batch; no batch lands on a skim.
- The secret scanner (`gitleaks`) is clean on the tree before every push, and the search for every retired term — the estate's names, hosts, paths, identifiers, and the framework's former name in every form — returns zero hits.
- No `<...>` placeholder token remains in any `.ts` file; every placeholder in prose or example configuration resolves to an entry in the release note's configuration legend.
- Each batch is a local commit first, reviewed by the Principal in person and by a second AI session; a batch is pushed only after both are green.
- The Principal reads the repository as a stranger would before the release is tagged.

## Research

- None in this repository. The extraction's working notes stay with the Principal.

## Specs

- None. This milestone moves and renames existing software; it builds none. The specs in `specs/` are part of the published tree and are edited only by the review itself.

### Trail

<!-- Every spec this milestone creates or edits, appended as the change lands — the traceability record tying spec evolution to its milestone. One row per spec touched; note stays short (what changed, not how). -->

| Spec | Change | Note |
|---|---|---|
| — | — | No spec created or edited by this milestone. |
