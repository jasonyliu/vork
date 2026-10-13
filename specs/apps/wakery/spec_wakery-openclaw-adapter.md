# Wakery OpenClaw Adapter

## Introduction

This spec defines Stage 3 of the Wakery: the adapter module through which wakery talks to the OpenClaw gateway. The adapter is no longer a fire-and-forget dialer — it implements the **gateway link**: one persistent authenticated WebSocket connection, owned by the dispatch worker for the life of the process, carrying outbound RPCs (`chat.send`, `agent`, `agent.wait`) and the inbound event stream that the lifecycle watcher consumes.

The pre-amendment adapter opened a socket per call, resolved on the first response frame, and closed — discarding every event the gateway pushed, including the run lifecycle. That blindness is what forced the retired proxy-inference designs (progression-completed leases, E9, timer-based probing); the link is the structural fix (`docs/research/research_20260729_openclaw-turn-signal-verification/research.md` T6).

## Purpose

The adapter exists to:
- maintain the persistent gateway connection: authenticate, subscribe, reconnect with backoff, and signal reconnects so the worker can bulk-reconcile
- resolve downstream targets and deliver rendered turn messages — one send per lease, `idempotencyKey = lease.id`
- surface the gateway's `agent` event stream to the dispatch worker's lifecycle watcher
- expose `agent.wait` for the reconcile paths
- emit event logs

## Scope

This spec covers:
- connection lifecycle: handshake, authentication, subscriptions, reconnect, liveness
- the runId contract on sends
- session and run delivery targeting
- event intake and the watcher interface
- `agent.wait` invocation
- MVP dispatch authority limits

This spec does not cover:
- dispatch policy, lease writes, reconcile decisions, or empty-run recovery (`spec_wakery-dispatch-worker.md` — the adapter carries signals; the worker owns every ledger write)
- message content (`spec_wakery-wake-message.md`, `spec_wakery-rewake-message.md`, `spec_wakery-template-renderer.md`)
- wake intake (`spec_wakery-ingress-api.md`)

## Definitions

- **gateway link** — the single long-lived WebSocket connection to the OpenClaw gateway, authenticated as wakery's operator identity.
- **frame** — one protocol message: `{type:"req", id, method, params}` outbound, `{type:"res", id, ok, payload|error}` and `{type:"event", event, payload}` inbound.
- **session delivery** — send into an existing long-standing session (`route.session_key` is the concrete session key).
- **run delivery** — send into a disposable one-shot session whose key is rendered from the route's template with the lease id substituted (`run-session.ts`).

## Upstream / Downstream Context

### Upstream
- routed wake + selected route + freshly minted lease from the dispatch worker
- the OpenClaw gateway (protocol v4, verified against OpenClaw 2026.6.11)

### Downstream
- delivered turn messages; `agent` events handed to the lifecycle watcher; `agent.wait` verdicts handed to reconcile
- JSONL event logs

## Interfaces / Shared Contracts

Depends on:
- `wake`, `route`, `wake_route_lease`, `event`
- the gateway protocol surfaces verified at OpenClaw 2026.6.11: `connect` (challenge/response), `chat.send`, `agent`, `agent.wait`, `sessions.subscribe`, `sessions.messages.subscribe {key}`, and the `agent` event family

Watcher interface (adapter → worker): the adapter delivers each `agent`-family event as `{runId, sessionKey, stream, data, ts, isHeartbeat}` and each connection-state change as connected/disconnected/reconnected signals. The worker registers handlers; the adapter never interprets lifecycle content itself.

## Procedure

### Stage 1 — Connection lifecycle

**Objective**
- keep one authenticated event-bearing connection alive for the process's life.

**Rules**
- dial the configured gateway URL; on the `connect.challenge` event, send `connect` with protocol 4, `role: "operator"`, operator read/write scopes, the gateway token, and the device signature from wakery's device identity (`device-auth.ts`) — the same credential set the pre-amendment adapter used per call
- after `hello-ok`, issue the explicit subscriptions: `sessions.subscribe {}` and, per session route in the routing table, `sessions.messages.subscribe {key}` where useful. The `agent`/`chat` broadcast to operator connections needs no subscription at OpenClaw 2026.6.11 — but that is observed behavior, not documented contract, so the subscriptions are issued as belt-and-braces (research T4)
- **liveness:** the gateway emits periodic `health`/`tick` frames; silence beyond the expected cadence is a dead-link signal — close and re-dial
- **reconnect:** on drop, re-dial with exponential backoff from `WAKERY_GATEWAY_RECONNECT_BACKOFF_MS` (doubling, capped at 8×; reset on success); on every successful (re)connect, signal the worker **before** resuming event delivery so the bulk reconcile runs first
- RPCs multiplex over the link by frame id; each pending request carries its own timeout. When the link is down, sends fail fast to the worker (which completes the lease `send_failed` and leaves the wake queued) — the adapter does not queue sends

### Stage 2 — Enforce current MVP authority

**Rules**
- `delivery = session` may send to an already-existing session; `delivery = run` may create a short-lived one-shot run session from the route's session-key template
- the adapter must not create persistent long-standing sessions

### Stage 3 — Send a turn

**Objective**
- deliver one rendered message as one gateway run whose identity wakery chose.

