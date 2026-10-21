/**
 * The meeting details screen as one list of rows (a FlatList), so a meeting with a long run of
 * notes or action items stays quick: the header, your answer, about, then each part — agenda,
 * people, Live notes, action items, final minutes — as a title row and its own rows (or a loading,
 * failed or empty row). Pure, so the layout is tested without a device.
 */
import { NOTE_TYPE_LABELS, openActionCount } from './meeting-detail';
import type { ApiActionItem, ApiAgendaItem, ApiFinalMinutes, ApiMeeting, ApiMeetingAttendee, ApiMeetingNote, MeetingNoteType } from './types';

/** People shown before "Show all" (as on the website). */
export const PEOPLE_FIRST = 12;

export type NoteFilter = MeetingNoteType | 'ALL' | 'KEY';

const NOTE_TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

/** All, Key points (when there are any) and each category that has notes — with how many. */
export function noteFilters(notes: ApiMeetingNote[]): { key: NoteFilter; label: string; count: number }[] {
  const counts = new Map<MeetingNoteType, number>();
  for (const n of notes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const key = notes.filter((n) => n.highlighted).length;
  return [
    { key: 'ALL' as NoteFilter, label: 'All', count: notes.length },
    ...(key ? [{ key: 'KEY' as NoteFilter, label: 'Key points', count: key }] : []),
    ...NOTE_TYPES.filter((t) => counts.get(t)).map((t) => ({ key: t as NoteFilter, label: NOTE_TYPE_LABELS[t], count: counts.get(t)! })),
  ];
}

export function filterNotes(notes: ApiMeetingNote[], filter: NoteFilter): ApiMeetingNote[] {
  if (filter === 'ALL') return notes;
  if (filter === 'KEY') return notes.filter((n) => n.highlighted);
  return notes.filter((n) => n.type === filter);
}

/** The meeting from any of the lists given (the Meetings tab's, the calendar's), else undefined. */
export function findMeeting(lists: unknown[], meetingId: string): ApiMeeting | undefined {
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const found = (list as ApiMeeting[]).find((m) => m?.id === meetingId);
    if (found) return found;
  }
  return undefined;
}

/** One part of the meeting as its query has it. */
export interface Part<T> {
  data?: T;
  loading: boolean;
  failed: boolean;
}

export type Section = 'agenda' | 'people' | 'notes' | 'actions' | 'minutes';

export interface DetailInput {
  meeting: ApiMeeting;
  /** You're on the meeting and can still answer the invitation. */
  canRsvp: boolean;
  /** You run the meeting (the server's `canEdit`): the empty parts say what to add. */
  canEdit?: boolean;
  agenda: Part<ApiAgendaItem[]>;
  people: Part<ApiMeetingAttendee[]>;
  notes: Part<ApiMeetingNote[]>;
  actions: Part<ApiActionItem[]>;
  minutes: Part<ApiFinalMinutes>;
  showAllPeople: boolean;
  noteFilter: NoteFilter;
}

export type DetailRow =
  | { kind: 'header'; key: string }
  | { kind: 'rsvp'; key: string }
  | { kind: 'about'; key: string }
  | { kind: 'title'; key: string; section: Section; title: string; count?: string }
  | { kind: 'loading'; key: string; section: Section }
  | { kind: 'failed'; key: string; section: Section }
  | { kind: 'empty'; key: string; section: Section; text: string }
  | { kind: 'agenda'; key: string; section: 'agenda'; item: ApiAgendaItem; index: number }
  | { kind: 'person'; key: string; section: 'people'; attendee: ApiMeetingAttendee }
  | { kind: 'more'; key: string; section: 'people'; total: number; expanded: boolean }
  | { kind: 'noteFilters'; key: string; section: 'notes' }
  | { kind: 'note'; key: string; section: 'notes'; note: ApiMeetingNote }
  | { kind: 'action'; key: string; section: 'actions'; item: ApiActionItem }
  | { kind: 'minutes'; key: string; section: 'minutes'; minutes: ApiFinalMinutes };

/** A part's rows: loading, failed (to retry), empty, or its own rows. */
function partRows<T>(section: Section, part: Part<T[]>, empty: string, rows: (items: T[]) => DetailRow[]): DetailRow[] {
  if (part.data === undefined) {
    return part.failed ? [{ kind: 'failed', key: `${section}:failed`, section }] : [{ kind: 'loading', key: `${section}:loading`, section }];
  }
  if (part.data.length === 0) return [{ kind: 'empty', key: `${section}:empty`, section, text: empty }];
  return rows(part.data);
}

const title = (section: Section, text: string, count?: string): DetailRow => ({ kind: 'title', key: `${section}:title`, section, title: text, count });

/** The details as rows, in reading order (see the module comment). */
export function meetingDetailRows(input: DetailInput): DetailRow[] {
  const { agenda, people, notes, actions, minutes } = input;
  const rows: DetailRow[] = [{ kind: 'header', key: 'header' }];
  if (input.canRsvp) rows.push({ kind: 'rsvp', key: 'rsvp' });
  rows.push({ kind: 'about', key: 'about' });

  rows.push(title('agenda', 'Agenda', agenda.data?.length ? String(agenda.data.length) : undefined));
  const canEdit = input.canEdit === true;
  rows.push(...partRows('agenda', agenda, canEdit ? 'No agenda yet. Add the topics you plan to cover, who presents each and for how long.' : 'No agenda yet.', (items) => items.map((item, index) => ({ kind: 'agenda', key: `agenda:${item.id}`, section: 'agenda', item, index }))));

  rows.push(title('people', 'People', people.data?.length ? String(people.data.length) : undefined));
  rows.push(
    ...partRows('people', people, canEdit ? 'Nobody yet. Add team members or guests.' : 'Nobody has been added yet.', (list) => {
      const shown = input.showAllPeople ? list : list.slice(0, PEOPLE_FIRST);
      const out: DetailRow[] = shown.map((attendee) => ({ kind: 'person', key: `person:${attendee.id}`, section: 'people', attendee }));
      if (list.length > PEOPLE_FIRST) out.push({ kind: 'more', key: 'people:more', section: 'people', total: list.length, expanded: input.showAllPeople });
      return out;
    }),
  );

  rows.push(title('notes', 'Live notes', notes.data?.length ? String(notes.data.length) : undefined));
  rows.push(
    ...partRows('notes', notes, 'No notes yet. Capture discussion, decisions and actions as the meeting unfolds.', (list) => {
      const shown = filterNotes(list, input.noteFilter);
      const out: DetailRow[] = [{ kind: 'noteFilters', key: 'notes:filters', section: 'notes' }];
      if (shown.length === 0) out.push({ kind: 'empty', key: 'notes:empty', section: 'notes', text: 'No notes in this category.' });
      for (const note of shown) out.push({ kind: 'note', key: `note:${note.id}`, section: 'notes', note });
      return out;
    }),
  );

  rows.push(title('actions', 'Action items', actions.data?.length ? `${openActionCount(actions.data)} open of ${actions.data.length}` : undefined));
  rows.push(...partRows('actions', actions, 'No action items yet. Add them here, or turn an action note into a task.', (items) => items.map((item) => ({ kind: 'action', key: `action:${item.id}`, section: 'actions', item }))));

  rows.push(title('minutes', 'Final MOM'));
  if (minutes.data) rows.push({ kind: 'minutes', key: 'minutes', section: 'minutes', minutes: minutes.data });
  else rows.push(minutes.failed ? { kind: 'failed', key: 'minutes:failed', section: 'minutes' } : { kind: 'loading', key: 'minutes:loading', section: 'minutes' });
  return rows;
}
