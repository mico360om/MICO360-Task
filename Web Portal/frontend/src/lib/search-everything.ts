/**
 * 1.23 Search everything, the website's side: what a result is (GET /search/all, the AI panel, the
 * top bar's `more`), each kind's name, the filters as the Search results address keeps them, and
 * where each result opens. Pure functions, tested on their own.
 */
import { formatDueDay } from './due-display';
import type { HighlightRange, TaskSearchMatch } from './search-highlight';
import { MAX_QUERY_LETTERS } from './search-highlight';

export const SEARCH_KINDS = ['task', 'project', 'meeting', 'note', 'minutes', 'file', 'inspection'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_META: Record<SearchKind, { label: string; plural: string }> = {
  task: { label: 'Task', plural: 'Tasks' },
  project: { label: 'Project', plural: 'Projects' },
  meeting: { label: 'Meeting', plural: 'Meetings' },
  note: { label: 'Note', plural: 'Notes' },
  minutes: { label: 'Minutes', plural: 'Minutes' },
  file: { label: 'File', plural: 'Files' },
  inspection: { label: 'Inspection', plural: 'Inspections' },
};

export type SearchTarget =
  | { type: 'task'; taskId: string }
  | { type: 'file'; taskId: string; fileId: string }
  | { type: 'project'; projectId: string }
  | { type: 'meeting'; meetingId: string; noteId?: string; section?: 'minutes' }
  | { type: 'inspection'; inspectionId: string };

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  titleRanges: HighlightRange[];
  key?: string;
  formerKeys?: string[];
  context?: string;
  project: { id: string; code: string; name: string; archived: boolean; color: string; icon: string | null; imageUrl: string | null } | null;
  status: { label: string; category: string | null; done: boolean } | null;
  date: { at: string; kind: 'due' | 'starts' | 'written' | 'added' | 'started' | 'approved' | 'saved' | 'created' } | null;
  people: { names: string[]; count: number } | null;
  matches: (Omit<TaskSearchMatch, 'field'> & { field: string })[];
  target: SearchTarget;
  /** Found by a corrected spelling, or holding only some of the words. */
  match?: 'close' | 'some';
}

/** The Search results page's filters, as its address keeps them. */
export interface EverythingFilters {
  q: string;
  /** One kind, or all. */
  type?: SearchKind;
  projectId?: string;
  /** A task column category (only with tasks). */
  status?: string;
  /** A person's id, or "me". */
  person?: string;
  /** Company days, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** true: finished only; false: open only. */
  done?: boolean;
  archived?: boolean;
  /** The AI panel answers (asked with Enter, "Ask AI", or from the top bar). */
  ai?: boolean;
}

const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function everythingFilters(params: URLSearchParams): EverythingFilters {
  const type = params.get('type');
  const status = params.get('status');
  const done = params.get('done');
  const from = params.get('from');
  const to = params.get('to');
  return {
    q: params.get('q') ?? '',
    ...(type && (SEARCH_KINDS as readonly string[]).includes(type) ? { type: type as SearchKind } : status && TASK_STATUSES.includes(status) && !type ? { type: 'task' as const } : {}),
    ...(params.get('project') ? { projectId: params.get('project')! } : {}),
    ...(status && TASK_STATUSES.includes(status) ? { status } : {}),
    // An address from before 1.23 said "assignee".
    ...(params.get('person') || params.get('assignee') ? { person: (params.get('person') || params.get('assignee'))! } : {}),
    ...(from && DAY.test(from) ? { from } : {}),
    ...(to && DAY.test(to) ? { to } : {}),
    ...(done === 'true' || done === 'false' ? { done: done === 'true' } : {}),
    ...(params.get('archived') === 'true' ? { archived: true } : {}),
    ...(params.get('ai') === '1' ? { ai: true } : {}),
  };
}

/** The Search results address ("q=…&type=…"), only what is set. */
export function everythingAddress(f: EverythingFilters): string {
  const p = new URLSearchParams();
  p.set('q', String(f.q ?? '').trim().slice(0, MAX_QUERY_LETTERS));
  if (f.type) p.set('type', f.type);
  if (f.projectId) p.set('project', f.projectId);
  if (f.status) p.set('status', f.status);
  if (f.person) p.set('person', f.person);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.done !== undefined) p.set('done', String(f.done));
  if (f.archived) p.set('archived', 'true');
  if (f.ai) p.set('ai', '1');
  return p.toString();
}

export const hasEverythingFilters = (f: EverythingFilters): boolean => Boolean(f.type || f.projectId || f.status || f.person || f.from || f.to || f.done !== undefined || f.archived);

/** GET /search/all's query for these filters (a task status only when tasks are asked for). */
export function allQuery(f: EverythingFilters, cursor?: string): string {
  const p = new URLSearchParams({ q: f.q.trim() });
  if (f.type) p.set('type', f.type);
  if (f.projectId) p.set('projectId', f.projectId);
  if (f.status && f.type === 'task') p.set('status', f.status);
  if (f.person) p.set('person', f.person);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.done !== undefined) p.set('done', String(f.done));
  if (f.archived) p.set('archived', 'true');
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

const DATE_WORD: Record<NonNullable<SearchHit['date']>['kind'], string> = {
  due: 'Due',
  starts: 'Starts',
  written: 'Written',
  added: 'Added',
  started: 'Started',
  approved: 'Approved',
  saved: 'Saved',
  created: 'Created',
};

/** "Due 31 Oct 2026", "Starts 10 Nov 2026"… in the company's days; null without a date. */
export function dateLabel(hit: Pick<SearchHit, 'date'>, timeZone: string): string | null {
  if (!hit.date) return null;
  const day = formatDueDay(hit.date.at, timeZone);
  return day ? `${DATE_WORD[hit.date.kind]} ${day}` : null;
}

/** Where a result opens as a page; null for a task or a file (they open in the task panel). */
export function targetLink(hit: Pick<SearchHit, 'target'>): string | null {
  const t = hit.target;
  switch (t.type) {
    case 'project':
      return `/projects/${encodeURIComponent(t.projectId)}`;
    case 'meeting':
      return `/meetings/${encodeURIComponent(t.meetingId)}${t.noteId ? `#note-${encodeURIComponent(t.noteId)}` : t.section === 'minutes' ? '#final-minutes' : ''}`;
    case 'inspection':
      return `/inspections/${encodeURIComponent(t.inspectionId)}`;
    default:
      return null;
  }
}
