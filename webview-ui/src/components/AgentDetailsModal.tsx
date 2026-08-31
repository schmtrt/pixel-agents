import { useEffect, useRef } from 'react';

import type { AgentActivityEntry } from '../../../core/src/messages.js';
import {
  ACTIVITY_FEED_HEIGHT,
  MODEL_BADGE_COLOR_DEFAULT,
  MODEL_BADGE_COLORS,
} from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { modelBadge } from '../office/modelBadge.js';
import { Modal } from './ui/Modal.js';

interface AgentDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: number | null;
  officeState: OfficeState;
  activity: AgentActivityEntry[];
  cwd?: string;
  status?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Agent details popup — the "terminal view" of an office character: which
 * model serves it, which workspace it runs in, and a feed of the concrete
 * tool calls it made (full commands / paths, not the 30-char overlay line).
 */
export function AgentDetailsModal({
  isOpen,
  onClose,
  agentId,
  officeState,
  activity,
  cwd,
  status,
}: AgentDetailsModalProps) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activity, agentId]);

  if (agentId === null) return null;
  const ch = officeState.characters.get(agentId);
  const badge = modelBadge(ch?.model);
  const title = ch?.agentName || `Agent #${agentId}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} className="w-md max-w-[90vw]">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 mb-3 text-xs">
        <span className="text-accent-bright whitespace-nowrap">MODEL</span>
        <span className="flex items-center min-w-0">
          {badge ? (
            <span
              className="overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ color: MODEL_BADGE_COLORS[badge] ?? MODEL_BADGE_COLOR_DEFAULT }}
              title={ch?.model ?? badge}
              data-testid="details-model"
            >
              {badge.toUpperCase()}
              {ch?.model ? ` — ${ch.model}` : ''}
            </span>
          ) : (
            <span className="opacity-50" data-testid="details-model">
              unknown (reported at end of first turn)
            </span>
          )}
        </span>
        <span className="text-accent-bright whitespace-nowrap">STATUS</span>
        <span className="flex items-center" data-testid="details-status">
          {status ?? 'active'}
        </span>
        <span className="text-accent-bright whitespace-nowrap">WORKDIR</span>
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap"
          title={cwd ?? ch?.folderName}
        >
          {cwd ?? ch?.folderName ?? '—'}
        </span>
      </div>
      <div
        ref={feedRef}
        data-testid="details-feed"
        className="border-2 border-border bg-bg-dark overflow-y-auto p-2 text-2xs leading-relaxed"
        style={{ height: ACTIVITY_FEED_HEIGHT }}
      >
        {activity.length === 0 ? (
          <div className="opacity-50">No tool activity recorded yet.</div>
        ) : (
          activity.map((e, i) => (
            <div key={`${e.toolId}-${i}`} className="flex gap-2 py-0.5" data-done={e.done}>
              <span className="opacity-40 shrink-0">{formatTime(e.ts)}</span>
              <span
                className="shrink-0 w-4 text-center"
                style={{ color: e.done ? MODEL_BADGE_COLOR_DEFAULT : MODEL_BADGE_COLORS.qwen }}
              >
                {e.done ? '·' : '>'}
              </span>
              <span className="break-all whitespace-pre-wrap">
                {e.status}
                {e.detail && e.detail !== e.status ? (
                  <span className="opacity-60"> — {e.detail}</span>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
