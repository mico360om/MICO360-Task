import { useState, type ReactNode } from 'react';
import type { CalMeeting } from '../../lib/calendar-meetings';
import type { CalendarChecklistItem } from '../../lib/calendar-checklist';
import type { CalBlock, CalReminder } from '../../api/calendar';
import type { Meeting } from '../../api/meetings';
import type { CalItem } from '../../lib/calendar-model';
import type { SpanItem } from '../../lib/calendar-span';
import { startDrag, endDrag } from '../../lib/calendar-dnd';
import { timeLabel } from '../../lib/calendar-hours';
import { zonedClock } from '../../lib/working-days';
import { ChecklistChip, MeetingChip, STATUS_META, dayLabel, itemName } from './calendar-ui';
import { BellIcon, BlockChip, DueIcon, StartIcon, blockTimes } from './schedule-chips';
import { TaskKey } from '../TaskKey';
import { calendarOrder } from '../../lib/calendar-order';
import { OVERDUE_CLASS } from '../../lib/colour-classes';

/** The meeting fields the panel reads beyond the calendar's item (the list sends your own row and answer). */
export type PanelMeeting = Meeting & { myAttendeeId?: string | null; myResponse?: string | null };

export interface DayPanelProps {
  day: string;
  today: string;
  timeZone: string;
  /** Every shown task item (the panel picks the day's). */
  items: SpanItem[];
  /** On today's panel: the open tasks already late from before today. */
  overdueBefore: CalItem[];
  meetings: CalMeeting[];
  meetingOf: (id: string) => PanelMeeting | undefined;
  blocks: CalBlock[];
  reminders: CalReminder[];
  steps: CalendarChecklistItem[];
  dayOff: { kind: 'holiday'; name: string } | { kind: 'weekend' } | null;
  colorOf: (projectId: string) => string | undefined;
  canCreate: boolean;
  canDragTask: (item: SpanItem | CalItem) => boolean;
  /** Tasks that can take a quick action (not done, not a repeat not created yet, not archived). */
  canAct: (item: SpanItem | CalItem) => boolean;
  onNewTask: (day: string) => void;
  onPlanTime: (day: string, item?: SpanItem | CalItem) => void;
  onRemind: (item: SpanItem | CalItem) => void;
  onOpenItem: (item: SpanItem | CalItem) => void;
  onOpenTask: (taskId: string) => void;
  onComplete: (item: SpanItem | CalItem) => void;
  onOpenBlock: (b: CalBlock) => void;
  onOpenStep: (s: CalendarChecklistItem) => void;
  onOpenReminder: (r: CalReminder) => void;
  onRsvp: (meeting: PanelMeeting, response: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | 'PENDING') => void;
  /** Filters are on: an empty day says so. */
  filtered: boolean;
  /** Shown in a dialog (Full view): no outer card. */
  bare?: boolean;
}

/** Late tasks from before today listed before "Show all". */
const LATE_PREVIEW = 8;

const RESPONSE_WORDS: Record<string, string> = { ACCEPTED: 'Going', TENTATIVE: 'Maybe', DECLINED: 'Not going', PENDING: 'No answer yet' };

function Section({ id, title, icon, count, children, startOpen = true }: { id: string; title: string; icon?: ReactNode; count: number; children: ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (count === 0) return null;
  return (
    <section aria-labelledby={`${id}-h`} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
      <h4 id={`${id}-h`} className="m-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-start text-xs font-bold uppercase tracking-wide text-ink-2 hover:bg-ground [@media(pointer:coarse)]:!min-h-11"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className={`flex-none transition-transform ${open ? 'rotate-90' : ''} rtl:-scale-x-100`}>
            <path d="M9 6l6 6-6 6" />
          </svg>
          {icon}
          <span className="flex-1">{title}</span>
          <span className="rounded-full bg-ground px-1.5 text-[11px] tabular-nums text-ink-2">{count}</span>
        </button>
      </h4>
      {open ? (
        <ul id={`${id}-list`} className="mt-1 flex flex-col gap-1.5">
          {children}
        </ul>
      ) : null}
    </section>
  );
}

const iconButton =
  'grid h-7 w-7 flex-none place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/**
 * The chosen day's list (calendar scheduling — the split view's right side, under the calendar on a
 * tablet or phone): its meetings (time, place or online link, your answer), tasks starting ▶, tasks due
 * ⚑ (late first), the tasks under way, planned time, my reminders 🔔, repeats not created yet and
 * checklist items — each section folds; each task has Open, Complete, Plan time and Remind me.
 */
