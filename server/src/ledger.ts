import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  LEDGER_DIR_NAME,
  LEDGER_FILE_NAME,
  LEDGER_MAX_FILE_BYTES,
  SERVER_JSON_DIR,
} from '../../core/src/constants.js';
import type { AgentStateStore } from './agentStateStore.js';

/**
 * The M0 ledger: an append-only, line-delimited event log. Everything the
 * office shows the user becomes a ledger event first; views are derivations
 * of the log, never the other way around ("if the event didn't happen, the
 * frame doesn't render"). Corrections are new events — nothing is mutated or
 * deleted.
 *
 * Storage: `~/.pixel-agents/ledger/events.jsonl`, one JSON object per line,
 * rotated to `events-<ts>.jsonl` when it crosses LEDGER_MAX_FILE_BYTES.
 * Append is synchronous (event volume is single-digit per second; the write
 * is tiny); batching/WAL is a known later optimization, not a v0 one.
 */

export interface LedgerEvent {
  /** Monotonic-ish unique id: evt_<base36 ts>_<base36 seq>. */
  id: string;
  /** Process-local sequence; total order within one server run. */
  seq: number;
  /** Wall-clock ISO timestamp. */
  ts: string;
  /** Event class — mirrors the broadcast message type, plus lifecycle
   *  types the bus does not carry (agent.added / agent.removed). */
  type: string;
  /** `agent:<id>` for agent-attributed events, `system` otherwise. */
  actor?: string;
  /** The full wire payload of the event (message body without `type`). */
  payload?: Record<string, unknown>;
  /** Ids of events this one answers. Mandatory once coordination lands
   *  (M1+); recorded but not yet enforced by producers in M0. */
  causedBy?: string[];
}

export interface LedgerAppendInput {
  type: string;
  actor?: string;
  payload?: Record<string, unknown>;
  causedBy?: string[];
}

export class Ledger {
  private readonly dirPath: string;
  private readonly filePath: string;
  private seq = 0;
  private bytesWritten = 0;
  private lastEventId: string | null = null;

  constructor(dirPath = defaultLedgerDir()) {
    this.dirPath = dirPath;
    this.filePath = path.join(dirPath, LEDGER_FILE_NAME);
    fs.mkdirSync(this.dirPath, { recursive: true, mode: 0o700 });
    try {
      this.bytesWritten = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
    } catch {
      this.bytesWritten = 0;
    }
  }

  /** The file the log currently appends to (after rotation this changes). */
  get activeFile(): string {
    return this.filePath;
  }

  /** Id of the last appended event — default `causedBy` anchor for
   *  follow-up events in the same flow when no better parent is known. */
  get lastId(): string | null {
    return this.lastEventId;
  }

  append(input: LedgerAppendInput): LedgerEvent {
    const now = Date.now();
    const event: LedgerEvent = {
      id: `evt_${now.toString(36)}_${(this.seq++).toString(36)}`,
      seq: this.seq - 1,
      ts: new Date(now).toISOString(),
      type: input.type,
      actor: input.actor ?? 'system',
      payload: input.payload,
      causedBy: input.causedBy,
    };
    const line = JSON.stringify(event) + '\n';
    if (this.bytesWritten > 0 && this.bytesWritten + line.length > LEDGER_MAX_FILE_BYTES) {
      this.rotate();
    }
    fs.appendFileSync(this.filePath, line, 'utf-8');
    this.bytesWritten += line.length;
    this.lastEventId = event.id;
    return event;
  }

  /** Last n events, oldest first. Malformed lines are skipped, never fatal. */
  tail(n = 100): LedgerEvent[] {
    if (n <= 0) return [];
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const out: LedgerEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LedgerEvent);
      } catch {
        /* truncated tail line (crash mid-append) — skip */
      }
    }
    return out.slice(-n);
  }

  /** Read the whole log oldest-first across rotated segments. */
  readAll(): LedgerEvent[] {
    const files = fs
      .readdirSync(this.dirPath)
      .filter((f) => f.startsWith('events') && f.endsWith('.jsonl'))
      .sort();
    const events: LedgerEvent[] = [];
    for (const f of files) {
      const raw = fs.readFileSync(path.join(this.dirPath, f), 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as LedgerEvent);
        } catch {
          /* skip malformed */
        }
      }
    }
    return events;
  }

  private rotate(): void {
    const stamp = Date.now().toString(36);
    fs.renameSync(this.filePath, path.join(this.dirPath, `events-${stamp}.jsonl`));
    this.bytesWritten = 0;
  }
}

