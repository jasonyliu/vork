import { z } from 'zod';

const taskRelationsSchema = z.object({
  parent: z.object({ task_id: z.string().min(1) }).optional(),
  children: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative()
  }).optional()
});

export const wakeRequestSchema = z.object({
  request_id: z.string().min(1),
  source: z.string().min(1),
  project_id: z.string().min(1),
  project_name: z.string().optional(),
  task_id: z.string().min(1),
  task_type: z.string().min(1),
  task_title: z.string().optional(),
  task_priority: z.number().int().optional(),
  task_status: z.string().min(1),
  task_status_expected: z.string().min(1).optional(),
  task_audit: z.string().min(1),
  task_audit_expected: z.string().min(1).optional(),
  task_labels: z.array(z.string()).optional(),
  task_relations: taskRelationsSchema.optional(),
  task_branch: z.string().min(1).optional(),
  task_payload: z.unknown().optional(),
  assignee_id: z.string().min(1).optional(),
  assignee_name: z.string().min(1).optional(),
  owner_id: z.string().min(1).optional(),
  owner_name: z.string().min(1).optional(),
  timestamp: z.number().int()
}).refine((value) => Boolean(value.assignee_id || value.assignee_name), {
  message: 'assignee_id or assignee_name is required',
  path: ['assignee_id']
});
