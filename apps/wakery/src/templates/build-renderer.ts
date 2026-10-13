import type { AppConfig } from '../config/env.js';
import type { EventWriter } from '../events/writer.js';
import { GithubAgentRepository } from '../db/github-agent-repository.js';
import { GithubRepoProjectRepository } from '../db/github-repo-project-repository.js';
import { ProjectRepository } from '../db/project-repository.js';
import type { Pool } from 'pg';
import { TemplateStore } from './store.js';
import { Renderer, type RepoProjectView } from './renderer.js';
import type { WakeMessageTemplate, RewakeMessageTemplate, GovernNoticeMessageTemplate, CapAlertMessageTemplate, StallNoticeMessageTemplate } from './validator.js';

// Boots the template store (loads every templates/*.json — wake, rewake,
// govern-notice, cap-alert, stall-notice — validates each, registers fs.watch) and
// constructs a Renderer wired with DB-backed fetchers. Used by main.ts and
// tooling so each long-running wakery entry point gets a fully-wired
// renderer + store.
export async function buildRendererAndStore(
  pool: Pool,
  config: AppConfig,
  eventWriter: EventWriter
): Promise<{ renderer: Renderer; store: TemplateStore }> {
  const store = new TemplateStore(config.WAKERY_TEMPLATE_DIR, eventWriter);
  await store.start();
  const wakeTemplate = store.getTemplate('wake-message') as WakeMessageTemplate;
  const rewakeTemplate = store.getTemplate('rewake-message') as RewakeMessageTemplate;
  const governNoticeTemplate = store.getTemplate('govern-notice-message') as GovernNoticeMessageTemplate;
  const capAlertTemplate = store.getTemplate('cap-alert-message') as CapAlertMessageTemplate;
  const stallNoticeTemplate = store.getTemplate('stall-notice-message') as StallNoticeMessageTemplate;

  const agentRepo = new GithubAgentRepository(pool);
  const repoProjectRepo = new GithubRepoProjectRepository(pool);
  const projectRepo = new ProjectRepository(pool);

  const renderer = new Renderer({
    template: wakeTemplate,
    rewakeTemplate,
    governNoticeTemplate,
    capAlertTemplate,
    stallNoticeTemplate,
    fetchAgent: async (_wake, route) => agentRepo.findByAgentId(route.agent_id),
    fetchRepoProject: async (wake) => {
      const rp = await repoProjectRepo.findByProjectId(wake.project_id);
      if (!rp) return null;
      // the homespace derives from the registry slug (platform identity),
      // never the GitHub repo name
      const project = await projectRepo.findById(rp.project_id);
      if (!project) return null;
      return { ...rp, project_slug: project.project } satisfies RepoProjectView;
    },
    projectStoragePath: config.WAKERY_PROJECT_STORAGE_PATH
  });

  return { renderer, store };
}
