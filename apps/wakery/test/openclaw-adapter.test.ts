import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OpenClawAdapter, type AdapterRenderer, type LinkSender } from '../src/adapters/openclaw/adapter.js';
import { EventWriter } from '../src/events/writer.js';
import { RenderError } from '../src/templates/renderer.js';
import { createTempDir } from './helpers.js';
import type { RoutedWake } from '../src/shared/types.js';

// The adapter is transport and translation only (spec_wakery-openclaw-adapter.md):
// it renders through the shared renderer, sends over the standing link with
// idempotencyKey = lease.id, and writes neither ledger. These tests mock the
// link boundary — no sockets are opened.

function fixture(): RoutedWake {
  const now = Date.now();
  return {
    wake: {
      id: 'wake-1', project_id: 'proj-1', project_name: null, task_id: 'task-1', task_title: 'Task', task_status: 'Todo', task_status_expected: null, task_audit: 'Approved', task_audit_expected: null,
      task_key: 'tk-1', state_key: 'sk-1', task_priority: 1, task_labels: null, task_relations: null, task_branch: null, task_payload: null, task_type: 'implementation',
      assignee_id: 'agent-1', assignee_name: null, owner_id: null, owner_name: null,
      queue_attempts: 0, dispatch_attempts: 0, wake_attempts: 0, status: 'queued', create_time: now, update_time: now
    },
    route: {
      id: 'route-1', project_id: 'proj-1', task_type: 'implementation', actor: 'assignee',
      session_key: 'agent:main:proj:main', agent_id: 'agent-1', agent_name: 'Agent', delivery: 'session' as const, max_run: 1, status: 'active' as const,
      create_time: now, update_time: now
    },
    lease: {
      id: 'lease-1', route_id: 'route-1', wake_id: 'wake-1', wake_task_status: 'Todo', task_key: 'tk-1',
      activity_time: now, status: 'active' as const, create_time: now, update_time: now
    }
  };
}

function recordingLink(): { link: LinkSender; calls: Array<{ method: string; params: any; opts?: any }> } {
  const calls: Array<{ method: string; params: any; opts?: any }> = [];
  return {
    calls,
    link: {
      call: async (method, params, opts) => {
        calls.push({ method, params, opts });
        return { runId: params.idempotencyKey, status: 'accepted' };
      }
    }
  };
}

function stubRenderer(): AdapterRenderer {
  return {
    render: async () => 'WAKE-RENDERED',
    renderRewake: async () => 'REWAKE-RENDERED',
    renderGovernNotice: async () => 'GOVERN-RENDERED',
    renderCapAlert: async () => 'CAP-ALERT-RENDERED',
    renderStallNotice: async () => 'STALL-NOTICE-RENDERED'
  };
}

function readEventLog(dir: string): Array<Record<string, unknown>> {
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  );
}