export function DayPanel(p: DayPanelProps) {
  const day = p.day;
  const rank = calendarOrder(p.items);
  const byRank = <T extends SpanItem | CalItem>(list: T[]) => [...list].sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
  const starting = byRank(p.items.filter((i) => i.kind === 'task' && i.start === day && i.mode !== 'due'));
  const due = byRank(p.items.filter((i) => i.kind === 'task' && i.due === day));
  const ongoing = byRank(p.items.filter((i) => i.kind === 'task' && i.mode === 'bar' && i.start! < day && i.due! > day));
  const repeats = p.items.filter((i) => i.kind === 'projected' && i.date === day);
  const dueToday = new Set(p.items.filter((x) => x.due === day).map((x) => x.key));
  const allLate = day === p.today ? p.overdueBefore.filter((i) => !dueToday.has(i.key)) : [];
  // Today's list shows the first few late tasks, the rest on request (as the Agenda).
  const [allLateShown, setAllLateShown] = useState(false);
  const lateBefore = allLateShown ? allLate : allLate.slice(0, LATE_PREVIEW);
  const total = p.meetings.length + starting.length + due.length + lateBefore.length + ongoing.length + p.blocks.length + p.reminders.length + repeats.length + p.steps.length;
  const heading = dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' });

  const taskRow = (item: SpanItem | CalItem, mark: 'start' | 'due' | 'none', key = item.key) => {
    const t = item.task;
    const late = item.status === 'overdue';
    const s = STATUS_META[item.status];
    const draggable = p.canDragTask(item);
    const act = p.canAct(item);
    return (
      <li
        key={key}
        draggable={draggable || undefined}
        // A due row moves by the days from its due day (a late one is listed on today); others from this day.
        onDragStart={(e) => startDrag(e, { kind: 'task', id: t.id, grip: 'body', grabDay: mark === 'due' ? item.date : day })}
        onDragEnd={endDrag}
        style={{ borderInlineStartColor: p.colorOf(t.projectId) }}
        className={`flex items-start gap-2 rounded-lg border border-s-[3px] px-2 py-1.5 text-sm ${late ? 'border-overdue/50 bg-overdue-soft/50' : 'border-line bg-surface'} ${draggable ? 'cursor-grab' : ''}`}
      >
        <span className={`mt-0.5 flex-none ${late ? 'text-overdue' : '[&_svg]:text-ink-2'}`}>{mark === 'start' ? <StartIcon size={12} /> : mark === 'due' ? <DueIcon size={13} /> : s.icon}</span>
        <button type="button" data-day-item={item.key} onClick={() => p.onOpenItem(item)} aria-label={itemName(item)} className="min-w-0 flex-1 text-start [@media(pointer:coarse)]:!min-h-11">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {item.kind === 'task' ? <TaskKey value={t.key} dense /> : null}
            <span dir="auto" className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{t.title}</span>
          </span>
          <span className={`block text-[11px] ${late ? OVERDUE_CLASS.text : 'text-ink-2'}`}>
            {[late ? 'Overdue' : s.label, t.assignees?.map((a) => a.name).join(', ') || null].filter(Boolean).join(' · ')}
          </span>
        </button>
        {act ? (
          <span role="group" aria-label={`Actions for ${t.key}`} className="flex flex-none items-center gap-1">
            <button type="button" className={iconButton} onClick={() => p.onComplete(item)} aria-label={`Complete ${t.key}`} title="Complete">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </button>
            <button type="button" className={iconButton} onClick={() => p.onPlanTime(day, item)} aria-label={`Plan time for ${t.key}`} title="Plan time">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
            </button>
            <button type="button" className={iconButton} onClick={() => p.onRemind(item)} aria-label={`Remind me about ${t.key}`} title="Remind me">
              <BellIcon size={14} />
            </button>
            <button type="button" className={iconButton} onClick={() => p.onOpenTask(t.id)} aria-label={`Open ${t.key}`} title="Open">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:-scale-x-100"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" /></svg>
            </button>
          </span>
        ) : null}
      </li>
    );
  };

  const body = (
    <>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="day-panel-heading" className="text-sm font-bold text-ink">{heading}</h3>
          {p.dayOff ? <p className="text-xs text-ink-2">{p.dayOff.kind === 'holiday' ? `${p.dayOff.name} — a day off` : 'A day off (weekend)'}</p> : null}
        </div>
        {p.canCreate ? (
          <div className="flex flex-none flex-wrap gap-1.5">
            <button type="button" onClick={() => p.onNewTask(day)} aria-label={`Add a task on ${dayLabel(day)}`} className="h-8 rounded-lg border border-line px-2.5 text-xs font-semibold text-brand hover:border-brand [@media(pointer:coarse)]:h-11">
              + Task
            </button>
            <button type="button" onClick={() => p.onPlanTime(day)} aria-label={`Plan time on ${dayLabel(day)}`} className="h-8 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11">
              Plan time
            </button>
          </div>
        ) : null}
      </div>
      {total === 0 ? (
        <p className="py-3 text-sm text-ink-2">Nothing on this day{p.filtered ? ' with these filters' : ''}.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Section id={`dp-${day}-m`} title="Meetings" count={p.meetings.length}>
            {p.meetings.map((m) => {
              const full = p.meetingOf(m.id);
              const mine = full?.myAttendeeId && full.myResponse !== undefined && !m.cancelled;
              return (
                <li key={m.key} className="flex flex-col gap-1">
                  <MeetingChip meeting={m} color={m.projectId ? p.colorOf(m.projectId) : undefined} meta={[m.time, m.location].filter(Boolean).join(' · ')} lines={2} />
                  {full?.onlineLink ? (
                    <a href={full.onlineLink} target="_blank" rel="noreferrer" className="ms-2 inline-flex w-fit items-center gap-1 text-xs font-semibold text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
                      {full.onlineMeetingProvider === 'TEAMS' ? 'Join on Teams' : 'Join online'}
                      <span className="sr-only"> — {m.title}</span>
                    </a>
                  ) : null}
                  {mine && full ? (
                    <div role="group" aria-label={`Your answer for ${m.title}`} className="ms-2 flex flex-wrap items-center gap-1 text-xs">
                      <span className="text-ink-2">You: {RESPONSE_WORDS[full.myResponse ?? 'PENDING'] ?? 'No answer yet'}</span>
                      {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={full.myResponse === r}
                          onClick={() => p.onRsvp(full, full.myResponse === r ? 'PENDING' : r)}
                          className={`min-h-7 rounded-md border px-2 font-medium [@media(pointer:coarse)]:min-h-11 ${full.myResponse === r ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line text-ink-2 hover:text-ink'}`}
                        >
                          {r === 'ACCEPTED' ? 'Accept' : r === 'TENTATIVE' ? 'Maybe' : 'Decline'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </Section>
          <Section id={`dp-${day}-s`} title="Starting" icon={<StartIcon size={11} />} count={starting.length}>
            {starting.map((i) => taskRow(i, 'start', `s:${i.key}`))}
          </Section>
          <Section id={`dp-${day}-d`} title={day === p.today && allLate.length ? 'Due today and overdue' : 'Due'} icon={<DueIcon size={12} />} count={due.length + allLate.length}>
            {[...due.filter((i) => i.status === 'overdue'), ...lateBefore, ...due.filter((i) => i.status !== 'overdue')].map((i) => taskRow(i, 'due', `d:${i.key}`))}
            {allLate.length > LATE_PREVIEW ? (
              <li>
                <button type="button" onClick={() => setAllLateShown((v) => !v)} aria-expanded={allLateShown} className="text-xs font-semibold text-overdue underline-offset-2 hover:underline [@media(pointer:coarse)]:!min-h-11">
                  {allLateShown ? 'Show fewer' : `Show all ${allLate.length} overdue tasks`}
                </button>
              </li>
            ) : null}
          </Section>
          <Section id={`dp-${day}-o`} title="Under way" count={ongoing.length} startOpen={false}>
            {ongoing.map((i) => taskRow(i, 'none', `o:${i.key}`))}
          </Section>
          <Section id={`dp-${day}-b`} title="Planned time" count={p.blocks.length}>
            {p.blocks.map((b) => (
              <li key={b.id}>
                <BlockChip block={b} timeZone={p.timeZone} onOpen={p.onOpenBlock} draggable={false} tall />
              </li>
            ))}
          </Section>
          <Section id={`dp-${day}-r`} title="My reminders" icon={<BellIcon size={11} />} count={p.reminders.length}>
            {p.reminders.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => p.onOpenReminder(r)} className={`flex w-full items-start gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-start text-sm hover:border-brand/60 [@media(pointer:coarse)]:!min-h-11 ${r.state === 'muted' || r.state === 'missed' ? 'opacity-70' : ''}`}>
                  <span className="mt-0.5 text-warning"><BellIcon size={13} muted={r.state === 'muted'} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="tabular-nums font-semibold">{timeLabel(zonedClock(new Date(r.fireAt), p.timeZone).minutes)}</span>
                      <TaskKey value={r.taskKey} dense />
                      <span dir="auto" className="min-w-0 [overflow-wrap:anywhere]">{r.taskTitle}</span>
                    </span>
                    <span className="block text-[11px] text-ink-2">
                      {[r.setByName ? `Set by ${r.setByName}` : null, r.state === 'muted' ? 'Muted' : r.state === 'sent' ? 'Sent' : r.state === 'missed' ? 'Missed' : null].filter(Boolean).join(' · ') || 'Yours'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </Section>
          <Section id={`dp-${day}-p`} title="Repeats (not created yet)" count={repeats.length}>
            {repeats.map((i) => taskRow(i, 'none', `p:${i.key}`))}
          </Section>
          <Section id={`dp-${day}-c`} title="Checklist items" count={p.steps.length}>
            {p.steps.map((s) => (
              <li key={`cl:${s.id}`}>
                <ChecklistChip item={s} late={!s.done && s.dueDate.slice(0, 10) < p.today} onOpen={p.onOpenStep} />
              </li>
            ))}
          </Section>
        </div>
      )}
    </>
  );
  if (p.bare) return <div aria-labelledby="day-panel-heading">{body}</div>;
  return (
    <section aria-label={dayLabel(day)} data-day-panel={day} className="rounded-xl border border-line bg-surface p-3">
      {body}
    </section>
  );
}

/** "09:00–10:00" for a block line (re-exported for the page's toasts). */
export { blockTimes };
