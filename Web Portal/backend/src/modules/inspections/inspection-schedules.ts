import { NotFoundError } from '../../lib/http-errors';
import { todayKey, dueDayKey } from '../../lib/due-date';
import { isValidRule, nextDueDate, withAnchorDay, type RecurrenceRule } from '../tasks/recurrence';
import { recurrenceSummary } from '../tasks/recurrence-summary';
import { defaultCompanyTimeZone } from '../tasks/task-status';
import { checkState, compareOpenChecks, daysLate, isCheckDone } from './inspection-checks';

/**
 * Scheduled inspections, as a project's Inspections tab shows them: its schedules (repeating checks)
 * and its due checks (open checks, late first), and how much a form is used (for the delete confirm).
 * A check is a task that carries a form; a schedule is the newest copy of a repeating series with a
 * form — see inspection-checks for the rules. Read by the project's team and administrators only.
 */

export interface Person {
  id: string;
  name: string;
}

export interface FormRef {
  id: string;
  title: string;
  /** Deleted since: the check can still be done, but no new schedule uses it. */
  deleted: boolean;
}

/** A check (a live task that carries a form) as the source reads it. */
export interface CheckRow {
  id: string;
  key: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
  startDate: Date | null;
  completedAt: Date | null;
  columnCategory: string | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  inspectionPlace: string | null;
  form: FormRef;
  assignees: Person[];
}

export interface InspectionScheduleSource {
  /**
   * The project's checks: only open ones (`openOnly`), only the schedules' newest copies
   * (`schedulesOnly`), or only the members of these series (`seriesIds`: the first task's id).
   */
  checks(projectId: string, opts: { openOnly?: boolean; schedulesOnly?: boolean; seriesIds?: string[] }): Promise<CheckRow[]>;
  /** How many copies each series has made (deleted ones too): a series with a set number ends. */
  seriesSizes(seriesIds: string[]): Promise<Map<string, number>>;
  /** Inspections in progress for these tasks. */
  inProgress(taskIds: string[]): Promise<Array<{ taskId: string; inspectionId: string; inspectorId: string }>>;
  /** How many schedules use the form and how many of its checks are open; null when it isn't there. */
  formUsage(formId: string): Promise<{ schedules: number; openChecks: number } | null>;
  /** The company's working days (0 = Sunday): "Every working day" repeats on these. */
  workingDays(): Promise<number[]>;
}

export interface ScheduleView {
  /** The newest copy, which carries the repeat: edit and stop it through the task routes. */
  taskId: string;
  key: string;
  title: string;
  form: FormRef;
  place: string | null;
  assignees: Person[];
  rule: RecurrenceRule;
  /** In words: "Every working day", "Repeats every week on Mon". */
  repeat: string;
  /**
   * Its checks are made on their dates, done or not (every schedule since 1.18.0). False: an older
   * series that makes the next one only when this one is done — said so in `repeat`.
   */
  onSchedule: boolean;
  paused: boolean;
  /** The next day a check is due ('YYYY-MM-DD'); null when paused or ended. */
  nextDue: string | null;
  /** When a check of the series was last finished. */
  lastDone: string | null;
  openChecks: number;
  lateChecks: number;
}

export interface CheckView {
  taskId: string;
  key: string;
  title: string;
  dueDate: string | null;
  state: 'DUE' | 'LATE';
  daysLate: number;
  /** Part of a repeating series (a scheduled check), not a one-off task with a form. */
  scheduled: boolean;
  form: FormRef;
  place: string | null;
  assignees: Person[];
  /** An inspection already started for it (Continue). */
  inProgress: { inspectionId: string; inspector: Person } | null;
}

export interface InspectionScheduleDeps {
  source: InspectionScheduleSource;
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  userNames(ids: string[]): Promise<Map<string, string>>;
  timeZone?: string;
  now?: () => Date;
}

const DUE_CHECKS_LIMIT = 200;
const sameDays = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((d, i) => d === [...b].sort()[i]);

/**
 * The repeat in words. On schedule (every schedule since 1.18.0) it leaves out "new copy on each
 * date"; a series that waits for each check to be done says so.
 */
export function scheduleRepeatText(rule: RecurrenceRule, workingDays: number[]): string {
  const plain: RecurrenceRule = { ...rule };
  delete plain.createNext;
  if (rule.createNext !== 'ON_SCHEDULE') return `${recurrenceSummary(plain)} · the next one when this one is done`;
  if (rule.freq === 'WEEKLY' && rule.interval === 1 && rule.weekdays?.length && sameDays(rule.weekdays, workingDays) && rule.count == null && !rule.until && !rule.paused) {
    return 'Every working day';
  }
  return recurrenceSummary(plain);
}

