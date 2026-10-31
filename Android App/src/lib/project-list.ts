/**
 * Projects on the phone (5b): a project's dates, why a status or owner change didn't go through,
 * and the Dashboard's all-projects totals and completion bars (frontend pages/DashboardPage.tsx).
 * The Projects page's own list rules are lib/projects-page.ts (Stage 2). Pure TypeScript.
 */
import { ApiError, isNetworkError } from './api-client';
import { formatDueDay } from './due-date';
import { PROJECT_CHANGE_REFUSED } from './project-team';
import type { ProjectPerformanceRow } from './reports';
import type { Tone } from './tone';

/** "1 Oct 2026 → 15 Dec 2026" (either may be "—"), or null when the project has neither date. */
export function projectDates(start: string | null | undefined, target: string | null | undefined, timeZone?: string): string | null {
  const a = formatDueDay(start ?? null, timeZone);
  const b = formatDueDay(target ?? null, timeZone);
  if (!a && !b) return null;
  return `${a ?? '—'} → ${b ?? '—'}`;
}

export function statusChangeProblem(error: unknown): string {
  if (isNetworkError(error)) return 'You’re offline — the status can be changed when you’re connected.';
  if (error instanceof ApiError && error.status < 500 && error.message && !/^Request failed/.test(error.message)) return error.message;
  return 'Couldn’t change the status. Please try again.';
}

/** Why the owner didn't change (an administrator's change on the project's Overview). */
export function ownerChangeProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return PROJECT_CHANGE_REFUSED;
  if (isNetworkError(error)) return 'You’re offline — the owner can be changed when you’re connected.';
  return 'Couldn’t change the owner. Please try again.';
}

// ── The Dashboard for administrators ─────────────────────────────────────────

/**
 * The Dashboard's administrator tiles: all tasks, the completed ones and the overdue ones over every
 * project — the sums of the server's /reports/projects rows, as the website's Dashboard adds them.
 */
export function reportTotals(rows: readonly ProjectPerformanceRow[]): { total: number; completed: number; overdue: number } {
  return rows.reduce((acc, p) => ({ total: acc.total + p.total, completed: acc.completed + p.completed, overdue: acc.overdue + p.overdue }), { total: 0, completed: 0, overdue: 0 });
}

/** Each project's completion, coloured as the website's traffic light: green from 67%, amber from 34%, else red. */
export function completionBars(rows: ProjectPerformanceRow[]): { id: string; label: string; pct: number; tone: Tone }[] {
  return rows.map((r) => ({ id: r.projectId, label: r.projectName, pct: r.completionPct, tone: r.completionPct >= 67 ? 'success' : r.completionPct >= 34 ? 'warning' : 'danger' }));
}
