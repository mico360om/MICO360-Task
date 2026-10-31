/**
 * The Dashboard as the website's (Web Portal/frontend/src/pages/DashboardPage.tsx, components/
 * FirstSteps.tsx, components/approvals/ApprovalsCard.tsx): the welcome band, the four tiles (the
 * company's totals for administrators, everyone else's own overdue work and what is due this week),
 * the first steps of a new company, Due soon, the approvals card and Recent activity — its words,
 * numbers and order. Pure TypeScript; dates only through day-words.
 */
import { dayText, instantDayText } from './day-words';
import { daysUntilDue, isTaskDone } from './due-date';
import { isWaitingForApproval } from './approvals';
import { relativeTime } from './relative-time';
import { reportTotals } from './project-list';
import type { MyDueCounts } from './dashboard-tiles';
import type { ProjectPerformanceRow } from './reports';
import type { ApiActivityRow } from './activity-page';
import type { IconName } from './icons';
import type { ApiTask, ApprovalsAnswer } from './types';

// ── The tiles ────────────────────────────────────────────────────────────────

/** Where a tile goes: a bottom tab, or Reports (an administrator's company totals). */
export type DashboardLink = { tab: 'MyTasks' | 'Projects' } | { screen: 'Reports' };

export interface DashboardTile {
  key: 'myTasks' | 'projects' | 'allTasks' | 'overdue' | 'dueThisWeek';
  label: string;
  /** The figure, or "—" until it has loaded. */
  value: string;
  /** The line under the figure (none until it has loaded). */
  hint?: string;
  tone: 'brand' | 'info' | 'success' | 'danger' | 'warning';
  icon: IconName;
  to: DashboardLink;
}

const NOT_YET = '—';

/** "Today, the week’s last day" or "Today – Sat 31 Oct": the Due this week tile's hint. */
export function weekHint(c: MyDueCounts): string {
  return c.weekEnd === c.today ? 'Today, the week’s last day' : `Today – ${dayText(c.weekEnd, { weekday: 'short', year: false })}`;
}

/**
 * The four tiles, in the website's order. Everyone: My tasks and Projects. An administrator: the
 * company's All tasks and Overdue (the server's report totals, each opening Reports); everyone else:
 * their own Overdue and Due this week (`mine`, opening My Tasks).
 */
export function dashboardTiles(o: { isAdmin: boolean; myTasks?: readonly unknown[]; projects?: readonly unknown[]; reportRows?: readonly ProjectPerformanceRow[]; mine?: MyDueCounts }): DashboardTile[] {
  const tiles: DashboardTile[] = [
    { key: 'myTasks', label: 'My tasks', value: o.myTasks ? String(o.myTasks.length) : NOT_YET, ...(o.myTasks ? { hint: 'Assigned to you' } : {}), tone: 'brand', icon: 'misc.tasks', to: { tab: 'MyTasks' } },
    { key: 'projects', label: 'Projects', value: o.projects ? String(o.projects.length) : NOT_YET, ...(o.projects ? { hint: 'Active workspaces' } : {}), tone: 'info', icon: 'nav.projects', to: { tab: 'Projects' } },
  ];
  if (o.isAdmin) {
    const totals = o.reportRows ? reportTotals(o.reportRows) : null;
    tiles.push(
      { key: 'allTasks', label: 'All tasks', value: totals ? String(totals.total) : NOT_YET, ...(totals ? { hint: `${totals.completed} completed` } : {}), tone: 'success', icon: 'misc.layers', to: { screen: 'Reports' } },
      {
        key: 'overdue',
        label: 'Overdue',
        value: totals ? String(totals.overdue) : NOT_YET,
        ...(totals ? { hint: totals.total ? `${Math.round((totals.overdue / totals.total) * 100)}% of tasks` : 'No tasks yet' } : {}),
        tone: 'danger',
        icon: 'misc.alertTriangle',
        to: { screen: 'Reports' },
      },
    );
  } else {
    const mine = o.mine;
    tiles.push(
      { key: 'overdue', label: 'Overdue', value: mine ? String(mine.overdue) : NOT_YET, ...(mine ? { hint: mine.overdue ? 'Past their due day' : 'Nothing late' } : {}), tone: 'danger', icon: 'misc.alertTriangle', to: { tab: 'MyTasks' } },
      { key: 'dueThisWeek', label: 'Due this week', value: mine ? String(mine.dueThisWeek) : NOT_YET, ...(mine ? { hint: weekHint(mine) } : {}), tone: 'warning', icon: 'misc.week', to: { tab: 'MyTasks' } },
    );
  }
  return tiles;
}