export function createInspectionScheduleService(deps: InspectionScheduleDeps) {
  const { source } = deps;
  const timeZone = deps.timeZone ?? defaultCompanyTimeZone();
  const now = deps.now ?? (() => new Date());

  async function mustView(actor: { id: string; roles: string[] }, projectId: string): Promise<void> {
    if (!(await deps.canViewProject(actor.id, actor.roles, projectId))) throw new NotFoundError('Project not found.');
  }

  /** The next day a check of the series is due, from its newest copy (null: paused, ended or broken). */
  function nextDueOf(head: CheckRow, size: number, today: string): string | null {
    const rule = head.recurrenceRule;
    if (!rule || !isValidRule(rule) || rule.paused) return null;
    const headDay = dueDayKey(head.dueDate, timeZone);
    if (headDay && headDay >= today && !isCheckDone(head)) return headDay;
    // A series that waits for each check: nothing is due next until the open one is done.
    if (rule.createNext !== 'ON_SCHEDULE' && !isCheckDone(head)) return null;
    if (rule.count != null && size >= rule.count) return null;
    const base = rule.resumeFrom ? new Date(`${rule.resumeFrom}T00:00:00.000Z`) : headDay ? new Date(`${headDay}T00:00:00.000Z`) : null;
    if (!base) return null;
    const next = nextDueDate(base, withAnchorDay(rule, base), today);
    return next ? next.toISOString().slice(0, 10) : null;
  }

  return {
    async schedules(actor: { id: string; roles: string[] }, projectId: string): Promise<{ schedules: ScheduleView[]; workingDays: number[] }> {
      await mustView(actor, projectId);
      const [heads, workingDays] = await Promise.all([source.checks(projectId, { schedulesOnly: true }), source.workingDays()]);
      const seriesOf = (t: CheckRow) => t.recurrenceParentId ?? t.id;
      const seriesIds = [...new Set(heads.map(seriesOf))];
      const [members, sizes] = seriesIds.length ? await Promise.all([source.checks(projectId, { seriesIds }), source.seriesSizes(seriesIds)]) : [[], new Map<string, number>()];
      const at = now();
      const today = todayKey(timeZone, at);
      const schedules = heads
        .filter((h) => h.recurrenceRule)
        .map((head): ScheduleView => {
          const series = members.filter((m) => seriesOf(m) === seriesOf(head));
          const open = series.filter((m) => !isCheckDone(m));
          const done = series.filter((m) => isCheckDone(m) && m.completedAt).map((m) => m.completedAt!.getTime());
          const rule = head.recurrenceRule!;
          return {
            taskId: head.id,
            key: head.key,
            title: head.title,
            form: head.form,
            place: head.inspectionPlace,
            assignees: head.assignees,
            rule,
            repeat: scheduleRepeatText(rule, workingDays),
            onSchedule: rule.createNext === 'ON_SCHEDULE',
            paused: !!rule.paused,
            nextDue: nextDueOf(head, sizes.get(seriesOf(head)) ?? series.length, today),
            lastDone: done.length ? new Date(Math.max(...done)).toISOString() : null,
            openChecks: open.length,
            lateChecks: open.filter((m) => checkState(m, timeZone, at) === 'LATE').length,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
      return { schedules, workingDays };
    },

    async dueChecks(actor: { id: string; roles: string[] }, projectId: string, opts: { limit?: number } = {}): Promise<{ checks: CheckView[]; total: number }> {
      await mustView(actor, projectId);
      const at = now();
      const open = (await source.checks(projectId, { openOnly: true })).filter((c) => !isCheckDone(c));
      const byDay = compareOpenChecks(timeZone);
      open.sort((a, b) => byDay(a, b) || a.key.localeCompare(b.key, undefined, { numeric: true }));
      const shown = open.slice(0, opts.limit ?? DUE_CHECKS_LIMIT);
      const started = shown.length ? await source.inProgress(shown.map((c) => c.id)) : [];
      const names = await deps.userNames([...new Set(started.map((s) => s.inspectorId))]);
      return {
        total: open.length,
        checks: shown.map((c): CheckView => {
          const s = started.find((x) => x.taskId === c.id);
          return {
            taskId: c.id,
            key: c.key,
            title: c.title,
            dueDate: dueDayKey(c.dueDate, timeZone),
            state: checkState(c, timeZone, at) === 'LATE' ? 'LATE' : 'DUE',
            daysLate: daysLate(c, timeZone, at),
            scheduled: !!(c.recurrenceRule || c.recurrenceParentId),
            form: c.form,
            place: c.inspectionPlace,
            assignees: c.assignees,
            inProgress: s ? { inspectionId: s.inspectionId, inspector: { id: s.inspectorId, name: names.get(s.inspectorId) ?? 'Someone' } } : null,
          };
        }),
      };
    },

    /** How much a form is used: shown before it is deleted ("2 schedules use this form; they'll stop."). */
    async formUsage(formId: string): Promise<{ schedules: number; openChecks: number }> {
      const usage = await source.formUsage(formId);
      if (!usage) throw new NotFoundError('Form not found.');
      return usage;
    },
  };
}

export type InspectionScheduleService = ReturnType<typeof createInspectionScheduleService>;
