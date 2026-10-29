import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { planningApi, workloadKey, type WorkloadCell, type WorkloadPerson, type WorkloadTask } from '../api/planning';
import { assigneesApi } from '../api/assignees';
import { tasksApi } from '../api/tasks';
import { systemSettingsApi } from '../api/system-settings';
import { PageTitle } from '../components/ui/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { LoadError } from '../components/ui/LoadError';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { WorkloadPopover } from '../components/workload/WorkloadPopover';
import { ApiError } from '../lib/api-client';
import { useDateSettings } from '../lib/useDatePrefs';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useNow } from '../lib/useNow';
import { shiftDayKey, todayKey } from '../lib/due-date';
import { weekDays } from '../lib/calendar';
import { invalidateTaskQueries } from '../lib/task-cache';
import {
  cellLabel,
  cellTone,
  dayHeading,
  filterPeople,
  limitOptions,
  sortPeople,
  problemText,
  summaryLine,
  weekBar,
  weekLabel,
  type CellTone,
} from '../lib/workload';

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const iconButton = 'grid h-9 w-9 flex-none place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
const BOX = 'flex h-9 min-w-0 [@media(pointer:coarse)]:h-11 items-center gap-1.5 rounded-xl border border-line bg-surface ps-3 text-sm transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20';
const SELECT = 'h-full min-w-[4.25rem] cursor-pointer rounded-xl bg-transparent pe-2 text-sm font-semibold text-ink outline-none';

/** A number's look: quiet, green below the limit, amber at it, red with "!" over it. */
const TONE: Record<Exclude<CellTone, 'off' | 'none'>, string> = {
  below: 'bg-success-soft text-success',
  at: 'bg-warning-soft text-warning ring-[1.5px] ring-inset ring-warning/70',
  over: 'bg-danger-soft text-danger ring-2 ring-inset ring-danger',
  // Due on a day off: the day's hatching with an amber outline (no limit applies, but it should move).
  offdue: 'hatch-off text-ink ring-[1.5px] ring-inset ring-warning',
};
const BAR: Record<'ok' | 'busy' | 'over', string> = { ok: 'bg-success', busy: 'bg-warning', over: 'bg-danger' };
const CELL = 'relative inline-grid h-9 w-11 [@media(pointer:coarse)]:h-11 place-items-center rounded-lg text-sm font-bold tabular-nums';

function reasonOf(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^Request failed/.test(err.message)) return err.message.replace(/\.$/, '');
  if (err instanceof TypeError) return 'the server couldn’t be reached';
  return 'the server had a problem';
}