// ── The welcome band and the first day ───────────────────────────────────────

/** "Friday 30 October" in the company zone, "Welcome back, sara." ("Welcome, …" on the first day, when the two links hide). */
export function welcomeBand(o: { firstDay: boolean; username: string | null | undefined; now: Date; timeZone: string }): { dateLine: string; greeting: string; showLinks: boolean } {
  return {
    dateLine: instantDayText(o.now, o.timeZone, { weekday: 'long', month: 'long', year: false }),
    greeting: `${o.firstDay ? 'Welcome' : 'Welcome back'}, ${o.username ?? 'there'}.`,
    showLinks: !o.firstDay,
  };
}

/**
 * A company's (or a newcomer's) first day: no project and no task yet, as the server says — never
 * while a list is loading or after one failed to load (an outage must not read as "start from scratch").
 */
export function isFirstDay(o: { projects?: readonly unknown[]; myTasks?: readonly unknown[]; dueSoon?: readonly unknown[] }): boolean {
  return !!o.projects && !!o.myTasks && !!o.dueSoon && o.projects.length === 0 && o.myTasks.length === 0 && o.dueSoon.length === 0;
}

/** The first steps' words (website components/FirstSteps.tsx and the Dashboard's empty state). */
export const FIRST_STEPS_TEXT = {
  admin: { title: 'Set up your workspace', body: 'Create your first project, then add the people who will work in it. Their tasks, due dates and progress will show up here.' },
  employee: { title: 'You’re not on a project yet', body: 'Ask your administrator to add you to a project, or create your own to start adding tasks.' },
  createProject: 'Create a project',
  addTeam: 'Add your team',
} as const;

/** The rest of the page's words (the band's subtitle is left out: the website hides it on phones). */
export const DASHBOARD_TEXT = {
  openBoard: 'Open board',
  viewMyTasks: 'View my tasks',
  openTasks: 'Your open tasks',
  viewAll: 'View all',
  noOpen: 'Nothing open assigned to you',
  noOpenBody: 'Open tasks assigned to you will appear here.',
  dueSoon: 'Due soon',
  calendar: 'Calendar',
  allClear: 'Nothing due — you’re all clear.',
  recent: 'Recent activity',
  noActivity: 'No activity yet — new, moved and finished tasks show up here.',
  reviewAll: 'Review all',
} as const;

// ── Due soon ─────────────────────────────────────────────────────────────────

/** How a due day reads from today — calendar days in the company zone: "3d overdue", "Due today", "Due tomorrow", "Due in 4d". */
export function dueMeta(due: string, now: Date, timeZone: string): { label: string; overdue: boolean } {
  const days = daysUntilDue(due, now, timeZone) ?? 0;
  if (days < 0) return { label: `${-days}d overdue`, overdue: true };
  if (days === 0) return { label: 'Due today', overdue: false };
  if (days === 1) return { label: 'Due tomorrow', overdue: false };
  return { label: `Due in ${days}d`, overdue: false };
}

export interface DueSoonRow {
  task: ApiTask;
  meta: { label: string; overdue: boolean };
  /** Past its day but waiting for approval: never "overdue" — the Waiting for approval chip shows instead. */
  waiting: boolean;
}

/** Upcoming and overdue work, earliest first, six at most (finished work never counts). */
export function dueSoonRows(tasks: readonly ApiTask[], now: Date, timeZone: string): DueSoonRow[] {
  return tasks
    .filter((t) => t.dueDate && !isTaskDone(t))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 6)
    .map((task) => {
      const meta = dueMeta(task.dueDate!, now, timeZone);
      return { task, meta, waiting: meta.overdue && isWaitingForApproval(task) };
    });
}

