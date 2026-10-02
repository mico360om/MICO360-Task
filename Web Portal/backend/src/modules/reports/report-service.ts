import { buildTimeSeries, type TimeSeriesResult } from './report-timeseries';
import { completedOnTime, dueDayKey, isOverdue } from '../../lib/due-date';
import { defaultCompanyTimeZone, isTaskDone } from '../tasks/task-status';

export interface ReportTask {
  id: string;
  projectId: string;
  projectName: string;
  columnCategory: string;
  createdAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
  assigneeIds: string[];
  /** Readable details for the task list (exports). */
  key?: string;
  title?: string;
  priority?: string;
  /** The task's column (its status as the team names it). */
  columnName?: string;
}

export interface ReportUser {
  id: string;
  username: string;
  /** Full name, when known. */
  name?: string;
}

/** One row of the task list: what a manager reads in an export. */
export interface TaskListRow {
  key: string;
  title: string;
  projectName: string;
  /** The column's name, e.g. "In review". */
  status: string;
  category: string;
  priority: string;
  assignees: string[];
  /** Due day, 'YYYY-MM-DD'. */
  dueDate: string | null;
  completedAt: Date | null;
  done: boolean;
  overdue: boolean;
}

/** The on-screen report filters; every report and export applies the same ones. */
export interface ReportFilter {
  projectId?: string;
  /** A team member: only tasks assigned to them (and, for workload, only their row). */
  userId?: string;
}

export function applyReportFilter(tasks: ReportTask[], filter: ReportFilter = {}): ReportTask[] {
  return tasks.filter(
    (t) => (!filter.projectId || t.projectId === filter.projectId) && (!filter.userId || t.assigneeIds.includes(filter.userId)),
  );
}

// "Done" is the shared rule (DONE column or a completion time), so the dashboard, the task lists
// and every report agree. "Overdue" means the due day is before today in the company time zone.
const isDone = (t: ReportTask): boolean => isTaskDone(t);
const isOverdueOpen = (t: ReportTask, timeZone: string, now: Date): boolean => !isDone(t) && isOverdue(t.dueDate, timeZone, now);

/** Number of tasks in each column category. */
export function statusBreakdown(tasks: ReportTask[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tasks) out[t.columnCategory] = (out[t.columnCategory] ?? 0) + 1;
  return out;
}

export interface ProjectPerformance {
  projectId: string;
  projectName: string;
  total: number;
  completed: number;
  overdue: number;
  completionPct: number;
}

export function projectPerformance(tasks: ReportTask[], timeZone: string = defaultCompanyTimeZone(), now: Date = new Date()): ProjectPerformance[] {
  const byProject = new Map<string, ReportTask[]>();
  for (const t of tasks) {
    const arr = byProject.get(t.projectId) ?? [];
    arr.push(t);
    byProject.set(t.projectId, arr);
  }
  return [...byProject.entries()].map(([projectId, ts]) => {
    const total = ts.length;
    const completed = ts.filter(isDone).length;
    const overdue = ts.filter((t) => isOverdueOpen(t, timeZone, now)).length;
    return {
      projectId,
      projectName: ts[0]!.projectName,
      total,
      completed,
      overdue,
      completionPct: total ? Math.round((completed / total) * 100) : 0,
    };
  });
}

export interface UserWorkload {
  userId: string;
  username: string;
  /** Full name, else the username. */
  name: string;
  assigned: number;
  completed: number;
  overdue: number;
}

export function userWorkload(tasks: ReportTask[], users: ReportUser[], timeZone: string = defaultCompanyTimeZone(), now: Date = new Date()): UserWorkload[] {
  return users.map((u) => {
    const theirs = tasks.filter((t) => t.assigneeIds.includes(u.id));
    return {
      userId: u.id,
      username: u.username,
      name: u.name?.trim() || u.username,
      assigned: theirs.length,
      completed: theirs.filter(isDone).length,
      overdue: theirs.filter((t) => isOverdueOpen(t, timeZone, now)).length,
    };
  });
}

