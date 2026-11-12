/**
 * 1.23 Search everything, the website's side: what a result is (GET /search/all, the AI panel, the
 * top bar's `more`), each kind's name, the filters as the Search results address keeps them, and
 * where each result opens. Pure functions, tested on their own.
 */
import { formatDueDay } from './due-display';
import type { HighlightRange, TaskSearchMatch } from './search-highlight';
import { MAX_QUERY_LETTERS } from './search-highlight';

export const SEARCH_KINDS = ['task', 'project', 'meeting', 'note', 'minutes', 'file', 'inspection', 'checklist', 'contact'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_META: Record<SearchKind, { label: string; plural: string }> = {
  task: { label: 'Task', plural: 'Tasks' },
  project: { label: 'Project', plural: 'Projects' },
  meeting: { label: 'Meeting', plural: 'Meetings' },
  note: { label: 'Note', plural: 'Notes' },
  minutes: { label: 'Minutes', plural: 'Minutes' },
  file: { label: 'File', plural: 'Files' },
  inspection: { label: 'Inspection', plural: 'Inspections' },
  // 1.23.6
  checklist: { label: 'Checklist item', plural: 'Checklist items' },
  contact: { label: 'Client or contact', plural: 'Clients & contacts' },
};

/** 1.23.6: a "Clients & contacts" result is one of three. */
export const CONTACT_SUB_LABEL: Record<'client' | 'account' | 'external', string> = { client: 'Client', account: 'Client account', external: 'External contact' };

export type SearchTarget =
  | { type: 'task'; taskId: string }
  | { type: 'file'; taskId: string; fileId: string }
  | { type: 'project'; projectId: string }
  | { type: 'meeting'; meetingId: string; noteId?: string; section?: 'minutes' }
  | { type: 'inspection'; inspectionId: string }
  // 1.23.6: a checklist item or an external contact in its task; a client's projects; a client account.
  | { type: 'checklist'; taskId: string; itemId: string }
  | { type: 'contact'; taskId: string; contactId: string }
  | { type: 'client'; name: string }
  | { type: 'account'; userId: string };

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
  /** 1.23.6 Clients & contacts: which of the three it is. */
  sub?: 'client' | 'account' | 'external';
  /** Task archive: a task result that is archived (it opens read-only). */
  archived?: boolean;
}

/** 1.23.6 The built-in reader's chips (the server reads the words as typed). */
export const READER_CHIP_KEYS = ['kind', 'due', 'when', 'done', 'status', 'approval', 'priority', 'category', 'project', 'assignee', 'mine', 'creator', 'organizer'] as const;
export type ReaderChipKey = (typeof READER_CHIP_KEYS)[number];
/** What the reader understood: a chip per filter, the words left to search, the chips taken off. */
export interface Understood {
  chips: { key: ReaderChipKey; label: string; text: string }[];
  words: string;
  removed: { key: ReaderChipKey; label: string }[];
  /** The kinds the kind chip reads as. */
  kinds?: SearchKind[];
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
  /** 1.23.6: the reader's chips taken off. */
  off?: ReaderChipKey[];
  /** 1.23.6: "Search the words instead" — every word as typed, nothing read. */
  plain?: boolean;
  /** 1.24: a category (of the chosen project), a guest and a guest company — tasks only. */
  category?: string;
  guest?: string;
  guestCompany?: string;
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
    ...(offOf(params.get('off')).length ? { off: offOf(params.get('off')) } : {}),
    ...(params.get('plain') === '1' ? { plain: true } : {}),
    // 1.24: tasks only (a filter of one of them makes the search one of tasks, as a status does).
    ...(params.get('category') ? { category: params.get('category')!.slice(0, 64) } : {}),
    ...(params.get('guest') ? { guest: params.get('guest')!.slice(0, 64) } : {}),
    ...(params.get('guestCompany') ? { guestCompany: params.get('guestCompany')!.slice(0, 120) } : {}),
    ...(!type && (params.get('category') || params.get('guest') || params.get('guestCompany')) ? { type: 'task' as const } : {}),
  };
}

/** The chips taken off, as the address keeps them ("due,project"), known ones only. */
function offOf(raw: string | null): ReaderChipKey[] {
  if (!raw) return [];
  const known = READER_CHIP_KEYS as readonly string[];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s): s is ReaderChipKey => known.includes(s)))];
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
  if (f.off?.length) p.set('off', f.off.join(','));
  if (f.plain) p.set('plain', '1');
  if (f.ai) p.set('ai', '1');
  if (f.category) p.set('category', f.category);
  if (f.guest) p.set('guest', f.guest);
  if (f.guestCompany) p.set('guestCompany', f.guestCompany);
  return p.toString();
}

export const hasEverythingFilters = (f: EverythingFilters): boolean =>
  Boolean(f.type || f.projectId || f.status || f.person || f.from || f.to || f.done !== undefined || f.archived || f.category || f.guest || f.guestCompany);

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
  if (f.off?.length) p.set('off', f.off.join(','));
  if (f.plain) p.set('plain', 'true');
  if (f.type === 'task') {
    if (f.category) p.set('category', f.category);
    if (f.guest) p.set('guest', f.guest);
    if (f.guestCompany) p.set('guestCompany', f.guestCompany);
  }
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
    // 1.23.6: a client opens the Projects page filtered to it; a client account in User Management.
    case 'client':
      return `/projects?client=${encodeURIComponent(t.name)}`;
    case 'account':
      return `/admin/users?open=${encodeURIComponent(t.userId)}`;
    default:
      return null;
  }
}

/** 1.23.6: where a result opens in the task panel — its task, with the file, checklist item or contact marked. */
export function taskPanelOf(hit: Pick<SearchHit, 'target'>): { task: string; mark?: ['file' | 'item' | 'contact', string] } | null {
  const t = hit.target;
  switch (t.type) {
    case 'task':
      return { task: t.taskId };
    case 'file':
      return { task: t.taskId, mark: ['file', t.fileId] };
    case 'checklist':
      return { task: t.taskId, mark: ['item', t.itemId] };
    case 'contact':
      return { task: t.taskId, mark: ['contact', t.contactId] };
    default:
      return null;
  }
}

/** 1.23.6 A saved search's filters (the Search page's address without the words). */
export interface SavedFilters {
  type?: SearchKind;
  projectId?: string;
  status?: string;
  person?: string;
  from?: string;
  to?: string;
  done?: boolean;
  archived?: boolean;
  off?: ReaderChipKey[];
  plain?: boolean;
}

/** The Search page's filters as a saved search keeps them (never the AI flag). */
export function savedFiltersOf(f: EverythingFilters): SavedFilters {
  return {
    ...(f.type ? { type: f.type } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.person ? { person: f.person } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.done !== undefined ? { done: f.done } : {}),
    ...(f.archived ? { archived: true } : {}),
    ...(f.off?.length ? { off: f.off } : {}),
    ...(f.plain ? { plain: true } : {}),
  };
}

/** The Search page's address of a saved search. */
export function savedAddress(s: { q: string; filters: SavedFilters }): string {
  return everythingAddress({ q: s.q, ...s.filters });
}

/** Is the page showing this saved search (the same words and filters)? */
export function isSavedSearch(f: EverythingFilters, s: { q: string; filters: SavedFilters }): boolean {
  return everythingAddress({ ...f, ai: undefined }) === savedAddress(s);
}
