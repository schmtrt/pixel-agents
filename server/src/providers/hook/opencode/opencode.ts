import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';
import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../../constants.js';
import { CONSENT_DISCLOSURE, CONSENT_INSTALL_HEADLINE } from './consentCopy.js';
import { OPENCODE_TERMINAL_NAME_PREFIX } from './constants.js';
import {
  areHooksInstalled as installerAreHooksInstalled,
  installHooks as installerInstallHooks,
  uninstallHooks as installerUninstallHooks,
} from './opencodePluginInstaller.js';

// ── formatToolStatus ──
//
// opencode tool names are lower-case (read, write, edit, bash, ...). The
// returned string is what appears above the character and what the webview
// reverse-maps for animation: reading tools get the "reading" frame pair,
// everything else types.

export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'read':
      return `Reading ${base(inp.filePath) || base(inp.path)}`;
    case 'write':
      return `Writing ${base(inp.filePath)}`;
    case 'edit': {
      const target = base(inp.filePath);
      return target ? `Editing ${target}` : 'Editing file';
    }
    case 'bash': {
      const cmd = (inp.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'glob':
      return 'Searching files';
    case 'grep':
      return 'Searching code';
    case 'webfetch':
      return 'Fetching web content';
    case 'websearch':
      return 'Searching the web';
    case 'task': {
      const desc = typeof inp.description === 'string' ? inp.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'question':
      return 'Waiting for your answer';
    case 'skill':
      return 'Loading skill';
    case 'todowrite':
      return 'Updating todos';
    default:
      return `Using ${toolName}`;
  }
}

// ── normalizeHookEvent: the single OpenCode-specific normalization boundary ──
//
// The plugin (hooks/opencode-plugin.ts) POSTs a small, provider-defined payload
// shape. All of its fields are read HERE and HERE ONLY; downstream
// (hookEventHandler.ts) sees only the normalized AgentEvent union.
//
// OpenCode has no Claude-style JSONL transcript, so this is a hooks-only
// provider: sessionStart carries no transcriptPath, which the runtime already
// treats as first-class (all state from hooks).

function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  const eventName = raw.hook_event_name;
  const sessionId = raw.session_id;
  if (typeof eventName !== 'string' || typeof sessionId !== 'string') return null;

  switch (eventName) {
    case 'SessionStart':
      return {
        sessionId,
        event: {
          kind: 'sessionStart',
          source: 'opencode',
          transcriptPath: undefined,
          cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        },
      };

    case 'SessionEnd':
      return {
        sessionId,
        event: {
          kind: 'sessionEnd',
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        },
      };

    case 'ToolStart': {
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : '';
      const toolInput =
        typeof raw.tool_input === 'object' && raw.tool_input !== null
          ? (raw.tool_input as Record<string, unknown>)
          : {};
      return {
        sessionId,
        event: {
          kind: 'toolStart',
          toolId: `hook-opencode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          toolName,
          input: toolInput,
          runInBackground: false,
        },
      };
    }

    case 'ToolEnd':
      // The handler correlates via its own currentHookToolId state (the plugin
      // emits ToolStart/ToolEnd pairs; the real opencode callID is not needed).
      return { sessionId, event: { kind: 'toolEnd', toolId: 'current' } };

    case 'TurnEnd':
      // session.idle = the agent finished its turn and is waiting for input.
      return {
        sessionId,
        event: {
          kind: 'turnEnd',
          awaitingInput: raw.awaiting_input === true,
          model: typeof raw.model === 'string' && raw.model ? raw.model : undefined,
        },
      };

    case 'PermissionRequest':
      return { sessionId, event: { kind: 'permissionRequest' } };

    default:
      return null;
  }
}

// ── Installer wrappers: adapt sync signatures to the async interface ──

async function installHooks(_serverUrl: string, _authToken: string): Promise<void> {
  await installerInstallHooks();
}

async function uninstallHooks(): Promise<void> {
  await installerUninstallHooks();
}

function areHooksInstalled(): Promise<boolean> {
  return Promise.resolve(installerAreHooksInstalled());
}

function consentDisclosure(): { headline: string; disclosure: string } {
  return { headline: CONSENT_INSTALL_HEADLINE, disclosure: CONSENT_DISCLOSURE };
}

// ── The provider ──
//
// Hooks-only: no getSessionDirs / getAllSessionRoots / sessionFilePattern /
// parseTranscriptLine / buildLaunchCommand — opencode keeps no per-session
// files a scanner could adopt.

export const opencodeProvider: HookProvider = {
  kind: 'hook',
  id: 'opencode',
  displayName: 'OpenCode',
  protocolVersion: 1,
  hooksOnly: true,

  normalizeHookEvent,

  installHooks,
  uninstallHooks,
  areHooksInstalled,
  consentDisclosure,

  formatToolStatus,
  // task spawns a sub-agent; question is the agent asking THE user (not a
  // permission gate) — same semantics as Claude's Task/AskUserQuestion.
  permissionExemptTools: new Set(['task', 'question', 'todowrite']),
  subagentToolNames: new Set(['task']),
  readingTools: new Set(['read', 'grep', 'glob', 'webfetch', 'websearch', 'lsp']),
  terminalNamePrefix: OPENCODE_TERMINAL_NAME_PREFIX,
};
