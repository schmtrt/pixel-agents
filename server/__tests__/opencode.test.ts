import { describe, expect, it } from 'vitest';

import { CONSENT_INSTALL_HEADLINE } from '../src/providers/hook/opencode/consentCopy.js';
import { formatToolStatus, opencodeProvider } from '../src/providers/hook/opencode/opencode.js';

describe('opencodeProvider', () => {
  it('has the right identity', () => {
    expect(opencodeProvider.kind).toBe('hook');
    expect(opencodeProvider.id).toBe('opencode');
    expect(opencodeProvider.displayName).toBe('OpenCode');
    expect(opencodeProvider.protocolVersion).toBe(1);
  });

  it('exposes the expected tool taxonomies', () => {
    expect(opencodeProvider.subagentToolNames.has('task')).toBe(true);
    expect(opencodeProvider.readingTools.has('read')).toBe(true);
    expect(opencodeProvider.readingTools.has('grep')).toBe(true);
    expect(opencodeProvider.readingTools.has('glob')).toBe(true);
    expect(opencodeProvider.readingTools.has('edit')).toBe(false);
    expect(opencodeProvider.readingTools.has('bash')).toBe(false);
  });

  it('is a hooks-only provider (no file fallback)', () => {
    expect(opencodeProvider.getSessionDirs).toBeUndefined();
    expect(opencodeProvider.getAllSessionRoots).toBeUndefined();
    expect(opencodeProvider.sessionFilePattern).toBeUndefined();
    expect(opencodeProvider.parseTranscriptLine).toBeUndefined();
    expect(opencodeProvider.team).toBeUndefined();
  });

  describe('normalizeHookEvent', () => {
    it('normalizes SessionStart with cwd and no transcript path', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'SessionStart',
        session_id: 'ses_1',
        cwd: '/home/user/project',
        source: 'opencode',
      });
      expect(result?.sessionId).toBe('ses_1');
      expect(result?.event).toEqual({
        kind: 'sessionStart',
        source: 'opencode',
        transcriptPath: undefined,
        cwd: '/home/user/project',
      });
    });

    it('normalizes SessionEnd', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'SessionEnd',
        session_id: 'ses_1',
        reason: 'deleted',
      });
      expect(result?.event).toEqual({ kind: 'sessionEnd', reason: 'deleted' });
    });

    it('normalizes ToolStart with tool_name + tool_input', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'ToolStart',
        session_id: 'ses_1',
        tool_name: 'bash',
        tool_input: { command: 'ls -la' },
        tool_call_id: 'call_abc',
      });
      expect(result?.sessionId).toBe('ses_1');
      const event = result?.event;
      expect(event?.kind).toBe('toolStart');
      if (event?.kind === 'toolStart') {
        expect(event.toolName).toBe('bash');
        expect(event.input).toEqual({ command: 'ls -la' });
        expect(typeof event.toolId).toBe('string');
      }
    });

    it('normalizes ToolEnd to the current-tool sentinel', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'ToolEnd',
        session_id: 'ses_1',
        tool_call_id: 'call_abc',
      });
      expect(result?.event).toEqual({ kind: 'toolEnd', toolId: 'current' });
    });

    it('normalizes TurnEnd with awaitingInput from session.idle', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'TurnEnd',
        session_id: 'ses_1',
        awaiting_input: true,
      });
      expect(result?.event).toEqual({ kind: 'turnEnd', awaitingInput: true });
    });

    it('passes the model through on TurnEnd so the office can badge it', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'TurnEnd',
        session_id: 'ses_1',
        awaiting_input: true,
        model: 'qwen-vllm/RadixArk/Qwen3.8-27B',
      });
      expect(result?.event).toEqual({
        kind: 'turnEnd',
        awaitingInput: true,
        model: 'qwen-vllm/RadixArk/Qwen3.8-27B',
      });
    });

    it('leaves model absent on TurnEnd when the payload carries none', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'TurnEnd',
        session_id: 'ses_1',
      });
      expect((result?.event as { model?: string }).model).toBeUndefined();
    });

    it('normalizes PermissionRequest', () => {
      const result = opencodeProvider.normalizeHookEvent({
        hook_event_name: 'PermissionRequest',
        session_id: 'ses_1',
      });
      expect(result?.event).toEqual({ kind: 'permissionRequest' });
    });

    it('drops unknown event names', () => {
      expect(
        opencodeProvider.normalizeHookEvent({
          hook_event_name: 'SomethingElse',
          session_id: 'ses_1',
        }),
      ).toBeNull();
    });

    it('drops payloads without session_id or hook_event_name', () => {
      expect(opencodeProvider.normalizeHookEvent({ hook_event_name: 'TurnEnd' })).toBeNull();
      expect(opencodeProvider.normalizeHookEvent({ session_id: 'ses_1' })).toBeNull();
    });
  });

  describe('formatToolStatus', () => {
    it('formats read with the file basename', () => {
      expect(formatToolStatus('read', { filePath: '/home/user/project/src/a.ts' })).toBe(
        'Reading a.ts',
      );
    });

    it('formats write/edit with the file basename', () => {
      expect(formatToolStatus('write', { filePath: '/x/y.md' })).toBe('Writing y.md');
      expect(formatToolStatus('edit', { filePath: '/x/y.ts' })).toBe('Editing y.ts');
    });

    it('formats bash with a truncated command', () => {
      expect(formatToolStatus('bash', { command: 'ls -la' })).toBe('Running: ls -la');
      const long = 'a'.repeat(200);
      expect(formatToolStatus('bash', { command: long }).length).toBeLessThan(long.length);
    });

    it('formats search tools', () => {
      expect(formatToolStatus('glob')).toBe('Searching files');
      expect(formatToolStatus('grep')).toBe('Searching code');
      expect(formatToolStatus('webfetch')).toBe('Fetching web content');
      expect(formatToolStatus('websearch')).toBe('Searching the web');
    });

    it('formats task as a subtask', () => {
      expect(formatToolStatus('task', { description: 'Explore the codebase' })).toBe(
        'Subtask: Explore the codebase',
      );
      expect(formatToolStatus('task')).toBe('Running subtask');
    });

    it('falls back to Using <tool>', () => {
      expect(formatToolStatus('fancy')).toBe('Using fancy');
    });
  });

  describe('consent', () => {
    it('discloses the plugin path and the undo route', () => {
      const { headline, disclosure } = opencodeProvider.consentDisclosure();
      expect(headline).toBe(CONSENT_INSTALL_HEADLINE);
      expect(headline).toBe('OpenCode integration');
      expect(disclosure).toContain('~/.config/opencode/plugin/pixel-agents.js');
      expect(disclosure).toContain('127.0.0.1');
      expect(disclosure).toContain('Undo');
    });
  });
});
