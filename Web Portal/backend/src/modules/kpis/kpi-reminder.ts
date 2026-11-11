/**
 * Project KPIs: the monthly reminder to enter a project's own KPI values (design: "a monthly reminder to
 * enter values (Notification & Scheduling)"). On the first working morning of a month (the project's
 * company's working days, holidays and hours) — or the first run after it — whoever runs a project with
 * own KPIs still missing last month's value gets one notice. It goes through the notification service, so
 * the Notification & Scheduling delivery rules apply (bell, phone push held in quiet hours); it is sent
 * once per person, project and month (its key in reminder_logs, prefixed `np:` so it is kept a year).
 */
import { todayKey } from '../../lib/due-date';
import { nextWorkingDay, zonedInstant, type WorkCalendar, type WorkHours } from '../../lib/working-days';
import { prevMonth } from './kpi-defs';

export const KPI_VALUES_TYPE = 'KPI_VALUES_DUE';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface DueProject {
  projectId: string;
  name: string;
  companyId: string | null;
  /** Its own KPIs with no value for the month. */
  missing: string[];
  /** Whoever runs it (active staff). */
  runnerIds: string[];
}

export interface KpiReminderDeps {
  /** Live projects with own KPIs missing a value for `month`. */
  projectsDue(month: string): Promise<DueProject[]>;
  rules(companyId: string | null): Promise<{ calendar: WorkCalendar; hours: WorkHours }>;
  keys: { existing(keys: string[]): Promise<Set<string>>; addMany(keys: string[]): Promise<void> };
  notify(n: { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null }): Promise<unknown>;
  timeZone: string;
  now?: () => Date;
}

const listWords = (names: string[]) => (names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`);

export function createKpiValuesReminder(deps: KpiReminderDeps) {
  return {
    /** Sends what is due; the number of notices sent. */
    async run(): Promise<number> {
      const at = deps.now?.() ?? new Date();
      const today = todayKey(deps.timeZone, at);
      const month = prevMonth(today.slice(0, 7));
      let sent = 0;
      for (const p of await deps.projectsDue(month)) {
        if (p.missing.length === 0 || p.runnerIds.length === 0) continue;
        const r = await deps.rules(p.companyId);
        const first = nextWorkingDay(`${today.slice(0, 7)}-01`, r.calendar);
        if (today < first || at.getTime() < zonedInstant(first, r.hours.start, deps.timeZone).getTime()) continue;
        const keys = p.runnerIds.map((u) => `np:kpi-values:${p.projectId}:${month}:${u}`);
        const done = await deps.keys.existing(keys);
        const due = p.runnerIds.filter((_, i) => !done.has(keys[i]!));
        if (due.length === 0) continue;
        // Recorded first: a notice that fails is not tried again and again.
        await deps.keys.addMany(due.map((u) => `np:kpi-values:${p.projectId}:${month}:${u}`));
        for (const userId of due) {
          await deps.notify({ userId, type: KPI_VALUES_TYPE, title: `Time to enter ${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}’s KPI values`, body: `${p.name}: ${listWords(p.missing)}`, entityType: 'project-kpis', entityId: p.projectId });
          sent += 1;
        }
      }
      return sent;
    },
  };
}