export interface CompletionStats {
  total: number;
  completed: number;
  /** Completed on or before the due day. */
  onTime: number;
  /** Completed after the due day. */
  late: number;
  /** Completed but timeliness can't be judged (no due date and/or no completion timestamp). */
  unclassified: number;
  /** % of timeliness-classifiable completions that were on time. */
  onTimeRate: number;
}

/** On-time vs late completion: finished on or before the due day (company time) is on time. */
export function completionStats(tasks: ReportTask[], timeZone: string = defaultCompanyTimeZone()): CompletionStats {
  const completedTasks = tasks.filter(isDone);
  let onTime = 0;
  let late = 0;
  for (const t of completedTasks) {
    const verdict = completedOnTime(t.dueDate, t.completedAt, timeZone);
    if (verdict === true) onTime += 1;
    else if (verdict === false) late += 1;
  }
  const classifiable = onTime + late;
  return {
    total: tasks.length,
    completed: completedTasks.length,
    onTime,
    late,
    unclassified: completedTasks.length - classifiable,
    onTimeRate: classifiable ? Math.round((onTime / classifiable) * 100) : 0,
  };
}

export interface ReportDataSource {
  getTasks(): Promise<ReportTask[]>;
  getUsers(): Promise<ReportUser[]>;
}

export interface ReportServiceDeps {
  data: ReportDataSource;
  /** Company time zone: defines "today", on-time days and the time-series day buckets. */
  timeZone?: string;
  now?: () => Date;
}

export function createReportService({ data, timeZone = defaultCompanyTimeZone(), now = () => new Date() }: ReportServiceDeps) {
  const tasksFor = async (filter?: ReportFilter) => applyReportFilter(await data.getTasks(), filter);

  async function taskStatusReport(filter?: ReportFilter): Promise<Record<string, number>> {
    return statusBreakdown(await tasksFor(filter));
  }
  async function projectPerformanceReport(filter?: ReportFilter): Promise<ProjectPerformance[]> {
    return projectPerformance(await tasksFor(filter), timeZone, now());
  }
  async function workloadReport(filter?: ReportFilter): Promise<UserWorkload[]> {
    const [tasks, users] = await Promise.all([tasksFor(filter), data.getUsers()]);
    return userWorkload(tasks, filter?.userId ? users.filter((u) => u.id === filter.userId) : users, timeZone, now());
  }
  async function completionReport(filter?: ReportFilter): Promise<CompletionStats> {
    return completionStats(await tasksFor(filter), timeZone);
  }
  /** The filtered tasks with readable details: open tasks first, soonest due first. */
  async function taskListReport(filter?: ReportFilter): Promise<TaskListRow[]> {
    const [tasks, users] = await Promise.all([tasksFor(filter), data.getUsers()]);
    const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.username]));
    const at = now();
    const rows = tasks.map((t): TaskListRow => {
      const done = isDone(t);
      return {
        key: t.key ?? '',
        title: t.title ?? '',
        projectName: t.projectName,
        status: t.columnName ?? t.columnCategory,
        category: t.columnCategory,
        priority: t.priority ?? 'NORMAL',
        assignees: t.assigneeIds.map((id) => nameOf.get(id)).filter((n): n is string => Boolean(n)),
        dueDate: dueDayKey(t.dueDate, timeZone),
        completedAt: done ? t.completedAt : null,
        done,
        overdue: isOverdueOpen(t, timeZone, at),
      };
    });
    return rows.sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.key.localeCompare(b.key, undefined, { numeric: true }),
    );
  }

  /** Daily time series (completion, overdue trend, burndown + velocity) over a date range. */
  async function timeSeriesReport(opts: { from: string; to: string } & ReportFilter): Promise<TimeSeriesResult> {
    return buildTimeSeries(await tasksFor(opts), opts.from, opts.to, timeZone);
  }
  return { taskStatusReport, projectPerformanceReport, workloadReport, completionReport, timeSeriesReport, taskListReport, timeZone };
}

export type ReportService = ReturnType<typeof createReportService>;
