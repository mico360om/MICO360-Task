import { dueDayKey } from '../../lib/due-date';
import { addWorkingDays, shiftDay, workingDaysBetween, workingDaysLate, zonedDay, type WorkCalendar } from '../../lib/working-days';
import { isTaskDone } from '../tasks/task-status';
import { taskNoticeBody } from '../notifications/task-notice';
import { overdueStepAt, scheduleOffsets, type NotificationPolicy, type ReminderKind, type ScheduleSteps } from './policy';

/**
 * The one reminder planner (Notification & Scheduling centre). Given the open tasks, their companies'
 * rules (working days and holidays, schedules, escalation, approvals and inactivity numbers) and the
 * time, it lists every reminder due *now*, each with a stable key (kind, task, person, step): the
 * sweep sends a key once (reminder_logs), so running it again — or on two servers — never repeats one.
 * Only the latest step reached is planned, so a missed run sends one notice, not every step it missed.
 * Days are counted in working days of the task's company (its project's main company). Pure.
 */

export interface PlannerCompanyRules {
  policy: NotificationPolicy;
  calendar: WorkCalendar;
  /** This company's reminder schedules by id. */
  schedules: ReadonlyMap<string, ScheduleSteps>;
  /** The schedule a project without its own uses ("Standard" unless an admin chose another). */
  defaultScheduleId: string | null;
}

/** An open task as the planner sees it; every list of people is already only those who may open it. */
export interface PlannerTask {
  id: string;
  key: string;
  title: string;
  /** Its project's main company (null: the site's rules). */
  companyId: string | null;
  dueDate: Date | null;
  startDate: Date | null;
  columnCategory: string | null;
  completedAt: Date | null;
  approvalRequestedAt: Date | null;
  /** The task's own reminder schedule, and its project's (null: the next one down). */
  scheduleId: string | null;
  projectScheduleId: string | null;
  /** The project's own escalation numbers (null: the company's). */
  escalation: { step1Days: number; step2Days: number } | null;
  /** Due-soon / overdue reminders: its assignees and watchers. */
  remindIds: string[];
  /** Inactivity: its assignees. */
  assigneeIds: string[];
  /** Whoever runs its project (escalation step 1, Blocked, inactivity step 2). */
  runnerIds: string[];
  /** Who approves it (approvals waiting, step 1). */
  approverIds: string[];
  /** The company's admins or the people it chose (escalation and approvals step 2). */
  step2Ids: string[];
  /** When it entered its current column (Blocked since). */
  enteredColumnAt: Date | null;
  /** Its latest real activity: a comment, a status change, a checklist tick, a file, a due-date change. */
  lastActivityAt: Date | null;
  /** Waiting for another task that isn't done. */
  hasOpenBlocker: boolean;
  /** Its project is on hold or completed: only its assignees' due dates (no escalations, inactivity, approvals waiting). */
  projectPaused?: boolean;
}

/** A dated checklist item of an open task (not waiting for approval), with who it reminds. */
export interface PlannerItem {
  id: string;
  text: string;
  dueDate: Date;
  taskId: string;
  taskKey: string;
  companyId: string | null;
  scheduleId: string | null;
  projectScheduleId: string | null;
  recipientIds: string[];
}

export interface PlannerInput {
  now: Date;
  /** The site's time zone: "today" and the day an instant falls on. */
  timeZone: string;
  tasks: readonly PlannerTask[];
  items?: readonly PlannerItem[];
  rules(companyId: string | null): PlannerCompanyRules;
  /** A person's own "remind me before due" lead, in whole calendar days (undefined: none). */
  leadDaysFor?(userId: string): number | undefined;
}

export interface PlannedNotice {
  dedupeKey: string;
  userId: string;
  kind: ReminderKind;
  type: string;
  title: string;
  body: string;
  entityType: 'task';
  entityId: string;
}

const STARTED = new Set(['IN_PROGRESS', 'REVIEW']);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const unique = (ids: readonly string[]) => [...new Set(ids)];