**Rules**
- the worker hands the adapter a rendered message plus `{wake, route, lease}`; rendering happened before the lease existed (`spec_wakery-dispatch-worker.md` Stage 4) — a render failure never reaches the adapter's send path
- **runId contract:** every send carries `idempotencyKey = lease.id`. The gateway adopts the caller's idempotency key as the run's `runId` — verified live at OpenClaw 2026.6.11 for **both** methods (research T2, T8). Idempotent re-send is verified end to end: a duplicate send with a completed run's key returns the original run's completed result and starts no new turn, so a crash-resend of the same lease cannot double-fire and even recovers the result.
- **Two-stage response (`agent` method):** the accepted ack (`{runId, sessionKey, status:"accepted", acceptedAt}`) resolves the send; a second res frame on the same request id later carries the terminal result (`{status:"ok"|"error", summary, result}`). The adapter forwards that final frame to the watcher interface as an auxiliary completion signal — same idempotent handling as a lifecycle end event.
- `delivery = session` → `chat.send { sessionKey: route.session_key, message, idempotencyKey: lease.id }`
- `delivery = run` → `agent { sessionKey: renderWakeryRunSessionKey(route.session_key, lease.id), message, idempotencyKey: lease.id, deliver: false }`
- the send resolves on the gateway's acceptance (`status:"started"` for `chat.send`; accepted-ack for `agent`); turn completion is **not** awaited on the send path — it arrives through the event stream
- send failure (link down, gateway error, timeout) throws to the worker; the adapter performs no retries and no state writes

### Stage 4 — Event intake

**Objective
**- hand the gateway's signals to the worker unfiltered by policy, filtered only by shape.

**Rules**
- `agent`-family events are parsed and handed to the watcher interface as-is: lifecycle (observed phases at 2026.6.11: `start`, `finishing`, `end`, `error` — with `startedAt`/`endedAt`/`aborted`), assistant, tool, heartbeat streams — the worker matches runIds to open leases and owns every consequent write. **Completion is `end`/`error` only**: `finishing` is activity, and a run-spawned session may broadcast no `start` event at all (research T8) — nothing may depend on observing `start`
- events whose `runId` is absent or foreign pass through the same interface; dropping them is the worker's call (it ignores unknown runIds), keeping the adapter policy-free
- `chat`, `sessions.changed`, `session.message` families are not consumed by the current design (the `agent` family is sufficient — research T3/T4); the adapter ignores them without error
- `health`/`tick` feed Stage 1 liveness only

### Stage 5 — `agent.wait`

**Objective**
- expose the gateway's run-state oracle to the worker's reconcile paths.

**Rules**
- `agent.wait { runId, timeoutMs }` over the link, per open lease under check; the adapter returns the verdict verbatim — `{status:"ok", endedAt}`, `{status:"error", …}`, or `{status:"timeout", timeoutPhase, providerStarted}` — and the worker maps it to a lease action (`spec_wakery-dispatch-worker.md` Stage 6)
- terminal-snapshot retention at the gateway is short (research T5); the adapter attaches no meaning to that — promptness is the worker's reconcile policy

## Invariants

- one gateway link per wakery process; RPCs and events share it
- the adapter holds no durable state and writes neither ledger — it is transport and translation only
- every turn-starting send carries `idempotencyKey = lease.id`; the adapter never mints run identities of its own
- no persistent OpenClaw session is ever created by wakery
- event delivery order per run follows the gateway's `seq`; the adapter does not reorder or buffer across reconnects (missed events are the reconcile's problem, by design)

## Failure / Recovery

- link drop → reconnect with backoff; worker signaled; bulk reconcile before event delivery resumes
- send failure → thrown to the worker; lease completed `send_failed` there; wake retries with a fresh lease
- `agent.wait` failure (link down, RPC error) → returned as an error verdict; the worker skips that lease until the next reconcile pass
- gateway restart → appears as a link drop + reconnect; the reconcile absorbs everything missed, including runs that ended while the link was down
- events for completed leases (late duplicates, reconcile races) → harmlessly ignored by the worker's idempotent completion

## Observability

Must emit at minimum:
- `link.connected` / `link.disconnected` (with cause) / `link.reconnect.attempt` (with backoff)
- dispatch attempted / sent to existing session / sent through one-shot run session — carrying the lease id (= runId)
- `openclaw.dispatch.failed` with reason (`send_failed`, `timeout`, `link_down`)
- dispatch blocked because an unauthorized persistent-session path was attempted
- `agent.wait` invocations and verdicts ride the worker's `lease.completed`/`link.reconciled` events rather than separate adapter events

## References

- `spec_wakery.md`
- `spec_wakery-contracts.md`
- `spec_wakery-dispatch-worker.md` — the worker that owns the link's policy side
- `spec_wakery-queue-and-leases.md` — the two-ledger contract
- `spec_wakery-wake-message.md` / `spec_wakery-rewake-message.md` / `spec_wakery-template-renderer.md`
- `specs/data/spec_event.md`
- `docs/research/research_20260729_openclaw-turn-signal-verification/research.md` — protocol facts verified at OpenClaw 2026.6.11 (T1–T6); test scripts in the record are the reference client implementation
- `docs/research/research_20260413_wake-router-gateway-auth-modes/` — the operator/backend auth mode this connection uses
