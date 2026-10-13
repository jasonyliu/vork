// @vork/data — the platform's data-layer module: the code home of
// specs/data/ the way apps own their process specs. Owns the schema lifecycle
// (structure migrations, canonical seed, the cutover window's data acts), the
// durable-identity key derivation, and the connection contract the lifecycle
// CLIs run under. Runtime DML stays app-local (wakery's repositories,
// resolver's queries) — this module is what changes the database's shape and
// canonical rows, for every app at once.

export { runMigrations, renameGithubRepoProjectToPlatformKeying, renameProjectRiskMappingProjectColumn, addProjectRiskMapping, addGithubRepoProjectProjectNumber, addLeaseTaskKey, migrateLeaseTurnSignal, createTaskTypeLabelTable, createSnoozeTable, createSnoozeTaskTypeTable } from './migrate.js';
export {
  runSeed,
  seedProjects,
  seedGithubAgents,
  seedRepoProjects,
  seedTaskTypeLabels,
  seedRiskMappings,
  seedRoutes,
  seedSnoozeTaskTypes,
  projectIdBySlug,
  PROJECT_SEED,
  GITHUB_AGENT_SEED,
  GITHUB_REPO_PROJECT_SEED,
  TASK_TYPE_LABEL_SEED,
  RISK_MAPPING_ROWS,
  RISK_MAPPING_WILDCARD_ROWS,
  RISK_MAPPING_OVERLAY_ROWS,
  ROUTE_SEED,
  PLATFORM_SPECIALISTS,
  SNOOZE_TASK_TYPE_SEED,
  SNOOZE_TYPE_CI,
  SNOOZE_TYPE_PR
} from './seed.js';
export type { SeedResult, ProjectSeed, GithubAgentSeed, RepoProjectSeed, TaskTypeLabelSeed, RiskMappingSeed, SnoozeTaskTypeSeed } from './seed.js';
export { routeTemplate, validateSpecialists, agentDisplayName, CREW, CREW_AGENTS, CREW_ROLE_LABEL, STAGE_TASK_TYPES, EXECUTION_TASK_TYPES, TASK_TYPES, LEASE_TOKEN } from './routes.js';
export type { RouteSeed, RouteActor, Specialist } from './routes.js';
export { cutoverPlatformKeying, LEGACY_BOARDS } from './cutover-platform-keying.js';
export type { CutoverReport, LegacyBoard } from './cutover-platform-keying.js';
export { md5, makeTaskKey, makeStateKey, mintId } from './ids.js';
export { loadDataDbConfig } from './env.js';
export type { DataDbConfig } from './env.js';
export { createDataPool } from './pool.js';
export type { Queryable } from './queryable.js';
