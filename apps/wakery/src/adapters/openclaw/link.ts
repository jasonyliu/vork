import WebSocket from 'ws';
import { EVENT_CODES } from '../../events/codes.js';
import { FileGatewayDeviceIdentityStore, createGatewayDeviceAuth } from './device-auth.js';

// The gateway link (spec_wakery-openclaw-adapter.md): ONE persistent
// authenticated WebSocket connection to the OpenClaw gateway, owned by the
// dispatch worker for the life of the process, carrying outbound RPCs
// (`chat.send`, `agent`, `agent.wait`) and the inbound `agent` event stream
// the lifecycle watcher consumes. The pre-amendment adapter opened a socket
// per call and discarded every pushed event — the blindness that forced the
// retired proxy-inference designs (research T6). The link is the structural
// fix: same URL, token, device identity, and challenge→connect handshake as
// the per-call client used; wakery just stops hanging up.

/** One `agent`-family event as handed to the lifecycle watcher, unfiltered by policy. */
export interface AgentEvent {
  runId: string | null;
  sessionKey: string | null;
  stream: string | null;
  data: any;
  ts: number | null;
  isHeartbeat: boolean;
}

/**
 * `agent.wait` verdict, verbatim from the gateway plus the adapter-local
 * `unavailable` shape for RPC failure (link down, timeout): the worker skips
 * that lease until the next reconcile pass — an RPC failure must never read
 * as the run having died.
 */
export type AgentWaitVerdict =
  | { status: 'ok'; endedAt?: number }
  | { status: 'error'; [key: string]: unknown }
  | { status: 'timeout'; timeoutPhase?: string; providerStarted?: boolean }
  | { status: 'unavailable'; error: string };

/** The auxiliary completion signal: the `agent` method's second same-request-id response frame. */
export interface AgentFinalSignal {
  runId: string;
  status: 'ok' | 'error';
  summary?: unknown;
}

interface EventCode { code: number; name: string; severity: string }
interface Emitter { emit(event: EventCode, fields?: Record<string, unknown>): void }

export interface GatewayLinkOptions {
  identityStore?: FileGatewayDeviceIdentityStore;
  eventWriter?: Emitter;
  /** Initial reconnect backoff; doubles per attempt to a cap of 8x, resets on success. */
  reconnectBackoffMs?: number;
  /** Default per-request RPC timeout. */
  rpcTimeoutMs?: number;
  /**
   * Liveness: the gateway emits periodic health/tick frames; silence beyond
   * this horizon is a dead-link signal — close and re-dial. 0 disables the
   * check (tests).
   */
  livenessTimeoutMs?: number;
  /** Cadence of the liveness check timer. */
  livenessCheckIntervalMs?: number;
  /**
   * Session keys to `sessions.messages.subscribe {key}` after hello — the
   * belt-and-braces subscriptions per session route (research T4: the
   * agent/chat broadcast to operator connections is observed behavior, not
   * documented contract). Re-read at every (re)connect.
   */
  sessionKeysProvider?: () => Promise<string[]>;
  clientVersion?: string;
  clientPlatform?: string;
  deviceFamily?: string;
}

interface PendingRequest {
  method: string;
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  resolved: boolean;
  /** For turn-starting `agent` sends: the runId (= idempotencyKey = lease id) the two-stage final frame belongs to. */
  runId?: string;
}

const RECONNECT_BACKOFF_MAX_MULTIPLE = 8;

export class GatewayLink {
  private socket: WebSocket | null = null;
  private connected = false;
  private stopped = false;
  private readonly pending = new Map<string, PendingRequest>();
  private backoffMultiple = 1;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private livenessTimer: NodeJS.Timeout | null = null;
  private lastAliveAt = 0;
  // Events arriving between hello-ok and the completion of the worker's bulk
  // reconcile are buffered so the reconcile always runs against gateway truth
  // BEFORE the stream is trusted (spec Stage 1).
  private deliverySuspended = false;
  private suspendedEvents: AgentEvent[] = [];

  private agentEventHandler: ((evt: AgentEvent) => void) | null = null;
  private agentFinalHandler: ((signal: AgentFinalSignal) => void) | null = null;
  private connectedHandler: (() => Promise<void> | void) | null = null;
  private disconnectedHandler: ((cause: string) => void) | null = null;

  private readonly reconnectBackoffMs: number;
  private readonly rpcTimeoutMs: number;
  private readonly livenessTimeoutMs: number;
  private readonly livenessCheckIntervalMs: number;

  constructor(
    private readonly gatewayUrl: string,
    private readonly gatewayToken: string,
    private readonly options: GatewayLinkOptions = {}
  ) {
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? 5000;
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 10_000;
    this.livenessTimeoutMs = options.livenessTimeoutMs ?? 90_000;
    this.livenessCheckIntervalMs = options.livenessCheckIntervalMs ?? 15_000;
  }

  /** Watcher interface (adapter → worker): every `agent`-family event, as-is. */
  onAgentEvent(handler: (evt: AgentEvent) => void) {
    this.agentEventHandler = handler;
  }

