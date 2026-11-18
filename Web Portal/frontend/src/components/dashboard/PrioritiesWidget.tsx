import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { dashboardApi, PRIORITIES_KEY, type PrioritiesAnswer, type PriorityChip, type PriorityRow, type PriorityTask } from '../../api/dashboard';
import { tasksApi } from '../../api/tasks';
import { assigneesApi } from '../../api/assignees';
import { membersApi } from '../../api/members';
import { meetingsApi } from '../../api/meetings';
import { bulkApi } from '../../api/bulk';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { approvalNotice, approvedNotice, approveLabel, isWaitingForApproval, sentBackNotice } from '../../lib/approvals';
import {
  CHIP_LABEL,
  chipsShown,
  planTaskReschedule,
  PRIORITIES_CHIP_EMPTY,
  PRIORITIES_EMPTY,
  PRIORITIES_TITLE,
  reasonText,
  rescheduleChoices,
  rowsFor,
  SHOWN_FIRST,
} from '../../lib/dashboard-priorities';
import { bulkConfirmText, dueLabel, GROUP_EMPTY, GROUP_FIRST, groupOf, groupRows, movableOverdue, rowName, type PriorityGroupId } from '../../lib/dashboard-priority-groups';
import { dayText } from '../../lib/day-words';
import { todayKey } from '../../lib/due-date';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { useCompanyWeekStart } from '../../lib/useDatePrefs';
import { usePrioritiesRealtime } from './usePrioritiesRealtime';
import { useNotificationRealtime } from '../../lib/useNotificationRealtime';
import { relativeTime } from '../../lib/relative-time';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { DENSE_FACE, DENSE_STACK } from '../../lib/density-tokens';
import { TaskKey, TaskKeyButton } from '../TaskKey';
import { ProjectAvatar } from '../ProjectAvatar';
import { Avatar } from '../ui/Avatar';
import { PriorityBadge } from '../ui/PriorityBadge';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DayCalendar } from '../ui/DateTimeField';
import { LoadError } from '../ui/LoadError';
import { SendBackDialog } from '../approvals/SendBackDialog';
import { MergedToast } from '../task-merge/MergedToast';

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A small button (the Overdue group's actions): finger-sized on a touch screen. */
const ACTION_SHAPE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60 [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:px-3';
const ACTION = `${ACTION_SHAPE} border-line bg-surface text-ink hover:border-brand/30 hover:bg-ground`;
/** An approval row's main action (Approve). */
const ACTION_MAIN = `${ACTION_SHAPE} border-brand bg-brand text-white hover:bg-brand-2`;
const POPOVER = 'rounded-xl border border-line bg-surface shadow-lift';
const MENU_ITEM = `flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-ground focus-visible:bg-ground disabled:opacity-60 ${TOUCH_TALL}`;
/** The tick and the ⋯ button: 44 × 44 in a narrow card (a phone, a Small widget) and on any touch screen; 32 × 32 in a wide card. */
const ROW_SQUARE = `h-11 w-11 [@container(min-width:44rem)]:h-8 [@container(min-width:44rem)]:w-8 ${TOUCH_SQUARE}`;

/**
 * 1.23.5: the list a widget shows — the Dashboard's My Priorities Today (the default), or a project's Next
 * actions (its Overview tab) — with the same rows, reasons and quick actions.
 */
export interface PriorityListConfig {
  queryKey: readonly unknown[];
  /** `fresh`: right after the person's own change. */
  fetch: (fresh: boolean) => Promise<PrioritiesAnswer>;
  title: string;
  /** The heading's id (the section is named by it). */
  headingId: string;
  /** What an empty list says. */
  empty: string;
  /** What a failed load names ("your priorities"). */
  what: string;
  /** How many rows show before "Show all" (default 10; a flat list only). */
  first?: number;
  /** The filter chips (default: shown). */
  chips?: boolean;
  /** Listen for live changes itself (default); false when its page already does (a project's Next actions). */
  live?: boolean;
  /** 1.23.41: Today · Overdue · Approvals · Blocked · Upcoming · Team groups (the Dashboard); otherwise one flat list. */
  grouped?: boolean;
  testId?: string;
}

const DASHBOARD_LIST: PriorityListConfig = {
  queryKey: PRIORITIES_KEY,
  fetch: (fresh) => dashboardApi(apiClient).priorities(fresh),
  title: PRIORITIES_TITLE,
  headingId: 'dash-priorities-heading',
  empty: PRIORITIES_EMPTY,
  what: 'your priorities',
  grouped: true,
  testId: 'priorities-widget',
};

interface Notice {
  text: string;
  /** How long it stays (MergedToast's default when absent). */
  ms?: number;
  undo?: () => Promise<string>;
  openTaskId?: string;
}

/** The Overdue group's "Move all to today" / "Reschedule all…", waiting for its confirmation. */
interface BulkMove {
  day: string;
  movable: PriorityRow[];
  staying: number;
  allTasks: boolean;
}

/**
 * 1.23.4 "My Priorities Today": one ranked list of what needs the person first — late and due-today work,
 * approvals waiting for them, what they block or are blocked by, urgent and upcoming tasks, their meeting
 * action items and, for the people who run projects, the team's tasks that need them — with filter chips
 * and the quick actions the person may do (the server's own rules decide each one). 1.23.41 (owner, 18 Nov
 * 2026): a compact grouped list — Today · Overdue · Approvals · Blocked · Upcoming · Team, five rows each,
 * one line per row (a tick, the task, its project, due day and people, one ⋯ menu), and the Overdue group's
 * "Move all to today" / "Reschedule all…". Every action updates the list at once, with Undo where it can.
 */
export function PrioritiesWidget({ onOpenTask, list }: { onOpenTask: (taskId: string, list?: string[], at?: { item?: string }) => void; list?: PriorityListConfig }) {
  const cfg = list ?? DASHBOARD_LIST;
  const first = cfg.first ?? SHOWN_FIRST;
  const grouped = cfg.grouped === true;
  const qc = useQueryClient();
  const fresh = useRef(false);
  const q = useQuery({
    queryKey: cfg.queryKey,
    queryFn: () => {
      const f = fresh.current;
      fresh.current = false;
      return cfg.fetch(f);
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const data: PrioritiesAnswer | null = q.data && Array.isArray(q.data.items) ? q.data : null;
  const timeZone = useCompanyTimeZone();
  const weekStart = useCompanyWeekStart();
  const today = data?.today ?? todayKey(timeZone);

  const [chip, setChip] = useState<'all' | PriorityChip>('all');
  const [showAll, setShowAll] = useState(false);
  /** How many rows each group shows (five until "Show more" / "Show all"). */
  const [groupShown, setGroupShown] = useState<Partial<Record<string, number>>>({});
  /** Rows an action just took off the list (until the list is read again). */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState<PriorityTask | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [asking, setAsking] = useState<BulkMove | null>(null);
  /** Where focus goes back after a row's action: the row (it may now be in another group), else its neighbour. */
  const refocus = useRef<{ id: string; order: string[] } | null>(null);
  const listRef = useRef<HTMLElement>(null);

  /** Read the list again: `own` after the person's own change (the server's 30-second copy is skipped). */
  const refresh = useCallback(
    async (own: boolean) => {
      if (own) fresh.current = true;
      await qc.invalidateQueries({ queryKey: cfg.queryKey });
      setGone(new Set());
    },
    [qc, cfg.queryKey],
  );
  /** After the person's own change: every task view, this list among them (read fresh). */
  const refreshAll = useCallback(async () => {
    fresh.current = true;
    await invalidateTaskQueries(qc);
    setGone(new Set());
  }, [qc]);
  // Live: another person's change in a project of the list, or a notice of the person's own (a new task for them).
  const live = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (live.current) clearTimeout(live.current);
    live.current = setTimeout(() => void refresh(false), 600);
  }, [refresh]);
  useEffect(() => () => void (live.current && clearTimeout(live.current)), []);
  // 1.23.5: a list whose page already listens (a project's Next actions) opens no sockets of its own.
  const listens = cfg.live !== false;
  usePrioritiesRealtime(listens ? data?.watch : undefined, soon);
  useNotificationRealtime(soon, undefined, listens);

  const rows = useMemo(() => (data?.items ?? []).filter((r) => !gone.has(r.id)), [data, gone]);
  const inChip = chip === 'all' ? rows.length : rows.filter((r) => r.chips.includes(chip)).length;
  const counts = data?.counts;

  /** What shows: the groups (All), one chip's rows, or the flat list (a project's Next actions). */
  const blocks = useMemo(() => {
    if (!grouped) return null;
    if (chip !== 'all') {
      const shownRows = rowsFor(rows, chip, true);
      // The chip's own number (the server's; more than the loaded rows when the list is cut at 300).
      return [{ id: chip as PriorityGroupId, label: CHIP_LABEL[chip], rows: shownRows, count: data && data.total > data.items.length ? Math.max(shownRows.length, counts?.[chip] ?? 0) : shownRows.length, empty: PRIORITIES_CHIP_EMPTY }];
    }
    return groupRows(rows, { manager: !!data?.manager }).map((g) => ({ ...g, count: g.rows.length, empty: GROUP_EMPTY[g.id] }));
  }, [grouped, chip, rows, data, counts]);
  const flat = grouped ? [] : rowsFor(rows, chip, true).slice(0, showAll ? undefined : first);
  const shownOf = (id: string) => groupShown[id] ?? GROUP_FIRST;
  const visible = blocks ? blocks.flatMap((b) => b.rows.slice(0, shownOf(b.id))) : flat;
  const taskIds = visible.map((r) => r.task?.id ?? r.checklistItem?.task.id).filter((id): id is string => !!id);

  /** Run one quick action: the row leaves at once when it is done with, the list is read again, the notice says what happened. */
  async function act(row: PriorityRow, work: () => Promise<Notice>, opts: { leaves: boolean }) {
    refocus.current = { id: row.id, order: visible.map((r) => r.id) };
    setBusy(row.id);
    setProblem(null);
    if (opts.leaves) setGone((g) => new Set([...g, row.id]));
    try {
      const said = await work();
      setNotice(said);
      await refreshAll();
    } catch (e) {
      setGone((g) => new Set([...g].filter((id) => id !== row.id)));
      setProblem({ id: row.id, text: messageOf(e, 'That didn’t work. Please try again.') });
      void refresh(true);
    } finally {
      setBusy(null);
    }
  }

  async function undo(n: Notice) {
    if (!n.undo) return;
    setNotice(null);
    try {
      const text = await n.undo();
      setNotice({ text });
    } catch (e) {
      setNotice({ text: messageOf(e, 'Couldn’t undo it. Please try again.') });
    }
    await refreshAll();
  }

  const tasks = tasksApi(apiClient);
  const dash = dashboardApi(apiClient);

  const complete = (row: PriorityRow, t: PriorityTask) =>
    act(
      row,
      async () => {
        const moved = await tasks.move(t.id, t.doneColumnId!);
        const waits = approvalNotice(t.doneColumnId!, moved);
        // Waiting for approval in the very column it was in (a Review column, or a project without one):
        // moving it "back" would change nothing, so there is no Undo (review I1).
        const stays = isWaitingForApproval(moved) && moved.columnId === t.columnId;
        return {
          text: waits ?? `Completed ${t.key}.`,
          openTaskId: t.id,
          undo: stays ? undefined : async () => {
            await tasks.move(t.id, t.columnId);
            return waits ? `${t.key} no longer waits for approval.` : `${t.key} is open again.`;
          },
        };
      },
      { leaves: true },
    );

  /** A task's reschedule as Reschedule sends it (the start date and a repeat rule move with it); the Undo it gets. */
  const moveTask = async (t: PriorityTask, day: string): Promise<() => Promise<void>> => {
    const plan = planTaskReschedule(t, day);
    const saved = await dash.reschedule(t.id, plan.patch);
    // From the copy this reschedule saved: if someone changed it since, the server refuses (409).
    return async () => {
      await dash.reschedule(t.id, plan.undo(saved.version ?? t.version + 1));
    };
  };

  const reschedule = (row: PriorityRow, t: PriorityTask, day: string) =>
    act(
      row,
      async () => {
        const back = await moveTask(t, day);
        return {
          text: `${t.key} is now due ${dayText(day, { weekday: 'short', year: false })}.`,
          openTaskId: t.id,
          undo: async () => {
            await back();
            return t.dueDate ? `${t.key} is due ${dayText(t.dueDate, { weekday: 'short', year: false })} again.` : `${t.key} has no due date again.`;
          },
        };
      },
      { leaves: false },
    );

  const assign = (row: PriorityRow, t: PriorityTask, person: { id: string; name: string }) =>
    act(
      row,
      async () => {
        await assigneesApi(apiClient).assign(t.id, person.id);
        return {
          text: `Assigned ${t.key} to ${person.name}.`,
          openTaskId: t.id,
          undo: async () => {
            await assigneesApi(apiClient).unassign(t.id, person.id);
            return `Took ${person.name} off ${t.key}.`;
          },
        };
      },
      { leaves: row.reason.code === 'unassigned' },
    );

  const approve = (row: PriorityRow, t: PriorityTask) =>
    act(
      row,
      async () => {
        await tasks.approve(t.id, t.version);
        return { text: approvedNotice(t.key), openTaskId: t.id };
      },
      { leaves: true },
    );

  const itemDone = (row: PriorityRow) => {
    const a = row.actionItem!;
    return act(
      row,
      async () => {
        await meetingsApi(apiClient).updateActionItem(a.id, { status: 'COMPLETED' });
        return {
          text: `Marked “${a.description}” done.`,
          undo: async () => {
            await meetingsApi(apiClient).updateActionItem(a.id, { status: a.status as 'OPEN' });
            return `“${a.description}” is open again.`;
          },
        };
      },
      { leaves: true },
    );
  };

  const itemReschedule = (row: PriorityRow, day: string) => {
    const a = row.actionItem!;
    return act(
      row,
      async () => {
        await meetingsApi(apiClient).updateActionItem(a.id, { dueDate: day });
        return {
          text: `“${a.description}” is now due ${dayText(day, { weekday: 'short', year: false })}.`,
          undo: async () => {
            await meetingsApi(apiClient).updateActionItem(a.id, { dueDate: a.dueDate });
            return `“${a.description}” is back to its day.`;
          },
        };
      },
      { leaves: false },
    );
  };

  /** 1.23.3 checklist items: Tick (Undo unticks it) and Reschedule. */
  const tick = (row: PriorityRow) => {
    const c = row.checklistItem!;
    return act(
      row,
      async () => {
        await dash.tickChecklistItem(c.id, true);
        return {
          text: `Ticked “${c.text}” on ${c.task.key}.`,
          openTaskId: c.task.id,
          undo: async () => {
            await dash.tickChecklistItem(c.id, false);
            return `“${c.text}” is open again.`;
          },
        };
      },
      { leaves: true },
    );
  };

  const stepReschedule = (row: PriorityRow, day: string) => {
    const c = row.checklistItem!;
    return act(
      row,
      async () => {
        await dash.rescheduleChecklistItem(c.id, day);
        return {
          text: `“${c.text}” is now due ${dayText(day, { weekday: 'short', year: false })}.`,
          openTaskId: c.task.id,
          undo: async () => {
            await dash.rescheduleChecklistItem(c.id, c.dueDate);
            return `“${c.text}” is back to its day.`;
          },
        };
      },
      { leaves: false },
    );
  };

  /** One row of "Move all", one by one (a repeating task, an action item, a checklist item): its Undo. */
  const moveOne = async (r: PriorityRow, day: string): Promise<() => Promise<void>> => {
    if (r.task) return moveTask(r.task, day);
    if (r.actionItem) {
      const a = r.actionItem;
      await meetingsApi(apiClient).updateActionItem(a.id, { dueDate: day });
      return async () => void (await meetingsApi(apiClient).updateActionItem(a.id, { dueDate: a.dueDate }));
    }
    const c = r.checklistItem!;
    await dash.rescheduleChecklistItem(c.id, day);
    return async () => void (await dash.rescheduleChecklistItem(c.id, c.dueDate));
  };

  /**
   * The Overdue group's "Move all": the tasks without a repeat go in one bulk change (POST /tasks/bulk, the
   * server checks each and says what it skipped; its own Undo); a repeating task, an action item and a
   * checklist item go one by one, as their own Reschedule sends them. One notice, one Undo for all of it.
   */
  async function moveAll(m: BulkMove) {
    setBusy('bulk');
    setProblem(null);
    // Only rows still on the list (someone may have finished or moved one while the question was open).
    const still = new Set(rows.map((r) => r.id));
    const movable = m.movable.filter((r) => still.has(r.id));
    const viaBulk = movable.filter((r) => r.kind === 'task' && r.task && !r.task.recurrenceRule);
    const oneByOne = movable.filter((r) => !viaBulk.includes(r));
    let moved = 0;
    let failed = 0;
    let why: string | null = null;
    let bulkUndo: { id: string; until: string } | null = null;
    let bulkMoved = 0;
    const backs: (() => Promise<void>)[] = [];
    // One by one first, so the bulk change (whose Undo lasts 30 seconds) is the last step before the notice.
    for (const r of oneByOne) {
      try {
        backs.push(await moveOne(r, m.day));
        moved += 1;
      } catch (e) {
        failed += 1;
        why ??= messageOf(e, 'That didn’t work. Please try again.');
      }
    }
    if (viaBulk.length) {
      try {
        const res = await bulkApi(apiClient).run(
          viaBulk.map((r) => r.task!.id),
          { type: 'dueDate', mode: 'set', date: m.day },
        );
        bulkMoved = res.changed.length;
        moved += res.changed.length;
        failed += res.skipped.length;
        why ??= res.skipped[0]?.reason ?? null;
        bulkUndo = res.undo;
      } catch (e) {
        failed += viaBulk.length;
        why ??= messageOf(e, 'That didn’t work. Please try again.');
      }
    }
    const [one, many] = m.allTasks ? ['task', 'tasks'] : ['item', 'items'];
    const when = m.day === today ? 'today' : dayText(m.day, { weekday: 'short', year: m.day.slice(0, 4) !== today.slice(0, 4) });
    const reason = why ? ` ${why.replace(/\.?$/, '.')}` : '';
    const text =
      moved > 0 ? `Moved ${plural(moved, one, many)} to ${when}.${failed ? ` ${failed} couldn’t be moved.${reason}` : ''}` : `Nothing was moved.${reason}`;
    setAsking(null);
    setNotice({
      text,
      // While the bulk change can still be undone (the server keeps it 30 seconds).
      ms: bulkUndo ? Math.max(3_000, Math.min(12_000, Date.parse(bulkUndo.until) - Date.now() - 1_000)) : undefined,
      undo:
        bulkUndo || backs.length
          ? async () => {
              let back = 0;
              let left = 0;
              let said = '';
              if (bulkUndo) {
                try {
                  const u = await bulkApi(apiClient).undo(bulkUndo.id);
                  back += u.restored.length;
                  left += u.skipped.length;
                } catch (e) {
                  // Ran out of time (or the network): say so — they weren't changed by anyone.
                  said = ` ${plural(bulkMoved, one, many)} stayed: ${messageOf(e, 'Undo is no longer available.')}`;
                }
              }
              for (const b of backs) {
                try {
                  await b();
                  back += 1;
                } catch {
                  left += 1;
                }
              }
              return `Put back ${plural(back, one, many)}.${left ? ` ${left} changed since — left as ${left === 1 ? 'it is' : 'they are'}.` : ''}${said}`;
            }
          : undefined,
    });
    try {
      await refreshAll();
    } finally {
      setBusy(null);
    }
  }

  const renderRow = (row: PriorityRow) => (
    <PriorityItem
      key={row.id}
      row={row}
      today={today}
      weekStart={weekStart}
      busy={busy === row.id}
      locked={busy !== null}
      problem={problem?.id === row.id ? problem.text : null}
      showProject={grouped}
      onExplain={(text) => setProblem({ id: row.id, text })}
      onOpenTask={(id, at) => (at ? onOpenTask(id, taskIds, at) : onOpenTask(id, taskIds))}
      onComplete={(t) => void complete(row, t)}
      onReschedule={(t, day) => void reschedule(row, t, day)}
      onAssign={(t, p) => void assign(row, t, p)}
      onApprove={(t) => void approve(row, t)}
      onSendBack={(t) => {
        setSendError(null);
        setSending(t);
      }}
      onItemDone={() => void itemDone(row)}
      onItemReschedule={(day) => void itemReschedule(row, day)}
      onStepTick={() => void tick(row)}
      onStepReschedule={(day) => void stepReschedule(row, day)}
    />
  );

  // After a row's action (the list read again): a row that moved to another group, or left, took the focus with
  // it — put it back on that row's ⋯, else on the next row's tick (the one before at the end), never the page.
  useEffect(() => {
    const f = refocus.current;
    const root = listRef.current;
    if (!f || busy !== null || !root) return;
    refocus.current = null;
    const at = document.activeElement;
    if (at && at !== document.body && at.isConnected) return;
    const rowEl = (id: string) => root.querySelector<HTMLElement>(`[data-priority-row="${CSS.escape(id)}"]`);
    const same = rowEl(f.id)?.querySelector<HTMLElement>('[data-row-more]');
    if (same) return void same.focus();
    const i = f.order.indexOf(f.id);
    for (const id of [...f.order.slice(i + 1), ...f.order.slice(0, Math.max(0, i)).reverse()]) {
      const el = rowEl(id);
      const target = el?.querySelector<HTMLElement>('[data-row-tick]') ?? el?.querySelector<HTMLElement>('[data-row-more]');
      if (target) return void target.focus();
    }
    root.querySelector<HTMLElement>('h2')?.focus();
  });

  const total = data?.total ?? 0;
  return (
    <section ref={listRef} className="card card-pad" aria-labelledby={cfg.headingId} data-testid={cfg.testId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={cfg.headingId} tabIndex={-1} className="font-display outline-none text-base font-semibold text-ink">
          {cfg.title}
          {data ? <span className="ms-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{total}</span> : null}
        </h2>
        {data && total > 0 && cfg.chips !== false ? (
          <div role="group" aria-label="Show priorities by reason" className="flex flex-wrap gap-1.5">
            {chipsShown(data.manager).map((c) => {
              const count = counts?.[c] ?? 0;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={chip === c}
                  onClick={() => {
                    setChip(c);
                    setShowAll(false);
                    setGroupShown({});
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${TOUCH_TALL} ${
                    chip === c ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'
                  }`}
                >
                  {CHIP_LABEL[c]} <span className={chip === c ? 'text-white' : 'text-ink-3'}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {q.isLoading ? (
        <div role="status" aria-label={`Loading ${cfg.what}`} className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : q.isError || !data ? (
        // An outage must never read as "nothing urgent".
        <LoadError what={cfg.what} onRetry={() => void q.refetch()} className="py-4 text-center" />
      ) : rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-ink-2">
          <span aria-hidden="true" className="text-success">
            <CheckIcon />
          </span>
          {cfg.empty}
        </p>
      ) : blocks ? (
        <div className="flex flex-col gap-4 [container-type:inline-size]">
          {blocks.map((b) => {
            const hid = `${cfg.headingId}-${b.id}`;
            const shown = shownOf(b.id);
            const n = b.rows.length;
            // Move all: the person's own late work only (in the Overdue chip too, never the team's).
            const late = b.rows.filter((r) => groupOf(r) === 'overdue');
            const set = (k: number) => setGroupShown((g) => ({ ...g, [b.id]: k }));
            return (
              <div key={b.id} data-priority-group={b.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5">
                  <h3 id={hid} className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                    {b.label} <span className={`ms-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${b.id === 'overdue' && n > 0 ? 'bg-danger-soft text-danger' : 'bg-ground text-ink-2'}`}>{b.count}</span>
                  </h3>
                  {b.id === 'overdue' ? (
                    <OverdueActions rows={late} today={today} weekStart={weekStart} disabled={busy !== null} onAsk={(day) => setAsking({ day, ...movableOverdue(late) })} />
                  ) : null}
                </div>
                {n === 0 ? (
                  <p className="py-2 text-sm text-ink-2">{b.empty}</p>
                ) : (
                  <ul aria-labelledby={hid} className="divide-y divide-line">
                    {b.rows.slice(0, shown).map(renderRow)}
                  </ul>
                )}
                {n > GROUP_FIRST ? (
                  <div className="flex flex-wrap gap-x-4 pt-1">
                    {shown < n && n - shown > GROUP_FIRST ? (
                      <button type="button" aria-label={`Show more in ${b.label}`} onClick={() => set(shown + GROUP_FIRST)} className={`text-sm font-semibold text-brand hover:underline ${TOUCH_TALL}`}>
                        Show more
                      </button>
                    ) : null}
                    {shown < n ? (
                      <button type="button" aria-label={`Show all ${n} in ${b.label}`} onClick={() => set(n)} className={`text-sm font-semibold text-brand hover:underline ${TOUCH_TALL}`}>
                        Show all {n}
                      </button>
                    ) : (
                      <button type="button" aria-label={`Show fewer in ${b.label}`} onClick={() => set(GROUP_FIRST)} className={`text-sm font-semibold text-brand hover:underline ${TOUCH_TALL}`}>
                        Show fewer
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {total > (data.items.length ?? 0) ? <p className="text-xs text-ink-2">Showing the {data.items.length} most urgent of {total}.</p> : null}
        </div>
      ) : flat.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-2">{PRIORITIES_CHIP_EMPTY}</p>
      ) : (
        <ul className="divide-y divide-line [container-type:inline-size]" aria-label={`${CHIP_LABEL[chip]} priorities`}>
          {flat.map(renderRow)}
        </ul>
      )}

      {!blocks && data && inChip > first ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setShowAll((s) => !s)} className={`text-sm font-semibold text-brand hover:underline ${TOUCH_TALL}`} aria-expanded={showAll}>
            {showAll ? 'Show fewer' : `Show all (${chip === 'all' ? total : inChip})`}
          </button>
          {showAll && total > data.items.length ? <p className="text-xs text-ink-2">Showing the {data.items.length} most urgent of {total}.</p> : null}
        </div>
      ) : null}

      {asking ? (
        <ConfirmDialog
          title={bulkConfirmText({ count: asking.movable.length, staying: asking.staying, allTasks: asking.allTasks, day: asking.day, today })}
          confirmLabel={`Move to ${asking.day === today ? 'today' : dayText(asking.day, { weekday: 'short', year: asking.day.slice(0, 4) !== today.slice(0, 4) })}`}
          keepLabel="Cancel"
          tone="primary"
          busy={busy === 'bulk'}
          onConfirm={() => void moveAll(asking)}
          onClose={() => setAsking(null)}
        >
          You can undo it from the notice that follows.
        </ConfirmDialog>
      ) : null}
      {sending ? (
        <SendBackDialog
          taskKey={sending.key}
          taskTitle={sending.title}
          busy={busy !== null}
          error={sendError}
          onClose={() => setSending(null)}
          onSend={(reason) => {
            const t = sending;
            const row = rows.find((r) => r.task?.id === t.id);
            setBusy(row?.id ?? t.id);
            setSendError(null);
            tasks
              .sendBack(t.id, reason, t.version)
              .then(async () => {
                setSending(null);
                setGone((g) => new Set([...g, row?.id ?? '']));
                setNotice({ text: sentBackNotice(t.key), openTaskId: t.id });
                await refreshAll();
              })
              .catch((e) => setSendError(messageOf(e, 'Couldn’t send it back. Please try again.')))
              .finally(() => setBusy(null));
          }}
        />
      ) : null}
      {notice ? (
        <MergedToast
          text={notice.text}
          onOpen={notice.openTaskId ? () => onOpenTask(notice.openTaskId!) : undefined}
          onUndo={notice.undo ? () => void undo(notice) : undefined}
          onDismiss={() => setNotice(null)}
          ms={notice.ms}
        />
      ) : null}
    </section>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

/** The Overdue group's actions: "Move all to today" and "Reschedule all…" (a date), for the rows the person may move. */
function OverdueActions({ rows, today, weekStart, disabled, onAsk }: { rows: PriorityRow[]; today: string; weekStart: 0 | 1 | 6; disabled: boolean; onAsk: (day: string) => void }) {
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (movableOverdue(rows).movable.length === 0) return null;
  const close = () => setPicking(false);
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={ACTION} disabled={disabled} onClick={() => onAsk(today)}>
        Move all to today
      </button>
      <button ref={anchor} type="button" className={ACTION} aria-haspopup="dialog" aria-expanded={picking} disabled={disabled} onClick={() => setPicking((p) => !p)}>
        <CalendarIcon /> Reschedule all…
      </button>
      {picking ? (
        <AnchoredPopover anchor={anchor} label="Reschedule the overdue tasks" onClose={close} className={`${POPOVER} w-[min(19rem,calc(100vw-1rem))] p-3`}>
          <p data-popover-heading tabIndex={-1} className="px-1 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            Move them to
          </p>
          <DayCalendar
            value=""
            today={today}
            weekStart={weekStart}
            onPick={(day) => {
              close();
              anchor.current?.focus();
              if (day) onAsk(day);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}

interface ItemProps {
  row: PriorityRow;
  today: string;
  weekStart: 0 | 1 | 6;
  busy: boolean;
  /** Another row's action is running: buttons wait. */
  locked: boolean;
  problem: string | null;
  /** The project on each row (not on one project's own Next actions). */
  showProject: boolean;
  /** A tap on a tick that can't be used: say why (a touch screen has no tooltip). */
  onExplain: (text: string) => void;
  onOpenTask: (taskId: string, at?: { item?: string }) => void;
  onComplete: (t: PriorityTask) => void;
  onReschedule: (t: PriorityTask, day: string) => void;
  onAssign: (t: PriorityTask, person: { id: string; name: string }) => void;
  onApprove: (t: PriorityTask) => void;
  onSendBack: (t: PriorityTask) => void;
  onItemDone: () => void;
  onItemReschedule: (day: string) => void;
  onStepTick: () => void;
  onStepReschedule: (day: string) => void;
}

/** Why a task's tick can't complete it (null: it can). */
function completeBlock(t: PriorityTask): string | null {
  if (t.blockers.length > 0) {
    const [b, ...more] = t.blockers;
    return `Blocked by ${b!.key}${more.length ? ` and ${more.length} more` : ''} — it can be completed once that’s done.`;
  }
  if (!t.doneColumnId) return 'Its project has no Done column.';
  if (!t.can.complete) return 'You can’t complete this one.';
  return null;
}

/**
 * One row, on one line (two on a phone): the tick, the task number and title (and Urgent / High), its
 * project, due day and people, and one ⋯ menu. A click on the row (not on a control) opens it, as Open does.
 */
function PriorityItem({ row, today, weekStart, busy, locked, problem, showProject, onExplain, onOpenTask, onComplete, onReschedule, onAssign, onApprove, onSendBack, onItemDone, onItemReschedule, onStepTick, onStepReschedule }: ItemProps) {
  const navigate = useNavigate();
  const t = row.task;
  const a = row.actionItem;
  const c = row.checklistItem;
  const name = rowName(row);
  const disabled = busy || locked;
  const due = dueLabel(t?.dueDate ?? a?.dueDate ?? c?.dueDate ?? null, today);
  const open = t ? () => onOpenTask(t.id) : c ? () => onOpenTask(c.task.id, { item: c.id }) : a?.meeting ? () => navigate(`/meetings/${a.meeting!.id}`) : null;
  const onRowClick = (e: MouseEvent<HTMLLIElement>) => {
    const target = e.target as HTMLElement;
    // Only the row itself: never a control, a menu or a dialog (React passes clicks in a portal up the tree too).
    if (!open || !e.currentTarget.contains(target) || target.closest('button, a, input, [role="dialog"], [role="alertdialog"]')) return;
    open();
  };

  const square = `${ROW_SQUARE} flex-none`;
  const tickBox =
    row.kind === 'approval' ? (
      <span aria-hidden="true" className={square} />
    ) : t ? (
      <Tick label={`Complete ${name}`} reason={completeBlock(t)} waiting={disabled} onTick={() => onComplete(t)} onExplain={onExplain} />
    ) : a ? (
      <Tick label={`Mark “${a.description}” done`} reason={a.can.done ? null : 'You can’t mark this one done.'} waiting={disabled} onTick={onItemDone} onExplain={onExplain} />
    ) : c ? (
      <Tick label={`Tick “${c.text}”`} reason={c.can.tick ? null : 'It’s ticked when all its sub-items are.'} waiting={disabled} onTick={onStepTick} onExplain={onExplain} />
    ) : (
      <span aria-hidden="true" className={square} />
    );

  const title = t ? (
    <button type="button" onClick={open!} aria-label={`Open ${t.key}: ${t.title}`} className="flex min-w-0 items-center gap-2 text-start">
      <TaskKey value={t.key} dense="compact" />
      <bdi dir="auto" title={t.title} className="truncate text-sm font-medium text-ink hover:text-brand">
        {t.title}
      </bdi>
    </button>
  ) : c ? (
    <button type="button" onClick={open!} aria-label={`Open ${c.task.key} at “${c.text}”`} className="flex min-w-0 items-center gap-2 text-start">
      <TaskKey value={c.task.key} dense="compact" />
      <bdi dir="auto" title={c.text} className="truncate text-sm font-medium text-ink hover:text-brand">
        {c.text}
      </bdi>
    </button>
  ) : a ? (
    <p dir="auto" title={a.description} className="truncate text-sm font-medium text-ink">
      {a.description}
    </p>
  ) : null;

  const priority = t?.priority ?? a?.priority;
  const note: ReactNode =
    row.kind === 'approval' && t?.requestedBy ? (
      <span className="truncate">
        Finished by <bdi>{t.requestedBy.name}</bdi>
        {t.requestedAt ? ` · ${relativeTime(t.requestedAt)}` : ''}
      </span>
    ) : t && t.blockers.length > 0 ? (
      <span className="inline-flex items-center gap-1">
        Blocked by <TaskKeyButton value={t.blockers[0]!.key} onClick={() => onOpenTask(t.blockers[0]!.id)} />
        {t.blockers.length > 1 ? ` +${t.blockers.length - 1}` : ''}
      </span>
    ) : row.reason.code === 'blocking' || row.reason.code === 'unassigned' || row.reason.code === 'blocked-status' || row.reason.code === 'team-blocked' ? (
      <span className="truncate">{reasonText(row.reason)}</span>
    ) : a ? (
      <span className="truncate">{a.meeting ? <>Action item · <bdi>{a.meeting.title}</bdi></> : 'Action item'}</span>
    ) : c ? (
      <span className="truncate">
        Checklist item{c.listTitle ? <> · <bdi>{c.listTitle}</bdi></> : null} · <bdi>{c.task.title}</bdi>
      </span>
    ) : null;

  return (
    <li className={`flex items-start gap-1 py-0.5 [@container(min-width:44rem)]:items-center ${open ? 'cursor-pointer rounded-lg hover:bg-ground/60' : ''}`} data-priority-row={row.id} data-kind={row.kind} onClick={onRowClick}>
      {tickBox}
      <div className="min-w-0 flex-1 [@container(min-width:44rem)]:flex [@container(min-width:44rem)]:items-center [@container(min-width:44rem)]:gap-3">
        <div data-row-line="1" className="flex min-h-11 min-w-0 items-center gap-2 [@container(min-width:44rem)]:min-h-8 [@container(min-width:44rem)]:flex-1">
          {title}
          {priority === 'URGENT' || priority === 'HIGH' ? (
            <span className="flex-none">
              <PriorityBadge priority={priority} />
            </span>
          ) : null}
          {row.kind === 'approval' && t ? (
            // In the first line, so the second keeps the whole width on a phone.
            <button type="button" className={`${ACTION_MAIN} ms-auto flex-none`} aria-label={approveLabel(t.key)} disabled={disabled} onClick={() => onApprove(t)}>
              {busy ? 'Approving…' : 'Approve'}
            </button>
          ) : null}
        </div>
        <div data-row-line="2" className="-mt-1.5 flex min-w-0 items-center gap-x-3 pb-1.5 text-xs text-ink-2 [@container(min-width:44rem)]:mt-0 [@container(min-width:44rem)]:flex-none [@container(min-width:44rem)]:pb-0">
          {note ? <span className="flex min-w-0 shrink [@container(min-width:44rem)]:max-w-[14rem]">{note}</span> : null}
          {t && showProject ? (
            <span className={`inline-flex min-w-0 items-center gap-1 [@container(min-width:44rem)]:w-40 [@container(min-width:44rem)]:flex-none ${note ? '[@container(max-width:43.99rem)]:flex-none' : 'shrink'}`}>
              <ProjectAvatar project={t.project} size="xs" />
              {/* A phone with a note beside it: the project's picture only (its name is still read out). */}
              <bdi className={`truncate ${note ? '[@container(max-width:43.99rem)]:sr-only' : ''}`} title={t.project.name}>
                {t.project.name}
              </bdi>
            </span>
          ) : null}
          {due ? <span className={`flex-none [@container(min-width:44rem)]:w-24 ${due.late ? 'font-semibold text-danger' : 'text-ink-2'}`}>{due.text}</span> : null}
          {t ? <Faces people={t.assignees} /> : null}
        </div>
        {problem ? (
          <p role="alert" className="pb-1 text-xs font-medium text-danger [@container(min-width:44rem)]:basis-full">
            {problem}
          </p>
        ) : null}
      </div>
      <MoreMenu
        name={name}
        disabled={disabled}
        today={today}
        weekStart={weekStart}
        reschedule={
          t?.can.reschedule && row.kind === 'task'
            ? { label: t.key, value: t.dueDate, onPick: (day) => onReschedule(t, day) }
            : a?.can.reschedule
              ? { label: `“${a.description}”`, value: a.dueDate, onPick: onItemReschedule }
              : c?.can.reschedule
                ? { label: `“${c.text}”`, value: c.dueDate, onPick: onStepReschedule }
                : null
        }
        assign={t && row.kind === 'task' && t.can.assign ? { task: t, onPick: (p) => onAssign(t, p) } : null}
        actions={[
          ...(row.kind === 'approval' && t
            ? [
                { label: 'Approve', onClick: () => onApprove(t), waits: true },
                { label: 'Send back', onClick: () => onSendBack(t), waits: true },
              ]
            : []),
          ...(t ? [{ label: 'Open', onClick: () => onOpenTask(t.id) }] : []),
          ...(c ? [{ label: 'Open task', onClick: () => onOpenTask(c.task.id, { item: c.id }) }] : []),
          ...(a?.meeting ? [{ label: 'Open meeting', to: `/meetings/${a.meeting.id}`, aria: `Open the meeting ${a.meeting.title}` }] : []),
        ]}
      />
    </li>
  );
}

/** The tick: completes the task (marks an action item done, ticks a checklist item); when it can't, it says why. */
function Tick({ label, reason, waiting, onTick, onExplain }: { label: string; reason: string | null; waiting: boolean; onTick: () => void; onExplain: (text: string) => void }) {
  const id = useId();
  const off = !!reason || waiting;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-disabled={off || undefined}
        aria-describedby={reason ? id : undefined}
        title={reason ?? undefined}
        data-row-tick
        onClick={() => {
          if (reason) onExplain(reason);
          else if (!off) onTick();
        }}
        className={`group/tick grid flex-none place-items-center rounded-full ${ROW_SQUARE} ${off ? 'cursor-not-allowed' : ''}`}
      >
        <span
          aria-hidden="true"
          className={`grid h-5 w-5 place-items-center rounded-full border-2 transition-colors ${
            reason ? 'border-dashed border-ink-3 text-transparent opacity-50' : 'border-ink-3 text-transparent group-hover/tick:border-success group-hover/tick:bg-success/10 group-hover/tick:text-success group-focus-visible/tick:border-success'
          }`}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      </button>
      {reason ? (
        <span id={id} className="sr-only">
          {reason}
        </span>
      ) : null}
    </>
  );
}

/** Up to three faces, then "+2"; the names for screen readers. */
function Faces({ people }: { people: { id: string; name: string }[] }) {
  if (people.length === 0) return <span className="flex-none text-ink-2 [@container(min-width:44rem)]:w-[4.25rem]">Unassigned</span>;
  const shown = people.slice(0, 3);
  return (
    <span className="inline-flex flex-none items-center [@container(min-width:44rem)]:w-[4.25rem]">
      <span aria-hidden="true" className={`flex -space-x-1.5 ${DENSE_STACK}`}>
        {shown.map((p) => (
          <Avatar key={p.id} name={p.name} size="sm" dense />
        ))}
        {people.length > 3 ? <span className={`grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2 ${DENSE_FACE}`}>+{people.length - 3}</span> : null}
      </span>
      <span className="sr-only">{people.map((p) => p.name).join(', ')}</span>
    </span>
  );
}

type MenuAction = { label: string; onClick?: () => void; to?: string; aria?: string; waits?: boolean };

/**
 * One ⋯ menu per row: Reschedule… (Today · Tomorrow · Next week · Pick a date, in the same menu), Assign…
 * (the project team), Open — or an approval's Approve / Send back — only what the person may do.
 */
function MoreMenu({
  name,
  disabled,
  today,
  weekStart,
  reschedule,
  assign,
  actions,
}: {
  name: string;
  disabled: boolean;
  today: string;
  weekStart: 0 | 1 | 6;
  reschedule: { label: string; value: string | null; onPick: (day: string) => void } | null;
  assign: { task: PriorityTask; onPick: (person: { id: string; name: string }) => void } | null;
  actions: MenuAction[];
}) {
  const [view, setView] = useState<'closed' | 'menu' | 'reschedule' | 'pick' | 'assign'>('closed');
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => setView('closed');
  const done = (work: () => void) => {
    close();
    anchor.current?.focus();
    work();
  };
  const label = view === 'reschedule' || view === 'pick' ? `Reschedule ${reschedule?.label ?? ''}` : view === 'assign' ? `Assign ${assign?.task.key ?? ''}` : `Actions for ${name}`;
  const wide = view === 'pick' ? 'w-[min(19rem,calc(100vw-1rem))] p-3' : view === 'assign' ? 'w-72 p-1.5' : 'w-64 p-1.5';
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`More actions for ${name}`}
        data-row-more
        aria-haspopup="dialog"
        aria-expanded={view !== 'closed'}
        onClick={() => setView((v) => (v === 'closed' ? 'menu' : 'closed'))}
        className={`grid flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink ${ROW_SQUARE}`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {view !== 'closed' ? (
        // A new popover for each step, so it is placed for its own size (a phone's edge too).
        <AnchoredPopover key={view} anchor={anchor} label={label} onClose={close} className={`${POPOVER} ${wide}`}>
          {view === 'menu' ? (
            <>
              <p data-popover-heading tabIndex={-1} className="sr-only">
                {name}
              </p>
              {reschedule ? (
                <button type="button" data-popover-action className={MENU_ITEM} disabled={disabled} onClick={() => setView('reschedule')}>
                  Reschedule…
                </button>
              ) : null}
              {assign ? (
                <button type="button" data-popover-action className={MENU_ITEM} disabled={disabled} onClick={() => setView('assign')}>
                  Assign…
                </button>
              ) : null}
              {actions.map((x) =>
                x.to ? (
                  <Link key={x.label} to={x.to} data-popover-action aria-label={x.aria} className={MENU_ITEM} onClick={close}>
                    {x.label}
                  </Link>
                ) : (
                  <button key={x.label} type="button" data-popover-action className={MENU_ITEM} disabled={x.waits ? disabled : false} onClick={() => done(x.onClick!)}>
                    {x.label}
                  </button>
                ),
              )}
            </>
          ) : view === 'reschedule' && reschedule ? (
            <>
              <p data-popover-heading tabIndex={-1} className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
                Reschedule to
              </p>
              {rescheduleChoices(today, weekStart).map((ch) => (
                <button key={ch.label} type="button" data-popover-action className={MENU_ITEM} onClick={() => done(() => ch.day !== reschedule.value && reschedule.onPick(ch.day))}>
                  <span className="font-medium">{ch.label}</span>
                  <span className="text-xs text-ink-2">{ch.hint}</span>
                </button>
              ))}
              <button type="button" data-popover-action className={MENU_ITEM} onClick={() => setView('pick')}>
                <span className="font-medium">Pick a date…</span>
                <CalendarIcon />
              </button>
            </>
          ) : view === 'pick' && reschedule ? (
            <>
              <p data-popover-heading tabIndex={-1} className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
                Pick a date
              </p>
              <DayCalendar value={reschedule.value ?? ''} today={today} weekStart={weekStart} onPick={(day) => (day ? done(() => day !== reschedule.value && reschedule.onPick(day)) : close())} />
            </>
          ) : view === 'assign' && assign ? (
            <AssignList task={assign.task} onPick={(p) => done(() => assign.onPick(p))} />
          ) : null}
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M16 2.5v4M8 2.5v4M3 10h18" />
    </svg>
  );
}

/** Assign: the project team (as the task panel's picker), the people already on it left out. */
function AssignList({ task, onPick }: { task: PriorityTask; onPick: (person: { id: string; name: string }) => void }) {
  const [filter, setFilter] = useState('');
  const membersQ = useQuery({ queryKey: ['members', task.project.id], queryFn: () => membersApi(apiClient).list(task.project.id), staleTime: 30_000 });
  const on = new Set(task.assignees.map((p) => p.id));
  const people = (Array.isArray(membersQ.data) ? membersQ.data : [])
    .filter((m) => m.hasAccess !== false && !on.has(m.id))
    .map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() || m.username }))
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((x, y) => x.name.localeCompare(y.name, 'en'));
  return (
    <>
      <p data-popover-heading tabIndex={-1} className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
        Assign to someone on the team
      </p>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Find a person"
        placeholder="Find a person…"
        className={`mx-1.5 mb-1 w-[calc(100%-0.75rem)] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink ${TOUCH_TALL}`}
      />
      <div className="max-h-64 overflow-y-auto">
        {membersQ.isLoading ? (
          <p className="px-3 py-2 text-sm text-ink-2">Loading the team…</p>
        ) : membersQ.isError ? (
          <LoadError what="the team" onRetry={() => void membersQ.refetch()} className="px-3 py-2" />
        ) : people.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-2">{filter.trim() ? 'No one by that name.' : 'Everyone on the team is already on it.'}</p>
        ) : (
          people.map((p) => (
            <button key={p.id} type="button" data-popover-action className={MENU_ITEM} onClick={() => onPick(p)}>
              <bdi>{p.name}</bdi>
            </button>
          ))
        )}
      </div>
    </>
  );
}