export function defaultLedgerDir(): string {
  return path.join(os.homedir(), SERVER_JSON_DIR, LEDGER_DIR_NAME);
}

/** Actor label for a broadcast payload carrying a numeric agent id. */
function actorOf(message: Record<string, unknown>): string {
  return typeof message.id === 'number' ? `agent:${message.id}` : 'system';
}

/**
 * Wire a store into a ledger: every broadcast and every lifecycle transition
 * is recorded. The office keeps working exactly as before — the ledger is a
 * pure observer in M0; views flip to reading FROM it in later milestones.
 */
export function attachLedger(store: AgentStateStore, ledger: Ledger): void {
  store.on('broadcast', (message: Record<string, unknown>) => {
    const { type, ...payload } = message;
    ledger.append({ type: String(type), actor: actorOf(message), payload });
  });
  store.on('agentAdded', (id: number) => {
    ledger.append({ type: 'agent.added', actor: `agent:${id}` });
  });
  store.on('agentRemoved', (id: number) => {
    ledger.append({
      type: 'agent.removed',
      actor: `agent:${id}`,
      causedBy: ledger.lastId ? [ledger.lastId] : undefined,
    });
  });
}

// ── Replay / rebuild ───────────────────────────────────────────

export interface RebuiltTool {
  toolId: string;
  toolName?: string;
  status: string;
  detail?: string;
  startedAt: string;
}

/** The state of one agent as derived purely from the event log — the proof
 *  that the ledger is a complete record: replaying it must reproduce what
 *  the live store shows. */
export interface RebuiltAgentState {
  agentId: number;
  added: boolean;
  removed: boolean;
  status?: 'active' | 'waiting';
  model?: string;
  cwd?: string;
  folderName?: string;
  toolsStarted: number;
  activeTools: Map<string, RebuiltTool>;
}

export function rebuildAgentStates(events: Iterable<LedgerEvent>): Map<number, RebuiltAgentState> {
  const states = new Map<number, RebuiltAgentState>();
  const touch = (id: number): RebuiltAgentState => {
    let s = states.get(id);
    if (!s) {
      s = {
        agentId: id,
        added: false,
        removed: false,
        toolsStarted: 0,
        activeTools: new Map(),
      };
      states.set(id, s);
    }
    return s;
  };

  for (const e of events) {
    const agentId =
      e.actor && e.actor.startsWith('agent:') ? Number(e.actor.slice('agent:'.length)) : NaN;
    if (!Number.isInteger(agentId)) continue;
    const s = touch(agentId);
    const p = e.payload ?? {};
    switch (e.type) {
      case 'agent.added':
        s.added = true;
        break;
      case 'agent.removed':
        s.removed = true;
        break;
      case 'agentCreated':
        s.added = true;
        if (typeof p.cwd === 'string') s.cwd = p.cwd;
        if (typeof p.folderName === 'string') s.folderName = p.folderName;
        break;
      case 'agentClosed':
        s.removed = true;
        break;
      case 'agentStatus':
        if (p.status === 'active' || p.status === 'waiting') s.status = p.status;
        break;
      case 'agentModel':
        if (typeof p.model === 'string') s.model = p.model;
        break;
      case 'agentToolStart':
        if (typeof p.toolId === 'string') {
          s.toolsStarted++;
          s.activeTools.set(p.toolId, {
            toolId: p.toolId,
            toolName: typeof p.toolName === 'string' ? p.toolName : undefined,
            status: typeof p.status === 'string' ? p.status : '',
            detail: typeof p.detail === 'string' ? p.detail : undefined,
            startedAt: e.ts,
          });
        }
        break;
      case 'agentToolDone':
        if (typeof p.toolId === 'string') s.activeTools.delete(p.toolId);
        break;
      case 'agentToolsClear':
        s.activeTools.clear();
        break;
    }
  }
  return states;
}
