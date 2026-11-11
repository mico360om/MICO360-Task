import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { calendarApi, DEFAULT_CALENDAR_PREFS, type CalBlock, type CalReminder, type CalendarPrefs, type CalendarRange } from '../api/calendar';
import { meetingsApi } from '../api/meetings';
import { schedulingApi } from '../api/scheduling';
import { columnsApi } from '../api/columns';
import { filterCalendarMeetings, groupMeetingsByDay, meetingItems, meetingRange, type CalMeeting } from '../lib/calendar-meetings';
import { checklistByDay as checklistItemsByDay } from '../lib/calendar-checklist';
import { projectsApi } from '../api/projects';
import { useProjectsWithAll } from '../lib/useProjectsWith';
import { tasksApi, type ApiTask } from '../api/tasks';
import { usersApi } from '../api/users';
import { useAuthStore } from '../stores/auth-store';
import { shiftDayKey, todayKey } from '../lib/due-date';
import { shiftMonth, visibleRange, weekDays, type CalendarView } from '../lib/calendar';
import { applyFilters, buildItems, filtersFromParams, filtersToParams, activeFilterCount, DEFAULT_FILTERS, type CalendarFilters, type CalItem } from '../lib/calendar-model';
import { buildSpanItems, type SpanItem } from '../lib/calendar-span';
import { canReschedule, needsSeriesChoice, type MoveScope } from '../lib/calendar-reschedule';
import { blockMovePlan, blockResizePlan, canDragMeeting, meetingMovePlan, planDatesUndo, planEdge, planShift, waitWords, type DatesPayload } from '../lib/calendar-plan';
import { instantAt, minutesAt, timeLabel } from '../lib/calendar-hours';
import type { DragPayload } from '../lib/calendar-dnd';
import { useDateSettings } from '../lib/useDatePrefs';
import { invalidateTaskQueries } from '../lib/task-cache';
import { PageTitle } from '../components/ui/PageHeader';
import { useFrameOffset } from '../lib/useFrameOffset';
import { useOpenTask } from '../lib/useOpenTask';
import { NewTaskModal } from '../components/NewTaskModal';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { useCurrentProject } from '../components/CurrentProject';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { CalendarFilterBar, CalendarToolbar, ShowMenu } from '../components/calendar/CalendarToolbar';
import { LegendButton, dayLabel, fullDayLabel, useMediaQuery } from '../components/calendar/calendar-ui';
import { calendarOrder } from '../lib/calendar-order';
import { AgendaView, MobileMonth, WeekView, type ViewProps } from '../components/calendar/views';
import { MonthGrid } from '../components/calendar/MonthGrid';
import { HourGrid, useNow } from '../components/calendar/HourGrid';
import { DayPanel, type PanelMeeting } from '../components/calendar/DayPanel';
import { BlockChip, BellIcon, reminderName, type KeyMove } from '../components/calendar/schedule-chips';
import { BlockDialog, MeetingMoveDialog, PlanTimeDialog, RemindDialog, SlotMenu, reasonOf, type TaskOption } from '../components/calendar/scheduling-dialogs';
import { MoveChoiceDialog, Shell, TaskPreview } from '../components/calendar/dialogs';
import { projectOption } from '../components/project-option';
import { isProjectArchived } from '../lib/project-archive';
import { useWorkingTime } from '../lib/useWorkingTime';
import { dayOffReason } from '../lib/working-days';
import { approvalNotice } from '../lib/approvals';
import { useDensity } from '../lib/density';