function scheduleOf(r: PlannerCompanyRules, own: string | null, project: string | null): ScheduleSteps | null {
  for (const id of [own, project, r.defaultScheduleId]) {
    const steps = id ? r.schedules.get(id) : undefined;
    if (steps) return steps;
  }
  return null;
}

interface Step {
  key: string;
  fireDay: string;
  /** Sort order among steps firing the same day: later steps win. */
  order: number;
  kind: 'dueSoon' | 'overdue';
  offset: number;
}

/** The latest reminder step reached by `today` for one person (null: none yet, or none on). */
function currentStep(steps: ScheduleSteps, dueKey: string, today: string, cal: WorkCalendar, on: Record<ReminderKind, boolean>, leadDays: number | undefined): Step | null {
  const reached: Step[] = [];
  // Due-soon steps only until the due day is over (a late task is overdue, never "due today").
  if (on.dueSoon && today <= dueKey) {
    for (const off of scheduleOffsets(steps).filter((o) => o <= 0)) {
      const fireDay = off < 0 ? addWorkingDays(dueKey, off, cal) : dueKey;
      if (fireDay <= today) reached.push({ key: String(off), fireDay, order: off, kind: 'dueSoon', offset: off });
    }
    if (leadDays !== undefined) {
      const fireDay = shiftDay(dueKey, -leadDays);
      if (fireDay <= today) reached.push({ key: `L${leadDays}`, fireDay, order: -0.5, kind: 'dueSoon', offset: -leadDays });
    }
  }
  if (on.overdue && today > dueKey) {
    const late = workingDaysLate(dueKey, today, cal);
    const s = overdueStepAt(steps, late);
    if (s !== null) reached.push({ key: String(s), fireDay: addWorkingDays(dueKey, s, cal), order: s, kind: 'overdue', offset: s });
  }
  reached.sort((a, b) => (a.fireDay < b.fireDay ? -1 : a.fireDay > b.fireDay ? 1 : a.order - b.order));
  return reached.at(-1) ?? null;
}

function dueTitle(step: Step, what: 'task' | 'checklist item', late: number): string {
  if (step.kind === 'overdue') return `A ${what} is ${plural(late, 'working day')} overdue`;
  return step.offset === 0 ? `A ${what} is due today` : `A ${what} is due soon`;
}

