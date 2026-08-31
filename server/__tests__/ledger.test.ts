import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { attachLedger, Ledger, rebuildAgentStates } from '../src/ledger.js';

describe('Ledger', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends events as append-only JSONL and tails them oldest-first', () => {
    const ledger = new Ledger(dir);
    ledger.append({ type: 'agent.added', actor: 'agent:1' });
    ledger.append({ type: 'agentToolStart', actor: 'agent:1', payload: { toolId: 't1' } });

    const events = ledger.tail(10);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('agent.added');
    expect(events[1].payload).toEqual({ toolId: 't1' });
    expect(events[1].seq).toBe(1);
    expect(new Date(events[1].ts).getTime()).toBeGreaterThan(0);

    const raw = fs.readFileSync(ledger.activeFile, 'utf-8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('tail returns the last n events, oldest first', () => {
    const ledger = new Ledger(dir);
    for (let i = 0; i < 5; i++) ledger.append({ type: `evt${i}` });
    const last2 = ledger.tail(2);
    expect(last2.map((e) => e.type)).toEqual(['evt3', 'evt4']);
    expect(ledger.tail(0)).toEqual([]);
  });

  it('skips malformed lines instead of failing (crash-truncated tail)', () => {
    const ledger = new Ledger(dir);
    ledger.append({ type: 'ok' });
    fs.appendFileSync(ledger.activeFile, '{"broken":tru\n');
    const events = ledger.tail(10);
    expect(events.map((e) => e.type)).toEqual(['ok']);
  });

  it('ids are unique and carry a monotonic seq', () => {
    const ledger = new Ledger(dir);
    const a = ledger.append({ type: 'x' });
    const b = ledger.append({ type: 'x' });
    expect(a.id).not.toBe(b.id);
    expect(b.seq).toBe(a.seq + 1);
  });

  it('records causedBy links', () => {
    const ledger = new Ledger(dir);
    const first = ledger.append({ type: 'decision' });
    const second = ledger.append({ type: 'gate', causedBy: [first.id] });
    expect(second.causedBy).toEqual([first.id]);
    expect(ledger.tail(1)[0].causedBy).toEqual([first.id]);
  });
});

describe('attachLedger', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-attach-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records broadcasts and lifecycle transitions', () => {
    const store = new AgentStateStore();
    const ledger = new Ledger(dir);
    attachLedger(store, ledger);

    store.broadcast({ type: 'agentStatus', id: 7, status: 'active' });
    store.set(1, { id: 1, sessionId: 's1' } as never);
    store.delete(1);

    const types = ledger.tail(10).map((e) => `${e.type}/${e.actor}`);
    expect(types).toContain('agentStatus/agent:7');
    expect(types).toContain('agent.added/agent:1');
    expect(types).toContain('agent.removed/agent:1');
    // broadcast payload carries the message body without the type field
    const statusEvt = ledger.tail(10).find((e) => e.type === 'agentStatus');
    expect(statusEvt?.payload).toEqual({ id: 7, status: 'active' });
    store.dispose();
  });
});

describe('rebuildAgentStates', () => {
  it('derives active tools, status and model purely from the event log', () => {
    const events = [
      {
        id: 'e1',
        seq: 0,
        ts: '2026-01-01T00:00:00.000Z',
        type: 'agentCreated',
        actor: 'agent:1',
        payload: { id: 1, cwd: '/srv/x', folderName: 'x' },
      },
      {
        id: 'e2',
        seq: 1,
        ts: '2026-01-01T00:00:01.000Z',
        type: 'agentToolStart',
        actor: 'agent:1',
        payload: {
          id: 1,
          toolId: 't1',
          toolName: 'bash',
          status: 'Running: ls',
          detail: 'ls -la /srv/x',
        },
      },
      {
        id: 'e3',
        seq: 2,
        ts: '2026-01-01T00:00:02.000Z',
        type: 'agentToolStart',
        actor: 'agent:1',
        payload: { id: 1, toolId: 't2', toolName: 'read', status: 'Reading a.ts' },
      },
      {
        id: 'e4',
        seq: 3,
        ts: '2026-01-01T00:00:03.000Z',
        type: 'agentToolDone',
        actor: 'agent:1',
        payload: { id: 1, toolId: 't1' },
      },
      {
        id: 'e5',
        seq: 4,
        ts: '2026-01-01T00:00:04.000Z',
        type: 'agentModel',
        actor: 'agent:1',
        payload: { id: 1, model: 'flash-next/pennyroyal' },
      },
      {
        id: 'e6',
        seq: 5,
        ts: '2026-01-01T00:00:05.000Z',
        type: 'agentStatus',
        actor: 'agent:1',
        payload: { id: 1, status: 'waiting' },
      },
      {
        id: 'e7',
        seq: 6,
        ts: '2026-01-01T00:00:06.000Z',
        type: 'agentToolStart',
        actor: 'agent:2',
        payload: { id: 2, toolId: 'z' },
      },
    ];

    const states = rebuildAgentStates(events);
    const one = states.get(1)!;
    expect(one.added).toBe(true);
    expect(one.removed).toBe(false);
    expect(one.cwd).toBe('/srv/x');
    expect(one.model).toBe('flash-next/pennyroyal');
    expect(one.status).toBe('waiting');
    expect(one.toolsStarted).toBe(2);
    expect([...one.activeTools.keys()]).toEqual(['t2']);

    const two = states.get(2)!;
    expect([...two.activeTools.keys()]).toEqual(['z']);
  });

  it('agentToolsClear empties the active set', () => {
    const events = [
      {
        id: 'e1',
        seq: 0,
        ts: 'x',
        type: 'agentToolStart',
        actor: 'agent:1',
        payload: { id: 1, toolId: 't' },
      },
      { id: 'e2', seq: 1, ts: 'x', type: 'agentToolsClear', actor: 'agent:1', payload: { id: 1 } },
    ];
    const states = rebuildAgentStates(events);
    expect(states.get(1)!.activeTools.size).toBe(0);
  });

  it('ignores events without an agent actor', () => {
    const states = rebuildAgentStates([
      { id: 'e1', seq: 0, ts: 'x', type: 'settingsLoaded', actor: 'system', payload: {} },
    ]);
    expect(states.size).toBe(0);
  });
});