describe('OpenClawAdapter', () => {
  test('session delivery sends chat.send with idempotencyKey = lease.id (the runId contract)', async () => {
    const { link, calls } = recordingLink();
    const adapter = new OpenClawAdapter(link, new EventWriter(createTempDir()), stubRenderer());
    const fx = fixture();

    await adapter.send(fx, 'MSG');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'chat.send',
      params: { sessionKey: 'agent:main:proj:main', message: 'MSG', idempotencyKey: 'lease-1' }
    });
  });

  test('run delivery sends the agent method into the rendered run-session key, idempotencyKey = lease.id, deliver:false', async () => {
    const { link, calls } = recordingLink();
    const adapter = new OpenClawAdapter(link, new EventWriter(createTempDir()), stubRenderer());
    const fx = fixture();
    fx.route.delivery = 'run';
    fx.route.session_key = 'agent:agent-1:proj:run:[wake_route_lease_id]';

    await adapter.send(fx, 'RUN-MSG');

    expect(calls[0]).toMatchObject({
      method: 'agent',
      params: {
        sessionKey: 'agent:agent-1:proj:run:lease-1',
        message: 'RUN-MSG',
        idempotencyKey: 'lease-1',
        deliver: false
      }
    });
  });

  test('renderTurn selects the template: no context renders the wake message, a rewake context the re-wake message', async () => {
    const { link } = recordingLink();
    const adapter = new OpenClawAdapter(link, new EventWriter(createTempDir()), stubRenderer());
    const fx = fixture();

    expect(await adapter.renderTurn(fx.wake, fx.route)).toBe('WAKE-RENDERED');
    expect(await adapter.renderTurn(fx.wake, fx.route, {
      wakeAttempts: 2, rewakeCap: 5, lastTurnMinutesAgo: 3, settledHolds: []
    })).toBe('REWAKE-RENDERED');
  });

  test("renderTurn: task_audit='Govern' selects the govern-notice message with precedence over both wake and re-wake", async () => {
    const { link } = recordingLink();
    const adapter = new OpenClawAdapter(link, new EventWriter(createTempDir()), stubRenderer());
    const fx = fixture();
    fx.wake.task_audit = 'Govern';

    expect(await adapter.renderTurn(fx.wake, fx.route)).toBe('GOVERN-RENDERED');
    // Precedence over the re-wake selection even if a rewake context is supplied.
    expect(await adapter.renderTurn(fx.wake, fx.route, {
      wakeAttempts: 2, rewakeCap: 5, lastTurnMinutesAgo: 3, settledHolds: []
    })).toBe('GOVERN-RENDERED');
  });

  test('a govern-notice render failure names the govern-notice-message template in the events', async () => {
    const { link } = recordingLink();
    const eventDir = createTempDir();
    const adapter = new OpenClawAdapter(link, new EventWriter(eventDir), {
      render: async () => 'x',
      renderRewake: async () => 'x',
      renderGovernNotice: async () => { throw new RenderError('wake-1', ['gate']); },
      renderCapAlert: async () => 'x',
      renderStallNotice: async () => 'x'
    });
    const fx = fixture();
    fx.wake.task_audit = 'Govern';

    await expect(adapter.renderTurn(fx.wake, fx.route)).rejects.toThrow(RenderError);
    expect(readEventLog(eventDir).find((e) => e.event_code === 5004)?.template_name).toBe('govern-notice-message');
  });

  test('render failure emits TEMPLATE_RENDER_FAILED + DISPATCH_FAILED(render_failed) and re-throws — nothing was persisted, nothing sent', async () => {
    const { link, calls } = recordingLink();
    const eventDir = createTempDir();
    const adapter = new OpenClawAdapter(link, new EventWriter(eventDir), {
      render: async () => { throw new RenderError('wake-1', ['agent_name']); },
      renderRewake: async () => 'x',
      renderGovernNotice: async () => 'x',
      renderCapAlert: async () => 'x',
      renderStallNotice: async () => 'x'
    });
    const fx = fixture();

    await expect(adapter.renderTurn(fx.wake, fx.route)).rejects.toThrow(RenderError);

    expect(calls).toHaveLength(0);
    const events = readEventLog(eventDir);
    expect(events.find((e) => e.event_code === 5004)?.template_name).toBe('wake-message');
    expect(events.find((e) => e.event_code === 3004)?.reason).toBe('render_failed');
  });

  test('a rewake render failure names the rewake-message template in the events', async () => {
    const { link } = recordingLink();
    const eventDir = createTempDir();
    const adapter = new OpenClawAdapter(link, new EventWriter(eventDir), {
      render: async () => 'x',
      renderRewake: async () => { throw new RenderError('wake-1', ['rewake-template']); },
      renderGovernNotice: async () => 'x',
      renderCapAlert: async () => 'x',
      renderStallNotice: async () => 'x'
    });
    const fx = fixture();

    await expect(adapter.renderTurn(fx.wake, fx.route, {
      wakeAttempts: 2, rewakeCap: 5, lastTurnMinutesAgo: 3, settledHolds: []
    })).rejects.toThrow(RenderError);
    expect(readEventLog(eventDir).find((e) => e.event_code === 5004)?.template_name).toBe('rewake-message');
  });

  test('send failure (link down) throws to the worker and emits DISPATCH_FAILED with reason link_down — no retries, no buffering', async () => {
    const eventDir = createTempDir();
    const adapter = new OpenClawAdapter({
      call: async () => { throw new Error('gateway link down: cannot send chat.send'); }
    }, new EventWriter(eventDir), stubRenderer());

    await expect(adapter.send(fixture(), 'MSG')).rejects.toThrow(/link down/i);

    const failed = readEventLog(eventDir).find((e) => e.event_code === 3004);
    expect(failed?.reason).toBe('link_down');
  });

  test('send success emits DISPATCH_SENT carrying the lease id (= runId)', async () => {
    const { link } = recordingLink();
    const eventDir = createTempDir();
    const adapter = new OpenClawAdapter(link, new EventWriter(eventDir), stubRenderer());

    await adapter.send(fixture(), 'MSG');

    const sent = readEventLog(eventDir).find((e) => e.event_code === 3003);
    expect(sent?.wake_route_lease_id).toBe('lease-1');
  });

  test('an unauthorized persistent delivery path is blocked', async () => {
    const { link, calls } = recordingLink();
    const eventDir = createTempDir();
    const adapter = new OpenClawAdapter(link, new EventWriter(eventDir), stubRenderer());
    const fx = fixture();
    (fx.route as any).delivery = 'persistent';

    await expect(adapter.send(fx as any, 'MSG')).rejects.toThrow(/unauthorized/i);
    expect(calls).toHaveLength(0);
    expect(readEventLog(eventDir).some((e) => e.event_code === 3002)).toBe(true);
  });

  test('missing session_key on session delivery fails the send (thrown to the worker)', async () => {
    const { link } = recordingLink();
    const adapter = new OpenClawAdapter(link, new EventWriter(createTempDir()), stubRenderer());
    const fx = fixture();
    fx.route.session_key = null;

    await expect(adapter.send(fx, 'MSG')).rejects.toThrow(/session_key/i);
  });
});
