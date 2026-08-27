/**
 * pixel-agents opencode plugin (bundled to dist/hooks/opencode-plugin.js).
 *
 * Runs INSIDE an opencode process. Forwards opencode's session/tool/permission
 * events to every live pixel-agents server discovered under
 * ~/.pixel-agents/servers/ (fallback: ~/.pixel-agents/server.json).
 *
 * Fail-quiet by design: every event path swallows its own errors. This plugin
 * must never break an opencode session — pixel-agents is a visualization,
 * not a dependency.
 *
 * The hook input/output shapes mirror opencode v1.x's Hooks type
 * (@opencode-ai/plugin) but are declared locally so this file bundles with
 * zero external dependencies.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

const PROVIDER_ID = 'opencode';
const HOOK_API_PREFIX = '/api/hooks';
const REQUEST_TIMEOUT_MS = 2000;

const SERVERS_REGISTRY_DIR = path.join(os.homedir(), '.pixel-agents', 'servers');
const LEGACY_SERVER_JSON = path.join(os.homedir(), '.pixel-agents', 'server.json');

interface PluginInput {
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
}

interface BusEvent {
  type: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SessionInfo {
  id?: string;
  directory?: string;
}

interface ToolBeforeInput {
  tool?: string;
  sessionID?: string;
  callID?: string;
}

interface ToolBeforeOutput {
  args?: unknown;
}

interface ToolAfterInput {
  tool?: string;
  sessionID?: string;
  callID?: string;
}

interface EventInput {
  event?: BusEvent;
}

interface PluginHooks {
  event?: (input: EventInput) => Promise<void>;
  'tool.execute.before'?: (input: ToolBeforeInput, output: ToolBeforeOutput) => Promise<void>;
  'tool.execute.after'?: (input: ToolAfterInput, output: unknown) => Promise<void>;
}

/** A registry entry is usable when its fields have the expected shape. */
function isServerConfig(entry: unknown): entry is { port: number; pid: number; token: string } {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.port === 'number' &&
    e.port >= 1 &&
    e.port <= 65535 &&
    typeof e.pid === 'number' &&
    e.pid > 0 &&
    typeof e.token === 'string' &&
    e.token.length > 0 &&
    e.protocol === 1
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readRegistry(): Array<{ port: number; pid: number; token: string }> {
  const targets: Array<{ port: number; pid: number; token: string }> = [];
  try {
    const files = fs.readdirSync(SERVERS_REGISTRY_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(SERVERS_REGISTRY_DIR, file), 'utf8'));
        if (isServerConfig(entry) && isProcessAlive(entry.pid)) targets.push(entry);
      } catch {
        /* skip malformed entries */
      }
    }
  } catch {
    /* registry dir missing — fall through to legacy file */
  }
  if (targets.length === 0) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_SERVER_JSON, 'utf8'));
      if (isServerConfig(legacy) && isProcessAlive(legacy.pid)) targets.push(legacy);
    } catch {
      /* no server reachable */
    }
  }
  return targets;
}

function postToServer(server: { port: number; token: string }, body: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: `${HOOK_API_PREFIX}/${PROVIDER_ID}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${server.token}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(undefined));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
    req.on('error', () => resolve(undefined));
    req.end(body);
  });
}

/** Fire-and-forget fan-out to every live server. Never throws. */
function emit(payload: Record<string, unknown>): void {
  try {
    const servers = readRegistry();
    if (servers.length === 0) return;
    const body = JSON.stringify(payload);
    Promise.all(servers.map((server) => postToServer(server, body))).catch(() => {});
  } catch {
    /* fail quiet */
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The opencode plugin itself: PluginInput → Hooks.
 */
const plugin = async (input?: PluginInput): Promise<PluginHooks> => {
  const cwd = input && typeof input.directory === 'string' ? input.directory : undefined;

  return {
    event: async ({ event }: EventInput): Promise<void> => {
      try {
        if (!isRecord(event)) return;
        const type = typeof event['type'] === 'string' ? event['type'] : '';
        const props = isRecord(event['properties']) ? event['properties'] : undefined;
        if (!props) return;

        if (type === 'session.created') {
          const info = isRecord(props['info']) ? (props['info'] as SessionInfo) : undefined;
          if (info && typeof info.id === 'string') {
            emit({
              session_id: info.id,
              hook_event_name: 'SessionStart',
              source: 'opencode',
              cwd: typeof info.directory === 'string' ? info.directory : cwd,
            });
          }
        } else if (type === 'session.idle' && typeof props['sessionID'] === 'string') {
          emit({
            session_id: props['sessionID'],
            hook_event_name: 'TurnEnd',
            awaiting_input: true,
          });
        } else if (type === 'session.deleted') {
          const info = isRecord(props['info']) ? (props['info'] as SessionInfo) : undefined;
          if (info && typeof info.id === 'string') {
            emit({
              session_id: info.id,
              hook_event_name: 'SessionEnd',
              reason: 'deleted',
            });
          }
        } else if (type === 'permission.updated' && typeof props['sessionID'] === 'string') {
          emit({
            session_id: props['sessionID'],
            hook_event_name: 'PermissionRequest',
          });
        }
      } catch {
        /* fail quiet */
      }
    },

    'tool.execute.before': async (i: ToolBeforeInput, o: ToolBeforeOutput): Promise<void> => {
      try {
        if (typeof i.sessionID !== 'string' || typeof i.tool !== 'string') return;
        emit({
          session_id: i.sessionID,
          hook_event_name: 'ToolStart',
          tool_name: i.tool,
          tool_input: isRecord(o.args) ? o.args : {},
          tool_call_id: typeof i.callID === 'string' ? i.callID : undefined,
        });
      } catch {
        /* fail quiet */
      }
    },

    'tool.execute.after': async (i: ToolAfterInput): Promise<void> => {
      try {
        if (typeof i.sessionID !== 'string') return;
        emit({
          session_id: i.sessionID,
          hook_event_name: 'ToolEnd',
          tool_call_id: typeof i.callID === 'string' ? i.callID : undefined,
        });
      } catch {
        /* fail quiet */
      }
    },
  };
};

/**
 * Default export is opencode's PluginModule shape ({ id, server }) — the
 * loader's readV1Plugin() resolves it before falling back to legacy exports.
 * Bundled as ESM (opencode runs on Bun, which detects ESM syntax in .js
 * regardless of the nearest package.json).
 */
export default { id: 'pixel-agents', server: plugin };