/** "Thursday 29 October". */
const longDay = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`)).replace(',', '');

function Legend() {
  const mini = 'inline-grid h-5 w-7 place-items-center rounded-md text-[11px] font-bold';
  return (
    <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${mini} text-ink-3`}>0</span>none</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${mini} ${TONE.below}`}>3</span>below the limit</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${mini} ${TONE.at}`}>5</span>at the limit</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${mini} ${TONE.over}`}>7</span>! over the limit</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${mini} hatch-off text-ink-3`}>Off</span>not a working day (Meeting hours)</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${mini} ${TONE.offdue}`}>2</span>due on a day off</li>
      <li className="ms-auto">Click a number to see the tasks and rebalance.</li>
    </ul>
  );
}

/**
 * Workload: each person's open tasks due each day of a week against the company's daily limit, their
 * overdue tasks, and — on a number — the day's tasks with one suggestion each to bring it under the
 * limit (a teammate on the project with room, or the next lighter working day), applied through the
 * usual task endpoints only when clicked. Administrators see everyone and set the limit; a project
 * manager sees the teams of the projects they manage; anyone else sees their own row.
 */
export function WorkloadPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { weekStart } = useDateSettings();
  const timeZone = useCompanyTimeZone();
  const now = useNow(60_000);
  const today = todayKey(timeZone, now);
  const thisWeek = weekDays(today, weekStart)[0]!;
  const asked = params.get('week');
  // The seven days from the day the address names (as the API reads `week`): a link from elsewhere —
  // the Management page counts company weeks — shows exactly the days it counted, whatever this
  // person's own week start. The page's own arrows always name a first day of the person's week.
  const week = isDay(asked) ? asked : thisWeek;
  const projectId = params.get('project') ?? '';
  const [q, setQ] = useState('');
  const setParam = (key: string, value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const goToWeek = (w: string) => {
    setOpen(null);
    setParam('week', w === thisWeek ? '' : w);
  };

  const query = useQuery({
    queryKey: workloadKey(week, projectId, today),
    queryFn: () => planningApi(apiClient).workload({ week, projectId: projectId || undefined }),
    placeholderData: keepPreviousData,
    // Read again whenever the page is opened: the limit and working hours are changed elsewhere too.
    staleTime: 0,
  });
  const data = query.data;
  const people = useMemo(() => sortPeople(data?.people ?? []), [data]);
  const shown = filterPeople(people, q);

  // The open day (whose number it is; its details sit right after it), what the last suggestion did, and the task panel.
  const [open, setOpen] = useState<{ personId: string; date: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'done' | 'problem' } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openPerson = open ? people.find((p) => p.id === open.personId) ?? null : null;
  const openCell = openPerson ? openPerson.days.find((c) => c.date === open!.date) ?? null : null;

  function openDay(person: WorkloadPerson, cell: WorkloadCell, e: MouseEvent<HTMLButtonElement>) {
    if (open?.personId === person.id && open.date === cell.date) {
      setOpen(null);
      return;
    }
    trigger.current = e.currentTarget;
    setNotice(null);
    setOpen({ personId: person.id, date: cell.date });
  }

  const apply = useMutation({
    mutationFn: async ({ task, person }: { task: WorkloadTask; person: WorkloadPerson }) => {
      const s = task.suggestion!;
      if (s.kind === 'reassign') {
        // One write, refused if the task changed since it was read, is done, or the person is off it already.
        await assigneesApi(apiClient).swap(task.id, person.id, s.to.id, task.version);
      } else {
        await tasksApi(apiClient).update(task.id, { dueDate: s.date, expectedVersion: task.version });
      }
    },
    onMutate: () => setNotice(null),
    onSuccess: (_d, { task }) => {
      const s = task.suggestion!;
      setNotice({ tone: 'done', text: s.kind === 'reassign' ? `Gave ${task.key} to ${s.to.name}.` : `Moved ${task.key} to ${longDay(s.date)}.` });
    },
    onError: (err, { task, person }) => {
      setNotice({
        tone: 'problem',
        text: problemText({ code: err instanceof ApiError ? err.code ?? null : null, reason: reasonOf(err), key: task.key, suggestion: task.suggestion!, from: person.name }),
      });
    },
    // Either way the numbers are read again, so they show what really happened.
    onSettled: () => invalidateTaskQueries(qc),
  });

  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  const setLimit = useMutation({
    mutationFn: (value: number) => systemSettingsApi(apiClient).set('workload.dailyLimit', value),
    onMutate: (value) => setLimitDraft(value),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['workload'] });
      void qc.invalidateQueries({ queryKey: ['system-settings'] });
      setLimitDraft(null);
    },
  });
  const limit = limitDraft ?? data?.limit ?? 0;

  const days = data?.days ?? [];
  const lead =
    data?.scope === 'teams' ? ' You see the people on the projects you manage, and only those projects’ tasks.' : data?.scope === 'self' ? ' You see your own tasks.' : '';

  return (
    <div>
      <div className="relative z-20 mb-1 animate-fade-in-up">
        <PageTitle eyebrow="Workspace" title="Workload" />
      </div>
      <p className="mb-4 text-sm text-ink-2">
        Open tasks due each day, per person. <span role="status">{data && !query.isError ? summaryLine(people, week === thisWeek) : ''}</span>
        {lead}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => goToWeek(shiftDayKey(week, -7))} aria-label="Previous week" title="Previous week" className={iconButton}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button type="button" onClick={() => goToWeek(thisWeek)} title="Back to this week" className="h-9 [@media(pointer:coarse)]:h-11 whitespace-nowrap rounded-xl border border-line bg-surface px-3 text-sm font-bold text-ink transition-colors hover:border-brand hover:text-brand">
            {weekLabel(week, today)}
          </button>
          <button type="button" onClick={() => goToWeek(shiftDayKey(week, 7))} aria-label="Next week" title="Next week" className={iconButton}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
        <div className={`${BOX} flex-[1_1_10rem] sm:flex-none`}>
          <label htmlFor="wl-project" className="flex-none text-ink-2">Project</label>
          <select
            id="wl-project"
            value={projectId}
            onChange={(e) => {
              setOpen(null);
              setParam('project', e.target.value);
            }}
            className={`${SELECT} flex-1 sm:max-w-[12rem]`}
          >
            <option value="">All</option>
            {(data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="relative min-w-0 flex-[1_1_12rem] sm:max-w-[16rem]">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </span>
          <input
            type="search"
            data-page-search
            aria-label="Find a person"
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a person…"
            className="h-9 [@media(pointer:coarse)]:h-11 w-full rounded-xl border border-line bg-surface pe-3 ps-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        {data ? (
          data.canChangeLimit ? (
            <div className={`${BOX} ms-auto`}>
              <label htmlFor="wl-limit" className="flex-none text-ink-2">Daily limit</label>
              <select id="wl-limit" value={limit} disabled={setLimit.isPending} onChange={(e) => setLimit.mutate(Number(e.target.value))} className={SELECT} title="Open tasks a person may have due on one working day — for everyone">
                {limitOptions(limit).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="ms-auto flex h-9 [@media(pointer:coarse)]:h-11 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink-2" title="Set by an administrator">
              <span>Daily limit</span> <b className="text-ink">{data.limit}</b>
            </div>
          )
        ) : null}
      </div>
      {setLimit.isError ? (
        <p role="alert" className="mb-3 text-sm text-danger">Couldn’t change the daily limit: {reasonOf(setLimit.error)}.</p>
      ) : null}

      {query.isLoading ? (
        <div className="card p-4" aria-busy="true" role="status" aria-label="Loading the workload">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="skeleton h-8 w-8 flex-none rounded-full" />
              <div className="skeleton h-4 w-40" />
              <div className="skeleton ms-6 h-8 flex-1" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <LoadError what="the workload" onRetry={() => void query.refetch()} />
      ) : data ? (
        <div>
          {/* On a phone the days don't fit beside the names: the names stay put while the days scroll. */}
          <p className="mb-2 text-xs text-ink-2 sm:hidden">Swipe the table sideways to see each day.</p>
          <div className="card overflow-hidden">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-sm sm:min-w-[48rem]">
                <caption className="sr-only">Open tasks due each day, per person — {weekLabel(week, today)}</caption>
                <thead>
                  <tr className="bg-surface-2 text-[11.5px] font-bold uppercase tracking-wide text-ink-2">
                    <th scope="col" className="sticky start-0 z-[2] w-36 border-b border-e border-line bg-surface-2 px-3 py-2.5 text-start font-bold sm:w-72 sm:border-e-0 sm:px-4">Person · this week</th>
                    <th scope="col" className="border-b border-line px-1 py-2.5 text-center font-bold">Overdue</th>
                    {days.map((d) => (
                      <th key={d.date} scope="col" className={`border-b border-line px-1 py-2.5 text-center font-bold ${d.date === today ? 'bg-brand/[0.05] text-brand' : ''}`}>
                        {dayHeading(d.date, today)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const bar = weekBar(p);
                    return (
                      <tr key={p.id}>
                        <th scope="row" className="sticky start-0 z-[1] border-b border-e border-line-2 border-e-line bg-surface px-3 py-2.5 text-start font-normal sm:border-e-0 sm:px-4">
                          {/* On a phone the person column stays narrow (no picture, the name and its note in
                              ~7.5rem), so more days show beside it. */}
                          <span className="flex items-center gap-2.5">
                            <span className="hidden flex-none sm:block"><Avatar name={p.name} src={p.avatarUrl} size="md" /></span>
                            <span className="min-w-0 max-sm:w-[7.5rem]">
                              <span data-person-name title={p.name} className="block truncate font-bold text-ink">{p.name}</span>
                              <span aria-hidden="true" className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-ground sm:w-36">
                                <span className={`block h-full rounded-full ${BAR[bar.tone]}`} style={{ width: `${bar.pct}%` }} />
                              </span>
                              <span className="mt-0.5 block text-[11px] text-ink-2">
                                {bar.text} · <span className={bar.tone === 'over' ? 'font-bold text-danger' : ''}>{bar.note}</span>
                              </span>
                            </span>
                          </span>
                        </th>
                        <td className={`border-b border-line-2 px-1 text-center text-sm font-bold tabular-nums ${p.overdue ? 'text-danger' : 'text-ink-3'}`}>{p.overdue}</td>
                        {p.days.map((c) => {
                          const tone = cellTone(c);
                          const isOpen = open?.personId === p.id && open.date === c.date;
                          return (
                            <td key={c.date} className={`border-b border-line-2 px-1 py-2 text-center ${c.date === today ? 'bg-brand/[0.04]' : ''}`}>
                              {tone === 'off' ? (
                                <span className={`${CELL} hatch-off text-[11.5px] text-ink-3`}>Off</span>
                              ) : tone === 'none' ? (
                                <span className={`${CELL} text-ink-3`}>0</span>
                              ) : (
                                <button
                                  type="button"
                                  data-tone={tone}
                                  onClick={(e) => openDay(p, c, e)}
                                  aria-label={cellLabel(p.name, c)}
                                  aria-haspopup="dialog"
                                  aria-expanded={isOpen}
                                  className={`${CELL} transition-transform hover:-translate-y-px ${TONE[tone]}`}
                                >
                                  {c.count}
                                  {tone === 'over' ? (
                                    <span aria-hidden="true" className="absolute -end-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-danger text-[10px] font-bold leading-none text-white">!</span>
                                  ) : null}
                                </button>
                              )}
                              {isOpen && openPerson && openCell ? (
                                <WorkloadPopover
                                  person={openPerson}
                                  cell={openCell}
                                  week={week}
                                  trigger={trigger}
                                  busyTaskId={apply.isPending ? apply.variables?.task.id ?? null : null}
                                  notice={notice}
                                  onApply={(task) => apply.mutate({ task, person: openPerson })}
                                  onOpenTask={(id) => {
                                    setOpen(null);
                                    setTaskId(id);
                                  }}
                                  onClose={() => setOpen(null)}
                                />
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={2 + days.length} className="px-4 py-8 text-center text-ink-2">
                        {q.trim() ? `Nobody matches “${q.trim()}”.` : 'Nobody to show for this week.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Legend />
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-sm text-ink-2">
        {data?.scope === 'self'
          ? 'Suggestions name the next lighter day. Nothing changes until you click.'
          : 'Suggestions name the least-busy teammate on the project for that day, or the next lighter day. Nothing changes until you click.'}
      </p>
      {taskId ? <TaskDrawerContainer taskId={taskId} onClose={() => setTaskId(null)} /> : null}
    </div>
  );
}
