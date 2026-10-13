import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunSessionSummary {
  exists: boolean;
  sessionKey?: string;
  sessionId?: string | null;
  sessionFile?: string | null;
  userMessage: string | null;
  lastAssistantMessage: string | null;
  assistantMessageCount: number;
}

export function renderWakeryRunSessionKey(sessionKeyTemplate: string, leaseId: string) {
  return sessionKeyTemplate.replaceAll('[wake_route_lease_id]', leaseId);
}

export function summarizeSessionTranscript(lines: string[]): RunSessionSummary {
  if (lines.length === 0) {
    return {
      exists: false,
      userMessage: null,
      lastAssistantMessage: null,
      assistantMessageCount: 0
    };
  }

  let sessionId: string | null = null;
  let userMessage: string | null = null;
  let lastAssistantMessage: string | null = null;
  let assistantMessageCount = 0;

  for (const line of lines) {
    const row = JSON.parse(line) as any;
    if (row.type === 'session' && typeof row.id === 'string') {
      sessionId = row.id;
      continue;
    }
    if (row.type !== 'message' || !row.message) continue;
    const text = flattenText(row.message.content);
    if (row.message.role === 'user' && userMessage == null) {
      userMessage = text;
    }
    if (row.message.role === 'assistant') {
      assistantMessageCount += 1;
      lastAssistantMessage = text;
    }
  }

  return {
    exists: true,
    sessionId,
    userMessage,
    lastAssistantMessage,
    assistantMessageCount
  };
}

export function inspectRunSession(sessionKeyOrAgentId: string, wakeIdOrLeaseId?: string, openclawHome = process.env.HOME ? join(process.env.HOME, '.openclaw') : '.openclaw'): RunSessionSummary {
  const sessionKey = wakeIdOrLeaseId == null
    ? sessionKeyOrAgentId
    : renderWakeryRunSessionKey(`agent:${sessionKeyOrAgentId}:wakery:run:[wake_route_lease_id]`, wakeIdOrLeaseId);

  const parts = sessionKey.split(':');
  const agentId = parts[1];
  const sessionsIndexPath = join(openclawHome, 'agents', agentId, 'sessions', 'sessions.json');
  if (!existsSync(sessionsIndexPath)) {
    return {
      exists: false,
      sessionKey,
      userMessage: null,
      lastAssistantMessage: null,
      assistantMessageCount: 0
    };
  }

  const sessionsIndex = JSON.parse(readFileSync(sessionsIndexPath, 'utf8')) as Record<string, { sessionId?: string }>;
  const sessionMeta = sessionsIndex[sessionKey];
  if (!sessionMeta?.sessionId) {
    return {
      exists: false,
      sessionKey,
      userMessage: null,
      lastAssistantMessage: null,
      assistantMessageCount: 0
    };
  }

  const sessionFile = join(openclawHome, 'agents', agentId, 'sessions', `${sessionMeta.sessionId}.jsonl`);
  if (!existsSync(sessionFile)) {
    return {
      exists: false,
      sessionKey,
      sessionId: sessionMeta.sessionId,
      sessionFile,
      userMessage: null,
      lastAssistantMessage: null,
      assistantMessageCount: 0
    };
  }

  const lines = readFileSync(sessionFile, 'utf8').trim().split('\n').filter(Boolean);
  const summary = summarizeSessionTranscript(lines);
  return {
    ...summary,
    exists: true,
    sessionKey,
    sessionId: sessionMeta.sessionId,
    sessionFile
  };
}

function flattenText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part: any) => (part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .trim();
}
