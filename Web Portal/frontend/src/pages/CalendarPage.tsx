import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { calendarApi, type CalendarRange } from '../api/calendar';
import { meetingsApi } from '../api/meetings';
import { filterCalendarMeetings, groupMeetingsByDay, meetingItems, meetingRange } from '../lib/calendar-meetings';
import { projectsApi } from '../api/projects';
import { tasksApi, type ApiTask } from '../api/tasks';
import { usersApi } from '../api/users';
import { ApiError } from '../lib/api-client';
import { useAuthStore } from '../stores/auth-store';
import { shiftDayKey, todayKey } from '../lib/due-date';
import { shiftMonth, visibleRange, weekDays, type CalendarView } from '../lib/calendar';
import {
  applyFilters,
  buildItems,
  filtersFromParams,
  filtersToParams,
  groupByDay,
  activeFilterCount,
  DEFAULT_FILTERS,
  type CalendarFilters,
  type CalItem,
} from '../lib/calendar-model';
import { canReschedule, needsSeriesChoice, planMove, planUndo, type MoveScope } from '../lib/calendar-reschedule';
import { useDateSettings } from '../lib/useDatePrefs';
import { invalidateTaskQueries } from '../lib/task-cache';
import { PageTitle } from '../components/ui/PageHeader';
import { useFrameOffset } from '../lib/useFrameOffset';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { NewTaskModal } from '../components/NewTaskModal';
import { useCurrentProject } from '../components/CurrentProject';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { CalendarFilterBar, CalendarToolbar } from '../components/calendar/CalendarToolbar';
import { LegendButton, MeetingChip, TaskChip, dayLabel, useMediaQuery } from '../components/calendar/calendar-ui';
import { AgendaView, MobileMonth, MonthView, WeekView, type ViewProps } from '../components/calendar/views';
import { DayDialog, MoveChoiceDialog, TaskPreview } from '../components/calendar/dialogs';
import { projectOption } from '../components/project-option';

const VIEWS: CalendarView[] = ['month', 'week', 'agenda'];
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const EMPTY: CalendarRange = { from: '', to: '', timeZone: '', tasks: [], occurrences: [], series: [] };

