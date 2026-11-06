import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { dashboardApi, PRIORITIES_KEY, type PrioritiesAnswer, type PriorityChip, type PriorityRow, type PriorityTask } from '../../api/dashboard';
import { tasksApi } from '../../api/tasks';
import { assigneesApi } from '../../api/assignees';
import { membersApi } from '../../api/members';
import { meetingsApi } from '../../api/meetings';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { approvalNotice, approvedNotice, approveLabel, isWaitingForApproval, sendBackLabel, sentBackNotice } from '../../lib/approvals';
import {
  CHIP_LABEL,
  chipsShown,
  planTaskReschedule,
  PRIORITIES_CHIP_EMPTY,
  PRIORITIES_EMPTY,
  PRIORITIES_TITLE,
  reasonTone,
  rescheduleChoices,
  rowsFor,
  SHOWN_FIRST,
  tagsOf,
} from '../../lib/dashboard-priorities';
import { dayText } from '../../lib/day-words';
import { todayKey } from '../../lib/due-date';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { useCompanyWeekStart } from '../../lib/useDatePrefs';
import { usePrioritiesRealtime } from './usePrioritiesRealtime';
import { useNotificationRealtime } from '../../lib/useNotificationRealtime';
import { relativeTime } from '../../lib/relative-time';
import { TOUCH_TALL } from '../../lib/touch';
import { TaskKey, TaskKeyButton } from '../TaskKey';
import { ProjectAvatar } from '../ProjectAvatar';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { DayCalendar } from '../ui/DateTimeField';
import { LoadError } from '../ui/LoadError';
import { badgeToneClass, type BadgeTone } from '../ui/Badge';
import { SendBackDialog } from '../approvals/SendBackDialog';
import { MergedToast } from '../task-merge/MergedToast';

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
/** A quick action's button: small, finger-sized on a touch screen. */
const ACTION_SHAPE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60 [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:px-3';
const ACTION = `${ACTION_SHAPE} border-line bg-surface text-ink hover:border-brand/30 hover:bg-ground`;
/** The row's main action (Approve). */
const ACTION_MAIN = `${ACTION_SHAPE} border-brand bg-brand text-white hover:bg-brand-2`;
/** A small menu beside its button (Reschedule, Assign). */
const POPOVER = 'rounded-xl border border-line bg-surface shadow-lift';
const MENU_ITEM = `flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-ground focus-visible:bg-ground ${TOUCH_TALL}`;

interface Notice {
  text: string;
  undo?: () => Promise<string>;
  openTaskId?: string;
}

/**
 * 1.23.4 "My Priorities Today": one ranked list of what needs the person first — late and due-today work,
 * approvals waiting for them, what they block or are blocked by, urgent and upcoming tasks, their meeting
 * action items and, for the people who run projects, the team's tasks that need them — each row saying why,
 * with filter chips and the quick actions the person may do (the server's own rules decide each one).
 * Every action updates the list at once (and for others live), with Undo where it can be undone.
 */
export function PrioritiesWidget({ onOpenTask }: { onOpenTask: (taskId: string, list?: string[], at?: { item?: string }) => void }) {
  const qc = useQueryClient();
  const fresh = useRef(false);
  const q = useQuery({
    queryKey: PRIORITIES_KEY,
    queryFn: () => {
      const f = fresh.current;
      fresh.current = false;
      return dashboardApi(apiClient).priorities(f);
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
  /** Rows an action just took off the list (until the list is read again). */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState<PriorityTask | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  /** Read the list again: `own` after the person's own change (the server's 30-second copy is skipped). */
  const refresh = useCallback(
    async (own: boolean) => {
      if (own) fresh.current = true;
      await qc.invalidateQueries({ queryKey: PRIORITIES_KEY });
      setGone(new Set());
    },
    [qc],
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
  usePrioritiesRealtime(data?.watch, soon);
  useNotificationRealtime(soon);

  const rows = useMemo(() => (data?.items ?? []).filter((r) => !gone.has(r.id)), [data, gone]);
  const shown = rowsFor(rows, chip, showAll);
  const inChip = chip === 'all' ? rows.length : rows.filter((r) => r.chips.includes(chip)).length;
  const counts = data?.counts;
  const taskIds = shown.map((r) => r.task?.id ?? r.checklistItem?.task.id).filter((id): id is string => !!id);

  /** Run one quick action: the row leaves at once when it is done with, the list is read again, the notice says what happened. */
  async function act(row: PriorityRow, work: () => Promise<Notice>, opts: { leaves: boolean }) {
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

  const reschedule = (row: PriorityRow, t: PriorityTask, day: string) =>
    act(
      row,
      async () => {
        const plan = planTaskReschedule(t, day);
        const saved = await dash.reschedule(t.id, plan.patch);
        return {
          text: `${t.key} is now due ${dayText(day, { weekday: 'short', year: false })}.`,
          openTaskId: t.id,
          // From the copy this reschedule saved: if someone changed it since, the server refuses (409).
          undo: async () => {
            await dash.reschedule(t.id, plan.undo(saved.version ?? t.version + 1));
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

  const total = data?.total ?? 0;
  return (
    <section className="card p-5" aria-labelledby="dash-priorities-heading" data-testid="priorities-widget">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-priorities-heading" className="font-display text-base font-semibold text-ink">
          {PRIORITIES_TITLE}
          {data ? <span className="ms-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{total}</span> : null}
        </h2>
        {data && total > 0 ? (
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
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${TOUCH_TALL} ${
                    chip === c ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'
                  }`}
                >
                  {CHIP_LABEL[c]} <span className={chip === c ? 'text-white/80' : 'text-ink-3'}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {q.isLoading ? (
        <div role="status" aria-label="Loading your priorities" className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-14 rounded-lg" />
          ))}
        </div>
      ) : q.isError || !data ? (
        // An outage must never read as "nothing urgent".
        <LoadError what="your priorities" onRetry={() => void q.refetch()} className="py-4 text-center" />
      ) : rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-ink-2">
          <span aria-hidden="true" className="text-success">
            <CheckIcon />
          </span>
          {PRIORITIES_EMPTY}
        </p>
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-2">{PRIORITIES_CHIP_EMPTY}</p>
      ) : (
        <ul className="divide-y divide-line" aria-label={`${CHIP_LABEL[chip]} priorities`}>
          {shown.map((row) => (
            <PriorityItem
              key={row.id}
              row={row}
              today={today}
              weekStart={weekStart}
              busy={busy === row.id}
              locked={busy !== null}
              problem={problem?.id === row.id ? problem.text : null}
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
          ))}
        </ul>
      )}

      {data && inChip > SHOWN_FIRST ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setShowAll((s) => !s)} className={`text-sm font-semibold text-brand hover:underline ${TOUCH_TALL}`} aria-expanded={showAll}>
            {showAll ? 'Show fewer' : `Show all (${chip === 'all' ? total : inChip})`}
          </button>
          {showAll && total > data.items.length ? <p className="text-xs text-ink-2">Showing the {data.items.length} most urgent of {total}.</p> : null}
        </div>
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

const TONE: Record<ReturnType<typeof reasonTone>, BadgeTone> = { danger: 'danger', warning: 'warning', info: 'info', neutral: 'neutral' };

interface ItemProps {
  row: PriorityRow;
  today: string;
  weekStart: 0 | 1 | 6;
  busy: boolean;
  /** Another row's action is running: buttons wait. */
  locked: boolean;
  problem: string | null;
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

/** One row: why (the strongest reason, then small tags), what it is, and its quick actions. */
function PriorityItem({ row, today, weekStart, busy, locked, problem, onOpenTask, onComplete, onReschedule, onAssign, onApprove, onSendBack, onItemDone, onItemReschedule, onStepTick, onStepReschedule }: ItemProps) {
  const [first, ...rest] = tagsOf(row);
  const t = row.task;
  const a = row.actionItem;
  const c = row.checklistItem;
  const label = t?.key ?? (a ? `“${a.description}”` : c ? `“${c.text}”` : '');
  const due = t?.dueDate ?? a?.dueDate ?? c?.dueDate ?? null;
  const saysDue = [row.reason, ...row.also].some((r) => r.code === 'overdue' || r.code === 'due-today' || r.code === 'due-soon' || r.code === 'team-overdue');
  const disabled = busy || locked;
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-4" data-priority-row={row.id} data-kind={row.kind}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${badgeToneClass(TONE[reasonTone(row.reason)])}`}>{first}</span>
          {rest.map((tag) => (
            <span key={tag} className="inline-flex items-center rounded-md bg-ground px-2 py-0.5 text-[11px] font-medium text-ink-2">
              {tag}
            </span>
          ))}
        </div>
        {t ? (
          <button type="button" onClick={() => onOpenTask(t.id)} aria-label={`Open ${t.key}: ${t.title}`} className={`mt-1 flex min-w-0 max-w-full items-center gap-2 text-start ${TOUCH_TALL}`}>
            <TaskKey value={t.key} dense="compact" />
            <bdi dir="auto" title={t.title} className="truncate text-sm font-medium text-ink hover:text-brand">
              {t.title}
            </bdi>
          </button>
        ) : a ? (
          <p dir="auto" className="mt-1 text-sm font-medium text-ink">
            {a.description}
          </p>
        ) : c ? (
          <button type="button" onClick={() => onOpenTask(c.task.id, { item: c.id })} aria-label={`Open ${c.task.key} at “${c.text}”`} className={`mt-1 flex min-w-0 max-w-full items-center gap-2 text-start ${TOUCH_TALL}`}>
            <TaskKey value={c.task.key} dense="compact" />
            <bdi dir="auto" className="truncate text-sm font-medium text-ink hover:text-brand">
              {c.text}
            </bdi>
          </button>
        ) : null}
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2">
          {t ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <ProjectAvatar project={t.project} size="xs" />
              <bdi className="truncate">{t.project.name}</bdi>
            </span>
          ) : null}
          {a ? <span>{a.meeting ? <>Action item · <bdi>{a.meeting.title}</bdi></> : 'Action item'}</span> : null}
          {c ? (
            <span>
              Checklist item{c.listTitle ? <> · <bdi>{c.listTitle}</bdi></> : null} · <bdi>{c.task.title}</bdi>
            </span>
          ) : null}
          {row.kind === 'approval' && t?.requestedBy ? (
            <span>
              Finished by <bdi>{t.requestedBy.name}</bdi>
              {t.requestedAt ? ` · ${relativeTime(t.requestedAt)}` : ''}
            </span>
          ) : null}
          {due && !saysDue ? <span>Due {dayText(due, { year: due.slice(0, 4) !== today.slice(0, 4) })}</span> : null}
        </p>
        {problem ? (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {problem}
          </p>
        ) : null}
      </div>

      {/* Two to a row on a phone (finger-sized, nothing left alone on a line), in one line on a wide screen. */}
      <div className="grid flex-none grid-cols-2 items-center gap-1.5 md:flex md:flex-wrap" aria-label={`Actions for ${label}`} role="group">
        {row.kind === 'approval' && t ? (
          <>
            <button type="button" className={ACTION_MAIN} aria-label={approveLabel(t.key)} disabled={disabled} onClick={() => onApprove(t)}>
              {busy ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className={ACTION} aria-label={sendBackLabel(t.key)} disabled={disabled} onClick={() => onSendBack(t)}>
              Send back
            </button>
          </>
        ) : null}
        {row.kind === 'task' && t ? (
          <>
            {t.blockers.length > 0 ? (
              <span className="inline-flex items-center justify-center gap-1 text-xs text-ink-2">
                Blocked by <TaskKeyButton value={t.blockers[0]!.key} onClick={() => onOpenTask(t.blockers[0]!.id)} />
              </span>
            ) : t.can.complete ? (
              <button type="button" className={ACTION} aria-label={`Complete ${t.key}`} disabled={disabled} onClick={() => onComplete(t)}>
                <TickIcon /> Complete
              </button>
            ) : null}
            {t.can.reschedule ? <RescheduleMenu label={t.key} today={today} weekStart={weekStart} value={t.dueDate} disabled={disabled} onPick={(day) => onReschedule(t, day)} /> : null}
            {t.can.assign ? <AssignMenu task={t} disabled={disabled} onPick={(p) => onAssign(t, p)} /> : null}
          </>
        ) : null}
        {a ? (
          <>
            {a.can.done ? (
              <button type="button" className={ACTION} aria-label={`Mark ${label} done`} disabled={disabled} onClick={onItemDone}>
                <TickIcon /> Mark done
              </button>
            ) : null}
            {a.can.reschedule ? <RescheduleMenu label={label} today={today} weekStart={weekStart} value={a.dueDate} disabled={disabled} onPick={onItemReschedule} /> : null}
            {a.meeting ? (
              <Link to={`/meetings/${a.meeting.id}`} className={ACTION} aria-label={`Open the meeting ${a.meeting.title}`}>
                Open meeting
              </Link>
            ) : null}
          </>
        ) : null}
        {t ? (
          <button type="button" className={ACTION} aria-label={`Open ${t.key}`} onClick={() => onOpenTask(t.id)}>
            Open
          </button>
        ) : null}
        {c ? (
          <>
            {c.can.tick ? (
              <button type="button" className={ACTION} aria-label={`Tick ${label}`} disabled={disabled} onClick={onStepTick}>
                <TickIcon /> Tick
              </button>
            ) : null}
            {c.can.reschedule ? <RescheduleMenu label={label} today={today} weekStart={weekStart} value={c.dueDate} disabled={disabled} onPick={onStepReschedule} /> : null}
            <button type="button" className={ACTION} aria-label={`Open ${c.task.key}`} onClick={() => onOpenTask(c.task.id, { item: c.id })}>
              Open task
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Reschedule: Today · Tomorrow · Next week · Pick a date (the month calendar, in the same menu). */
function RescheduleMenu({ label, today, weekStart, value, disabled, onPick }: { label: string; today: string; weekStart: 0 | 1 | 6; value: string | null; disabled: boolean; onPick: (day: string) => void }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setPicking(false);
  };
  const pick = (day: string) => {
    close();
    anchor.current?.focus();
    if (day !== value) onPick(day);
  };
  return (
    <>
      <button ref={anchor} type="button" className={ACTION} aria-label={`Reschedule ${label}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
        <CalendarIcon /> Reschedule
      </button>
      {open ? (
        // A new popover for the month calendar, so it is placed for its own size (a phone's edge too).
        <AnchoredPopover key={picking ? 'month' : 'days'} anchor={anchor} label={`Reschedule ${label}`} onClose={close} className={`${POPOVER} ${picking ? 'w-[min(19rem,calc(100vw-1rem))] p-3' : 'w-64 p-1.5'}`}>
          <p data-popover-heading tabIndex={-1} className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
            {picking ? 'Pick a date' : 'Reschedule to'}
          </p>
          {picking ? (
            <DayCalendar value={value ?? ''} today={today} weekStart={weekStart} onPick={(day) => (day ? pick(day) : close())} />
          ) : (
            <>
              {rescheduleChoices(today, weekStart).map((c) => (
                <button key={c.label} type="button" data-popover-action className={MENU_ITEM} onClick={() => pick(c.day)}>
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs text-ink-2">{c.hint}</span>
                </button>
              ))}
              <button type="button" data-popover-action className={MENU_ITEM} onClick={() => setPicking(true)}>
                <span className="font-medium">Pick a date…</span>
                <CalendarIcon />
              </button>
            </>
          )}
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
function AssignMenu({ task, disabled, onPick }: { task: PriorityTask; disabled: boolean; onPick: (person: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const membersQ = useQuery({ queryKey: ['members', task.project.id], queryFn: () => membersApi(apiClient).list(task.project.id), enabled: open, staleTime: 30_000 });
  const on = new Set(task.assignees.map((p) => p.id));
  const people = (Array.isArray(membersQ.data) ? membersQ.data : [])
    .filter((m) => m.hasAccess !== false && !on.has(m.id))
    .map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() || m.username }))
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((x, y) => x.name.localeCompare(y.name, 'en'));
  const close = () => {
    setOpen(false);
    setFilter('');
  };
  return (
    <>
      <button ref={anchor} type="button" className={ACTION} aria-label={`Assign ${task.key}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
        <PersonIcon /> Assign
      </button>
      {open ? (
        <AnchoredPopover anchor={anchor} label={`Assign ${task.key}`} onClose={close} className={`${POPOVER} w-72 p-1.5`}>
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
                <button
                  key={p.id}
                  type="button"
                  data-popover-action
                  className={MENU_ITEM}
                  onClick={() => {
                    close();
                    anchor.current?.focus();
                    onPick(p);
                  }}
                >
                  <bdi>{p.name}</bdi>
                </button>
              ))
            )}
          </div>
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function PersonIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
    </svg>
  );
}
