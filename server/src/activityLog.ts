import { ACTIVITY_LOG_MAX_ENTRIES, TOOL_DETAIL_MAX_LENGTH } from '../../core/src/constants.js';
import type { AgentActivityLogEntry, AgentState } from './types.js';

/**
 * Build the fuller human-readable rendering of a raw tool input for the
 * details popup's terminal feed. Unlike formatToolStatus (a short overlay
 * line) this keeps the full command / file path / description, capped only
 * by TOOL_DETAIL_MAX_LENGTH. Tool names are matched case-insensitively so
 * one helper serves Claude (Bash/Read/...) and OpenCode (bash/read/...).
 */
export function buildToolDetail(toolName: string, input?: unknown): string | undefined {
  const inp = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  switch (toolName.toLowerCase()) {
    case 'bash':
      return str(inp.command);
    case 'read':
    case 'write':
    case 'edit':
      return str(inp.file_path) ?? str(inp.filePath) ?? str(inp.path);
    case 'task':
    case 'agent':
      return str(inp.description) ?? str(inp.prompt);
    case 'glob':
      return str(inp.pattern);
    case 'grep':
      return str(inp.pattern);
    case 'webfetch':
      return str(inp.url);
    default: {
      if (Object.keys(inp).length === 0) return undefined;
      try {
        return JSON.stringify(inp);
      } catch {
        return undefined;
      }
    }
  }
}

/** Cap the detail string for the wire (the UI wraps, it does not truncate). */
export function clipToolDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const oneLine = detail.replace(/\s*\n+\s*/g, ' ↵ ');
  return oneLine.length > TOOL_DETAIL_MAX_LENGTH
    ? oneLine.slice(0, TOOL_DETAIL_MAX_LENGTH) + '…'
    : oneLine;
}

/**
 * Append a tool-start entry to the agent's bounded activity ring buffer.
 * Re-broadcasts of the same live toolId update in place instead of
 * duplicating (activity resends and shadow-store translations reuse ids).
 */
export function pushActivityEntry(
  agent: AgentState,
  entry: { toolId: string; toolName?: string; status: string; detail?: string },
): void {
  const log = (agent.activityLog ??= []);
  const existing = log.find((e) => e.toolId === entry.toolId && !e.done);
  if (existing) {
    existing.status = entry.status;
    existing.detail = entry.detail ?? existing.detail;
    existing.toolName = entry.toolName ?? existing.toolName;
    return;
  }
  log.push({ ...entry, done: false, ts: Date.now() } as AgentActivityLogEntry);
  if (log.length > ACTIVITY_LOG_MAX_ENTRIES) {
    log.splice(0, log.length - ACTIVITY_LOG_MAX_ENTRIES);
  }
}

/** Mark an activity entry done; keeps the feed truthful after toolEnd. */
export function markActivityDone(agent: AgentState, toolId: string): void {
  const entry = agent.activityLog?.find((e) => e.toolId === toolId && !e.done);
  if (entry) entry.done = true;
}
