import { githubError } from '../errors.js';
import type { InceptionTaskRecord } from '../events.js';
import type { FieldInfo, GitHubApi } from './api.js';

// The start acts (`spec_foundry.md §Rulesets, Inception Task, inception lane`,
// `§Kickoff`): both are direct Stage Task creation, one shape, taken only under
// `--conducted`. The creator token is the design — the issue author is the
// task owner, so the token that creates the issue decides the conduction
// outcome. Every Stage Task is born visible to conduction: assigned to the AI
// Lead (`DELIVERY.md §Inception`: Owner the Principal, Assignee the AI Lead;
// the sweep treats an unassigned issue as parked) and followed by the creation
// comment whose delivery mints the owner-lane wake at once
// (`spec_foundry-interface.md §Stage Task creation`). An open Task left
// half-made by an interrupted run is converged, never duplicated: placement,
// fields, lane, and comment are each ensured idempotently. Kept separable
// from the closed-ended bootstrap core (the extraction seam).

export const INCEPTION_LANE = 'feature/inception/charter';

function optionId(field: FieldInfo, optionName: string): string {
  const option = field.options.find((candidate) => candidate.name === optionName);
  if (!option) throw githubError(`board field ${field.name} missing option ${optionName}`);
  return option.id;
}

// The canonical Task-body shape every Stage Task creator follows
// (`spec_foundry-interface.md §Task body`).
export function taskBody(sections: { type: string; scope: string; primarySpecification: string; definitiveDeliverable: string }): string {
  return [
    '## Type',
    sections.type,
    '',
    '## Scope',
    sections.scope,
    '',
    '## Primary Specification',
    sections.primarySpecification,
    '',
    '## Definitive Deliverable',
    sections.definitiveDeliverable,
    ''
  ].join('\n');
}

// The creation comment: canonical paired form with both sides the creation
// state. The adapter accepts a `To:` equal to the observed state, so this
// delivery mints the `Init/Gated` owner-lane wake; `Init → Todo` stays the
// Owner's act. State words stay out of the prose (parser rule).
export const CREATION_COMMENT_HEAD = 'Transition\nFrom: Init (Audit: Gated)\nTo: Init (Audit: Gated)\n';

export function creationComment(actor: string, command: 'bootstrap' | 'kickoff'): string {
  return `${CREATION_COMMENT_HEAD}Actor: ${actor}\nReason: Stage Task created by foundry ${command}.\n`;
}

interface PlacementInput {
  api: GitHubApi;
  ownerLogin: string;
  projectKey: string;
  boardId: string;
  statusField: FieldInfo;
  auditField: FieldInfo;
  issue: { number: number; nodeId: string };
  actor: string;
  command: 'bootstrap' | 'kickoff';
}

// Board placement at Init/Gated and the creation comment, each idempotent:
// addProjectV2ItemById returns the existing item for an issue already on the
// board; setting a field to its current value is a no-op; the comment is
// posted only when no creation comment exists yet.
async function ensurePlacementAndComment(input: PlacementInput): Promise<{ comment: 'posted' | 'skipped' }> {
  const itemId = await input.api.addIssueToBoard(input.boardId, input.issue.nodeId);
  await input.api.setBoardItemField(input.boardId, itemId, input.statusField.id, optionId(input.statusField, 'Init'));
  await input.api.setBoardItemField(input.boardId, itemId, input.auditField.id, optionId(input.auditField, 'Gated'));
  const comments = await input.api.listIssueComments(input.ownerLogin, input.projectKey, input.issue.number);
  if (comments.some((body) => body.startsWith(CREATION_COMMENT_HEAD))) return { comment: 'skipped' };
  await input.api.createIssueComment(input.ownerLogin, input.projectKey, input.issue.number, creationComment(input.actor, input.command));
  return { comment: 'posted' };
}

export interface InceptionContext {
  api: GitHubApi; // the owner PAT client — the act is the Principal's
  ownerLogin: string;
  aiLeadLogin: string; // the assignee
  projectKey: string;
  projectName: string;
  boardId: string;
  statusField: FieldInfo;
  auditField: FieldInfo;
  repoNodeId: string;
  headSha: string; // the scaffold commit — the lane's starting oid
}