export function planReminders(input: PlannerInput): PlannedNotice[] {
  const today = zonedDay(input.now, input.timeZone);
  const dayOf = (d: Date) => zonedDay(d, input.timeZone);
  const out: PlannedNotice[] = [];
  const add = (n: Omit<PlannedNotice, 'entityType'>) => out.push({ ...n, entityType: 'task' });

  for (const t of input.tasks) {
    if (isTaskDone(t)) continue;
    const r = input.rules(t.companyId);
    const { policy, calendar: cal } = r;
    const on = policy.remindersOn;
    const body = taskNoticeBody({ key: t.key, title: t.title }) ?? t.title;
    const base = { body, entityId: t.id };
    const weekly = Math.max(1, cal.workingDays.length);
    const step2 = unique(t.step2Ids);

    // Waiting for approval: no deadline reminders (owner, 30 Oct) — the approval steps instead.
    if (t.approvalRequestedAt) {
      if (t.projectPaused) continue;
      const since = dayOf(t.approvalRequestedAt);
      const waited = workingDaysBetween(since, today, cal);
      const { step1Days, step2Days } = policy.approvals;
      if (on.approvalWaiting && waited >= step1Days)
        for (const userId of unique(t.approverIds))
          add({ ...base, dedupeKey: `apw1:${t.id}:${since}`, userId, kind: 'approvalWaiting', type: 'TASK_APPROVAL_WAITING', title: `${t.key} has waited ${plural(waited, 'working day')} for your approval` });
      if (on.escalationAdmin && waited >= step1Days + step2Days)
        for (const userId of step2)
          add({ ...base, dedupeKey: `apw2:${t.id}:${since}`, userId, kind: 'escalationAdmin', type: 'TASK_ESCALATION_ADMIN', title: `Escalation: ${t.key} has waited ${plural(waited, 'working day')} for approval` });
      continue;
    }

    const dueKey = dueDayKey(t.dueDate, input.timeZone);
    if (dueKey) {
      const steps = scheduleOf(r, t.scheduleId, t.projectScheduleId);
      const late = workingDaysLate(dueKey, today, cal);
      if (steps)
        for (const userId of unique(t.remindIds)) {
          const step = currentStep(steps, dueKey, today, cal, on, input.leadDaysFor?.(userId));
          if (step)
            add({ ...base, dedupeKey: `rem:${t.id}:${dueKey}:${step.key}:${userId}`, userId, kind: step.kind, type: step.kind === 'overdue' ? 'TASK_OVERDUE' : 'TASK_DUE_SOON', title: dueTitle(step, 'task', late) });
        }
      const { step1Days, step2Days } = t.escalation ?? policy.escalation;
      // An on-hold or completed project: its assignees' due dates only.
      if (t.projectPaused) continue;
      // Step 1, then weekly — unless Blocked, whose own weekly notice stands for it.
      if (on.escalation && t.columnCategory !== 'BLOCKED' && late >= step1Days) {
        const round = Math.floor((late - step1Days) / weekly);
        for (const userId of unique(t.runnerIds))
          add({ ...base, dedupeKey: `esc1:${t.id}:${dueKey}:${round}`, userId, kind: 'escalation', type: 'TASK_ESCALATION', title: `Escalation: ${t.key} is ${plural(late, 'working day')} overdue` });
      }
      if (on.escalationAdmin && late >= step1Days + step2Days)
        for (const userId of step2)
          add({ ...base, dedupeKey: `esc2:${t.id}:${dueKey}`, userId, kind: 'escalationAdmin', type: 'TASK_ESCALATION_ADMIN', title: `Escalation: ${t.key} is still overdue after ${plural(late, 'working day')}` });
    }

    if (t.projectPaused) continue;
    // Blocked: one notice when it becomes Blocked, then weekly.
    if (on.escalation && t.columnCategory === 'BLOCKED') {
      const since = dayOf(t.enteredColumnAt ?? input.now);
      const round = Math.floor(Math.max(0, workingDaysBetween(since, today, cal)) / weekly);
      for (const userId of unique(t.runnerIds))
        add({ ...base, dedupeKey: `blk:${t.id}:${since}:${round}`, userId, kind: 'escalation', type: 'TASK_ESCALATION', title: `Escalation: ${t.key} is Blocked` });
    }

    // Inactivity: started (In progress / Review), not waiting for its start day, nothing in its way.
    const startKey = t.startDate ? dueDayKey(t.startDate, input.timeZone) : null;
    if (on.inactivity && STARTED.has(t.columnCategory ?? '') && !t.hasOpenBlocker && !(startKey && startKey > today) && t.lastActivityAt) {
      const since = dayOf(t.lastActivityAt);
      const idle = workingDaysBetween(since, today, cal);
      const { assigneeDays, managerDays } = policy.inactivity;
      const title = `No activity on ${t.key} for ${plural(idle, 'working day')}`;
      if (idle >= managerDays) {
        for (const userId of unique([...t.assigneeIds, ...t.runnerIds])) add({ ...base, dedupeKey: `idle2:${t.id}:${since}`, userId, kind: 'inactivity', type: 'TASK_INACTIVE', title });
      } else if (idle >= assigneeDays) {
        for (const userId of unique(t.assigneeIds)) add({ ...base, dedupeKey: `idle1:${t.id}:${since}`, userId, kind: 'inactivity', type: 'TASK_INACTIVE', title });
      }
    }
  }

  for (const item of input.items ?? []) {
    const r = input.rules(item.companyId);
    const dueKey = dueDayKey(item.dueDate, input.timeZone);
    const steps = scheduleOf(r, item.scheduleId, item.projectScheduleId);
    if (!dueKey || !steps) continue;
    const late = workingDaysLate(dueKey, today, r.calendar);
    const body = taskNoticeBody({ key: item.taskKey, title: item.text }) ?? item.text;
    for (const userId of unique(item.recipientIds)) {
      const step = currentStep(steps, dueKey, today, r.calendar, r.policy.remindersOn, input.leadDaysFor?.(userId));
      if (step)
        add({ body, entityId: item.taskId, dedupeKey: `rem:item:${item.id}:${dueKey}:${step.key}:${userId}`, userId, kind: step.kind, type: step.kind === 'overdue' ? 'TASK_OVERDUE' : 'TASK_DUE_SOON', title: dueTitle(step, 'checklist item', late) });
    }
  }
  return out;
}

