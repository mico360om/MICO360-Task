import { describe, expect, it } from 'vitest';
import type { ActionItem, AgendaItem, MeetingNote } from '../api/meetings';
import { EMPTY_TABLE_FILTERS, ME, NO_PERSON, OPEN_ONLY } from './data-table';
import { actionItemSortValue, filterActionItems, groupActionItems, itemTopic } from './meeting-table';

const topic = (id: string, title: string, position: number): AgendaItem => ({ id, meetingId: 'm1', title, ownerId: null, expectedMinutes: null, position, completed: false, linkedPrevActionId: null, createdAt: '' });
const item = (id: string, patch: Partial<ActionItem> = {}): ActionItem => ({
  id, meetingId: 'm1', agendaItemId: null, sourceNoteId: null, projectId: null, description: id, assigneeId: null, priority: 'NORMAL', status: 'OPEN', dueDate: null, progress: 0, completedAt: null, taskId: null, createdById: 'u1', createdAt: '', updatedAt: '', overdue: false, ...patch,
});
const note = (id: string, agendaItemId: string | null): MeetingNote => ({ id, meetingId: 'm1', agendaItemId, authorId: 'u1', type: 'ACTION', body: '', highlighted: false, taskId: null, actionItemId: null, decisionId: null, createdAt: '', editedAt: null });

const TOPICS = [topic('a2', 'Safety', 1), topic('a1', 'Site progress', 0)];
const NOTES = new Map([['n1', note('n1', 'a2')], ['n2', note('n2', null)]]);

describe('itemTopic', () => {
  it('is the item’s own topic, else (read-time) its source note’s', () => {
    expect(itemTopic(item('x', { agendaItemId: 'a1' }), NOTES)).toEqual({ id: 'a1', fromNote: false });
    expect(itemTopic(item('x', { sourceNoteId: 'n1' }), NOTES)).toEqual({ id: 'a2', fromNote: true });
    expect(itemTopic(item('x', { sourceNoteId: 'n2' }), NOTES)).toEqual({ id: null, fromNote: false });
    expect(itemTopic(item('x'), NOTES)).toEqual({ id: null, fromNote: false });
    // Its own topic wins over its note's.
    expect(itemTopic(item('x', { agendaItemId: 'a1', sourceNoteId: 'n1' }), NOTES)).toEqual({ id: 'a1', fromNote: false });
  });
});

describe('groupActionItems', () => {
  it('puts the items under their topics in agenda order, then Other', () => {
    const items = [item('i1', { agendaItemId: 'a1' }), item('i2'), item('i3', { sourceNoteId: 'n1' }), item('i4', { agendaItemId: 'gone' })];
    const groups = groupActionItems(TOPICS, items, NOTES);
    expect(groups.map((g) => [g.topic?.title ?? 'Other', g.items.map((i) => i.id)])).toEqual([
      ['Site progress', ['i1']],
      ['Safety', ['i3']],
      // An item whose topic is no longer on the agenda is under Other.
      ['Other', ['i2', 'i4']],
    ]);
    expect(groups.map((g) => g.number)).toEqual([1, 2, null]);
  });
  it('leaves out an empty Other, never an empty topic', () => {
    const groups = groupActionItems(TOPICS, [item('i1', { agendaItemId: 'a1' })], NOTES);
    expect(groups.map((g) => g.topic?.title ?? 'Other')).toEqual(['Site progress', 'Safety']);
  });
});

describe('filterActionItems', () => {
  const items = [
    item('Order rebar', { assigneeId: 'u1', priority: 'HIGH', status: 'IN_PROGRESS', taskId: 't1', taskKey: 'MICO-12' }),
    item('Book crane', { assigneeId: 'u2', status: 'COMPLETED' }),
    item('Call client', { status: 'CANCELLED' }),
    item('Send drawings', { status: 'PENDING', priority: 'URGENT' }),
  ];
  const ids = (list: ActionItem[]) => list.map((i) => i.id);
  it('by words, the linked task’s number, owner (Me, Unassigned), status (Open only) and priority', () => {
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, text: 'CRANE' }, 'u1'))).toEqual(['Book crane']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, text: 'mico12' }, 'u1'))).toEqual(['Order rebar']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, person: ME }, 'u1'))).toEqual(['Order rebar']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, person: NO_PERSON }, 'u1'))).toEqual(['Call client', 'Send drawings']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, person: 'u2' }, 'u1'))).toEqual(['Book crane']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, status: OPEN_ONLY }, 'u1'))).toEqual(['Order rebar', 'Send drawings']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, status: 'PENDING' }, 'u1'))).toEqual(['Send drawings']);
    expect(ids(filterActionItems(items, { ...EMPTY_TABLE_FILTERS, priority: 'URGENT' }, 'u1'))).toEqual(['Send drawings']);
  });
});

describe('actionItemSortValue', () => {
  const name = (id: string | null) => (id === 'u1' ? 'Ada' : id === 'u2' ? 'Omar' : null);
  it('sorts by words, owner’s name, priority rank, due day and status order', () => {
    const a = item('Order rebar', { assigneeId: 'u2', priority: 'URGENT', dueDate: '2026-11-07T00:00:00.000Z', status: 'PENDING' });
    expect(actionItemSortValue(a, 'title', name, 'UTC')).toBe('Order rebar');
    expect(actionItemSortValue(a, 'owner', name, 'UTC')).toBe('Omar');
    expect(actionItemSortValue(item('x'), 'owner', name, 'UTC')).toBe('');
    expect(actionItemSortValue(a, 'priority', name, 'UTC')).toBe(0);
    expect(actionItemSortValue(a, 'due', name, 'UTC')).toBe('2026-11-07');
    expect(actionItemSortValue(a, 'status', name, 'UTC')).toBe(2);
  });
});
