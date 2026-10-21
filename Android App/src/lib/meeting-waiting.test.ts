import { describe, it, expect } from 'vitest';
import { isMeetingChange, isWaitingRow, withWaitingChanges } from './meeting-waiting';
import type { QueuedMutation } from './sync-queue';
import type { ApiActionItem, ApiAgendaItem, ApiMeetingAttendee, ApiMeetingNote } from './types';

const at = Date.parse('2026-10-21T07:05:00.000Z');
const change = (id: string, kind: string, payload: unknown): QueuedMutation => ({ id, kind, payload, createdAt: at, userId: 'u1', idempotencyKey: `k-${id}`, attempts: 0, status: 'pending' });
const ctx = { meetingId: 'm1', myId: 'u1' };

const note = (over: Partial<ApiMeetingNote> = {}): ApiMeetingNote => ({
  id: 'n1',
  meetingId: 'm1',
  agendaItemId: null,
  authorId: 'u2',
  type: 'DISCUSSION',
  body: 'Budget is agreed',
  highlighted: false,
  taskId: null,
  createdAt: '2026-10-21T07:00:00.000Z',
  editedAt: null,
  ...over,
});
const agendaItem = (over: Partial<ApiAgendaItem> = {}): ApiAgendaItem => ({ id: 'a2', meetingId: 'm1', title: 'Budget', ownerId: null, expectedMinutes: 10, completed: false, position: 1, ...over }) as ApiAgendaItem;
const person = (over: Partial<ApiMeetingAttendee> = {}): ApiMeetingAttendee => ({ id: 'p1', meetingId: 'm1', userId: 'u3', role: 'REQUIRED', attendance: 'INVITED', response: 'ACCEPTED', ...over }) as ApiMeetingAttendee;
const action = (over: Partial<ApiActionItem> = {}): ApiActionItem => ({
  id: 'x1',
  meetingId: 'm1',
  projectId: null,
  description: 'Send the plan',
  assigneeId: null,
  priority: 'NORMAL',
  status: 'OPEN',
  dueDate: null,
  progress: 0,
  completedAt: null,
  taskId: null,
  sourceNoteId: null,
  createdById: 'u2',
  createdAt: '2026-10-21T07:00:00.000Z',
  updatedAt: '2026-10-21T07:00:00.000Z',
  overdue: false,
  ...over,
});

describe('changes still waiting on this phone show on the meeting', () => {
  it('a note taken on this phone shows in Live notes, waiting to sync — yours, with its words, category and key point', () => {
    const out = withWaitingChanges({ notes: [note()] }, [change('q1', 'meeting.note.add', { meetingId: 'm1', body: 'Hire two people', format: 'PLAIN', type: 'DECISION', highlighted: true })], ctx);
    expect(out.notes).toHaveLength(2);
    const mine = out.notes![1]!;
    expect(mine).toMatchObject({ meetingId: 'm1', authorId: 'u1', body: 'Hire two people', type: 'DECISION', highlighted: true, taskId: null, createdAt: '2026-10-21T07:05:00.000Z' });
    expect(isWaitingRow(mine.id)).toBe(true);
    expect(out.waiting.has(mine.id)).toBe(true);
  });

  it('an action item added on this phone shows too, open, with its owner, due day and priority', () => {
    const out = withWaitingChanges({ actions: [] }, [change('q2', 'meeting.action.add', { meetingId: 'm1', description: 'Book the hall', assigneeId: 'u3', dueDate: '2026-10-30T00:00:00.000Z', priority: 'HIGH' })], ctx);
    expect(out.actions).toEqual([expect.objectContaining({ description: 'Book the hall', assigneeId: 'u3', dueDate: '2026-10-30T00:00:00.000Z', priority: 'HIGH', status: 'OPEN', createdById: 'u1', taskId: null })]);
    expect(out.waiting.has(out.actions![0]!.id)).toBe(true);
  });

  it('a tick, attendance or action-item change waiting stays shown when the list loads again before the sync', () => {
    // The lists as the server has them (it doesn't have the changes yet).
    const out = withWaitingChanges(
      { agenda: [agendaItem()], attendees: [person()], actions: [action()] },
      [
        change('q3', 'meeting.agenda.covered', { meetingId: 'm1', itemId: 'a2', completed: true }),
        change('q4', 'meeting.attendance', { meetingId: 'm1', attendeeId: 'p1', attendance: 'PRESENT' }),
        change('q5', 'meeting.action.update', { meetingId: 'm1', id: 'x1', patch: { status: 'COMPLETED' } }),
        change('q6', 'meeting.action.update', { meetingId: 'm1', id: 'x1', patch: { priority: 'URGENT' } }),
      ],
      ctx,
    );
    expect(out.agenda![0]).toMatchObject({ id: 'a2', completed: true });
    expect(out.attendees![0]).toMatchObject({ id: 'p1', attendance: 'PRESENT' });
    expect(out.actions![0]).toMatchObject({ id: 'x1', status: 'COMPLETED', priority: 'URGENT' });
    expect([...out.waiting].sort()).toEqual(['a2', 'p1', 'x1']);
  });

  it('the newest change of an item wins (an untick after a tick)', () => {
    const out = withWaitingChanges(
      { agenda: [agendaItem()] },
      [change('q3', 'meeting.agenda.covered', { meetingId: 'm1', itemId: 'a2', completed: true }), change('q7', 'meeting.agenda.covered', { meetingId: 'm1', itemId: 'a2', completed: false })],
      ctx,
    );
    expect(out.agenda![0]).toMatchObject({ completed: false });
  });

  it('shows only this meeting’s changes, leaves a list not loaded yet alone, and gives the same lists back when nothing waits', () => {
    const lists = { notes: [note()], agenda: [agendaItem()] };
    const other = [change('q8', 'meeting.note.add', { meetingId: 'm2', body: 'Elsewhere' }), change('q9', 'task.move', { id: 't1', columnId: 'c2' })];
    const out = withWaitingChanges(lists, other, ctx);
    expect(out.notes).toBe(lists.notes);
    expect(out.agenda).toBe(lists.agenda);
    expect(out.waiting.size).toBe(0);
    const loading = withWaitingChanges({ notes: undefined }, [change('q1', 'meeting.note.add', { meetingId: 'm1', body: 'x' })], ctx);
    expect(loading.notes).toBeUndefined();
  });

  it('tells this meeting’s changes from the others (for its own “waiting / couldn’t save” box)', () => {
    expect(isMeetingChange(change('a', 'meeting.note.add', { meetingId: 'm1', body: 'x' }), 'm1')).toBe(true);
    expect(isMeetingChange(change('b', 'meeting.attendance', { meetingId: 'm1', attendeeId: 'p1' }), 'm1')).toBe(true);
    expect(isMeetingChange(change('c', 'meeting.note.add', { meetingId: 'm2', body: 'x' }), 'm1')).toBe(false);
    expect(isMeetingChange(change('d', 'task.update', { id: 't1', meetingId: 'm1' }), 'm1')).toBe(false);
  });
});
