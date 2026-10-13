import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mintId } from '../shared/ids.js';

export class EventWriter {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  emit(event: { code: number; name: string; severity: string }, fields: Record<string, unknown> = {}) {
    const timestamp = Date.now();
    const file = join(this.directory, `wakery-${new Date(timestamp).toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, `${JSON.stringify({
      event_id: mintId('evt'),
      event_code: event.code,
      event_name: event.name,
      event_type: 'wakery',
      severity: event.severity,
      timestamp,
      ...fields
    })}\n`);
  }
}
