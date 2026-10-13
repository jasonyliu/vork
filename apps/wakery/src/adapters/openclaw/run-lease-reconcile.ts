import type { RunSessionSummary } from './run-session.js';

export function shouldCompleteRunLease(summary: Pick<RunSessionSummary, 'exists' | 'assistantMessageCount'>) {
  return summary.exists && summary.assistantMessageCount > 0;
}
