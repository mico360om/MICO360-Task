import type { ActionItem, ActionItemStatus, AgendaItem, MeetingNote } from '../api/meetings';
import { ME, NO_PERSON, OPEN_ONLY, type SortValue, type TableFilters } from './data-table';
import { dueDayKey } from './due-date';
import { matchesTaskNumber } from './task-number';

/**
 * A meeting's Table view (1.23.0): its agenda topics as groups, each with its action items, then
 * "Other" (items with no topic); the filters and sorting for the items.
 */

/** The statuses in their usual order (and the table's status sort). */
export const ACTION_STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];

/**
 * The topic an item is under: its own — else, for an item made from a note before items had topics
 * (1.23.0), its source note's (read at display time; nothing is stored). `fromNote`: that second case.
 */
export function itemTopic(item: ActionItem, notesById: ReadonlyMap<string, Pick<MeetingNote, 'agendaItemId'>>): { id: string | null; fromNote: boolean } {
  if (item.agendaItemId) return { id: item.agendaItemId, fromNote: false };
  const fromNote = item.sourceNoteId ? (notesById.get(item.sourceNoteId)?.agendaItemId ?? null) : null;
  return fromNote ? { id: fromNote, fromNote: true } : { id: null, fromNote: false };
}

export interface MeetingTableGroup {
  /** The topic; null for "Other". */
  topic: AgendaItem | null;
  /** Its number on the agenda (1, 2…); null for Other. */
  number: number | null;
  items: ActionItem[];
}

/**
 * Every topic in agenda order with its items (in the order given), then Other — the items with no
 * topic, or whose topic is no longer on the agenda — when there are any.
 */
export function groupActionItems(agenda: readonly AgendaItem[], items: readonly ActionItem[], notesById: ReadonlyMap<string, Pick<MeetingNote, 'agendaItemId'>>): MeetingTableGroup[] {
  const topics = [...agenda].sort((a, b) => a.position - b.position);
  const known = new Set(topics.map((t) => t.id));
  const under = new Map<string, ActionItem[]>();
  const other: ActionItem[] = [];
  for (const it of items) {
    const { id } = itemTopic(it, notesById);
    if (id && known.has(id)) under.set(id, [...(under.get(id) ?? []), it]);
    else other.push(it);
  }
  const groups: MeetingTableGroup[] = topics.map((t, i) => ({ topic: t, number: i + 1, items: under.get(t.id) ?? [] }));
  if (other.length) groups.push({ topic: null, number: null, items: other });
  return groups;
}

const DONE: ActionItemStatus[] = ['COMPLETED', 'CANCELLED'];

/** The meeting table's filters: words (or the linked task's number), owner, status (or Open only), priority. */
export function filterActionItems(items: readonly ActionItem[], f: TableFilters, myId: string | null | undefined): ActionItem[] {
  const words = f.text.trim().toLocaleLowerCase('en');
  return items.filter((i) => {
    if (words && !(i.description.toLocaleLowerCase('en').includes(words) || (i.taskKey && (i.taskKey.toLocaleLowerCase('en').includes(words) || matchesTaskNumber(words, i.taskKey))))) return false;
    if (f.person === NO_PERSON ? !!i.assigneeId : f.person === ME ? i.assigneeId !== myId : f.person && i.assigneeId !== f.person) return false;
    if (f.status === OPEN_ONLY ? DONE.includes(i.status) : f.status && i.status !== f.status) return false;
    if (f.priority && i.priority !== f.priority) return false;
    return true;
  });
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** What an action item sorts by in each column (inside its topic). */
export function actionItemSortValue(i: ActionItem, column: string, ownerName: (id: string | null) => string | null, timeZone: string): SortValue {
  switch (column) {
    case 'title':
      return i.description;
    case 'owner':
      return ownerName(i.assigneeId) ?? '';
    case 'priority':
      return PRIORITY_RANK[i.priority] ?? 9;
    case 'due':
      return dueDayKey(i.dueDate, timeZone);
    case 'status':
      return ACTION_STATUSES.indexOf(i.status);
    default:
      return null;
  }
}
