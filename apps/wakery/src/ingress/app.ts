import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { EventWriter } from '../events/writer.js';
import { wakeRequestSchema } from '../shared/schema.js';
import { WakeRepository } from '../db/wake-repository.js';
import { GithubAgentRepository } from '../db/github-agent-repository.js';
import { GithubRepoProjectRepository } from '../db/github-repo-project-repository.js';
import { TaskTypeLabelRepository } from '../db/task-type-label-repository.js';
import { IngressService } from './service.js';
import { EVENT_CODES } from '../events/codes.js';
import { verifyGitHubSignature, buildWakeRequestFromComment } from '../adapters/github/adapter.js';
import { GitHubTaskRelationsRefresher } from '../adapters/github/task-relations-refresher.js';
import { handleIssueDependenciesEvent, handleIssuesEvent, handleSubIssuesEvent } from '../adapters/github/webhook-handlers.js';
import { stubSnoozeIntake, type SnoozeIntake } from '../snooze/intake.js';

export function buildServer({ pool, eventWriter, githubSecret, githubToken, snoozeIntake }: {
  pool: Pool;
  eventWriter: EventWriter;
  githubSecret?: string;
  githubToken?: string;
  // The snooze module's intake surface; defaults to the acknowledging stub
  // when the module is not wired (spec_wakery-snooze.md Stage 1).
  snoozeIntake?: SnoozeIntake;
}) {
  const app = Fastify();
  const githubAgentRepo = new GithubAgentRepository(pool);
  const githubRepoProjectRepo = new GithubRepoProjectRepository(pool);
  const taskTypeLabelRepo = new TaskTypeLabelRepository(pool);
  const wakeRepo = new WakeRepository(pool);
  const ingress = new IngressService(wakeRepo, githubAgentRepo, eventWriter);
  const taskRelationsRefresher = new GitHubTaskRelationsRefresher(
    githubToken ?? '',
    githubRepoProjectRepo,
    wakeRepo,
    eventWriter
  );

  app.post('/wake', async (request, reply) => {
    const parsed = wakeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      eventWriter.emit(EVENT_CODES.REQUEST_REJECTED, { message: parsed.error.message, payload: parsed.error.flatten() });
      return reply.code(400).send({ request_id: (request.body as any)?.request_id ?? 'unknown', status: 'rejected', message: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }

    const result = await ingress.handleWakeRequest(parsed.data);
    return reply.code(result.status === 'updated' || result.status === 'dropped' ? 200 : 202).send(result);
  });

  app.post('/adapters/github/webhook', async (request, reply) => {
    const raw = JSON.stringify(request.body ?? {});
    const signature = String(request.headers['x-hub-signature-256'] ?? '');
    if (!verifyGitHubSignature(raw, signature, githubSecret ?? '')) {
      return reply.code(401).send({ status: 'rejected', message: 'Invalid GitHub signature' });
    }
    const event = String(request.headers['x-github-event'] ?? '');
    if (event === 'ping') {
      return reply.code(200).send({ status: 'ok', message: 'pong' });
    }

    const payload = request.body as any;
    const action = String(payload?.action ?? '');

    // `issues` (closed/reopened) and `sub_issues` events trigger task_relations
    // refreshes on the affected parent/child wakes; they never produce new
    // WakeRequests.
    if (event === 'issues') {
      const result = await handleIssuesEvent(payload, action, {
        githubToken: githubToken ?? '',
        githubRepoProjectRepo,
        refresher: taskRelationsRefresher,
        wakeRepo,
        eventWriter
      });
      return reply.code(200).send(result);
    }
    if (event === 'sub_issues') {
      const result = await handleSubIssuesEvent(payload, action, {
        githubToken: githubToken ?? '',
        githubRepoProjectRepo,
        refresher: taskRelationsRefresher
      });
      return reply.code(200).send(result);
    }
    if (event === 'issue_dependencies') {
      const result = await handleIssueDependenciesEvent(payload, action, {
        githubToken: githubToken ?? '',
        githubRepoProjectRepo,
        refresher: taskRelationsRefresher
      });
      return reply.code(200).send(result);
    }

    // `pull_request` and `workflow_run` are snooze source events — routed to
    // the snooze worker's intake surface (spec_wakery-snooze-worker.md Stage 1),
    // never to the wake path. `check_suite` is not routed: its only
    // repo-webhook-deliverable action is `completed` (scope #16) and the
    // subscription drops it at the v2026.07.27.r2 deploy.
    if (event === 'pull_request' || event === 'workflow_run') {
      const result = await (snoozeIntake ?? stubSnoozeIntake).handleEvent(event, payload);
      return reply.code(200).send(result);
    }

    if (event !== 'issue_comment') {
      return reply.code(200).send({ status: 'ignored', message: `unsupported event: ${event}` });
    }

    const result = await buildWakeRequestFromComment(
      request.headers['x-github-delivery'] as string | undefined,
      payload,
      { githubToken: githubToken ?? '', githubAgentRepo, githubRepoProjectRepo, taskTypeLabelRepo, eventWriter, wakeStateReader: wakeRepo }
    );

    if ('ignored' in result) {
      eventWriter.emit(EVENT_CODES.REQUEST_DROPPED_INELIGIBLE, {
        message: result.ignored,
        source: 'github',
        // The PR-origin comment guard sets reason: 'pull_request_comment'
        // (spec_wakery-github-adapter.md Stage 2) so the drop is greppable.
        ...(result.reason ? { reason: result.reason } : {})
      });
      return reply.code(200).send({ status: 'ignored', message: result.ignored });
    }

    const wakeResult = await ingress.handleWakeRequest(result.wakeRequest);
    return reply.code(wakeResult.status === 'updated' || wakeResult.status === 'dropped' ? 200 : 202).send(wakeResult);
  });

  return app;
}