const VIEWS: CalendarView[] = ['month', 'week', 'day', 'agenda'];
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const EMPTY: CalendarRange = { from: '', to: '', timeZone: '', tasks: [], occurrences: [], series: [] };
const PREFS_KEY = ['calendar', 'prefs'] as const;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** The period a view shows, e.g. "October 2026", "4 – 10 Oct 2026" or "Thursday 12 November 2026". */
function periodLabel(view: CalendarView, cursor: string, weekStart: 0 | 1 | 6): string {
  if (view === 'day') return `${dayLabel(cursor, { weekday: 'long', day: 'numeric', month: 'long' })} ${cursor.slice(0, 4)}`;
  if (view !== 'week') return dayLabel(cursor, { month: 'long', year: 'numeric' });
  const days = weekDays(cursor, weekStart);
  const [a, b] = [days[0]!, days[6]!];
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  const sameMonth = sameYear && a.slice(0, 7) === b.slice(0, 7);
  const start = dayLabel(a, sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${dayLabel(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

type Toast = { tone: 'moved' | 'error'; text: string; undo?: () => void };

interface PlaceState {
  view: CalendarView;
  /** The day shown ('YYYY-MM-DD'); null = today. */
  date: string | null;
  filters: CalendarFilters;
}

function placeFromParams(p: URLSearchParams): PlaceState {
  const v = p.get('view') as CalendarView | null;
  return { view: v && VIEWS.includes(v) ? v : 'month', date: isDay(p.get('date')) ? p.get('date') : null, filters: filtersFromParams(p) };
}

/** The address for a place (an open task panel's `task` is kept, and the checklist item it was opened at). */
function paramsFor(s: PlaceState, keep: URLSearchParams): URLSearchParams {
  const next = filtersToParams(s.filters);
  if (s.view !== 'month') next.set('view', s.view);
  if (s.date) next.set('date', s.date);
  const task = keep.get('task');
  if (task) next.set('task', task);
  const item = keep.get('item');
  if (task && item) next.set('item', item);
  return next;
}

/** The task as the cached range keeps it, patched with a change being saved (or the saved task). */
const patchTask = (t: ApiTask, patch: DatesPayload | ApiTask): ApiTask => {
  if ('id' in patch) return { ...t, ...patch };
  return {
    ...t,
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.recurrenceRule ? { recurrenceRule: patch.recurrenceRule } : {}),
  };
};

/** A day's stored date ('YYYY-MM-DD' or an instant) as the calendar's day. */
const dayOfValue = (value: string, timeZone: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) || value.endsWith('T00:00:00.000Z') ? value.slice(0, 10) : minutesAt(value, timeZone).day);

export function CalendarPage() {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const [params, setParams] = useSearchParams();
  const { timeZone, ownTimeZone, weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  const now = useNow();
  const phone = useMediaQuery('(max-width: 639px)');
  // Below 1024px a month day is too narrow for bars: the month shows day marks and the chosen day's list.
  const compactMonth = useMediaQuery('(max-width: 1023px)');
  // From 1280px the calendar and the chosen day's list sit side by side (the split view, owner).
  const wide = useMediaQuery('(min-width: 1280px)');
  const fit = !compactMonth;
  const pageRef = useRef<HTMLDivElement>(null);
  const pageTop = useFrameOffset(pageRef, fit);
  // Names not cut (owner): a month bar's title takes one line in compact rows, two in comfortable, three in detailed.
  const density = useDensity();
  const lines = density === 'compact' ? 1 : density === 'detailed' ? 3 : 2;

  // View, day and filters change at once here, and are copied to the address (see the calendar memory:
  // reading them back from the router made a ticked box flicker).
  const [place, setPlace] = useState<PlaceState>(() => placeFromParams(params));
  const written = useRef(params.toString());
  useEffect(() => {
    const next = paramsFor(place, params);
    if (next.toString() === params.toString()) return;
    written.current = next.toString();
    setParams(next, { replace: true });
  }, [place]);
  useEffect(() => {
    if (params.toString() === written.current) return;
    written.current = params.toString();
    setPlace(placeFromParams(params));
  }, [params]);
  const { view, filters } = place;
  useCurrentProject(filters.projectId);
  const cursor = place.date ?? today;
  const navigate = useCallback((patch: Partial<PlaceState>) => setPlace((s) => ({ ...s, ...patch })), []);

  // ── The person's own choices (Split | Full, Show, Team), remembered on the server ──
  const prefsQ = useQuery({ queryKey: PREFS_KEY, queryFn: () => calendarApi(apiClient).prefs(), staleTime: 5 * 60_000 });
  const prefs: CalendarPrefs = prefsQ.data && prefsQ.data.show ? prefsQ.data : DEFAULT_CALENDAR_PREFS;
  const savePrefs = useMutation({
    mutationFn: (patch: Parameters<ReturnType<typeof calendarApi>['savePrefs']>[0]) => calendarApi(apiClient).savePrefs(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const before = qc.getQueryData<CalendarPrefs>(PREFS_KEY);
      const base = before ?? DEFAULT_CALENDAR_PREFS;
      qc.setQueryData<CalendarPrefs>(PREFS_KEY, { ...base, ...patch, show: { ...base.show, ...(patch.show ?? {}) } });
      return { before };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.before) qc.setQueryData(PREFS_KEY, ctx.before);
    },
    onSuccess: (data) => qc.setQueryData(PREFS_KEY, data),
  });
  const split = wide && prefs.layout === 'split' && view !== 'agenda';

  const { from, to } = visibleRange(view, cursor, weekStart);
  const team = prefs.team;
  const rangeKey = useMemo(() => ['calendar', from, to, team ? 'team' : 'mine'] as const, [from, to, team]);
  // Asked once the person's choices are known (their Team view changes the answer).
  const rangeQ = useQuery({ queryKey: rangeKey, queryFn: () => calendarApi(apiClient).range(from, to, { team }), placeholderData: keepPreviousData, enabled: !prefsQ.isLoading });
  const overdueQ = useQuery({ queryKey: ['calendar', 'overdue'], queryFn: () => calendarApi(apiClient).overdue(), enabled: view === 'agenda' || split || compactMonth });
  const span = meetingRange(from, to, timeZone);
  const meetingsQ = useQuery({
    queryKey: ['meetings', 'range', span.from, span.to],
    queryFn: () => meetingsApi(apiClient).list({ from: span.from, to: span.to }),
    placeholderData: keepPreviousData,
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  // Working days, hours and days off for the visible days (call 7): the filtered project's company, else the page's scope.
  const working = useWorkingTime({ projectId: filters.projectId || null, from, to });
  const dayOff = useCallback((day: string) => (working.calendar ? dayOffReason(day, working.calendar) : null), [working.calendar]);

  const projects = useMemo(() => (Array.isArray(projectsQ.data) ? projectsQ.data : []), [projectsQ.data]);
  const range = rangeQ.data ?? EMPTY;
  // Names and colours: an administrator's own tasks show from projects off their "my projects" list too.
  const shownProjectIds = useMemo(
    () => [...range.tasks, ...(range.spanning ?? []), ...(Array.isArray(overdueQ.data) ? overdueQ.data : [])].map((t) => t.projectId),
    [range, overdueQ.data],
  );
  const { projects: namedProjects } = useProjectsWithAll(shownProjectIds);
  const projectById = useMemo(() => new Map(namedProjects.map((p) => [p.id, p])), [namedProjects]);
  const colorOf = useCallback((id: string) => projectById.get(id)?.color, [projectById]);
  const projectStatus = useCallback((id: string) => {
    const p = projectById.get(id);
    return p && isProjectArchived(p) ? 'ARCHIVED' : p?.status;
  }, [projectById]);
  const people = useMemo(() => new Map((Array.isArray(dirQ.data) ? dirQ.data : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.username])), [dirQ.data]);

  // ── What is shown (filters, and the person's Show choices) ──
  const show = prefs.show;
  const items = useMemo(() => buildSpanItems(range, { today, timeZone, projectStatus }), [range, today, timeZone, projectStatus]);
  // Overdue work from before the visible days (today's list shows it): found for opening and dragging too.
  const overdueSpan = useMemo(
    () => (Array.isArray(overdueQ.data) ? buildSpanItems({ tasks: overdueQ.data, occurrences: [], series: [] }, { today, timeZone, projectStatus }) : []),
    [overdueQ.data, today, timeZone, projectStatus],
  );
  const taskItem = useCallback((id: string) => items.find((i) => i.kind === 'task' && i.task.id === id) ?? overdueSpan.find((i) => i.task.id === id) ?? null, [items, overdueSpan]);
  const shown = useMemo(() => (show.tasks ? applyFilters(items, filters, { myId }) : []), [items, filters, myId, show.tasks]);
  // The lists by day (phone month, agenda, phone week): a task on its due day, and on its start day too.
  const byDay = useMemo(() => {
    const days = new Map<string, CalItem[]>();
    const add = (day: string, item: CalItem) => days.set(day, [...(days.get(day) ?? []), item]);
    for (const i of shown) {
      add(i.date, i);
      if (i.start && i.start !== i.date && (i.mode === 'bar' || i.mode === 'markers')) add(i.start, { ...i, key: `${i.key}:start`, date: i.start });
    }
    // Each day's most urgent first (as groupByDay orders a day): its list, and Previous / Next through it.
    const rank = calendarOrder(shown);
    const rankOf = (i: CalItem) => rank.get(i.key.replace(/:start$/, '')) ?? 0;
    for (const list of days.values()) list.sort((a, b) => rankOf(a) - rankOf(b));
    return days;
  }, [shown]);
  const rawMeetings = useMemo(() => (Array.isArray(meetingsQ.data) ? (meetingsQ.data as PanelMeeting[]) : []), [meetingsQ.data]);
  const meetingById = useMemo(() => new Map(rawMeetings.map((m) => [m.id, m])), [rawMeetings]);
  const shownMeetings = useMemo(() => (show.meetings ? filterCalendarMeetings(meetingItems(rawMeetings, timeZone), filters, { myId }) : []), [rawMeetings, timeZone, filters, myId, show.meetings]);
  const meetingsByDay = useMemo(() => groupMeetingsByDay(shownMeetings), [shownMeetings]);
  const meetingEnd = useCallback((id: string) => meetingById.get(id)?.endAt ?? null, [meetingById]);
  const checklistByDay = useMemo(
    () => (show.tasks ? checklistItemsByDay(range.checklistItems, filters, { myId, today, projectStatus }) : new Map<string, never[]>()),
    [range, filters, myId, today, projectStatus, show.tasks],
  );
  const q = filters.q.trim().toLocaleLowerCase('en');
  // Planned time and reminders follow the project filter and the words (they belong to a task).
  const matchesExtra = useCallback(
    (x: { projectId: string; taskKey: string; taskTitle: string }) =>
      (!filters.projectId || x.projectId === filters.projectId) &&
      (filters.showArchived || projectStatus(x.projectId) !== 'ARCHIVED') &&
      (!q || x.taskTitle.toLocaleLowerCase('en').includes(q) || x.taskKey.toLocaleLowerCase('en').includes(q)),
    [filters.projectId, filters.showArchived, projectStatus, q],
  );
  const blocks = useMemo(() => (show.blocks ? (range.workBlocks ?? []).filter(matchesExtra) : []), [range, show.blocks, matchesExtra]);
  const reminders = useMemo(() => (show.reminders ? (range.reminders ?? []).filter(matchesExtra) : []), [range, show.reminders, matchesExtra]);
  const blocksByDay = useMemo(() => {
    const m = new Map<string, CalBlock[]>();
    for (const b of blocks) {
      const day = minutesAt(b.startAt, timeZone).day;
      m.set(day, [...(m.get(day) ?? []), b]);
    }
    return m;
  }, [blocks, timeZone]);
  const remindersByDay = useMemo(() => {
    const m = new Map<string, CalReminder[]>();
    for (const r of reminders) {
      const day = minutesAt(r.fireAt, timeZone).day;
      m.set(day, [...(m.get(day) ?? []), r]);
    }
    return m;
  }, [reminders, timeZone]);
  const overdueItems = useMemo(() => {
    if (!Array.isArray(overdueQ.data) || !show.tasks) return [];
    const list = buildItems({ tasks: overdueQ.data, occurrences: [], series: [] }, { today, timeZone, projectStatus }).filter((i) => i.status === 'overdue');
    return applyFilters(list, filters, { myId });
  }, [overdueQ.data, today, timeZone, projectStatus, filters, myId, show.tasks]);

  const projectOptions = useMemo(() => [{ value: '', label: 'All projects' }, ...projects.map(projectOption)], [projects]);
  const assigneeOptions = useMemo(() => {
    const list = Array.isArray(dirQ.data) ? dirQ.data : [];
    return [{ value: '', label: 'Everyone' }, ...list.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }))];
  }, [dirQ.data]);

  // ── The chosen day (the split view's list; the list under the calendar on a tablet or phone) ──
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen && chosen >= from && chosen <= to ? chosen : cursor >= from && cursor <= to ? cursor : from;

  // ── Dialogs, panel and notices ──
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [createOn, setCreateOn] = useState<string | null>(null);
  const [meetingAt, setMeetingAt] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ day: string; minutes: number; at: { x: number; y: number } } | null>(null);
  const [plan, setPlan] = useState<{ day: string; minutes: number; task: TaskOption | null } | null>(null);
  const [remind, setRemind] = useState<Pick<ApiTask, 'id' | 'key' | 'title' | 'startDate' | 'dueDate'> | null>(null);
  const [blockOpen, setBlockOpen] = useState<CalBlock | null>(null);
  const [meetingMove, setMeetingMove] = useState<{ m: CalMeeting; startAt: string; endAt: string; hasEnd: boolean } | null>(null);
  const openTask = useOpenTask();
  const [choice, setChoice] = useState<{ item: SpanItem; to: string; run: (scope: MoveScope) => void } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 9000 : 8000);
    return () => clearTimeout(t);
  }, [toast]);
  const itemByKey = useCallback((key: string) => {
    const k = key.replace(/:start$/, '');
    return items.find((i) => i.key === k) ?? overdueSpan.find((i) => i.key === k) ?? null;
  }, [items, overdueSpan]);
  const preview = previewKey ? itemByKey(previewKey) : null;
  const fail = (text: string) => setToast({ tone: 'error', text });

  // ── A task's dates: shown at once, saved, undoable — and put back if the save fails ──
  const patchRange = (taskId: string, patch: DatesPayload | ApiTask) =>
    qc.setQueryData<CalendarRange>(rangeKey, (old) =>
      old
        ? {
            ...old,
            tasks: old.tasks.map((t) => (t.id === taskId ? patchTask(t, patch) : t)),
            spanning: (old.spanning ?? []).map((t) => (t.id === taskId ? patchTask(t, patch) : t)),
          }
        : old,
    );
  const refresh = () => {
    void invalidateTaskQueries(qc);
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };

  async function saveDates(task: ApiTask, payload: DatesPayload, words: { done: string; back: string }, opts: { undoable?: boolean } = {}) {
    // A refetch still running (from the last move) must not paint the old dates back over this one.
    await qc.cancelQueries({ queryKey: rangeKey });
    const snapshot = qc.getQueryData<CalendarRange>(rangeKey);
    patchRange(task.id, payload);
    try {
      const saved = await tasksApi(apiClient).update(task.id, payload);
      patchRange(task.id, saved);
      refresh();
      setToast({
        tone: 'moved',
        text: words.done,
        undo:
          opts.undoable === false
            ? undefined
            : () => {
                setToast(null);
                void saveDates(saved, planDatesUndo(task, saved.version, payload), { done: words.back, back: words.done }, { undoable: false });
              },
      });
    } catch (err) {
      if (snapshot) qc.setQueryData(rangeKey, snapshot);
      fail(opts.undoable === false ? `Couldn’t undo the move of ${task.key} — ${reasonOf(err)}.` : `Couldn’t move ${task.key} — ${reasonOf(err)}. It’s back where it was.`);
    }
  }

  /** "Moved RIG-12 to Fri 20 Nov – Tue 24 Nov." (+ "It will wait until …" for a task nobody has started — call 6). */
  const movedWords = (item: SpanItem, payload: DatesPayload, scope: MoveScope) => {
    const nextStart = payload.startDate !== undefined ? (payload.startDate ? dayOfValue(payload.startDate, timeZone) : null) : item.start;
    const nextDue = payload.dueDate ? dayOfValue(payload.dueDate, timeZone) : item.due;
    const where = nextStart && nextDue && nextStart !== nextDue ? `${dayLabel(nextStart)} – ${dayLabel(nextDue)}` : nextDue ? dayLabel(nextDue) : nextStart ? `start ${dayLabel(nextStart)}` : '';
    const rep = item.task.recurrenceRule && payload.recurrenceRule ? (scope === 'series' ? ' (and the occurrences after it)' : ' (this occurrence only)') : '';
    const wait = payload.startDate !== undefined ? waitWords(item.task, nextStart, today) : null;
    return `Moved ${item.task.key} to ${where}${rep}.${wait ? ` ${wait}` : ''}`;
  };
  const backWords = (item: SpanItem) => `${item.task.key} is back where it was.`;

  /** A repeating newest copy whose due day moves asks "this occurrence / the series" first. */
  const withScope = (item: SpanItem, toDue: string | null, run: (scope: MoveScope) => void) => {
    if (toDue && toDue !== item.due && needsSeriesChoice(item.task)) setChoice({ item, to: toDue, run });
    else run('occurrence');
  };

  function shiftTask(item: SpanItem, days: number) {
    if (!days || !canReschedule(item)) return;
    withScope(item, item.due ? shiftDayKey(item.due, days) : null, (scope) => {
      const payload = planShift(item.task, days, scope, timeZone);
      void saveDates(item.task, payload, { done: movedWords(item, payload, scope), back: backWords(item) });
    });
  }
  function moveEdge(item: SpanItem, edge: 'start' | 'due', toDay: string) {
    if (!canReschedule(item)) return;
    if ((edge === 'start' ? item.start : item.due) === toDay) return;
    withScope(item, edge === 'due' ? toDay : null, (scope) => {
      const payload = planEdge(item.task, edge, toDay, timeZone, scope);
      if (!payload) return fail(edge === 'start' ? 'The start can’t be after the due date.' : 'The due date can’t be before the start.');
      void saveDates(item.task, payload, { done: movedWords(item, payload, scope), back: backWords(item) });
    });
  }

  // ── Planned time (work blocks — owner 2) ──
  const sched = schedulingApi(apiClient);
  const taskOf = (id: string) => items.find((i) => i.kind === 'task' && i.task.id === id)?.task ?? null;
  const remindTaskOf = (r: CalReminder) => taskOf(r.taskId) ?? { id: r.taskId, key: r.taskKey, title: r.taskTitle, startDate: null, dueDate: null };
  const blockWords = (b: { startAt: string; endAt: string }) =>
    `${dayLabel(minutesAt(b.startAt, timeZone).day)}, ${timeLabel(minutesAt(b.startAt, timeZone).minutes)}–${timeLabel(minutesAt(b.endAt, timeZone).minutes)}`;
  const afterBlocks = (taskId: string) => {
    void qc.invalidateQueries({ queryKey: ['calendar'] });
    void qc.invalidateQueries({ queryKey: ['task-blocks', taskId] });
    void qc.invalidateQueries({ queryKey: ['workload'] });
  };
  async function addBlock(taskId: string, body: { userId?: string; startAt: string; endAt: string }, key: string, opts: { quiet?: boolean } = {}): Promise<string | null> {
    try {
      const b = await sched.addBlock(taskId, body);
      afterBlocks(taskId);
      if (opts.quiet) {
        setToast({ tone: 'moved', text: `The planned time for ${key} is back.` });
        return null;
      }
      setToast({
        tone: 'moved',
        text: `Planned ${key}: ${blockWords(b)}${b.userId !== myId ? ` for ${b.userName}` : ''}.`,
        undo: () => {
          setToast(null);
          void sched
            .removeBlock(taskId, b.id)
            .then(() => {
              afterBlocks(taskId);
              setToast({ tone: 'moved', text: `The planned time for ${key} is removed.` });
            })
            .catch((err) => fail(`Couldn’t remove the planned time — ${reasonOf(err)}.`));
        },
      });
      return null;
    } catch (err) {
      return `Couldn’t plan the time — ${reasonOf(err)}.`;
    }
  }
  async function moveBlock(b: CalBlock, next: { startAt: string; endAt: string }, opts: { quiet?: boolean } = {}) {
    if (!b.canChange) return;
    await qc.cancelQueries({ queryKey: rangeKey });
    const snapshot = qc.getQueryData<CalendarRange>(rangeKey);
    qc.setQueryData<CalendarRange>(rangeKey, (old) => (old ? { ...old, workBlocks: (old.workBlocks ?? []).map((x) => (x.id === b.id ? { ...x, ...next } : x)) } : old));
    try {
      await sched.moveBlock(b.taskId, b.id, next);
      afterBlocks(b.taskId);
      if (opts.quiet) return setToast({ tone: 'moved', text: `The planned time for ${b.taskKey} is back where it was.` });
      setToast({
        tone: 'moved',
        text: `Planned time for ${b.taskKey}: ${blockWords(next)}.`,
        undo: () => {
          setToast(null);
          void moveBlock({ ...b, ...next }, { startAt: b.startAt, endAt: b.endAt }, { quiet: true });
        },
      });
    } catch (err) {
      if (snapshot) qc.setQueryData(rangeKey, snapshot);
      fail(`Couldn’t move the planned time — ${reasonOf(err)}.`);
    }
  }
  async function removeBlock(b: CalBlock) {
    try {
      await sched.removeBlock(b.taskId, b.id);
      afterBlocks(b.taskId);
      setToast({
        tone: 'moved',
        text: `Removed the planned time for ${b.taskKey} (${blockWords(b)}).`,
        undo: () => {
          setToast(null);
          void addBlock(b.taskId, { userId: b.userId, startAt: b.startAt, endAt: b.endAt }, b.taskKey, { quiet: true }).then((err) => err && fail(err));
        },
      });
    } catch (err) {
      fail(`Couldn’t remove the planned time — ${reasonOf(err)}.`);
    }
  }
  /** A task dropped into an hour: an hour of my time on it — or, when I'm not on it, ask whom it is for. */
  function planFromDrop(task: ApiTask, day: string, minutes: number) {
    const mine = (task.assignees ?? []).some((a) => a.id === myId);
    if (!mine) return setPlan({ day, minutes, task: { id: task.id, key: task.key, title: task.title } });
    const startAt = instantAt(day, minutes, timeZone);
    void addBlock(task.id, { startAt, endAt: new Date(Date.parse(startAt) + 3600_000).toISOString() }, task.key).then((err) => err && fail(err));
  }

  // ── Meetings (their organizer): a new time, the updated invitation sent by the meeting's own update ──
  async function moveMeeting(m: CalMeeting, next: { startAt: string; endAt: string | null }, opts: { undo?: boolean } = {}) {
    const full = meetingById.get(m.id);
    // A meeting without an end keeps none (it moves by its start alone, and Undo puts back exactly that).
    const hadEnd = !!full?.endAt;
    const before = { startAt: m.startAt, endAt: full?.endAt ?? null };
    try {
      await meetingsApi(apiClient).update(m.id, hadEnd && next.endAt ? next : { startAt: next.startAt });
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      const count = full?.attendeeCount ?? 0;
      const sent = full?.invitesSentAt ? ` The updated invitation went to ${count} ${count === 1 ? 'person' : 'people'}.` : '';
      const when = (x: { startAt: string; endAt: string | null }) => (x.endAt ? blockWords({ startAt: x.startAt, endAt: x.endAt }) : `${dayLabel(minutesAt(x.startAt, timeZone).day)}, ${timeLabel(minutesAt(x.startAt, timeZone).minutes)}`);
      if (opts.undo) return setToast({ tone: 'moved', text: `${m.title} is back at ${when(next)}.${sent}` });
      setToast({
        tone: 'moved',
        text: `Moved ${m.title} to ${when(next)}.${sent}`,
        undo: () => {
          setToast(null);
          void moveMeeting({ ...m, startAt: next.startAt }, hadEnd ? before : { startAt: before.startAt, endAt: null }, { undo: true });
        },
      });
    } catch (err) {
      fail(`Couldn’t move ${m.title} — ${reasonOf(err)}.`);
    }
  }
  const askMeetingMove = (m: CalMeeting, startAt: string) => {
    if (!canDragMeeting(m, myId, now)) return;
    const end = meetingById.get(m.id)?.endAt ?? null;
    const next = meetingMovePlan({ startAt: m.startAt, endAt: end }, startAt);
    if (Date.parse(next.startAt) <= Date.now()) return fail('A meeting moves to a time still to come.');
    setMeetingMove({ m, startAt: next.startAt, endAt: next.endAt, hasEnd: !!end });
  };

  // ── Drops ──
  function dropOnDay(payload: DragPayload, day: string) {
    if (payload.kind === 'task') {
      const item = taskItem(payload.id);
      if (!item) return;
      if (payload.grip === 'start') return moveEdge(item, 'start', day);
      if (payload.grip === 'due') return moveEdge(item, 'due', day);
      return shiftTask(item, daysBetween(payload.grabDay || item.date, day));
    }
    if (payload.kind === 'block') {
      const b = blocks.find((x) => x.id === payload.id);
      if (!b || payload.grip !== 'body') return;
      const at = minutesAt(b.startAt, timeZone);
      if (at.day !== day) void moveBlock(b, blockMovePlan(b, instantAt(day, at.minutes, timeZone)));
      return;
    }
    const m = shownMeetings.find((x) => x.id === payload.id);
    if (!m) return;
    const at = minutesAt(m.startAt, timeZone);
    if (at.day !== day) askMeetingMove(m, instantAt(day, at.minutes, timeZone));
  }
  function dropOnSlot(payload: DragPayload, day: string, minutes: number) {
    if (payload.kind === 'task') {
      const item = taskItem(payload.id);
      if (!item) return;
      // R12: due dates are days on this site — a ⚑ dropped on an hour sets the due day.
      if (payload.grip === 'due') return moveEdge(item, 'due', day);
      if (payload.grip === 'start') return moveEdge(item, 'start', day);
      if (item.status === 'done' || item.projectArchived) return;
      return planFromDrop(item.task, day, minutes);
    }
    if (payload.kind === 'block') {
      const b = blocks.find((x) => x.id === payload.id);
      if (!b) return;
      if (payload.grip === 'end') {
        const next = blockResizePlan(b, instantAt(day, minutes + 15, timeZone));
        if (next) void moveBlock(b, next);
        else fail('Planned time is at least 15 minutes.');
        return;
      }
      void moveBlock(b, blockMovePlan(b, instantAt(day, minutes, timeZone)));
      return;
    }
    const m = shownMeetings.find((x) => x.id === payload.id);
    if (m) askMeetingMove(m, instantAt(day, minutes, timeZone));
  }

  // ── Keyboard moves (Alt + arrows), with the same Undo ──
  const keyMoveTask = (item: SpanItem, move: KeyMove) => {
    if (!move.days) return;
    if (move.edge === 'due' && item.due) return moveEdge(item, 'due', shiftDayKey(item.due, move.days));
    shiftTask(item, move.days);
  };
  const keyMoveBlock = (b: CalBlock, move: KeyMove) => {
    if (!b.canChange) return;
    if (move.edge === 'end') {
      const next = blockResizePlan(b, new Date(Date.parse(b.endAt) + move.minutes * 60_000).toISOString());
      if (next) void moveBlock(b, next);
      else fail('Planned time is at least 15 minutes.');
      return;
    }
    void moveBlock(b, blockMovePlan(b, new Date(Date.parse(b.startAt) + (move.days * 24 * 60 + move.minutes) * 60_000).toISOString()));
  };
  const keyMoveMeeting = (m: CalMeeting, move: KeyMove) => askMeetingMove(m, new Date(Date.parse(m.startAt) + (move.days * 24 * 60 + move.minutes) * 60_000).toISOString());

  // ── Quick actions ──
  async function complete(item: CalItem) {
    const t = item.task;
    try {
      const columns = await columnsApi(apiClient).list(t.projectId);
      const done = columns.find((c) => c.category === 'DONE');
      if (!done) return fail(`${t.key}’s project has no Done column.`);
      const moved = await tasksApi(apiClient).move(t.id, done.id);
      refresh();
      const waits = approvalNotice(done.id, moved);
      setToast({
        tone: 'moved',
        text: waits ?? `Completed ${t.key}.`,
        undo:
          moved.columnId === t.columnId
            ? undefined
            : () => {
                setToast(null);
                void tasksApi(apiClient)
                  .move(t.id, t.columnId)
                  .then(() => {
                    refresh();
                    setToast({ tone: 'moved', text: `${t.key} is open again.` });
                  })
                  .catch((err) => fail(`Couldn’t reopen ${t.key} — ${reasonOf(err)}.`));
              },
      });
    } catch (err) {
      fail(`Couldn’t complete ${t.key} — ${reasonOf(err)}.`);
    }
  }
  async function rsvp(m: PanelMeeting, response: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | 'PENDING') {
    if (!m.myAttendeeId) return;
    try {
      await meetingsApi(apiClient).updateAttendee(m.id, m.myAttendeeId, { response });
      void qc.invalidateQueries({ queryKey: ['meetings'] });
    } catch (err) {
      fail(`Couldn’t save your answer — ${reasonOf(err)}.`);
    }
  }

  const canCreate = projects.some((p) => !isProjectArchived(p) && p.status !== 'COMPLETED');
  // N adds a task due on the day the calendar is showing (the chosen day in the split view).
  useShortcut('new', () => setCreateOn(split ? selected : cursor), { enabled: canCreate });
  const canDragTask = (item: CalItem) => canReschedule(item);
  const canAct = (item: CalItem) => item.kind === 'task' && item.status !== 'done' && !item.projectArchived;
  const canDragBlock = (b: CalBlock) => b.canChange;
  const canDragMeetingNow = (m: CalMeeting) => canDragMeeting(m, myId, now);
  const taskOptions: TaskOption[] = useMemo(
    () =>
      items
        .filter((i) => i.kind === 'task' && i.status !== 'done' && !i.projectArchived)
        .map((i) => ({ id: i.task.id, key: i.task.key, title: i.task.title })),
    [items],
  );

  /** A day clicked: the split view lists it; otherwise its list opens in a dialog (a tablet or phone lists it below). */
  const selectDay = (day: string) => {
    setChosen(day);
    if (!split && !compactMonth) setOpenDay(day);
  };
  const viewProps: ViewProps = {
    today,
    weekStart,
    byDay,
    colorOf,
    // A task's "Starts" copy in a day list isn't dragged (it would move by the days from its due day).
    canDrag: (item) => !item.key.endsWith(':start') && canReschedule(item),
    onOpen: (item) => setPreviewKey(item.key),
    onOpenDay: selectDay,
    onDrop: (taskId, day) => {
      const item = taskItem(taskId);
      if (item) shiftTask(item, daysBetween(item.date, day));
    },
    meetingsByDay,
    checklistByDay,
    onOpenChecklistItem: (s) => openTask(s.taskId, undefined, { item: s.id }),
  };
  const meta = (item: CalItem) => {
    const p = projectById.get(item.task.projectId);
    const who = item.task.assignees?.map((a) => a.name).join(', ');
    return [item.kind === 'task' ? null : 'Not created yet', item.key.endsWith(':start') ? 'Starts' : null, p?.name, who].filter(Boolean).join(' · ');
  };

  const label = periodLabel(view, cursor, weekStart);
  const filtered = activeFilterCount(filters) > 0;
  const nothingShown = shown.length === 0 && shownMeetings.length === 0 && blocks.length === 0 && reminders.length === 0 && [...checklistByDay.values()].every((l) => l.length === 0);
  const nothingText = filtered ? `No tasks match these filters in ${label}.` : `Nothing is due in ${label}.`;
  const clearButton = (
    <button type="button" onClick={() => navigate({ filters: DEFAULT_FILTERS })} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-brand hover:border-brand">
      Clear filters
    </button>
  );
  const nothing = (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="font-semibold text-ink">{nothingText}</p>
      {filtered ? <div className="mt-3">{clearButton}</div> : canCreate ? <p className="mt-1 text-sm text-ink-2">Click a day to add a task on it.</p> : null}
    </div>
  );
  const nothingBar = (
    <div className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-dashed border-line bg-surface px-4 py-1.5 text-sm">
      <p className="font-semibold text-ink">
        {nothingText}
        {!filtered && canCreate ? <span className="ms-1.5 font-normal text-ink-2">Click a day to add a task on it.</span> : null}
      </p>
      {filtered ? clearButton : null}
    </div>
  );

  const closeDay = () => setOpenDay(null);
  const panelFor = (day: string, bare = false) => (
    <DayPanel
      day={day}
      today={today}
      timeZone={timeZone}
      items={shown}
      overdueBefore={overdueItems}
      meetings={meetingsByDay.get(day) ?? []}
      meetingOf={(id) => meetingById.get(id)}
      blocks={blocksByDay.get(day) ?? []}
      reminders={remindersByDay.get(day) ?? []}
      steps={checklistByDay.get(day) ?? []}
      dayOff={dayOff(day)}
      colorOf={colorOf}
      canCreate={canCreate}
      canDragTask={canDragTask}
      canAct={canAct}
      onNewTask={(d) => {
        closeDay();
        setCreateOn(d);
      }}
      onPlanTime={(d, item) => {
        closeDay();
        setPlan({ day: d, minutes: 9 * 60, task: item ? { id: item.task.id, key: item.task.key, title: item.task.title } : null });
      }}
      onRemind={(item) => {
        closeDay();
        setRemind(item.task);
      }}
      onOpenItem={(item) => {
        closeDay();
        setPreviewKey(item.key);
      }}
      onOpenTask={(id) => {
        closeDay();
        openTask(id);
      }}
      onComplete={(item) => void complete(item)}
      onOpenBlock={(b) => {
        closeDay();
        setBlockOpen(b);
      }}
      onOpenStep={(s) => {
        closeDay();
        openTask(s.taskId, undefined, { item: s.id });
      }}
      onOpenReminder={(r) => {
        closeDay();
        setRemind(remindTaskOf(r));
      }}
      onRsvp={(m, r) => void rsvp(m, r)}
      filtered={filtered}
      bare={bare}
    />
  );
  // Agenda: planned time and reminders after the day's tasks.
  const extrasFor = (day: string) => (
    <>
      {(blocksByDay.get(day) ?? []).map((b) => (
        <li key={`b:${b.id}`}>
          <BlockChip block={b} timeZone={timeZone} onOpen={setBlockOpen} draggable={false} />
        </li>
      ))}
      {(remindersByDay.get(day) ?? []).map((r) => (
        <li key={`r:${r.id}`}>
          <button
            type="button"
            onClick={() => setRemind(remindTaskOf(r))}
            aria-label={reminderName(r, timeZone)}
            className="flex min-h-6 w-full items-center gap-1 rounded-md border border-line px-1.5 text-start text-[11px] text-ink-2 hover:border-brand/60 [@media(pointer:coarse)]:min-h-[28px]"
          >
            <span className="text-warning">
              <BellIcon size={11} muted={r.state === 'muted'} />
            </span>
            <span className="tabular-nums font-semibold">{timeLabel(minutesAt(r.fireAt, timeZone).minutes)}</span>
            <span dir="auto" className="min-w-0 truncate">{r.taskTitle}</span>
          </button>
        </li>
      ))}
    </>
  );

  const step = (dir: 1 | -1) => navigate({ date: view === 'day' ? shiftDayKey(cursor, dir) : view === 'week' ? shiftDayKey(cursor, 7 * dir) : shiftMonth(cursor, dir) });
  const hourProps = {
    label,
    today,
    timeZone,
    now,
    items: shown,
    meetingsByDay,
    meetingEnd,
    checklistByDay,
    blocks,
    reminders,
    colorOf,
    projectName: (id: string) => projectById.get(id)?.name,
    dayOff,
    hours: working.data?.hours ?? null,
    selected: split ? selected : null,
    canDragTask,
    canDragBlock,
    canDragMeeting: canDragMeetingNow,
    onOpenItem: (item: SpanItem) => setPreviewKey(item.key),
    onOpenBlock: setBlockOpen,
    onRemoveBlock: (b: CalBlock) => void removeBlock(b),
    onOpenStep: (s: { taskId: string; id: string }) => openTask(s.taskId, undefined, { item: s.id }),
    // A week's day heading: the split view lists it; otherwise that day's hours open.
    onSelectDay: (day: string) => (view === 'week' && !split ? navigate({ view: 'day', date: day }) : setChosen(day)),
    onSlot: (day: string, minutes: number, at: { x: number; y: number }) => setSlot({ day, minutes, at }),
    onDropDay: dropOnDay,
    onDropSlot: dropOnSlot,
    onKeyMoveTask: keyMoveTask,
    onKeyMoveBlock: keyMoveBlock,
    onKeyMoveMeeting: keyMoveMeeting,
    fit,
  };

  // Pending: loading, or waiting for the person's choices (the Team view changes what is asked).
  const calendar = rangeQ.isPending ? (
    <div role="status" aria-label="Loading the calendar" className={`grid grid-cols-7 gap-1.5 ${fit ? 'min-h-0 flex-1 grid-rows-5' : ''}`}>
      {Array.from({ length: 35 }).map((_, i) => <div key={i} className={`skeleton rounded-lg ${fit ? 'min-h-0' : 'h-24'}`} />)}
    </div>
  ) : rangeQ.isError && !rangeQ.data ? (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-6 text-center text-sm text-danger">
      Couldn’t load the calendar.{' '}
      <button type="button" onClick={() => void rangeQ.refetch()} className="font-semibold underline">Retry</button>
    </div>
  ) : (
    <div className={`flex flex-col gap-2.5 transition-opacity ${fit ? 'min-h-0 flex-1' : ''} ${rangeQ.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={rangeQ.isFetching || undefined}>
      {view !== 'agenda' && nothingShown ? nothingBar : null}
      {view === 'month' ? (
        compactMonth ? (
          <MobileMonth key={cursor.slice(0, 7)} cursor={cursor} p={viewProps} label={label} renderDayList={(day) => panelFor(day)} />
        ) : (
          <div className="min-h-0 flex-1">
            <MonthGrid
              cursor={cursor}
              label={label}
              weekStart={weekStart}
              today={today}
              timeZone={timeZone}
              items={shown}
              meetingsByDay={meetingsByDay}
              checklistByDay={checklistByDay}
              blocksByDay={blocksByDay}
              remindersByDay={remindersByDay}
              colorOf={colorOf}
              dayOff={dayOff}
              selected={split ? selected : null}
              lines={lines}
              canDragTask={canDragTask}
              canDragBlock={canDragBlock}
              onOpenItem={(item) => setPreviewKey(item.key)}
              onOpenBlock={setBlockOpen}
              onOpenStep={(s) => openTask(s.taskId, undefined, { item: s.id })}
              onSelectDay={selectDay}
              onEmptyDay={(day) => (canCreate ? setCreateOn(day) : selectDay(day))}
              onDrop={dropOnDay}
              onKeyMoveTask={keyMoveTask}
              onKeyMoveBlock={keyMoveBlock}
            />
          </div>
        )
      ) : view === 'week' ? (
        phone ? (
          <WeekView cursor={cursor} p={viewProps} phone meta={meta} fit={false} />
        ) : (
          <div className={fit ? 'min-h-0 flex-1' : ''}>
            <HourGrid days={weekDays(cursor, weekStart)} {...hourProps} />
          </div>
        )
      ) : view === 'day' ? (
        <div className={`flex flex-col gap-2.5 ${fit ? 'min-h-0 flex-1' : ''}`}>
          <div className={fit ? 'min-h-0 flex-1' : ''}>
            <HourGrid days={[cursor]} {...hourProps} />
          </div>
          {split ? null : panelFor(cursor)}
        </div>
      ) : (
        <div className={fit ? '-me-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pe-2' : ''}>
          <AgendaView from={from} to={to} p={viewProps} overdue={overdueItems} meta={meta} empty={nothing} extraDays={[...blocksByDay.keys(), ...remindersByDay.keys()]} renderExtras={extrasFor} />
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={pageRef}
      className={`flex flex-col gap-2.5 ${fit ? 'page-fill' : ''}`}
      style={fit && pageTop !== null ? ({ '--page-top': `${pageTop}px` } as React.CSSProperties) : undefined}
    >
      {/* The title, the period and its controls on one line; the filters, Show and the legend on the next. */}
      <div className="relative z-20 flex flex-none flex-wrap items-center gap-x-4 gap-y-2 animate-fade-in-up">
        <PageTitle eyebrow="Workspace" title="Calendar" className="flex-none" />
        <CalendarToolbar
          view={view}
          onView={(v) => navigate({ view: v, ...(v === 'day' && chosen ? { date: selected } : {}) })}
          period={label}
          unit={view === 'week' ? 'week' : view === 'day' ? 'day' : 'month'}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => {
            setChosen(today);
            navigate({ date: null });
          }}
          cursor={cursor}
          onGoTo={(d) => {
            setChosen(d);
            navigate({ date: d });
          }}
          onNew={canCreate ? () => setCreateOn(split ? selected : cursor) : undefined}
          layout={wide && view !== 'agenda' ? prefs.layout : undefined}
          onLayout={(l) => savePrefs.mutate({ layout: l })}
        />
      </div>
      <div className="relative z-20 flex-none">
        <CalendarFilterBar
          filters={filters}
          onChange={(f) => navigate({ filters: f })}
          projectOptions={projectOptions}
          assigneeOptions={assigneeOptions}
          compact={phone}
          trailing={
            <div className="flex items-center gap-2">
              <ShowMenu show={show} onShow={(patch) => savePrefs.mutate({ show: patch })} team={range.team ? { available: range.team.available, on: prefs.team && range.team.available } : undefined} onTeam={(on) => savePrefs.mutate({ team: on })} />
              <LegendButton timeNote={ownTimeZone ? `Dates in ${ownTimeZone} (your setting)` : `Dates in ${timeZone} (company time)`} />
            </div>
          }
        />
      </div>

      {split ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] gap-3 2xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="flex min-h-0 flex-col">{calendar}</div>
          <aside aria-label="The chosen day" className="-me-1 min-h-0 overflow-y-auto overscroll-contain pe-1">
            {panelFor(selected)}
          </aside>
        </div>
      ) : (
        calendar
      )}

      {openDay ? (
        <Shell label={fullDayLabel(openDay)} onClose={closeDay} wide>
          <div className="flex flex-none items-center justify-end border-b border-line px-3 py-2">
            <button type="button" onClick={closeDay} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{panelFor(openDay, true)}</div>
        </Shell>
      ) : null}
      {preview ? (
        <TaskPreview
          item={preview}
          today={today}
          timeZone={timeZone}
          project={projectById.get(preview.task.projectId) ?? null}
          movable={canReschedule(preview)}
          onMove={(toDay, scope) => {
            setPreviewKey(null);
            const payload = planEdge(preview.task, 'due', toDay, timeZone, scope);
            if (!payload) return fail('The due date can’t be before the start.');
            void saveDates(preview.task, payload, { done: movedWords(preview, payload, scope), back: backWords(preview) });
          }}
          onMoveDates={(startDay, dueDay, scope) => {
            setPreviewKey(null);
            if (startDay && dueDay && startDay > dueDay) return fail('The start can’t be after the due date.');
            const duePart = dueDay && dueDay !== preview.due ? planEdge({ ...preview.task, startDate: null }, 'due', dueDay, timeZone, scope) : null;
            const payload: DatesPayload = {
              ...(startDay !== preview.start ? { startDate: startDay } : {}),
              ...(duePart ?? {}),
              ...(preview.task.version !== undefined ? { expectedVersion: preview.task.version } : {}),
            };
            void saveDates(preview.task, payload, { done: movedWords(preview, payload, scope), back: backWords(preview) });
          }}
          waitNote={(startDay) => waitWords(preview.task, startDay, today)}
          onPlanTime={
            canAct(preview)
              ? () => {
                  setPreviewKey(null);
                  setPlan({ day: preview.due ?? preview.start ?? today, minutes: 9 * 60, task: { id: preview.task.id, key: preview.task.key, title: preview.task.title } });
                }
              : undefined
          }
          onRemind={
            preview.kind === 'task' && preview.status !== 'done'
              ? () => {
                  setPreviewKey(null);
                  setRemind(preview.task);
                }
              : undefined
          }
          onOpenTask={(id) => {
            setPreviewKey(null);
            openTask(id, (byDay.get(preview.date) ?? []).map((i) => i.task.id));
          }}
          onClose={() => setPreviewKey(null)}
        />
      ) : null}
      {choice ? (
        <MoveChoiceDialog
          item={choice.item}
          to={choice.to}
          onMove={(scope) => {
            const c = choice;
            setChoice(null);
            c.run(scope);
          }}
          onClose={() => setChoice(null)}
        />
      ) : null}
      {createOn ? <NewTaskModal defaultDueDate={createOn} onClose={() => setCreateOn(null)} onCreated={() => refresh()} /> : null}
      {meetingAt ? (
        <MeetingFormModal defaultStart={meetingAt} defaultProjectId={filters.projectId || undefined} onClose={() => setMeetingAt(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ['meetings'] })} />
      ) : null}
      {slot ? (
        <SlotMenu
          at={slot.at}
          day={slot.day}
          minutes={slot.minutes}
          onClose={() => setSlot(null)}
          onMeeting={() => {
            setMeetingAt(instantAt(slot.day, slot.minutes, timeZone));
            setSlot(null);
          }}
          onPlan={() => {
            setPlan({ day: slot.day, minutes: slot.minutes, task: null });
            setSlot(null);
          }}
        />
      ) : null}
      {plan ? (
        <PlanTimeDialog
          task={plan.task}
          options={taskOptions}
          day={plan.day}
          minutes={plan.minutes}
          timeZone={timeZone}
          people={people}
          onClose={() => setPlan(null)}
          onSave={async (taskId, body) => {
            const key = taskOptions.find((o) => o.id === taskId)?.key ?? plan.task?.key ?? '';
            const err = await addBlock(taskId, body, key);
            if (!err) setPlan(null);
            return err;
          }}
        />
      ) : null}
      {remind ? <RemindDialog task={remind} timeZone={timeZone} people={people} onClose={() => setRemind(null)} onChanged={(text) => setToast({ tone: 'moved', text })} /> : null}
      {blockOpen ? (
        <BlockDialog
          block={blockOpen}
          timeZone={timeZone}
          onClose={() => setBlockOpen(null)}
          onMove={(startAt, endAt) => {
            const b = blockOpen;
            setBlockOpen(null);
            void moveBlock(b, { startAt, endAt });
          }}
          onRemove={() => {
            const b = blockOpen;
            setBlockOpen(null);
            void removeBlock(b);
          }}
          onOpenTask={() => {
            const b = blockOpen;
            setBlockOpen(null);
            openTask(b.taskId);
          }}
        />
      ) : null}
      {meetingMove ? (
        <MeetingMoveDialog
          title={meetingMove.m.title}
          startAt={meetingMove.startAt}
          endAt={meetingMove.endAt}
          invitesSent={!!meetingById.get(meetingMove.m.id)?.invitesSentAt}
          people={meetingById.get(meetingMove.m.id)?.attendeeCount ?? 0}
          timeZone={timeZone}
          onClose={() => setMeetingMove(null)}
          series={meetingMove.m.recurring}
          onConfirm={(startAt, endAt) => {
            const { m, hasEnd } = meetingMove;
            setMeetingMove(null);
            void moveMeeting(m, { startAt, endAt: hasEnd ? endAt : null });
          }}
        />
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-labelledby="calendar-toast-text"
            className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border bg-surface px-4 py-2.5 text-sm text-ink shadow-lift ${toast.tone === 'error' ? 'border-danger/40' : 'border-line'}`}
          >
            <span id="calendar-toast-text" className="min-w-0 flex-1">{toast.text}</span>
            {toast.undo ? (
              <button type="button" onClick={toast.undo} className="rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand/10">Undo</button>
            ) : null}
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-ink-2 hover:text-ink">✕</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
