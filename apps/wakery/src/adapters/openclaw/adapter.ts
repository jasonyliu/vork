import { EVENT_CODES, STALL_ALARM_LABEL } from '../../events/codes.js';
import type { EventWriter } from '../../events/writer.js';
import type { RoutedWake, Route, Wake } from '../../shared/types.js';
import type { RewakeRenderContext } from '../../templates/renderer.js';
import { renderWakeryRunSessionKey } from './run-session.js';

// Stage 3 of the Wakery (spec_wakery-openclaw-adapter.md): transport and
// translation only. The adapter holds no durable state and writes neither
// ledger — the dispatch worker owns every consequent write. Sends ride the
// persistent gateway link; a send failure throws to the worker (which
// completes the lease `send_failed` and leaves the wake queued) — the adapter
// performs no retries, no buffering, and no state writes.

// Narrow renderer surface — satisfied by the full Renderer class or a test stub.
export interface AdapterRenderer {
  render(wake: Wake, route: Route): string | Promise<string>;
  renderRewake(wake: Wake, route: Route, ctx: RewakeRenderContext): string | Promise<string>;
  renderGovernNotice(wake: Wake, route: Route): string | Promise<string>;
  renderCapAlert(wake: Wake, route: Route, ctx: RewakeRenderContext): string | Promise<string>;
  renderStallNotice(wake: Wake, route: Route): string | Promise<string>;
}

// The link surface the adapter needs: one multiplexed RPC over the standing
// socket. Satisfied by GatewayLink or a test stub.
export interface LinkSender {
  call(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number; runId?: string }): Promise<unknown>;
}

export class OpenClawAdapter {
  constructor(
    private readonly link: LinkSender,
    private readonly eventWriter: EventWriter,
    private readonly renderer: AdapterRenderer
  ) {}

  /**
   * Render one turn message per the Stage 4 template-selection precedence
   * (spec_wakery-dispatch-worker.md): the stall-alarm label → the stall-notice
   * message (the synthetic wake exists only for that turn); `task_audit='Govern'`
   * → the govern-notice message (spec_wakery-govern-notice-message.md);
   * `rewake.capAlert` → the cap-alert message (self-healing F2b); else the
   * wake message (first dispatch) or the re-wake message (`rewake` context
   * present). Rendering happens BEFORE the lease exists, so a render failure
   * here has persisted nothing: emit the render-failure events and re-throw
   * for the worker to park the wake (E7).
   */
  async renderTurn(wake: Wake, route: Route, rewake?: RewakeRenderContext): Promise<string> {
    const isStall = wake.task_labels?.includes(STALL_ALARM_LABEL) ?? false;
    const isGovern = !isStall && wake.task_audit === 'Govern';
    const isCapAlert = !isStall && !isGovern && rewake?.capAlert === true;
    const templateName = isStall ? 'stall-notice-message' : isGovern ? 'govern-notice-message' : isCapAlert ? 'cap-alert-message' : rewake ? 'rewake-message' : 'wake-message';
    try {
      if (isStall) return await this.renderer.renderStallNotice(wake, route);
      if (isGovern) return await this.renderer.renderGovernNotice(wake, route);
      if (isCapAlert) return await this.renderer.renderCapAlert(wake, route, rewake!);
      return rewake
        ? await this.renderer.renderRewake(wake, route, rewake)
        : await this.renderer.render(wake, route);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.eventWriter.emit(EVENT_CODES.TEMPLATE_RENDER_FAILED, {
        wake_id: wake.id,
        template_name: templateName,
        error: errorMessage
      });
      this.eventWriter.emit(EVENT_CODES.DISPATCH_FAILED, {
        wake_id: wake.id,
        route_id: route.id,
        actor: route.actor,
        reason: 'render_failed',
        error: errorMessage
      });
      throw err;
    }
  }

  /**
   * Deliver one rendered message as one gateway run whose identity wakery
   * chose: every send carries `idempotencyKey = lease.id`, which the gateway
   * adopts as the run's runId (verified for both methods — research T2/T8).
   * Resolves on the gateway's acceptance; turn completion arrives through the
   * event stream, never on the send path. Throws on failure — the worker owns
   * the `send_failed` lease completion.
   */
  async send(routedWake: RoutedWake, message: string): Promise<void> {
    const { wake, route, lease } = routedWake;
    this.eventWriter.emit(EVENT_CODES.DISPATCH_ATTEMPTED, {
      wake_id: wake.id,
      route_id: route.id,
      wake_route_lease_id: lease.id,
      actor: route.actor
    });

    try {
      if (route.delivery === 'session') {
        if (!route.session_key) throw new Error('missing route.session_key for session delivery');
        await this.link.call('chat.send', {
          sessionKey: route.session_key,
          message,
          idempotencyKey: lease.id
        }, { runId: lease.id });
        this.emitSent(routedWake, 'sent to existing session');
        return;
      }
      if (route.delivery === 'run') {
        if (!route.agent_id) throw new Error('missing route.agent_id for run delivery');
        if (!route.session_key) throw new Error('missing route.session_key template for run delivery');
        await this.link.call('agent', {
          sessionKey: renderWakeryRunSessionKey(route.session_key, lease.id),
          message,
          idempotencyKey: lease.id,
          deliver: false
        }, { runId: lease.id });
        this.emitSent(routedWake, 'sent through one-shot run session');
        return;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.eventWriter.emit(EVENT_CODES.DISPATCH_FAILED, {
        wake_id: wake.id,
        route_id: route.id,
        wake_route_lease_id: lease.id,
        actor: route.actor,
        reason: /link down/i.test(errorMessage) ? 'link_down' : /timeout/i.test(errorMessage) ? 'timeout' : 'send_failed',
        error: errorMessage
      });
      throw err;
    }

    // Neither session nor run: a persistent-session path is unauthorized in MVP.
    this.eventWriter.emit(EVENT_CODES.DISPATCH_BLOCKED, {
      wake_id: wake.id,
      route_id: route.id,
      actor: route.actor,
      message: 'unauthorized persistent delivery'
    });
    throw new Error('unauthorized persistent delivery path');
  }

  private emitSent(routedWake: RoutedWake, message: string) {
    this.eventWriter.emit(EVENT_CODES.DISPATCH_SENT, {
      wake_id: routedWake.wake.id,
      route_id: routedWake.route.id,
      wake_route_lease_id: routedWake.lease.id,
      actor: routedWake.route.actor,
      message
    });
  }
}
