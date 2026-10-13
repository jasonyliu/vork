# Wakery Re-wake Message

## Introduction

This spec defines the **re-wake message** — the template the dispatch worker sends when it re-dispatches an **empty run**: a wake whose previous turn ended without observed task progression (`spec_wakery-dispatch-worker.md` Stage 5). It sits beside the wake message (first dispatch) as one of the two dispatch templates; the retired probe message's nudge role is absorbed here on facts instead of timers, and the retired **resume message** folds in as the settled-holds context block — a held wake re-engages through this template when its external work settles (`spec_wakery-snooze.md` Stage 3).

The re-wake message has two artifacts:

- **This spec** — the human-facing contract. Composition, placeholders, design rationale.
- **`apps/wakery/templates/rewake-message.json`** — the machine-facing artifact the renderer parses at runtime.

Renderer machinery is shared and governed by `spec_wakery-template-renderer.md`. Template selection is the dispatch worker's: `wake_attempts = 0` → wake message; `wake_attempts > 0` → this template (`spec_wakery-dispatch-worker.md` Stage 4).

## Purpose

An empty run has several possible causes, and wakery deliberately does not distinguish them (Principal ruling: no upstream re-read before re-waking — the agent absorbs the ambiguity with the context it has). The message is therefore **outcome-blind self-heal**: it names the observed fact (your turn ended; no transition was observed), lists the possible causes — work unfinished, transition comment missing, upstream event delivery lagging, or the turn dropped mid-work (session died, token budget exhausted) — and instructs the agent to read current state and take whichever action fits. A false-positive re-wake (progression happened; the webhook is late) costs one polite confirm turn and is harmless by construction.

**The composition must be self-sufficient.** For `delivery=run`, every re-wake lands in a **fresh disposable session** (new lease id → new run-session key) with zero prior context — the re-wake cannot assume the agent remembers anything. It therefore carries the full task packet exactly as the wake message does, plus the re-wake preamble. A session-delivery agent simply gets context it already has; a run-delivery agent gets context it needs.

## Scope

This spec covers:
- the canonical re-wake composition
- the placeholder set beyond the wake message's
- invariants every dispatched re-wake must satisfy

This spec does not cover:
- empty-run detection, the terminal-verifier guard, or the attempt cap (`spec_wakery-dispatch-worker.md` Stage 5)
- the renderer module (`spec_wakery-template-renderer.md`)
- the wake variant (`spec_wakery-wake-message.md`)

## Definitions

- **Composition** — the single assembled message body, all placeholders substituted before dispatch; an un-substituted placeholder is a render failure.
- **Empty run** — per `spec_wakery-queue-and-leases.md`: a `dispatched` wake with no open lease that is still its task's newest open wake.

## Placeholders

The re-wake reuses the wake message's full placeholder set and source map (`spec_wakery-wake-message.md §Placeholders`) — including `task_payload_json` and the state-specific instruction selection — and adds three of its own. All placeholders are required at render time; wakery aborts with `wakery.template.render_failed` on any missing value.

| Placeholder | Source | Notes |
|---|---|---|
| *(all wake-message placeholders)* | per `spec_wakery-wake-message.md` | The full task packet: identity, project, homespace, issue, state fields, payload, state-specific instruction block. |
| `{{wake_attempts}}` | `wake.wake_attempts` (after increment) | Which turn this is for the wake — `2` on the first re-wake. |
| `{{rewake_cap}}` | env `WAKERY_REWAKE_MAX_ATTEMPTS` | The cap, so the agent sees how much runway remains. |
| `{{last_turn_minutes_ago}}` | derived: `Math.round((now - update_time of the wake's most recent completed lease) / 60000)` | How long ago the empty turn ended — lets the agent judge upstream-lag plausibility. |
| `{{settled_holds_block}}` | derived: the settled-holds context (below), or the empty string | The folded resume context. Non-empty when snoozes matching the wake's branch + scope reached `completed` or `timeout` since the wake's previous turn ended (`spec_wakery-snooze.md`). Allowed-empty: this is the one placeholder that may render to nothing. |

## Composition

The re-wake composition is the **wake-message composition** (`spec_wakery-wake-message.md §Composition` — header, identity block, `Required first action`, state-specific instruction block, wake-context footer) with two deltas:

**1. The header line identifies the re-wake:**

```
[{{utc_timestamp}}] Wakery re-wake — turn {{wake_attempts}} of {{rewake_cap}} for this task state
```

**2. The settled-holds context block (`{{settled_holds_block}}`), rendered between the header and the preamble when non-empty:**

```
External holds settled since your last turn: {{for each settled snooze: <TYPE> (<status>, held <minutes>m)}}.
Wakery reads no outcomes. Check the real external state yourself — the CI conclusion, the pull request, the merge.
A hold marked `timeout` never sent its completion signal: verify that external process is not still running before you proceed.
```

Type-aware, outcome-blind — the resume message's contract, carried forward verbatim in philosophy: it names *what* was waited on and *that* the wait ended, never how it ended.

**3. A re-wake preamble block inserted immediately before the state-specific instruction block:**

```
Why you are being woken again: your previous turn on this task ended {{last_turn_minutes_ago}} minutes ago without an observed transition. Wakery reads no outcomes and does not know why. Possible causes: the work is unfinished; the work is done but the transition comment or field move was never posted; upstream event delivery is lagging; or your previous session dropped mid-work.

Read the issue's current state first, then act on what you find:
- Work already done and transitioned → reply confirming in one line and end your turn (upstream lag heals itself).
- Transition missing → post the transition per TASK.md and end your turn.
- Work unfinished → continue and finish, ending with its transition.
- Cannot proceed within scope → transition to Pending per TASK.md with the blocker named.

This is turn {{wake_attempts}} of at most {{rewake_cap}}; at the cap wakery stops waking you and raises an alert instead.
```

The state-specific instruction block that follows is selected exactly as the wake message selects it — the task's state has not changed, so the same state's duties apply.

## Invariants

- Outcome-blind: the message asserts only the observed facts (turn ended, no transition observed; holds settled) and never guesses causes or carries external outcomes.
- Self-sufficient: carries the full wake-message task packet; valid as first contact in a context-free fresh session (`delivery=run`).
- Sent only on empty-run re-dispatch (`wake_attempts > 0`); never as a first dispatch; never for a wake at or past `WAKERY_REWAKE_MAX_ATTEMPTS`.
- A terminal (cue) wake reaches this template only after the terminal verifier found the issue still open (`spec_wakery-dispatch-worker.md` Stage 5) — a verifier-completed cue is never re-waked.
- One re-wake message per re-dispatch, on a fresh lease; `runId = the new lease.id`.
- Composition lives in this spec; `apps/wakery/templates/rewake-message.json` mirrors it mechanically — drift is a code-review concern.
- Render aborts on any missing placeholder; no message ships with un-substituted `{{placeholders}}`.

## References

- `spec_wakery-dispatch-worker.md` — Stage 4 template selection, Stage 5 empty-run recovery and cap
- `spec_wakery-queue-and-leases.md` — the empty-run condition and `wake_attempts`
- `spec_wakery-wake-message.md` — the base composition and shared placeholder map
- `superseded/spec_wakery-resume-message.md` — the folded-in predecessor of the settled-holds block
- `spec_wakery-snooze.md` — hold predicate, settle semantics, and the settled-set definition
- `spec_wakery-template-renderer.md` — renderer module
- `docs/research/research_20260729_openclaw-turn-signal-verification/research.md` — why empty runs are detectable at all
