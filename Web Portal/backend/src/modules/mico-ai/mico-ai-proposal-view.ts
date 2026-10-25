import { dayLabel } from './mico-ai-dates';
import type { ItemResult, ProposalItem, ProposalRecord, ProposalView, ResultStatus } from './mico-ai-actions-types';

/**
 * A stored card as the page sees it (without what Undo needs, which stays on the server), and in
 * words: for the chats' search, and for the model when a later question follows it.
 */

const STATUS: Record<ProposalRecord['status'], ProposalView['status']> = {
  PROPOSED: 'proposed',
  CONFIRMING: 'confirming',
  DONE: 'done',
  CANCELLED: 'cancelled',
  UNDOING: 'undoing',
  UNDONE: 'undone',
};

const shown = (r: ItemResult | undefined): Omit<ItemResult, 'undo'> | null => (r ? { status: r.status, message: r.message, link: r.link } : null);

export function proposalView(p: ProposalRecord, now: Date): ProposalView {
  const results = p.results ?? {};
  const undoable = Object.values(results).some((r) => r.status === 'done' && !!r.undo);
  return {
    id: p.id,
    status: STATUS[p.status],
    note: p.note,
    sendInvites: p.sendInvites,
    hasMeetings: p.items.some((i) => i.type === 'schedule_meeting'),
    items: p.items.map((i) => ({ ...i, result: shown(results[i.id]), undo: p.undo?.[i.id] ?? null })),
    confirmedAt: p.confirmedAt ? p.confirmedAt.toISOString() : null,
    undoUntil: p.undoUntil ? p.undoUntil.toISOString() : null,
    canUndo: p.status === 'DONE' && undoable && !!p.undoUntil && now.getTime() <= p.undoUntil.getTime(),
  };
}

const quote = (s: string) => `“${s.slice(0, 80)}”`;

/** One change in a few words: "Create task “Replace the gauge” in Rig Inspection Portal". */
export function changeSummary(item: ProposalItem): string {
  switch (item.type) {
    case 'create_task':
      return `Create task ${quote(item.fields.title)}${item.labels.project ? ` in ${item.labels.project}` : ''}${item.fields.due ? `, due ${dayLabel(item.fields.due)}` : ''}${
        item.labels.assignees.length ? `, for ${item.labels.assignees.map((a) => a.name).join(', ')}` : ''
      }`;
    case 'update_task': {
      const f = item.fields;
      const parts = [
        f.due !== undefined ? (f.due ? `due ${dayLabel(f.due)}` : 'no due date') : null,
        f.columnId !== undefined ? `status ${item.labels.column ?? ''}`.trim() : null,
        f.priority !== undefined ? `priority ${f.priority.charAt(0)}${f.priority.slice(1).toLowerCase()}` : null,
        f.assigneeIds !== undefined ? `assigned to ${(item.labels.assignees ?? []).map((a) => a.name).join(', ') || 'no one'}` : null,
      ].filter(Boolean);
      return `Change ${item.task.key} ${quote(item.task.title)}: ${parts.join(', ') || 'nothing'}`;
    }
    case 'draft_minutes':
      return `Draft the final minutes of ${quote(item.meeting.title)}`;
    case 'schedule_meeting':
      return `Schedule ${quote(item.fields.title)}${item.fields.date ? ` on ${dayLabel(item.fields.date)}` : ''}${item.fields.time ? ` at ${item.fields.time}` : ''}${
        item.labels.attendees.length ? ` with ${item.labels.attendees.map((a) => a.name).join(', ')}` : ''
      }`;
  }
}

const count = (results: Record<string, ItemResult>, status: ResultStatus) => Object.values(results).filter((r) => r.status === status).length;

/** What became of the card, for the model ("confirmed: 2 done, 1 refused"). */
function outcome(p: ProposalRecord): string {
  if (p.status === 'PROPOSED') return 'not confirmed yet';
  if (p.status === 'CANCELLED') return 'cancelled by the user: nothing was changed';
  const r = p.results ?? {};
  const parts = (['done', 'refused', 'failed', 'skipped'] as const).map((s) => [s, count(r, s)] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`);
  const confirmed = `confirmed: ${parts.join(', ') || 'nothing made'}`;
  if (p.status === 'UNDONE') return `${confirmed}; then undone by the user (${Object.values(p.undo ?? {}).filter((u) => u.status === 'undone').length} put back)`;
  return confirmed;
}

/** The card as the model is told of it in later questions. */
export function proposalHistory(p: ProposalRecord): string {
  const lines = p.items.slice(0, 12).map((i) => `${changeSummary(i)}${p.results?.[i.id] ? ` (${p.results[i.id]!.status})` : ''}`);
  const more = p.items.length > 12 ? `; and ${p.items.length - 12} more` : '';
  return `[Proposed changes: ${lines.join('; ')}${more}. ${outcome(p)}. The card’s Undo button puts confirmed changes back for 15 minutes.]`;
}

/** The card's words for the chats' search. */
export function proposalSearchText(items: ProposalItem[]): string {
  return items.map(changeSummary).join('\n');
}
