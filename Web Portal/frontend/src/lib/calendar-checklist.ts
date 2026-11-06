/**
 * Checklist items on the calendar (1.23.3, owner): an item with a due date shows on that day — across
 * all projects for the person it is assigned to, and on a project's calendar for anyone viewing it.
 * The page's filters apply where they mean something for an item (people, done, late, words).
 */
import type { CalendarFilters } from './calendar-model';
import { matchesTaskNumber } from './task-number';

/** One dated item, as GET /calendar sends it. */
export interface CalendarChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** 'YYYY-MM-DD'. */
  dueDate: string;
  assigneeId: string | null;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
}

interface Context {
  myId: string;
  /** Today ('YYYY-MM-DD'): an open item before it is late. */
  today: string;
  projectStatus: (projectId: string) => string | undefined;
}

/** The items to show, by day; open ones first, then done. */
export function checklistByDay(items: CalendarChecklistItem[] | undefined, f: CalendarFilters, ctx: Context): Map<string, CalendarChecklistItem[]> {
  const q = f.q.trim().toLocaleLowerCase('en');
  const days = new Map<string, CalendarChecklistItem[]>();
  // Items have no priority: a priority filter is about tasks only.
  if (f.priorities.length) return days;
  for (const i of items ?? []) {
    if (!i || typeof i.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(i.dueDate)) continue;
    // One project's calendar: its items. Every project: mine.
    if (f.projectId ? i.projectId !== f.projectId : i.assigneeId !== ctx.myId && !f.assigneeId) continue;
    if (f.mine && i.assigneeId !== ctx.myId) continue;
    if (f.assigneeId && i.assigneeId !== f.assigneeId) continue;
    if (!f.showCompleted && i.done) continue;
    if (!f.showArchived && ctx.projectStatus(i.projectId) === 'ARCHIVED') continue;
    const day = i.dueDate.slice(0, 10);
    const status = i.done ? 'done' : day < ctx.today ? 'overdue' : 'todo';
    if (f.statuses.length && !f.statuses.includes(status)) continue;
    if (q && !i.text.toLocaleLowerCase('en').includes(q) && !i.taskKey.toLocaleLowerCase('en').includes(q) && !matchesTaskNumber(q, i.taskKey)) continue;
    days.set(day, [...(days.get(day) ?? []), i]);
  }
  for (const list of days.values()) list.sort((a, b) => Number(a.done) - Number(b.done));
  return new Map([...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