// ── Never a burst: one person's many reminders of one kind become one notice ──

/** More than this many of one kind for one person in one run are sent as one notice. */
export const BUNDLE_AFTER = 3;
const MAX_BUNDLE_LINES = 10;

const BUNDLE_TITLES: Record<ReminderKind, (n: number) => string> = {
  dueSoon: (n) => `${n} tasks are due soon`,
  overdue: (n) => `${n} tasks are overdue`,
  escalation: (n) => `${n} tasks in your projects need attention`,
  escalationAdmin: (n) => `${n} tasks were escalated to you`,
  approvalWaiting: (n) => `${n} tasks are waiting for your approval`,
  inactivity: (n) => `${n} tasks have had no activity`,
};
/** Where a bundled notice opens (the website; older apps open nothing). */
const BUNDLE_TARGETS: Record<ReminderKind, string> = {
  dueSoon: 'my-tasks',
  overdue: 'my-tasks',
  inactivity: 'my-tasks',
  approvalWaiting: 'approvals',
  escalation: 'management',
  escalationAdmin: 'management',
};

export interface OutgoingNotice {
  userId: string;
  kind: ReminderKind;
  notice: { userId: string; type: string; title: string; body: string; entityType: string | null; entityId: string | null };
  /** Every reminder this notice stands for (each recorded as sent). */
  dedupeKeys: string[];
}

/** One notice per planned reminder — or, past BUNDLE_AFTER of one kind for one person, one notice listing them. */
export function bundleNotices(planned: readonly PlannedNotice[]): OutgoingNotice[] {
  const groups = new Map<string, PlannedNotice[]>();
  for (const n of planned) {
    const k = `${n.userId}|${n.kind}`;
    const list = groups.get(k);
    if (list) list.push(n);
    else groups.set(k, [n]);
  }
  const out: OutgoingNotice[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    if (list.length <= BUNDLE_AFTER) {
      for (const n of list) out.push({ userId: n.userId, kind: n.kind, notice: { userId: n.userId, type: n.type, title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId }, dedupeKeys: [n.dedupeKey] });
      continue;
    }
    const lines = unique(list.map((n) => n.body));
    const body = lines.slice(0, MAX_BUNDLE_LINES).join('\n') + (lines.length > MAX_BUNDLE_LINES ? `\n…and ${lines.length - MAX_BUNDLE_LINES} more` : '');
    // The type of the most pressing reminder in it (overdue over due soon), so the person's settings for it apply.
    const type = list.some((n) => n.type === 'TASK_OVERDUE') ? 'TASK_OVERDUE' : first.type;
    out.push({
      userId: first.userId,
      kind: first.kind,
      notice: { userId: first.userId, type, title: BUNDLE_TITLES[first.kind](unique(list.map((n) => n.entityId + n.body)).length), body, entityType: BUNDLE_TARGETS[first.kind], entityId: null },
      dedupeKeys: list.map((n) => n.dedupeKey),
    });
  }
  return out;
}
