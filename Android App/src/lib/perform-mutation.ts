import { ApiError, isNetworkError } from './api-client';
import type { ResourcesApi } from './resources';
import type { QueuedMutation } from './sync-queue';
import { taskHoldsEdit } from './task-writes';
import { editRefreshes, moveRefreshes, MY_ACTION_ITEMS } from './task-cache';
import type { Refresh } from './refresh';
import type { ActionItemInput, ActionItemPatch, ApiTask, AttendanceStatus, NoteInput } from './types';

/**
 * Replay a queued task edit. The server de-duplicates only POSTs, so an edit whose first try timed
 * out after the server had saved it comes back as a version conflict — refused by its own change.
 * On a conflict the task is reloaded: when it already holds the edit, the edit is done (and the
 * reloaded task stands in for the server's answer); otherwise the conflict stands, as before. A
 * reload that gets no answer waits for the connection like any other replay.
 */
async function replayTaskEdit(resources: ResourcesApi, id: string, patch: Record<string, unknown>): Promise<ApiTask> {
  try {
    return await resources.tasks.update(id, patch);
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'VERSION_CONFLICT')) throw e;
    let current: ApiTask;
    try {
      current = await resources.tasks.get(id);
    } catch (reloadError) {
      if (isNetworkError(reloadError)) throw reloadError;
      throw e; // gone, or no longer yours to see: the conflict is what to show
    }
    if (taskHoldsEdit(current, patch)) return current;
    throw e;
  }
}

/**
 * Replay one queued offline mutation against the API (A8). Every write the app can make offline maps
 * to a case here; an unknown kind is a permanent failure so a stale entry is marked failed rather
 * than wedging the queue. Creating writes (POSTs) re-send the item's idempotency key so the server
 * de-duplicates a replay of a write it already saved (XP-06). Pure (no native imports) so the
 * kind → resource mapping is unit-testable. A task edit or move resolves with the server's task, so
 * the queue can move this phone's later edits of it on to the version it made (rebaseQueuedVersion).
 */
export async function performMutation(resources: ResourcesApi, m: QueuedMutation): Promise<unknown> {
  const write = { idempotencyKey: m.idempotencyKey };
  switch (m.kind) {
    case 'task.create': {
      const p = m.payload as Parameters<ResourcesApi['tasks']['create']>[0];
      await resources.tasks.create(p, write);
      return;
    }
    case 'task.move': {
      const p = m.payload as { id: string; columnId: string; position?: number };
      return resources.tasks.move(p.id, p.columnId, p.position);
    }
    case 'task.update': {
      const p = m.payload as { id: string; patch: Record<string, unknown> };
      return replayTaskEdit(resources, p.id, p.patch);
    }
    case 'task.assign': {
      const p = m.payload as { id: string; userIds: string[] };
      await resources.tasks.assign(p.id, p.userIds, write);
      return;
    }
    case 'task.unassign': {
      const p = m.payload as { id: string; userId: string };
      await resources.tasks.unassign(p.id, p.userId);
      return;
    }
    case 'checklist.add': {
      const p = m.payload as { id: string; text: string };
      await resources.tasks.addChecklistItem(p.id, p.text, write);
      return;
    }
    case 'checklist.update': {
      const p = m.payload as { itemId: string; patch: { done?: boolean; text?: string } };
      await resources.tasks.updateChecklistItem(p.itemId, p.patch);
      return;
    }
    case 'comment.add': {
      const p = m.payload as { id: string; body: string };
      await resources.tasks.addComment(p.id, p.body, undefined, write);
      return;
    }
    case 'notification.read': {
      const p = m.payload as { id: string };
      await resources.notifications.markRead(p.id);
      return;
    }
    case 'chat.send': {
      const p = m.payload as { conversationId: string; body: string };
      await resources.chat.send(p.conversationId, p.body, write);
      return;
    }
    // Meetings (2b): what is taken down in a meeting room with a poor connection.
    case 'meeting.note.add': {
      const { meetingId, ...note } = m.payload as { meetingId: string } & NoteInput;
      await resources.meetings.addNote(meetingId, note, write);
      return;
    }
    case 'meeting.action.add': {
      const { meetingId, ...item } = m.payload as { meetingId: string } & ActionItemInput;
      await resources.meetings.addActionItem(meetingId, item, write);
      return;
    }
    case 'meeting.action.update': {
      const p = m.payload as { id: string; patch: ActionItemPatch };
      await resources.meetings.updateActionItem(p.id, p.patch);
      return;
    }
    case 'meeting.agenda.covered': {
      const p = m.payload as { meetingId: string; itemId: string; completed: boolean };
      await resources.meetings.updateAgendaItem(p.meetingId, p.itemId, { completed: p.completed });
      return;
    }
    case 'meeting.attendance': {
      const p = m.payload as { meetingId: string; attendeeId: string; attendance: AttendanceStatus };
      await resources.meetings.updateAttendee(p.meetingId, p.attendeeId, { attendance: p.attendance });
      return;
    }
    default:
      throw new ApiError(422, 'UNKNOWN_MUTATION', `Unknown queued mutation: ${m.kind}`);
  }
}

