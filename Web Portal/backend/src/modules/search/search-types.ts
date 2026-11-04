import type { TextRange } from './task-search-text';

/** 1.23 Search everything: the kinds of result, in the order the results page lists their filters. */
export const SEARCH_KINDS = ['task', 'project', 'meeting', 'note', 'minutes', 'file', 'inspection'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Where a result matched (a task's comment, a meeting's agenda item, the text inside a file…). */
export interface SearchMatch {
  field: string;
  /** "Comment by Bilal · 28 Oct 2026", "Agenda item", "Text in the file"… */
  label: string;
  /** About 140 characters around the match. */
  snippet: string;
  /** What to highlight in `snippet` (UTF-16 positions, end exclusive). */
  ranges: TextRange[];
}

/** Where a result opens. */
export type SearchTarget =
  | { type: 'task'; taskId: string }
  | { type: 'file'; taskId: string; fileId: string }
  | { type: 'project'; projectId: string }
  | { type: 'meeting'; meetingId: string; noteId?: string; section?: 'minutes' }
  | { type: 'inspection'; inspectionId: string };

export interface SearchHit {
  kind: SearchKind;
  /** The item's id (the minutes: its meeting's; a file: the attachment's). */
  id: string;
  title: string;
  titleRanges: TextRange[];
  /** A task's number (a file: its task's), and the numbers it had before a move. */
  key?: string;
  formerKeys?: string[];
  /** What it belongs to, shown under the title ("MICO-12 Fix the pump", a note's meeting). */
  context?: string;
  project: { id: string; code: string; name: string; archived: boolean; color: string; icon: string | null; imageUrl: string | null } | null;
  /** Its state: a task's column, a meeting's status, "Final" minutes, a finished inspection… */
  status: { label: string; category: string | null; done: boolean } | null;
  /** Its date, and what that date is. */
  date: { at: string; kind: 'due' | 'starts' | 'written' | 'added' | 'started' | 'approved' | 'saved' | 'created' } | null;
  /** Who: a task's assignees, a meeting's organizer, a note's author, a file's uploader, an inspector. */
  people: { names: string[]; count: number } | null;
  matches: SearchMatch[];
  target: SearchTarget;
  /** Found by a corrected spelling ('close') or holding only some of the words ('some'). */
  match?: 'close' | 'some';
}
