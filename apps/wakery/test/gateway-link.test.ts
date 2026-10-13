// The gateway link (spec_wakery-openclaw-adapter.md): one persistent
// authenticated socket, RPC multiplexing, event intake, two-stage agent
// response, agent.wait, reconnect. Tested against a loopback WebSocketServer
// (the established pattern from the retired per-call client's tests — no
// external network is touched).
import { afterEach, describe, expect, test } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { GatewayLink, type AgentEvent } from '../src/adapters/openclaw/link.js';
import { FileGatewayDeviceIdentityStore } from '../src/adapters/openclaw/device-auth.js';
import { EventWriter } from '../src/events/writer.js';
import { createTempDir } from './helpers.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface TestServer {
  url: string;
  frames: any[];
  sockets: WebSocket[];
  close(): Promise<void>;
  send(frame: unknown): void;
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startGatewayServer(
  onRequest?: (frame: any, socket: WebSocket) => boolean | void
): Promise<TestServer> {
  const frames: any[] = [];
  const sockets: WebSocket[] = [];
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'nonce', ts: Date.now() } }));
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      if (onRequest?.(frame, socket)) return; // custom handler consumed it
      if (frame.method === 'connect') {
        socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { type: 'hello-ok', protocol: 4, server: { version: 'test' } } }));
        return;
      }
      if (frame.method === 'sessions.subscribe' || frame.method === 'sessions.messages.subscribe') {
        socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
        return;
      }
      if (frame.method === 'chat.send') {
        socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { runId: frame.params.idempotencyKey, status: 'started' } }));
        return;
      }
      socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { message: `Unexpected method: ${frame.method}` } }));
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind ws test server');
  const ts: TestServer = {
    url: `ws://127.0.0.1:${address.port}`,
    frames,
    sockets,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) { try { s.terminate(); } catch { /* closing */ } }
      server.close(() => resolve());
    }),
    send: (frame) => sockets[sockets.length - 1]?.send(JSON.stringify(frame))
  };
  cleanups.push(() => ts.close());
  return ts;
}

function makeLink(url: string, extra: ConstructorParameters<typeof GatewayLink>[2] = {}) {
  const link = new GatewayLink(url, 'token-123', {
    identityStore: new FileGatewayDeviceIdentityStore(createTempDir('wakery-device-')),
    reconnectBackoffMs: 30,
    livenessTimeoutMs: 0,
    ...extra
  });
  cleanups.push(() => link.stop());
  return link;
}

async function connectedLink(server: TestServer, extra: ConstructorParameters<typeof GatewayLink>[2] = {}) {
  const link = makeLink(server.url, extra);
  const connected = new Promise<void>((resolve) => link.onConnected(() => resolve()));
  link.start();
  await connected;
  return link;
}

function until<T>(predicate: () => T | undefined | null | false, capMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const value = predicate();
      if (value) { clearInterval(timer); resolve(value as T); }
      else if (Date.now() - start > capMs) { clearInterval(timer); reject(new Error('until timed out')); }
    }, 5);
  });
}

