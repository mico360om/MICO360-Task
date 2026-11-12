import type { ApiClient } from '../lib/api-client';
import type { ApiTask } from './tasks';
import type { CalendarOccurrence } from '../lib/calendar-model';
import type { CalendarChecklistItem } from '../lib/calendar-checklist';

export interface CalendarRange {
  from: string;
  to: string;
  timeZone: string;
  /** Tasks due in the range, in projects you can see. */
  tasks: ApiTask[];
  /** Days repeating tasks will be copied to (computed by the server, not stored). */
  occurrences: CalendarOccurrence[];
  /** The newest copy of each series the occurrences come from. */
  series: ApiTask[];
  /** 1.23.3: checklist items due in the range (mine, and those of projects I can see); an older server sends none. */
  checklistItems?: CalendarChecklistItem[];
  /** Calendar scheduling: tasks the range shows by their start or their bar (start → due) while not due in it. */
  spanning?: ApiTask[];
  /** Calendar scheduling: my planned time (work blocks) — and with the Team view, that of people on projects I run. */
  workBlocks?: CalBlock[];
  /** Calendar scheduling: my reminders, at their times. */
  reminders?: CalReminder[];
  /** Calendar scheduling: whether I have the Team view, and whether it is on. */
  team?: { available: boolean; on: boolean };
}

/** Planned time to work on a task (a work block), as the calendar shows it. */
export interface CalBlock {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
  userId: string;
  userName: string;
  plannedById: string;
  plannedByName: string;
  startAt: string;
  endAt: string;
  /** My own time. */
  mine: boolean;
  /** I may move, resize or remove it. */
  canChange: boolean;
  /** Its task is done (a past block kept as history). */
  done: boolean;
}

/** One of my reminders, as the calendar shows it (a bell mark at its time). */
export interface CalReminder {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
  fireAt: string;
  at: string | null;
  anchor: 'start' | 'due' | null;
  offsetMinutes: number | null;
  setById: string;
  /** Who set it, when someone else did ("set by Sara"). */
  setByName: string | null;
  state: 'wait' | 'send' | 'sent' | 'missed' | 'muted';
  snoozedUntil: string | null;
}

/** A person's own Calendar choices (remembered on the server). */
export interface CalendarPrefs {
  layout: 'split' | 'full';
  show: { tasks: boolean; meetings: boolean; blocks: boolean; reminders: boolean };
  team: boolean;
}

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = { layout: 'split', show: { tasks: true, meetings: true, blocks: true, reminders: true }, team: false };

export function calendarApi(client: ApiClient) {
  return {
    /** One visible range of days ('YYYY-MM-DD', at most 101); `team`: also the blocks of people on projects I run. */
    range: (from: string, to: string, opts: { team?: boolean } = {}) =>
      client.get<{ data: CalendarRange }>(`/calendar?from=${from}&to=${to}${opts.team ? '&team=1' : ''}`).then((r) => r.data),
    /** My Calendar choices (Split | Full, Show, Team). */
    prefs: () => client.get<{ data: CalendarPrefs }>('/calendar/preferences').then((r) => r.data),
    savePrefs: (patch: Partial<Omit<CalendarPrefs, 'show'>> & { show?: Partial<CalendarPrefs['show']> }) =>
      client.put<{ data: CalendarPrefs }>('/calendar/preferences', patch).then((r) => r.data),
    /** Open tasks already past their due day (company time). */
    overdue: () => client.get<{ data: ApiTask[] }>('/tasks?overdue=true').then((r) => r.data),
  };
}
