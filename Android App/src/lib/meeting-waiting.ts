import type { QueuedMutation } from './sync-queue';
import type { ActionItemInput, ActionItemPatch, ApiActionItem, ApiAgendaItem, ApiMeetingAttendee, ApiMeetingNote, AttendanceStatus, NoteInput } from './types';

/**
 * A meeting's changes still waiting on this phone, laid over its lists (2b review) — as the board
 * lays the moves still waiting over its cards (offline-reads). Someone taking notes on flaky Wi-Fi
 * sees each note and action item they added ("Waiting to sync"), and a tick, attendance or action
 * item change stays shown when a list loads again before the sync — neither the server nor the
 * list has it yet. Once the sync has sent a change it leaves the queue, and the list the server
 * gives back has it. Pure, so it is tested here.
 */

export interface MeetingLists {
  agenda?: ApiAgendaItem[];
  attendees?: ApiMeetingAttendee[];
  notes?: ApiMeetingNote[];
  actions?: ApiActionItem[];
}

export interface WaitingOverlay extends MeetingLists {
  /** The rows with a change still waiting on this phone ("Waiting to sync"). */
  waiting: ReadonlySet<string>;
}

type Pending = Pick<QueuedMutation, 'id' | 'kind' | 'payload' | 'createdAt'>;

const WAITING = 'waiting:';

/** A row made on this phone and not sent yet (it has no id on the server; it can't be changed until it has). */
export function isWaitingRow(id: string): boolean {
  return id.startsWith(WAITING);
}

const meetingOf = (m: Pick<QueuedMutation, 'payload'>) => (m.payload as { meetingId?: unknown } | null)?.meetingId;

/** Is this queued change one of this meeting's (for its own "waiting / couldn't save" box)? */
export function isMeetingChange(m: Pick<QueuedMutation, 'kind' | 'payload'>, meetingId: string): boolean {
  return m.kind.startsWith('meeting.') && meetingOf(m) === meetingId;
}

/** The rows of a list with patches laid over them (the same list when nothing changes). */
function patched<T extends { id: string }>(list: T[] | undefined, patches: Map<string, Partial<T>>): T[] | undefined {
  if (!list || patches.size === 0) return list;
  let changed = false;
  const next = list.map((row) => {
    const p = patches.get(row.id);
    if (!p) return row;
    changed = true;
    return { ...row, ...p };
  });
  return changed ? next : list;
}

/** This meeting's lists with its changes still waiting on this phone laid over them (newest last, so it wins). */
export function withWaitingChanges(lists: MeetingLists, pending: readonly Pending[], ctx: { meetingId: string; myId: string | null }): WaitingOverlay {
  const waiting = new Set<string>();
  const ticks = new Map<string, Partial<ApiAgendaItem>>();
  const attendance = new Map<string, Partial<ApiMeetingAttendee>>();
  const actionPatches = new Map<string, Partial<ApiActionItem>>();
  const newNotes: ApiMeetingNote[] = [];
  const newActions: ApiActionItem[] = [];

  for (const m of pending) {
    if (!isMeetingChange(m, ctx.meetingId)) continue;
    const when = new Date(m.createdAt).toISOString();
    const rowId = `${WAITING}${m.id}`;
    switch (m.kind) {
      case 'meeting.note.add': {
        const p = m.payload as NoteInput;
        newNotes.push({
          id: rowId,
          meetingId: ctx.meetingId,
          agendaItemId: p.agendaItemId ?? null,
          authorId: ctx.myId ?? '',
          type: p.type ?? 'DISCUSSION',
          body: p.body ?? '',
          bodyFormat: p.format ?? 'PLAIN',
          highlighted: !!p.highlighted,
          taskId: null,
          createdAt: when,
          editedAt: null,
        });
        waiting.add(rowId);
        break;
      }
      case 'meeting.action.add': {
        const p = m.payload as ActionItemInput;
        newActions.push({
          id: rowId,
          meetingId: ctx.meetingId,
          projectId: null,
          description: p.description ?? '',
          assigneeId: p.assigneeId ?? null,
          priority: p.priority ?? 'NORMAL',
          status: 'OPEN',
          dueDate: p.dueDate ?? null,
          progress: 0,
          completedAt: null,
          taskId: null,
          sourceNoteId: null,
          createdById: ctx.myId ?? '',
          createdAt: when,
          updatedAt: when,
          overdue: false,
          taskKey: null,
        });
        waiting.add(rowId);
        break;
      }
      case 'meeting.agenda.covered': {
        const p = m.payload as { itemId: string; completed: boolean };
        ticks.set(p.itemId, { completed: !!p.completed });
        waiting.add(p.itemId);
        break;
      }
      case 'meeting.attendance': {
        const p = m.payload as { attendeeId: string; attendance: AttendanceStatus };
        attendance.set(p.attendeeId, { attendance: p.attendance });
        waiting.add(p.attendeeId);
        break;
      }
      case 'meeting.action.update': {
        const p = m.payload as { id: string; patch: ActionItemPatch };
        actionPatches.set(p.id, { ...actionPatches.get(p.id), ...(p.patch as Partial<ApiActionItem>) });
        waiting.add(p.id);
        break;
      }
    }
  }

  const notes = lists.notes && newNotes.length ? [...lists.notes, ...newNotes] : lists.notes;
  const actions = patched(lists.actions, actionPatches);
  return {
    agenda: patched(lists.agenda, ticks),
    attendees: patched(lists.attendees, attendance),
    notes,
    actions: actions && newActions.length ? [...actions, ...newActions] : actions,
    waiting,
  };
}