describe('GatewayLink', () => {
  test('authenticates with the challenge->connect handshake (operator role, device signature) and issues sessions.subscribe', async () => {
    const server = await startGatewayServer();
    await connectedLink(server, { sessionKeysProvider: async () => ['agent:main:proj:main'] });

    await until(() => server.frames.length >= 3);
    const connect = server.frames.find((f) => f.method === 'connect');
    expect(connect.params).toMatchObject({
      minProtocol: 4,
      maxProtocol: 4,
      client: { id: 'gateway-client', mode: 'backend', deviceFamily: 'wakery' },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: { token: 'token-123' },
      device: { nonce: 'nonce' }
    });
    expect(connect.params.device.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    const subscribed = await until(() => server.frames.find((f) => f.method === 'sessions.subscribe'));
    expect(subscribed).toBeTruthy();
    const messagesSub = await until(() => server.frames.find((f) => f.method === 'sessions.messages.subscribe'));
    expect(messagesSub.params).toEqual({ key: 'agent:main:proj:main' });
  });

  test('RPCs multiplex over the standing socket; a second call reuses the same connection', async () => {
    const server = await startGatewayServer();
    const link = await connectedLink(server);

    const first = await link.call('chat.send', { sessionKey: 'k', message: 'a', idempotencyKey: 'lease-1' });
    const second = await link.call('chat.send', { sessionKey: 'k', message: 'b', idempotencyKey: 'lease-2' });
    expect((first as any).runId).toBe('lease-1');
    expect((second as any).runId).toBe('lease-2');
    expect(server.sockets).toHaveLength(1); // one connection for the process's life
  });

  test('agent-family events stream to the watcher as {runId, sessionKey, stream, data} — unfiltered by policy', async () => {
    const server = await startGatewayServer();
    const events: AgentEvent[] = [];
    const link = await connectedLink(server);
    link.onAgentEvent((evt) => events.push(evt));

    server.send({ type: 'event', event: 'agent', payload: { runId: 'run-1', sessionKey: 'sess', stream: 'lifecycle', data: { phase: 'end', endedAt: 5 }, seq: 3, ts: 4, isHeartbeat: false } });
    server.send({ type: 'event', event: 'agent', payload: { runId: 'run-1', sessionKey: 'sess', stream: 'assistant', data: {}, isHeartbeat: true } });
    server.send({ type: 'event', event: 'chat', payload: { state: 'final' } }); // not consumed
    server.send({ type: 'event', event: 'health', payload: {} });

    await until(() => events.length >= 2);
    expect(events[0]).toMatchObject({ runId: 'run-1', stream: 'lifecycle', data: { phase: 'end' } });
    expect(events[1]).toMatchObject({ stream: 'assistant', isHeartbeat: true });
    expect(events).toHaveLength(2);
  });

  test('the agent method resolves on the accepted ack; the second same-id res frame arrives as the auxiliary final signal', async () => {
    const server = await startGatewayServer((frame, socket) => {
      if (frame.method === 'agent') {
        socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { runId: frame.params.idempotencyKey, sessionKey: frame.params.sessionKey, status: 'accepted', acceptedAt: Date.now() } }));
        setTimeout(() => {
          socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { status: 'ok', summary: 'completed' } }));
        }, 20);
        return true;
      }
    });
    const finals: Array<{ runId: string; status: string }> = [];
    const link = await connectedLink(server);
    link.onAgentFinal((signal) => finals.push(signal));

    const ack = await link.call('agent', { sessionKey: 'agent:a:run:lease-9', message: 'm', idempotencyKey: 'lease-9', deliver: false }, { runId: 'lease-9' });
    expect((ack as any).status).toBe('accepted');
    expect(finals).toHaveLength(0); // send resolved before the terminal frame

    await until(() => finals.length >= 1);
    expect(finals[0]).toMatchObject({ runId: 'lease-9', status: 'ok' });
  });

  test('agent.wait returns the verdict verbatim; RPC failure maps to unavailable, never an error verdict', async () => {
    const server = await startGatewayServer((frame, socket) => {
      if (frame.method === 'agent.wait') {
        const runId = frame.params.runId;
        const payload = runId === 'run-done'
          ? { status: 'ok', endedAt: 123 }
          : { status: 'timeout', timeoutPhase: 'queue', providerStarted: false };
        socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload }));
        return true;
      }
    });
    const link = await connectedLink(server);

    expect(await link.wait('run-done')).toMatchObject({ status: 'ok', endedAt: 123 });
    expect(await link.wait('run-unknown')).toMatchObject({ status: 'timeout', timeoutPhase: 'queue', providerStarted: false });

    link.stop();
    expect(await link.wait('run-after-stop')).toMatchObject({ status: 'unavailable' });
  });

  test('sends fail fast when the link is down — the adapter never queues', async () => {
    const link = makeLink('ws://127.0.0.1:1');
    await expect(link.call('chat.send', { sessionKey: 'k', message: 'm', idempotencyKey: 'x' })).rejects.toThrow(/link down/i);
  });

  test('on drop: disconnect signaled, reconnect with backoff, and the connected handler runs BEFORE buffered events are delivered', async () => {
    const eventDir = createTempDir();
    const server = await startGatewayServer();
    const order: string[] = [];
    const link = makeLink(server.url, { eventWriter: new EventWriter(eventDir) });
    link.onAgentEvent((evt) => order.push(`event:${evt.runId}`));
    link.onConnected(async () => {
      order.push('connected');
      // An event arriving while the (reconcile) handler runs must be buffered
      // until the handler completes — reconcile runs against gateway truth first.
      server.send({ type: 'event', event: 'agent', payload: { runId: 'mid-reconcile', stream: 'lifecycle', data: { phase: 'end' } } });
      await new Promise((r) => setTimeout(r, 30));
      order.push('reconcile-done');
    });
    link.start();
    await until(() => order.includes('reconcile-done') && order.length >= 3);
    expect(order).toEqual(['connected', 'reconcile-done', 'event:mid-reconcile']);

    // Drop the connection: the link re-dials and re-authenticates by itself.
    server.sockets[0]!.terminate();
    await until(() => order.filter((o) => o === 'reconcile-done').length >= 2, 5000);
    expect(server.sockets.length).toBeGreaterThanOrEqual(2);

    const events = readdirSync(eventDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
      readFileSync(join(eventDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    );
    expect(events.some((e) => e.event_code === 3005)).toBe(true); // link.connected
    expect(events.some((e) => e.event_code === 3006)).toBe(true); // link.disconnected
    expect(events.some((e) => e.event_code === 3007)).toBe(true); // link.reconnect.attempt
  });
});