/** A meeting's part once a change to it was replayed; the lists' counts are fetched when next shown. */
function meetingReplayRefreshes(kind: string, meetingId: string): Refresh[] {
  const part = (name: string): Refresh => ({ queryKey: ['meeting', meetingId, name], exact: true });
  const counts: Refresh[] = [{ queryKey: ['meetings'], later: true }, { projectMeetingsOf: meetingId }];
  const myItems: Refresh = { queryKey: ['action-items', 'mine'] };
  switch (kind) {
    case 'meeting.note.add':
      return [part('notes'), ...counts];
    case 'meeting.action.add':
    case 'meeting.action.update':
      return meetingId ? [part('action-items'), myItems, ...counts] : [myItems];
    case 'meeting.agenda.covered':
      return [part('agenda')];
    default:
      return [part('attendees')];
  }
}

/**
 * What to refresh once a queued change was replayed (or finally refused): what that change touched,
 * instead of every query in the app. A refused change refreshes the same, so an optimistic change
 * on screen (a card moved offline) goes back to what the server holds. A kind it doesn't know
 * refreshes everything, as before.
 */
export function refreshesAfterReplay(m: Pick<QueuedMutation, 'kind' | 'payload'>): Refresh[] {
  const p = (m.payload ?? {}) as { id?: unknown; projectId?: unknown; patch?: unknown; conversationId?: unknown };
  const id = typeof p.id === 'string' ? p.id : '';
  const part = (name?: string): Refresh => ({ queryKey: name ? ['task', id, name] : ['task', id], exact: true });
  const checklist = (): Refresh[] => [part('checklist'), part(), part('activity'), { listsHolding: id }];
  switch (m.kind) {
    case 'task.create':
      if (typeof p.projectId !== 'string') return [{ queryKey: ['tasks'] }];
      return [{ queryKey: ['tasks', 'project', p.projectId] }, { queryKey: ['tasks', 'mine'] }, { queryKey: ['project', p.projectId, 'progress'], exact: true }];
    case 'task.move':
      // Queued with its project: what the move refreshes online, its project's board days included
      // (finishing a repeating task adds its next copy to a later day). Older items name no project.
      if (typeof p.projectId === 'string' && p.projectId) return moveRefreshes(id, p.projectId);
      return [part(), part('activity'), { listsHolding: id }, { progressFor: id }, MY_ACTION_ITEMS];
    case 'task.update':
      // The task itself first, then what the edit changed (its activity, the lists showing it…).
      return [part(), ...editRefreshes(id, typeof p.patch === 'object' && p.patch ? p.patch : {})];
    case 'task.assign':
    case 'task.unassign':
      return [part('assignees'), part('activity'), { queryKey: ['tasks', 'mine'] }, { listsHolding: id }];
    case 'checklist.add':
      return checklist();
    case 'checklist.update':
      // Queued by a version that didn't note the task: every task's (only the ones on screen refetch).
      return id ? checklist() : [{ queryKey: ['task'] }, { queryKey: ['tasks'] }];
    case 'comment.add':
      return [part('comments'), part('activity'), { listsHolding: id }];
    case 'notification.read':
      return [{ queryKey: ['notifications'] }];
    case 'chat.send':
      return typeof p.conversationId === 'string'
        ? [{ queryKey: ['chat', 'messages', p.conversationId] }, { queryKey: ['chat', 'conversations'] }]
        : [{ queryKey: ['chat'] }];
    case 'meeting.note.add':
    case 'meeting.action.add':
    case 'meeting.action.update':
    case 'meeting.agenda.covered':
    case 'meeting.attendance': {
      const meetingId = (m.payload as { meetingId?: unknown } | null)?.meetingId;
      return meetingReplayRefreshes(m.kind, typeof meetingId === 'string' ? meetingId : '');
    }
    default:
      return [{ queryKey: [] }];
  }
}

/** Short, human description of a queued change for the "waiting to sync / couldn't save" list. */
export function describeMutation(m: Pick<QueuedMutation, 'kind' | 'payload'>): string {
  const p = (m.payload ?? {}) as Record<string, unknown>;
  const snippet = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  };
  switch (m.kind) {
    case 'task.create':
      return `New task “${snippet(p.title)}”`;
    case 'task.move':
      return 'Move a task';
    case 'task.update':
      return 'Edit a task';
    case 'task.assign':
      return 'Assign a task';
    case 'task.unassign':
      return 'Unassign a task';
    case 'checklist.add':
      return `Add subtask “${snippet(p.text)}”`;
    case 'checklist.update':
      return 'Update a subtask';
    case 'comment.add':
      return `Comment “${snippet(p.body)}”`;
    case 'notification.read':
      return 'Mark a notification read';
    case 'chat.send':
      return `Message “${snippet(p.body)}”`;
    case 'meeting.note.add':
      return `Meeting note “${snippet(p.body)}”`;
    case 'meeting.action.add':
      return `Action item “${snippet(p.description)}”`;
    case 'meeting.action.update':
      return 'Update an action item';
    case 'meeting.agenda.covered':
      return p.completed === false ? 'Untick an agenda item' : 'Tick off an agenda item';
    case 'meeting.attendance':
      return 'Record attendance';
    default:
      return 'A change';
  }
}