// ── Waiting for your approval ────────────────────────────────────────────────

/** How many waiting tasks the card lists (the rest are on My Tasks). */
const APPROVALS_SHOWN = 5;

/**
 * The "Waiting for your approval (N)" card, for the people who can approve (they run a project, or are
 * an administrator): the longest waiting first, five at most; hidden for everyone else.
 */
export function approvalsCardView(
  data: ApprovalsAnswer | undefined,
  now: number,
  timeZone: string,
): { visible: boolean; title: string; rows: { id: string; key: string; title: string; line: string }[]; more: string | null; empty: string | null; reviewAll: boolean } {
  const tasks = data?.tasks ?? [];
  const n = tasks.length;
  return {
    visible: !!data?.canApprove,
    title: `Waiting for your approval (${n})`,
    rows: tasks.slice(0, APPROVALS_SHOWN).map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      line: [t.project.name, t.requestedBy ? `finished by ${t.requestedBy.name}` : null, t.approvalRequestedAt ? relativeTime(t.approvalRequestedAt, now, timeZone) : null].filter(Boolean).join(' · '),
    })),
    more: n > APPROVALS_SHOWN ? `+${n - APPROVALS_SHOWN} more on My Tasks.` : null,
    empty: n === 0 ? 'Nothing is waiting for your approval.' : null,
    reviewAll: n > 0,
  };
}

// ── Recent activity ──────────────────────────────────────────────────────────

export const DASHBOARD_ACTION_LABEL: Record<string, string> = {
  CREATED: 'created',
  MOVED: 'moved',
  COMPLETED: 'completed',
  REOPENED: 'reopened',
  ASSIGNED: 'assigned',
  // Task approvals.
  APPROVAL_REQUESTED: 'asked for approval on',
  APPROVED: 'approved',
  SENT_BACK: 'sent back',
  APPROVAL_WITHDRAWN: 'withdrew the approval request on',
};

/** The verb for an action ("asked for approval on"); any other is its name in lower case ("project renamed"). */
export function dashboardActionLabel(a: string): string {
  return DASHBOARD_ACTION_LABEL[a] ?? (a || '').toLowerCase().replace(/_/g, ' ');
}

/** The verb's colour, as the website's (text-success, text-warning, text-info, text-brand, else text-ink-2). */
export function dashboardActionTone(a: string): 'success' | 'warning' | 'info' | 'brand' | 'ink2' {
  if (a === 'COMPLETED' || a === 'APPROVED') return 'success';
  if (a === 'SENT_BACK' || a === 'REOPENED') return 'warning';
  if (a === 'MOVED') return 'info';
  if (a === 'CREATED') return 'brand';
  return 'ink2';
}

/** "just now", "5m ago", "3h ago", "2d ago" (the Dashboard's own, which counts days on past a week); '' for a time ahead or unreadable. */
export function timeAgo(iso: string, now: number): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export interface ActivityLine {
  id: string;
  /** Who did it ("Someone" when the server names no one). */
  who: string;
  verb: string;
  /** The task it was done to (its key opens it), else the project's name. */
  taskKey: string | null;
  taskId: string | null;
  projectName: string | null;
  /** "… assigned MICO-3 to Omar Ahmed". */
  assignee: string | null;
  ago: string;
  tone: ReturnType<typeof dashboardActionTone>;
}

/** The newest six things done: "Aisha Khan assigned MICO-3 to Omar Ahmed · 5m ago". */
export function activityRows(rows: readonly ApiActivityRow[], now: number): ActivityLine[] {
  return rows.slice(0, 6).map((a) => ({
    id: a.id,
    who: a.actor?.name ?? 'Someone',
    verb: dashboardActionLabel(a.action),
    taskKey: a.task?.key ?? null,
    taskId: a.task?.id ?? null,
    projectName: a.task ? null : (a.project?.name ?? null),
    assignee: a.action === 'ASSIGNED' && typeof a.meta?.assignee === 'string' ? a.meta.assignee : null,
    ago: timeAgo(a.createdAt, now),
    tone: dashboardActionTone(a.action),
  }));
}