/** The period a view shows, e.g. "October 2026" or "4 – 10 Oct 2026". */
function periodLabel(view: CalendarView, cursor: string, weekStart: 0 | 1 | 6): string {
  if (view !== 'week') return dayLabel(cursor, { month: 'long', year: 'numeric' });
  const days = weekDays(cursor, weekStart);
  const [a, b] = [days[0]!, days[6]!];
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  const sameMonth = sameYear && a.slice(0, 7) === b.slice(0, 7);
  const start = dayLabel(a, sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${dayLabel(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function reasonOf(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^Request failed/.test(err.message)) return err.message.replace(/\.$/, '');
  if (err instanceof TypeError) return 'the server couldn’t be reached';
  return 'the server had a problem';
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

/** The address for a place (an open task panel's `task` is kept). */
function paramsFor(s: PlaceState, keep: URLSearchParams): URLSearchParams {
  const next = filtersToParams(s.filters);
  if (s.view !== 'month') next.set('view', s.view);
  if (s.date) next.set('date', s.date);
  const task = keep.get('task');
  if (task) next.set('task', task);
  return next;
}

export function CalendarPage() {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const [params, setParams] = useSearchParams();
  const { timeZone, ownTimeZone, weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  const phone = useMediaQuery('(max-width: 639px)');
  // Below 1024px the sidebar leaves the month about 70px a day — too narrow for readable chips — so
  // the month shows day marks and the chosen day's list instead (as on a phone).
  const compactMonth = useMediaQuery('(max-width: 1023px)');
  // From 1024px the page fits the window: the toolbar on top, the calendar taking the rest (its
  // weeks share the height; a long week or agenda scrolls inside it). Smaller screens scroll.
  const fit = !compactMonth;
  const pageRef = useRef<HTMLDivElement>(null);
  const pageTop = useFrameOffset(pageRef, fit);

  // View, day and filters change at once here, and are copied to the address — so they survive
  // switching views and a reload, and a link can open the calendar just so. (The router applies
  // address changes a moment later; reading them back from it made a ticked box flicker.)
  const [place, setPlace] = useState<PlaceState>(() => placeFromParams(params));
  const written = useRef(params.toString());
  useEffect(() => {
    const next = paramsFor(place, params);
    if (next.toString() === params.toString()) return;
    written.current = next.toString();
    setParams(next, { replace: true });
    // Only when the place changes; the address is read for the task panel's link only.
  }, [place]);
  useEffect(() => {
    // The address changed by itself (a link to the calendar): go there.
    if (params.toString() === written.current) return;
    written.current = params.toString();
    setPlace(placeFromParams(params));
  }, [params]);
  const { view, filters } = place;
  // Filtered to one project: a new task (header, N, a day) starts in it.
  useCurrentProject(filters.projectId);
  const cursor = place.date ?? today;
  const navigate = useCallback((patch: Partial<PlaceState>) => setPlace((s) => ({ ...s, ...patch })), []);

  const { from, to } = visibleRange(view, cursor, weekStart);
  const rangeKey = useMemo(() => ['calendar', from, to] as const, [from, to]);
  const rangeQ = useQuery({ queryKey: rangeKey, queryFn: () => calendarApi(apiClient).range(from, to), placeholderData: keepPreviousData });
  const overdueQ = useQuery({ queryKey: ['calendar', 'overdue'], queryFn: () => calendarApi(apiClient).overdue(), enabled: view === 'agenda' });
  // Meetings in the visible days (company time); under ['meetings'], so any meeting change refreshes them.
  const span = meetingRange(from, to, timeZone);
  const meetingsQ = useQuery({
    queryKey: ['meetings', 'range', span.from, span.to],
    queryFn: () => meetingsApi(apiClient).list({ from: span.from, to: span.to }),
    placeholderData: keepPreviousData,
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const projects = useMemo(() => (Array.isArray(projectsQ.data) ? projectsQ.data : []), [projectsQ.data]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const colorOf = useCallback((id: string) => projectById.get(id)?.color, [projectById]);
  const projectStatus = useCallback((id: string) => projectById.get(id)?.status, [projectById]);

  const items = useMemo(() => buildItems(rangeQ.data ?? EMPTY, { today, timeZone, projectStatus }), [rangeQ.data, today, timeZone, projectStatus]);
  const shown = useMemo(() => applyFilters(items, filters, { myId }), [items, filters, myId]);
  const byDay = useMemo(() => groupByDay(shown), [shown]);
  const shownMeetings = useMemo(
    () => filterCalendarMeetings(meetingItems(Array.isArray(meetingsQ.data) ? meetingsQ.data : [], timeZone), filters, { myId }),
    [meetingsQ.data, timeZone, filters, myId],
  );
  const meetingsByDay = useMemo(() => groupMeetingsByDay(shownMeetings), [shownMeetings]);
  const overdueItems = useMemo(() => {
    if (view !== 'agenda' || !Array.isArray(overdueQ.data)) return [];
    const list = buildItems({ tasks: overdueQ.data, occurrences: [], series: [] }, { today, timeZone, projectStatus }).filter((i) => i.status === 'overdue');
    return applyFilters(list, filters, { myId });
  }, [view, overdueQ.data, today, timeZone, projectStatus, filters, myId]);

  const projectOptions = useMemo(() => [{ value: '', label: 'All projects' }, ...projects.map(projectOption)], [projects]);
  const assigneeOptions = useMemo(() => {
    const people = Array.isArray(dirQ.data) ? dirQ.data : [];
    return [{ value: '', label: 'Everyone' }, ...people.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }))];
  }, [dirQ.data]);

  // ── Dialogs, panel and notices ──
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [createOn, setCreateOn] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ item: CalItem; to: string } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 9000 : 8000);
    return () => clearTimeout(t);
  }, [toast]);
  const preview = previewKey ? items.find((i) => i.key === previewKey) ?? null : null;

  // ── Rescheduling: shown at once, saved, undoable — and put back if the save fails ──
  const setDue = (taskId: string, patch: Partial<ApiTask>) =>
    qc.setQueryData<CalendarRange>(rangeKey, (old) => (old ? { ...old, tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) } : old));

  async function save(task: ApiTask, fromDay: string, toDay: string, payload: ReturnType<typeof planMove>, after: (saved: ApiTask) => void) {
    const snapshot = qc.getQueryData<CalendarRange>(rangeKey);
    setDue(task.id, { dueDate: `${toDay}T00:00:00.000Z` });
    try {
      const saved = await tasksApi(apiClient).update(task.id, payload);
      setDue(task.id, saved);
      after(saved);
      void invalidateTaskQueries(qc);
    } catch (err) {
      if (snapshot) qc.setQueryData(rangeKey, snapshot);
      setToast({ tone: 'error', text: `Couldn’t move ${task.key} — ${reasonOf(err)}. It’s back on ${dayLabel(fromDay)}.` });
    }
  }

  function move(item: CalItem, toDay: string, scope: MoveScope) {
    const original = item.task;
    const fromDay = item.date;
    void save(original, fromDay, toDay, planMove(original, fromDay, toDay, scope), (saved) => {
      setToast({
        tone: 'moved',
        text: `Moved ${original.key} to ${dayLabel(toDay)}${original.recurrenceRule ? (scope === 'series' ? ' (and the occurrences after it)' : ' (this occurrence only)') : ''}.`,
        undo: () => {
          setToast(null);
          void save(saved, toDay, fromDay, planUndo(original, fromDay, saved.version), () =>
            setToast({ tone: 'moved', text: `${original.key} is back on ${dayLabel(fromDay)}.` }),
          );
        },
      });
    });
  }

  function requestMove(taskId: string, toDay: string) {
    const item = items.find((i) => i.kind === 'task' && i.task.id === taskId);
    if (!item || !canReschedule(item) || item.date === toDay) return;
    if (needsSeriesChoice(item.task)) setChoice({ item, to: toDay });
    else move(item, toDay, 'occurrence');
  }

  const canCreate = projects.some((p) => p.status !== 'ARCHIVED' && p.status !== 'COMPLETED');
  // N adds a task due on the day the calendar is showing.
  useShortcut('new', () => setCreateOn(cursor), { enabled: canCreate });
  const viewProps: ViewProps = {
    today,
    weekStart,
    byDay,
    colorOf,
    canDrag: canReschedule,
    onOpen: (item) => setPreviewKey(item.key),
    onOpenDay: setOpenDay,
    onDrop: requestMove,
    meetingsByDay,
  };
  const meta = (item: CalItem) => {
    const p = projectById.get(item.task.projectId);
    const people = item.task.assignees?.map((a) => a.name).join(', ');
    return [item.kind === 'task' ? item.task.key : 'Not created yet', p?.name, people].filter(Boolean).join(' · ');
  };

  const label = periodLabel(view, cursor, weekStart);
  const filtered = activeFilterCount(filters) > 0;
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
  // Over the month or week: one line, so the days keep their room.
  const nothingBar = (
    <div className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-dashed border-line bg-surface px-4 py-1.5 text-sm">
      <p className="font-semibold text-ink">
        {nothingText}
        {!filtered && canCreate ? <span className="ms-1.5 font-normal text-ink-2">Click a day to add a task on it.</span> : null}
      </p>
      {filtered ? clearButton : null}
    </div>
  );
  const dayList = (day: string) => {
    const list = byDay.get(day) ?? [];
    const dayMeetings = meetingsByDay.get(day) ?? [];
    return (
      <section aria-label={dayLabel(day)} className="rounded-xl border border-line bg-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          {canCreate ? (
            <button type="button" onClick={() => setCreateOn(day)} aria-label={`Add a task on ${dayLabel(day)}`} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand">
              + Add
            </button>
          ) : null}
        </div>
        {list.length === 0 && dayMeetings.length === 0 ? (
          <p className="py-2 text-sm text-ink-2">Nothing due{filtered ? ' with these filters' : ''}.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dayMeetings.map((m) => (
              <li key={m.key}>
                <MeetingChip meeting={m} color={m.projectId ? colorOf(m.projectId) : undefined} meta={[m.time, m.location].filter(Boolean).join(' · ')} lines={2} />
              </li>
            ))}
            {list.map((item) => (
              <li key={item.key}>
                <TaskChip item={item} color={colorOf(item.task.projectId)} draggable={false} onOpen={viewProps.onOpen} meta={meta(item)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const step = (dir: 1 | -1) => navigate({ date: view === 'week' ? shiftDayKey(cursor, 7 * dir) : shiftMonth(cursor, dir) });

  return (
    <div
      ref={pageRef}
      className={`flex flex-col gap-2.5 ${fit ? 'page-fill' : ''}`}
      style={fit && pageTop !== null ? ({ '--page-top': `${pageTop}px` } as React.CSSProperties) : undefined}
    >
      {/* The title, the period and its controls on one line; the filters and the legend on the next. */}
      <div className="relative z-20 flex flex-none flex-wrap items-center gap-x-4 gap-y-2 animate-fade-in-up">
        <PageTitle eyebrow="Workspace" title="Calendar" className="flex-none" />
        <CalendarToolbar
          view={view}
          onView={(v) => navigate({ view: v })}
          period={label}
          unit={view === 'week' ? 'week' : 'month'}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => navigate({ date: null })}
          cursor={cursor}
          onGoTo={(d) => navigate({ date: d })}
          onNew={canCreate ? () => setCreateOn(cursor) : undefined}
        />
      </div>
      <div className="relative z-20 flex-none">
        <CalendarFilterBar
          filters={filters}
          onChange={(f) => navigate({ filters: f })}
          projectOptions={projectOptions}
          assigneeOptions={assigneeOptions}
          compact={phone}
          trailing={<LegendButton timeNote={ownTimeZone ? `Dates in ${ownTimeZone} (your setting)` : `Dates in ${timeZone} (company time)`} />}
        />
      </div>

      {rangeQ.isLoading ? (
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
          {view !== 'agenda' && shown.length === 0 && shownMeetings.length === 0 ? nothingBar : null}
          {view === 'month' ? (
            phone || compactMonth ? (
              <MobileMonth key={cursor.slice(0, 7)} cursor={cursor} p={viewProps} label={label} renderDayList={dayList} />
            ) : (
              <div className="min-h-0 flex-1">
                <MonthView cursor={cursor} p={viewProps} label={label} fit={fit} />
              </div>
            )
          ) : view === 'week' ? (
            <div className={fit ? 'min-h-0 flex-1' : ''}>
              <WeekView cursor={cursor} p={viewProps} phone={phone} meta={meta} fit={fit} />
            </div>
          ) : (
            <div className={fit ? '-me-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pe-2' : ''}>
              <AgendaView from={from} to={to} p={viewProps} overdue={overdueItems} meta={meta} empty={nothing} />
            </div>
          )}
        </div>
      )}

      {openDay ? (
        <DayDialog
          day={openDay}
          items={byDay.get(openDay) ?? []}
          meetings={meetingsByDay.get(openDay) ?? []}
          colorOf={colorOf}
          canDrag={() => false}
          canCreate={canCreate}
          onOpen={(item) => { setOpenDay(null); setPreviewKey(item.key); }}
          onAdd={(d) => { setOpenDay(null); setCreateOn(d); }}
          onClose={() => setOpenDay(null)}
        />
      ) : null}
      {preview ? (
        <TaskPreview
          item={preview}
          today={today}
          timeZone={timeZone}
          project={projectById.get(preview.task.projectId) ?? null}
          movable={canReschedule(preview)}
          onMove={(toDay, scope) => { setPreviewKey(null); move(preview, toDay, scope); }}
          onOpenTask={(id) => { setPreviewKey(null); setOpenTaskId(id); }}
          onClose={() => setPreviewKey(null)}
        />
      ) : null}
      {choice ? (
        <MoveChoiceDialog
          item={choice.item}
          to={choice.to}
          onMove={(scope) => { const c = choice; setChoice(null); move(c.item, c.to, scope); }}
          onClose={() => setChoice(null)}
        />
      ) : null}
      {createOn ? (
        <NewTaskModal defaultDueDate={createOn} onClose={() => setCreateOn(null)} onCreated={() => void invalidateTaskQueries(qc)} />
      ) : null}
      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}

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