// Create the Inception Stage Task under the owner PAT and its lane through the
// Task (`createLinkedBranch` — Branch↔Task binding from birth). Idempotency: an
// open `type:project_inception` issue → converge (placement, fields, lane,
// comment ensured), record its number; a closed one with no open successor →
// drift for the operator (a re-run does not resurrect Inception).
export async function createInceptionTask(ctx: InceptionContext): Promise<InceptionTaskRecord> {
  const placement = { api: ctx.api, ownerLogin: ctx.ownerLogin, projectKey: ctx.projectKey, boardId: ctx.boardId, statusField: ctx.statusField, auditField: ctx.auditField, actor: `Principal (${ctx.ownerLogin})`, command: 'bootstrap' as const };
  const open = await ctx.api.findOpenIssueByTypeLabel(ctx.ownerLogin, ctx.projectKey, 'type:project_inception');
  if (open) {
    const lanes = await ctx.api.linkedBranchNames(open.nodeId);
    if (!lanes.includes(INCEPTION_LANE)) await ctx.api.createLinkedBranch(ctx.repoNodeId, open.nodeId, INCEPTION_LANE, ctx.headSha);
    const { comment } = await ensurePlacementAndComment({ ...placement, issue: open });
    return { resource: 'inception_task', issue_number: open.number, node_id: open.nodeId, linked_branch: INCEPTION_LANE, created_or_skipped: 'converged', assignee: ctx.aiLeadLogin, creation_comment: comment };
  }
  const closed = await ctx.api.findClosedIssueByTypeLabel(ctx.ownerLogin, ctx.projectKey, 'type:project_inception');
  if (closed) {
    return {
      resource: 'inception_task',
      issue_number: closed.number,
      node_id: closed.nodeId,
      linked_branch: null,
      created_or_skipped: 'skipped',
      drift: `inception task #${closed.number} is closed with no open successor — not resurrected`
    };
  }
  const issue = await ctx.api.createIssue(
    ctx.ownerLogin,
    ctx.projectKey,
    `Project Inception — ${ctx.projectName}`,
    taskBody({
      type: 'project_inception',
      scope: `Stand the Project up: author the Charter from the founding bundle, settle provisioning and team topology. Founding surfaces: the input bundle (recorded sanitized in the bootstrap's run events), channel \`${ctx.projectKey}\`, the platform registry row this bootstrap wrote, and the run event log in foundry's var.`,
      primarySpecification: 'PROJECT.md',
      definitiveDeliverable: 'main/docs/charter.md'
    }),
    ['type:project_inception', 'agent:owner'],
    [ctx.aiLeadLogin]
  );
  await ctx.api.createLinkedBranch(ctx.repoNodeId, issue.nodeId, INCEPTION_LANE, ctx.headSha);
  const { comment } = await ensurePlacementAndComment({ ...placement, issue });
  return {
    resource: 'inception_task',
    issue_number: issue.number,
    node_id: issue.nodeId,
    linked_branch: INCEPTION_LANE,
    created_or_skipped: 'created',
    assignee: ctx.aiLeadLogin,
    creation_comment: comment
  };
}

export interface KickoffContext {
  api: GitHubApi; // the project manager's client — author = owner decides the lane
  ownerLogin: string; // the repo owner (the Principal's account)
  aiLeadLogin: string; // the assignee
  projectKey: string;
  milestoneFolder: string; // milestone_v<YYYY.MM.DD>_<slug>
  title: string;
  note?: string;
}

export interface KickoffResult {
  issueNumber: number;
  existing: boolean;
}

// `foundry kickoff --conducted`: create the Draft Stage Task under the project
// manager's identity, assigned to the AI Lead, with its creation comment; the
// delivery reaches ingress, the owner-lane wake lands the turn on him. An
// existing open `type:project_draft` issue is reported instead of duplicated
// — the one-active-milestone invariant enforced at the source — with its
// placement and comment converged.
export async function kickoff(ctx: KickoffContext): Promise<KickoffResult> {
  const boards = await ctx.api.listRepoBoards(ctx.ownerLogin, ctx.projectKey);
  if (boards.length !== 1) {
    throw githubError(`repo ${ctx.ownerLogin}/${ctx.projectKey} links ${boards.length} boards — expected exactly 1`);
  }
  const board = boards[0]!;
  const fields = await ctx.api.listBoardFields(board.id);
  const statusField = fields.find((field) => field.name === 'Status');
  const auditField = fields.find((field) => field.name === 'Audit');
  if (!statusField || !auditField) throw githubError(`board ${board.title} missing canonical Status/Audit fields`);
  const placement = { api: ctx.api, ownerLogin: ctx.ownerLogin, projectKey: ctx.projectKey, boardId: board.id, statusField, auditField, actor: 'Owner (Sarge)', command: 'kickoff' as const };

  const open = await ctx.api.findOpenIssueByTypeLabel(ctx.ownerLogin, ctx.projectKey, 'type:project_draft');
  if (open) {
    await ensurePlacementAndComment({ ...placement, issue: open });
    return { issueNumber: open.number, existing: true };
  }

  const scope = [
    `Open milestone \`${ctx.milestoneFolder}\` (${ctx.title}): settle the direction with the Principal and author \`docs/milestones/${ctx.milestoneFolder}/milestone.md\`.`,
    ...(ctx.note ? ['', `Settling pointer: ${ctx.note}`] : [])
  ].join('\n');
  const issue = await ctx.api.createIssue(
    ctx.ownerLogin,
    ctx.projectKey,
    `Project Draft — ${ctx.title}`,
    taskBody({
      type: 'project_draft',
      scope,
      primarySpecification: 'The current Charter and PROJECT.md',
      definitiveDeliverable: `docs/milestones/${ctx.milestoneFolder}/milestone.md`
    }),
    ['type:project_draft', 'agent:owner'],
    [ctx.aiLeadLogin]
  );
  await ensurePlacementAndComment({ ...placement, issue });
  return { issueNumber: issue.number, existing: false };
}
