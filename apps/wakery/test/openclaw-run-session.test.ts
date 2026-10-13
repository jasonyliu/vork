import { describe, expect, test } from 'vitest';
import { renderWakeryRunSessionKey, summarizeSessionTranscript } from '../src/adapters/openclaw/run-session.js';

describe('Wakery run session helpers', () => {
  test('renders deterministic run session keys from the stored template', () => {
    expect(renderWakeryRunSessionKey('agent:main:sample_project:run:[wake_route_lease_id]', 'lease-123')).toBe('agent:main:sample_project:run:lease-123');
  });

  test('summarizes user and assistant messages from a transcript', () => {
    const summary = summarizeSessionTranscript([
      JSON.stringify({ type: 'session', id: 'sess-1' }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Wakery dispatch' }] } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Started work' }] } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Progress update' }] } })
    ]);

    expect(summary.exists).toBe(true);
    expect(summary.userMessage).toContain('Wakery dispatch');
    expect(summary.lastAssistantMessage).toContain('Progress update');
    expect(summary.assistantMessageCount).toBe(2);
  });

  test('returns empty summary for missing transcript', () => {
    const summary = summarizeSessionTranscript([]);
    expect(summary.exists).toBe(false);
    expect(summary.assistantMessageCount).toBe(0);
    expect(summary.lastAssistantMessage).toBeNull();
  });
});
