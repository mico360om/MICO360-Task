import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { schedulingApi, type TaskReminder } from '../../api/scheduling';
import type { CalBlock } from '../../api/calendar';
import { ApiError } from '../../lib/api-client';
import { SearchableSelect } from '../ui/SearchableSelect';
import { Header, Shell } from './dialogs';
import { dayLabel } from './calendar-ui';
import { BellIcon, blockTimes } from './schedule-chips';
import { instantAt, minutesAt, timeLabel } from '../../lib/calendar-hours';
import { describeReminder, localInputToIso, reminderChoices } from '../../lib/reminder-presets';
import { TaskKey } from '../TaskKey';

/** Plain words for a refused change (the server's own, else a general one). */
export function reasonOf(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^Request failed/.test(err.message)) return err.message.replace(/\.$/, '');
  if (err instanceof TypeError) return 'the server couldn’t be reached';
  return 'the server had a problem';
}

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h` }));
const field = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:min-h-11';
const label = 'flex flex-col gap-1 text-sm font-medium text-ink';
const primary = 'rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 [@media(pointer:coarse)]:min-h-11';
const secondary = 'rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-ground [@media(pointer:coarse)]:min-h-11';

export interface TaskOption {
  id: string;
  key: string;
  title: string;
}

/**
 * Plan time for a task (a work block — owner 2): a day, a start and a length, for yourself or (whoever
 * made the task or runs its project) for one of its people. Never changes the task's dates.
 */
export function PlanTimeDialog({
  task,
  options,
  day,
  minutes,
  timeZone,
  people,
  onClose,
  onSave,
}: {
  task: TaskOption | null;
  options: TaskOption[];
  day: string;
  minutes: number;
  timeZone: string;
  /** Names of people (the task's), for the "For" choice. */
  people: Map<string, string>;
  onClose: () => void;
  onSave: (taskId: string, body: { userId?: string; startAt: string; endAt: string }) => Promise<string | null>;
}) {
  const [taskId, setTaskId] = useState(task?.id ?? '');
  const [date, setDate] = useState(day);
  const [start, setStart] = useState(timeLabel(minutes));
  const [length, setLength] = useState('60');
  const [forId, setForId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const who = useQuery({ queryKey: ['task-blocks', taskId], queryFn: () => schedulingApi(apiClient).blocks(taskId), enabled: !!taskId });
  const forPeople = who.data?.forPeople ?? [];
  useEffect(() => {
    if (forPeople.length && !forPeople.includes(forId)) setForId(forPeople[0]!);
  }, [forPeople.join(','), forId]);
  const chosen = options.find((o) => o.id === taskId) ?? task;
  const startMinutes = /^\d{2}:\d{2}$/.test(start) ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) : NaN;
  const ok = !!taskId && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(startMinutes) && forPeople.length > 0 && !busy;
  return (
    <Shell label="Plan time" onClose={onClose}>
      <Header title="Plan time" sub={chosen ? <span className="inline-flex items-center gap-1"><TaskKey value={chosen.key} dense /> <bdi>{chosen.title}</bdi></span> : 'Time to work on a task — its dates stay as they are'} onClose={onClose} />
      <form
        className="flex flex-col gap-3 px-5 py-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          setProblem(null);
          const startAt = instantAt(date, startMinutes, timeZone);
          const endAt = new Date(Date.parse(startAt) + Number(length) * 60_000).toISOString();
          const err = await onSave(taskId, { ...(forId && forPeople.length > 1 ? { userId: forId } : forPeople[0] ? { userId: forPeople[0] } : {}), startAt, endAt });
          setBusy(false);
          if (err) setProblem(err);
        }}
      >
        {task ? null : (
          <div className={label}>
            <span id="plan-task-label">Task</span>
            <SearchableSelect ariaLabel="Task" value={taskId} onChange={setTaskId} options={options.map((o) => ({ value: o.id, label: `${o.key} ${o.title}` }))} placeholder="Choose a task…" />
          </div>
        )}
        {taskId && who.isSuccess && forPeople.length === 0 ? <p role="alert" className="text-sm text-danger">Only the people on this task plan time for it.</p> : null}
        {forPeople.length > 1 ? (
          <label className={label}>
            For
            <select value={forId} onChange={(e) => setForId(e.target.value)} className={field}>
              {forPeople.map((id) => (
                <option key={id} value={id}>{people.get(id) ?? 'Someone'}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className={`${label} col-span-2 sm:col-span-1`}>
            Day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
          </label>
          <label className={label}>
            Start
            <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required className={field} />
          </label>
          <label className={label}>
            Length
            <select value={length} onChange={(e) => setLength(e.target.value)} className={field}>
              {LENGTHS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
        </div>
        {problem ? <p role="alert" className="text-sm text-danger">{problem}</p> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={secondary}>Cancel</button>
          <button type="submit" disabled={!ok} className={primary}>{busy ? 'Saving…' : 'Plan time'}</button>
        </div>
      </form>
    </Shell>
  );
}

/** A work block's own dialog: its task and person, a new day / start / length, or remove it. */
export function BlockDialog({ block, timeZone, onClose, onMove, onRemove, onOpenTask }: { block: CalBlock; timeZone: string; onClose: () => void; onMove: (startAt: string, endAt: string) => void; onRemove: () => void; onOpenTask: () => void }) {
  const at = minutesAt(block.startAt, timeZone);
  const [date, setDate] = useState(at.day);
  const [start, setStart] = useState(timeLabel(at.minutes));
  const [length, setLength] = useState(String(Math.round((Date.parse(block.endAt) - Date.parse(block.startAt)) / 60_000)));
  const lengths = LENGTHS.some((l) => l.value === length) ? LENGTHS : [...LENGTHS, { value: length, label: `${length} min` }];
  const startMinutes = /^\d{2}:\d{2}$/.test(start) ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) : NaN;
  return (
    <Shell label={`Planned: ${block.taskKey}`} onClose={onClose}>
      <Header
        title={<span className="inline-flex flex-wrap items-center gap-1.5">Planned time <TaskKey value={block.taskKey} dense /></span>}
        sub={
          <>
            <bdi>{block.taskTitle}</bdi> · {dayLabel(at.day)} {blockTimes(block, timeZone)}
            {block.mine ? '' : ` · ${block.userName}`}
            {block.plannedById !== block.userId ? ` · planned by ${block.plannedByName}` : ''}
          </>
        }
        onClose={onClose}
      />
      <form
        className="flex flex-col gap-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!Number.isFinite(startMinutes)) return;
          const startAt = instantAt(date, startMinutes, timeZone);
          onMove(startAt, new Date(Date.parse(startAt) + Number(length) * 60_000).toISOString());
        }}
      >
        {block.canChange ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className={`${label} col-span-2 sm:col-span-1`}>
              Day
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
            </label>
            <label className={label}>
              Start
              <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required className={field} />
            </label>
            <label className={label}>
              Length
              <select value={length} onChange={(e) => setLength(e.target.value)} className={field}>
                {lengths.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Only its person, whoever planned it or whoever runs the project changes this planned time.</p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onOpenTask} className={secondary}>Open task</button>
          {block.canChange ? (
            <>
              <button type="button" onClick={onRemove} className={`${secondary} text-danger`}>Remove</button>
              <button type="submit" className={primary}>Save</button>
            </>
          ) : null}
        </div>
      </form>
    </Shell>
  );
}

/**
 * Moving a meeting (its organizer — owner): the new time, and — once invitations went out — "Send the
 * updated invitation to 6 people?" (the meeting's own update path sends it, with its calendar file).
 */
export function MeetingMoveDialog({
  title,
  startAt,
  endAt,
  invitesSent,
  people,
  timeZone,
  onClose,
  onConfirm,
}: {
  title: string;
  startAt: string;
  endAt: string;
  invitesSent: boolean;
  people: number;
  timeZone: string;
  onClose: () => void;
  onConfirm: (startAt: string, endAt: string) => void;
}) {
  const at = minutesAt(startAt, timeZone);
  const [date, setDate] = useState(at.day);
  const [start, setStart] = useState(timeLabel(at.minutes));
  const length = Date.parse(endAt) - Date.parse(startAt);
  const startMinutes = /^\d{2}:\d{2}$/.test(start) ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) : NaN;
  const newStart = Number.isFinite(startMinutes) ? instantAt(date, startMinutes, timeZone) : startAt;
  const newEnd = new Date(Date.parse(newStart) + length).toISOString();
  const past = Date.parse(newStart) <= Date.now();
  const who = `${people} ${people === 1 ? 'person' : 'people'}`;
  return (
    <Shell label="Move the meeting" onClose={onClose}>
      <Header title="Move the meeting" sub={<bdi>{title}</bdi>} onClose={onClose} />
      <form
        className="flex flex-col gap-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!past) onConfirm(newStart, newEnd);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
          </label>
          <label className={label}>
            Start
            <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required className={field} />
          </label>
        </div>
        <p className="text-sm text-ink">
          {dayLabel(minutesAt(newStart, timeZone).day)} {timeLabel(minutesAt(newStart, timeZone).minutes)}–{timeLabel(minutesAt(newEnd, timeZone).minutes)}.{' '}
          {invitesSent ? <strong>Send the updated invitation to {who}?</strong> : 'Invitations haven’t gone out yet, so nobody is emailed.'}
        </p>
        {past ? <p role="alert" className="text-sm text-danger">Choose a time still to come.</p> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={secondary}>Cancel</button>
          <button type="submit" disabled={past} className={primary}>{invitesSent ? 'Move and send' : 'Move'}</button>
        </div>
      </form>
    </Shell>
  );
}

/** An empty hour clicked: "New meeting at 10:00" or "Plan time for a task…". */
export function SlotMenu({ at, day, minutes, onMeeting, onPlan, onClose }: { at: { x: number; y: number }; day: string; minutes: number; onMeeting: () => void; onPlan: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('keydown', key);
    const t = setTimeout(() => document.addEventListener('mousedown', click), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', click);
    };
  }, [onClose]);
  const left = Math.min(at.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240);
  const top = Math.min(at.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 130);
  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-ground focus:bg-ground focus:outline-none [@media(pointer:coarse)]:min-h-11';
  return (
    <div ref={ref} role="menu" aria-label={`${dayLabel(day)} ${timeLabel(minutes)}`} className="fixed z-50 w-56 rounded-xl border border-line bg-surface p-1 shadow-lift animate-scale-in" style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
      <button type="button" role="menuitem" className={item} onClick={onMeeting}>
        New meeting at {timeLabel(minutes)}
      </button>
      <button type="button" role="menuitem" className={item} onClick={onPlan}>
        Plan time for a task…
      </button>
    </div>
  );
}

/**
 * My reminders on one task (and the ones I set for its people) with "Remind me" — a time before its due
 * day or start, or a date and time — for myself or, as its creator or whoever runs its project, for one
 * of its people. A reminder someone else set for me: mute it or snooze it (only the setter removes it).
 * Shared by the calendar's "Remind me" and the task panel.
 */
export function ReminderEditor({ task, timeZone, people, onChanged, compact = false }: { task: { id: string; key: string; title: string; startDate: string | null; dueDate: string | null }; timeZone: string; people: Map<string, string>; onChanged?: (text: string) => void; compact?: boolean }) {
  const qc = useQueryClient();
  const api = schedulingApi(apiClient);
  const q = useQuery({ queryKey: ['task-reminders', task.id], queryFn: () => api.reminders(task.id) });
  const choices = reminderChoices(task, timeZone);
  const [choice, setChoice] = useState(choices[0]?.key ?? 'at');
  const [atValue, setAtValue] = useState('');
  const [forId, setForId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forPeople = q.data?.forPeople ?? [];
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['task-reminders', task.id] });
    await qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await refresh();
      onChanged?.(done);
    } catch (err) {
      setProblem(`Couldn’t save — ${reasonOf(err)}.`);
    } finally {
      setBusy(false);
    }
  };
  const timed = (anchor: 'start' | 'due' | null) => {
    const v = anchor === 'start' ? task.startDate : task.dueDate;
    return !!v && !/^\d{4}-\d{2}-\d{2}$/.test(v) && !v.endsWith('T00:00:00.000Z');
  };
  const list: TaskReminder[] = q.data?.reminders ?? [];
  return (
    <div className="flex flex-col gap-3">
      {q.isLoading ? <div className="skeleton h-10" /> : null}
      {list.length ? (
        <ul aria-label="Reminders" className="flex flex-col gap-1.5">
          {list.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm ${r.muted ? 'opacity-75' : ''}`}>
              <span className="text-warning"><BellIcon size={13} muted={r.muted} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-ink">{describeReminder(r, timeZone, timed(r.anchor))}</span>
                <span className="block text-[11px] text-ink-2">
                  {[
                    r.userId !== r.setById && r.canChange ? `For ${r.userName}` : null,
                    r.canMute ? `Set by ${r.setByName}` : null,
                    r.muted ? (r.canChange ? `Muted by ${r.userName}` : 'Muted') : null,
                    r.snoozedUntil ? `Snoozed until ${describeReminder({ at: r.snoozedUntil, anchor: null, offsetMinutes: null, fireAt: null }, timeZone, false)}` : null,
                    r.state === 'sent' ? 'Sent' : r.state === 'missed' ? 'Missed' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Yours'}
                </span>
              </span>
              {r.canMute ? (
                <button type="button" disabled={busy} onClick={() => run(() => api.mute(task.id, r.id, !r.muted), r.muted ? 'Reminder back on.' : 'Reminder muted for you.')} className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:text-ink [@media(pointer:coarse)]:min-h-11">
                  {r.muted ? 'Unmute' : 'Mute'}
                </button>
              ) : null}
              {r.userId && (r.canMute || (r.canChange && r.setById === r.userId)) && !r.muted ? (
                <button type="button" disabled={busy} onClick={() => run(() => api.snooze(task.id, r.id, r.snoozedUntil ? { until: null } : { minutes: 60 }), r.snoozedUntil ? 'Snooze cleared.' : 'Snoozed for an hour.')} className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:text-ink [@media(pointer:coarse)]:min-h-11">
                  {r.snoozedUntil ? 'Unsnooze' : 'Snooze 1 h'}
                </button>
              ) : null}
              {r.canChange ? (
                <button type="button" disabled={busy} onClick={() => run(() => api.removeReminder(task.id, r.id), 'Reminder removed.')} aria-label={`Remove the reminder ${describeReminder(r, timeZone, timed(r.anchor))}`} className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-danger hover:border-danger/50 [@media(pointer:coarse)]:min-h-11">
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : q.isSuccess && !compact ? (
        <p className="text-sm text-ink-2">No reminders yet.</p>
      ) : null}
      <form
        className="flex flex-col gap-2 rounded-xl border border-line bg-ground/50 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const preset = choices.find((c) => c.key === choice);
          const at = choice === 'at' ? localInputToIso(atValue, timeZone) : null;
          if (!preset && !at) {
            setProblem('Choose when.');
            return;
          }
          const body = preset ? preset.timing : { at: at! };
          const userId = forId && forPeople.length > 1 ? forId : undefined;
          void run(() => api.addReminder(task.id, { ...body, ...(userId ? { userId } : {}) }), userId ? `Reminder set for ${people.get(userId) ?? 'them'}.` : 'Reminder set.');
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-ink">Remind me</legend>
          {choices.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-ink hover:bg-surface [@media(pointer:coarse)]:min-h-11">
              <input type="radio" name={`remind-${task.id}`} value={c.key} checked={choice === c.key} onChange={() => setChoice(c.key)} className="accent-[rgb(var(--c-brand))]" />
              {c.label}
            </label>
          ))}
          <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 text-sm text-ink hover:bg-surface [@media(pointer:coarse)]:min-h-11">
            <input type="radio" name={`remind-${task.id}`} value="at" checked={choice === 'at'} onChange={() => setChoice('at')} className="accent-[rgb(var(--c-brand))]" />
            At a date and time
            {choice === 'at' ? (
              <input type="datetime-local" aria-label="Date and time" step={300} value={atValue} onChange={(e) => setAtValue(e.target.value)} className={`${field} w-auto py-1`} />
            ) : null}
          </label>
        </fieldset>
        {forPeople.length > 1 ? (
          <label className={label}>
            For
            <select value={forId || forPeople[0]} onChange={(e) => setForId(e.target.value)} className={field}>
              {forPeople.map((id, i) => (
                <option key={id} value={id}>{i === 0 ? 'Me' : (people.get(id) ?? 'Someone')}</option>
              ))}
            </select>
          </label>
        ) : null}
        {problem ? <p role="alert" className="text-sm text-danger">{problem}</p> : null}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primary}>{busy ? 'Saving…' : 'Add reminder'}</button>
        </div>
      </form>
    </div>
  );
}

/** "Remind me" from the calendar: the task's reminders, in a dialog. */
export function RemindDialog({ task, timeZone, people, onClose, onChanged }: { task: { id: string; key: string; title: string; startDate: string | null; dueDate: string | null }; timeZone: string; people: Map<string, string>; onClose: () => void; onChanged: (text: string) => void }) {
  return (
    <Shell label={`Reminders: ${task.key}`} onClose={onClose}>
      <Header title="Reminders" sub={<span className="inline-flex items-center gap-1"><TaskKey value={task.key} dense /> <bdi>{task.title}</bdi></span>} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ReminderEditor task={task} timeZone={timeZone} people={people} onChanged={onChanged} />
      </div>
    </Shell>
  );
}