  /** The `agent` method's terminal same-request response — auxiliary completion signal. */
  onAgentFinal(handler: (signal: AgentFinalSignal) => void) {
    this.agentFinalHandler = handler;
  }

  /**
   * Called on every successful (re)connect BEFORE event delivery resumes, so
   * the worker's bulk reconcile runs against gateway truth first.
   */
  onConnected(handler: () => Promise<void> | void) {
    this.connectedHandler = handler;
  }

  onDisconnected(handler: (cause: string) => void) {
    this.disconnectedHandler = handler;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  start() {
    this.stopped = false;
    this.dial();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopLiveness();
    this.rejectAllPending(new Error('gateway link stopped'));
    this.connected = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try { socket.close(); } catch { /* already closing */ }
    }
  }

  /**
   * One RPC over the standing link, multiplexed by frame id. Fails fast when
   * the link is down — the adapter never queues sends (spec Stage 1); the
   * worker completes the lease `send_failed` and the wake stays queued.
   */
  async call(method: string, params: Record<string, unknown>, opts: { timeoutMs?: number; runId?: string } = {}): Promise<unknown> {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`gateway link down: cannot send ${method}`);
    }
    return this.sendRequest(this.socket, method, params, opts);
  }

  /**
   * The gateway's run-state oracle for the reconcile paths. Returns the
   * verdict verbatim; RPC failure comes back as `unavailable` so the worker
   * skips the lease instead of misreading a dead link as a dead run.
   */
  async wait(runId: string, timeoutMs = 2000): Promise<AgentWaitVerdict> {
    try {
      const payload = await this.call('agent.wait', { runId, timeoutMs }, { timeoutMs: timeoutMs + 8000 });
      if (payload && typeof payload === 'object' && 'status' in (payload as any)) {
        return payload as AgentWaitVerdict;
      }
      return { status: 'unavailable', error: 'malformed agent.wait payload' };
    } catch (err) {
      return { status: 'unavailable', error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── connection lifecycle ──────────────────────────────────────────────────

  private dial() {
    if (this.stopped) return;
    const socket = new WebSocket(normalizeGatewayUrl(this.gatewayUrl));
    this.socket = socket;
    this.lastAliveAt = Date.now();
    let closed = false;

    const handleDrop = (cause: string) => {
      if (closed) return;
      closed = true;
      if (this.socket === socket) {
        const wasConnected = this.connected;
        this.connected = false;
        this.socket = null;
        this.stopLiveness();
        this.rejectAllPending(new Error(`gateway link closed (${cause})`));
        this.deliverySuspended = false;
        this.suspendedEvents = [];
        if (wasConnected || this.reconnectAttempt === 0) {
          this.options.eventWriter?.emit(EVENT_CODES.LINK_DISCONNECTED, { cause });
        }
        this.disconnectedHandler?.(cause);
        this.scheduleReconnect();
      }
      socket.removeAllListeners();
    };

    socket.on('message', (raw) => {
      let frame: any;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.lastAliveAt = Date.now();
      this.handleFrame(socket, frame);
    });
    socket.on('error', (err) => handleDrop(err instanceof Error ? err.message : String(err)));
    socket.on('close', () => handleDrop('socket closed'));
  }

  private handleFrame(socket: WebSocket, frame: any) {
    if (frame.type === 'res') {
      this.handleResponse(frame);
      return;
    }
    if (frame.type !== 'event') return;

    if (frame.event === 'connect.challenge') {
      void this.authenticate(socket, frame.payload?.nonce).catch(() => {
        try { socket.close(); } catch { /* drop path handles reconnect */ }
      });
      return;
    }
    if (frame.event === 'health' || frame.event === 'tick') {
      // Liveness only (spec Stage 4); lastAliveAt already refreshed above.
      return;
    }
    if (frame.event === 'agent') {
      const p = frame.payload ?? {};
      const evt: AgentEvent = {
        runId: typeof p.runId === 'string' ? p.runId : null,
        sessionKey: typeof p.sessionKey === 'string' ? p.sessionKey : null,
        stream: typeof p.stream === 'string' ? p.stream : null,
        data: p.data ?? null,
        ts: typeof p.ts === 'number' ? p.ts : null,
        isHeartbeat: Boolean(p.isHeartbeat)
      };
      if (this.deliverySuspended) {
        this.suspendedEvents.push(evt);
        return;
      }
      this.agentEventHandler?.(evt);
      return;
    }
    // chat / sessions.changed / session.message families are not consumed by
    // the current design — ignored without error (spec Stage 4).
  }

  private handleResponse(frame: any) {
    const request = this.pending.get(frame.id);
    if (!request) return;
    if (!request.resolved) {
      request.resolved = true;
      clearTimeout(request.timer);
      if (frame.ok) {
        request.resolve(frame.payload);
      } else {
        request.reject(new Error(frame.error?.message ?? `gateway call failed: ${request.method}`));
      }
      // Two-stage response (`agent` method, research T8): keep the entry so
      // the terminal res frame on the same request id can be forwarded as the
      // auxiliary completion signal. Everything else is done with its id.
      if (!(request.method === 'agent' && request.runId)) {
        this.pending.delete(frame.id);
      }
      return;
    }
    // Second res frame on an already-resolved `agent` request: the terminal
    // result ({status:"ok"|"error", summary, result}) — forward to the
    // watcher, same idempotent handling as a lifecycle end event.
    this.pending.delete(frame.id);
    if (request.runId) {
      const status = frame.ok && frame.payload?.status !== 'error' ? 'ok' : 'error';
      this.agentFinalHandler?.({ runId: request.runId, status, summary: frame.payload?.summary });
    }
  }

  private async authenticate(socket: WebSocket, nonce: string | undefined) {
    const params = this.buildConnectParams(nonce);
    const hello = await this.sendRequest(socket, 'connect', params, { timeoutMs: this.rpcTimeoutMs });
    if (this.socket !== socket) return; // superseded connection
    this.connected = true;
    this.backoffMultiple = 1;
    this.reconnectAttempt = 0;
    this.options.eventWriter?.emit(EVENT_CODES.LINK_CONNECTED, {
      server_version: (hello as any)?.server?.version ?? (hello as any)?.version ?? null,
      protocol: (hello as any)?.protocol ?? null
    });

    // Belt-and-braces subscriptions (research T4): agent/chat broadcast to
    // operator connections is observed default behavior, not contract.
    void this.sendRequest(socket, 'sessions.subscribe', {}, { timeoutMs: this.rpcTimeoutMs }).catch(() => {});
    if (this.options.sessionKeysProvider) {
      try {
        const keys = await this.options.sessionKeysProvider();
        for (const key of keys) {
          void this.sendRequest(socket, 'sessions.messages.subscribe', { key }, { timeoutMs: this.rpcTimeoutMs }).catch(() => {});
        }
      } catch { /* subscription sugar only — never fatal */ }
    }

    this.startLiveness();

    // Signal the worker BEFORE resuming event delivery so the bulk reconcile
    // runs first; events fired while disconnected are gone by design and the
    // reconcile is what absorbs them.
    this.deliverySuspended = true;
    try {
      await this.connectedHandler?.();
    } finally {
      this.deliverySuspended = false;
      const queued = this.suspendedEvents;
      this.suspendedEvents = [];
      for (const evt of queued) this.agentEventHandler?.(evt);
    }
  }

  private sendRequest(
    socket: WebSocket,
    method: string,
    params: Record<string, unknown>,
    opts: { timeoutMs?: number; runId?: string } = {}
  ): Promise<unknown> {
    const id = crypto.randomUUID();
    const timeoutMs = opts.timeoutMs ?? this.rpcTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway timeout during ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer, resolved: false, runId: opts.runId });
      try {
        socket.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const backoff = this.reconnectBackoffMs * this.backoffMultiple;
    this.backoffMultiple = Math.min(this.backoffMultiple * 2, RECONNECT_BACKOFF_MAX_MULTIPLE);
    this.reconnectAttempt += 1;
    this.options.eventWriter?.emit(EVENT_CODES.LINK_RECONNECT_ATTEMPT, {
      attempt: this.reconnectAttempt,
      backoff_ms: backoff
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial();
    }, backoff);
  }

  private startLiveness() {
    this.stopLiveness();
    if (this.livenessTimeoutMs <= 0) return;
    this.lastAliveAt = Date.now();
    this.livenessTimer = setInterval(() => {
      if (Date.now() - this.lastAliveAt > this.livenessTimeoutMs) {
        // Dead link: no health/tick within the horizon — close and re-dial.
        const socket = this.socket;
        if (socket) {
          try { socket.terminate(); } catch { try { socket.close(); } catch { /* drop path */ } }
        }
      }
    }, this.livenessCheckIntervalMs);
    this.livenessTimer.unref?.();
  }

  private stopLiveness() {
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.livenessTimer = null;
  }

  private rejectAllPending(err: Error) {
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      if (!request.resolved) request.reject(err);
    }
    this.pending.clear();
  }

  private buildConnectParams(nonce?: string) {
    const clientVersion = this.options.clientVersion ?? '0.1.0';
    const clientPlatform = this.options.clientPlatform ?? process.platform;
    const deviceFamily = this.options.deviceFamily ?? 'wakery';
    const params: Record<string, unknown> = {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: 'gateway-client',
        version: clientVersion,
        platform: clientPlatform,
        deviceFamily,
        mode: 'backend'
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: { token: this.gatewayToken }
    };

    if (this.options.identityStore && nonce) {
      const identity = this.options.identityStore.loadOrCreate();
      params.device = createGatewayDeviceAuth(identity, {
        nonce,
        token: this.gatewayToken,
        clientId: 'gateway-client',
        clientMode: 'backend',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        platform: clientPlatform,
        deviceFamily
      });
    }

    return params;
  }
}

function normalizeGatewayUrl(url: string) {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  return `ws://${url}`;
}
