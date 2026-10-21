/**
 * The Projects list and Home's all-projects totals on the phone (5b), as the website shows them
 * (frontend pages/ProjectsPage.tsx, components/ProjectsList.tsx, pages/DashboardPage.tsx): each
 * card's progress, overdue count, dates and owner; an administrator's status change (Archived goes
 * through the archive action); and, for administrators, all tasks and the overdue ones across every
 * project, with each project's completion coloured by how healthy it is. Pure TypeScript.
 */
import { ApiError, isNetworkError } from './api-client';
import { formatDueDay } from './due-date';
import { projectStatusLabel } from './project-identity';
import { summarize, type ProjectPerformanceRow } from './reports';
import type { Tone } from './tone';
import type { ApiProject, ApiProjectProgress } from './types';

export interface ProjectCardMeta {
  total: number;
  overdue: number;
  completedPct: number;
  /** The bar shows once the project has tasks. */
  hasProgress: boolean;
  ownerName: string | null;
}

/** A card's figures from the project's progress (null until it has come). */
export function projectCardMeta(progress: ApiProjectProgress | undefined, ownerName: string | null): ProjectCardMeta | null {
  if (!progress) return null;
  return { total: progress.total, overdue: progress.overdue, completedPct: progress.completionPct, hasProgress: progress.total > 0, ownerName };
}

/** "Oct 1 → Dec 15" (either may be "—"), or null when the project has neither date. */
export function projectDates(start: string | null | undefined, target: string | null | undefined, locale?: string): string | null {
  const a = formatDueDay(start ?? null, locale);
  const b = formatDueDay(target ?? null, locale);
  if (!a && !b) return null;
  return `${a ?? '—'} → ${b ?? '—'}`;
}

/** What TalkBack says for a card: everything it shows. */
export function projectCardLabel(p: ApiProject, meta: ProjectCardMeta | null, dates: string | null): string {
  return [
    p.name,
    p.code,
    p.number ? `project number ${p.number}` : null,
    projectStatusLabel(p.status),
    p.clientName || 'Internal',
    meta?.hasProgress ? `${meta.completedPct}% done` : null,
    meta ? `${meta.total} tasks` : null,
    meta ? `${meta.overdue} overdue` : null,
    dates,
    meta?.ownerName ? `owner ${meta.ownerName}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function projectsSubtitle(admin: boolean): string {
  return admin ? 'Create, browse and manage your projects.' : 'Browse and open the projects you have access to.';
}

export function emptyProjects(admin: boolean): { title: string; subtitle: string } {
  return { title: 'No projects yet', subtitle: admin ? 'Create your first project with “New project”.' : 'Projects you can access will appear here.' };
}

/** Archived goes through the archive action (recorded as such); any other status is an edit. */
export function statusChangeRequest(status: string): 'archive' | 'update' {
  return status === 'ARCHIVED' ? 'archive' : 'update';
}

export function statusChangeProblem(error: unknown): string {
  if (isNetworkError(error)) return 'You’re offline — the status can be changed when you’re connected.';
  if (error instanceof ApiError && error.status < 500 && error.message && !/^Request failed/.test(error.message)) return error.message;
  return 'Couldn’t change the status. Please try again.';
}

/** Why the owner didn't change (an administrator's change on the project's Overview). */
export function ownerChangeProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return 'Only an administrator can change the project owner.';
  if (isNetworkError(error)) return 'You’re offline — the owner can be changed when you’re connected.';
  return 'Couldn’t change the owner. Please try again.';
}

// ── Home for administrators ──────────────────────────────────────────────────
export interface TotalTile {
  key: 'all' | 'overdue';
  label: string;
  value: number;
  hint?: string;
  tone: Tone;
}

/** "All tasks" (and how many are completed) and "Overdue" (and their share), over every project. */
export function adminTotals(rows: ProjectPerformanceRow[]): TotalTile[] {
  const s = summarize(rows);
  return [
    { key: 'all', label: 'All tasks', value: s.total, hint: `${s.completed} completed`, tone: 'success' },
    { key: 'overdue', label: 'Overdue', value: s.overdue, ...(s.total ? { hint: `${s.overduePct}% of tasks` } : {}), tone: 'danger' },
  ];
}

/** Each project's completion, coloured as the website's traffic light: green from 67%, amber from 34%, else red. */
export function completionBars(rows: ProjectPerformanceRow[]): { id: string; label: string; pct: number; tone: Tone }[] {
  return rows.map((r) => ({ id: r.projectId, label: r.projectName, pct: r.completionPct, tone: r.completionPct >= 67 ? 'success' : r.completionPct >= 34 ? 'warning' : 'danger' }));
}
