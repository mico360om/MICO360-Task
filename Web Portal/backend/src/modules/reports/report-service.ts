import { buildTimeSeries, type TimeSeriesResult } from './report-timeseries';

export interface ReportTask {
  id: string;
  projectId: string;
  projectName: string;
  columnCategory: string;
  createdAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
  assigneeIds: string[];
}

export interface ReportUser {
  id: string;
  username: string;
}

function isDone(t: ReportTask): boolean {
  // A task is done if it's in a DONE column OR it carries a completedAt (it can retain
  // completedAt after being moved out of DONE via PUT). Matches task-filter / My Tasks so
  // the dashboard and the task lists never disagree.
  return t.columnCategory === 'DONE' || t.completedAt !== null;
}
function isOverdue(t: ReportTask, now = Date.now()): boolean {
  return t.dueDate !== null && t.dueDate.getTime() < now && !isDone(t);
}

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

export function projectPerformance(tasks: ReportTask[]): ProjectPerformance[] {
  const byProject = new Map<string, ReportTask[]>();
  for (const t of tasks) {
    const arr = byProject.get(t.projectId) ?? [];
    arr.push(t);
    byProject.set(t.projectId, arr);
  }
  return [...byProject.entries()].map(([projectId, ts]) => {
    const total = ts.length;
    const completed = ts.filter(isDone).length;
    const overdue = ts.filter((t) => isOverdue(t)).length;
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
  assigned: number;
  completed: number;
  overdue: number;
}

export function userWorkload(tasks: ReportTask[], users: ReportUser[]): UserWorkload[] {
  return users.map((u) => {
    const theirs = tasks.filter((t) => t.assigneeIds.includes(u.id));
    return {
      userId: u.id,
      username: u.username,
      assigned: theirs.length,
      completed: theirs.filter(isDone).length,
      overdue: theirs.filter((t) => isOverdue(t)).length,
    };
  });
}

export interface CompletionStats {
  total: number;
  completed: number;
  /** Completed on or before the due date. */
  onTime: number;
  /** Completed after the due date. */
  late: number;
  /** Completed but timeliness can't be judged (no due date and/or no completion timestamp). */
  unclassified: number;
  /** % of timeliness-classifiable completions that were on time. */
  onTimeRate: number;
}

/** On-time vs late completion, from each completed task's completedAt vs dueDate. */
export function completionStats(tasks: ReportTask[]): CompletionStats {
  const completedTasks = tasks.filter(isDone);
  let onTime = 0;
  let late = 0;
  for (const t of completedTasks) {
    if (t.completedAt && t.dueDate) {
      if (t.completedAt.getTime() <= t.dueDate.getTime()) onTime += 1;
      else late += 1;
    }
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

export function createReportService({ data }: { data: ReportDataSource }) {
  async function taskStatusReport(): Promise<Record<string, number>> {
    return statusBreakdown(await data.getTasks());
  }
  async function projectPerformanceReport(): Promise<ProjectPerformance[]> {
    return projectPerformance(await data.getTasks());
  }
  async function workloadReport(): Promise<UserWorkload[]> {
    const [tasks, users] = await Promise.all([data.getTasks(), data.getUsers()]);
    return userWorkload(tasks, users);
  }
  async function completionReport(): Promise<CompletionStats> {
    return completionStats(await data.getTasks());
  }
  /** Daily time series (completion, overdue trend, burndown + velocity) over a date range. */
  async function timeSeriesReport(opts: { from: string; to: string; projectId?: string }): Promise<TimeSeriesResult> {
    let tasks = await data.getTasks();
    if (opts.projectId) tasks = tasks.filter((t) => t.projectId === opts.projectId);
    return buildTimeSeries(tasks, opts.from, opts.to);
  }
  return { taskStatusReport, projectPerformanceReport, workloadReport, completionReport, timeSeriesReport };
}

export type ReportService = ReturnType<typeof createReportService>;
