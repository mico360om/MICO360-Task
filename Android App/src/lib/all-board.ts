/**
 * The All projects board (4c), as the website's (Web Portal/frontend/src/lib/board.ts
 * composeAllProjectsBoard and pages/BoardPage.tsx, "All projects"): every open project's tasks for
 * the day under the six shared statuses — Backlog, To Do, In Progress, Blocked, Review, Done — each
 * card with its project, a status sorted by due date then priority. A card moved to a status goes
 * into its own project's first shown column of that kind, or stays (saying why) when the project has
 * none. Which projects show is chosen with "Projects:", remembered per person (the ones left out,
 * so a new project shows). Pure, so it is tested here (all-board.test.ts runs the website's own
 * functions against these).
 */
import { isNetworkError } from './api-client';
import { boardCard, type BoardCard } from './board';
import { BOARD_TEXT, type MoveOutcome } from './board-writes';
import { keptOnPhoneText } from './write-order';
import type { ApiColumn, ApiProject, ApiTask, ColumnCategory } from './types';

/** The six statuses, in the board's order (the website's STATUS_ORDER). */
export const STATUS_ORDER: readonly ColumnCategory[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];

/** Each status in the website's words (its STATUS_META labels). */
export const STATUS_NAME: Record<ColumnCategory, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  DONE: 'Done',
};

/** The board's words (the website's, checked by the test). */
export const ALL_PROJECTS_TEXT = {
  title: 'All projects',
  /** Under the board's day: how a card changes status here (the website says "drag"). */
  subtitle: 'All projects — long-press a card to change its status in its own project.',
  filterTitle: 'Projects on the board',
  showAll: 'Show all',
  showNone: 'Show none',
  find: 'Find a project',
  noMatch: 'No project matches.',
} as const;

/** A task's status: its column's kind, or To Do when the server names none it knows. */
export function statusOfTask(t: Pick<ApiTask, 'columnCategory'>): ColumnCategory {
  const c = t.columnCategory as ColumnCategory | null | undefined;
  return c && STATUS_ORDER.includes(c) ? c : 'TODO';
}

/** The projects the board shows: not finished, not archived. */
export function boardProjects<P extends Pick<ApiProject, 'status'>>(projects: readonly P[]): P[] {
  return projects.filter((p) => p.status !== 'COMPLETED' && p.status !== 'ARCHIVED');
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export interface StatusColumn {
  status: ColumnCategory;
  /** The status in words ("In Progress"). */
  name: string;
  /** Its tasks, sorted, each with its project. */
  tasks: { task: ApiTask; project: ApiProject }[];
}

/**
 * Every shown project's tasks under the six statuses. A status is sorted by due date (no date
 * last), then priority, then key. Tasks of finished or archived projects, of projects left out
 * (`hidden`), and in columns switched off are left out.
 */
export function composeAllProjectsBoard(tasks: readonly ApiTask[], projects: readonly ApiProject[], opts: { hidden?: ReadonlySet<string> } = {}): StatusColumn[] {
  const shown = new Map(boardProjects(projects).filter((p) => !opts.hidden?.has(p.id)).map((p) => [p.id, p]));
  const list = Array.isArray(tasks) ? tasks : [];
  return STATUS_ORDER.map((status) => ({
    status,
    name: STATUS_NAME[status],
    tasks: list
      .filter((t) => shown.has(t.projectId) && !t.columnHidden && statusOfTask(t) === status)
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
          a.key.localeCompare(b.key, undefined, { numeric: true }),
      )
      .map((task) => ({ task, project: shown.get(task.projectId)! })),
  }));
}

/** One card: the board's card, coloured by its status, with its project (as the website's). */
export function allBoardCard(t: ApiTask, status: ColumnCategory, p: Pick<ApiProject, 'name' | 'code' | 'color' | 'icon' | 'imageUrl'>, color: string): BoardCard {
  const column: ApiColumn = { id: `status:${status}`, projectId: t.projectId, name: STATUS_NAME[status], category: status, position: 0, color, enabled: true };
  return { ...boardCard(t, column), project: { name: p.name, code: p.code, color: p.color, icon: p.icon ?? null, imageUrl: p.imageUrl } };
}

/** Where a card moved to a status lands in its own project: that project's first shown column of it. */
export function targetColumnFor(columns: readonly ApiColumn[], status: ColumnCategory): string | null {
  return [...columns].filter((c) => c.enabled !== false && c.category === status).sort((a, b) => a.position - b.position)[0]?.id ?? null;
}

/** The statuses a card can be moved to: the other five, in the board's order. */
export function statusMoveTargets(current: ColumnCategory): { status: ColumnCategory; name: string }[] {
  return STATUS_ORDER.filter((s) => s !== current).map((status) => ({ status, name: STATUS_NAME[status] }));
}

/** Why a card stayed: its project has no column of that kind (the website's notice). */
export function noStatusColumnText(projectName: string | null | undefined, status: ColumnCategory, key: string): string {
  return `${projectName || 'Its project'} has no “${STATUS_NAME[status]}” column, so ${key} stayed where it was.`;
}

export type StatusMovePlan = { kind: 'same' } | { kind: 'move'; columnId: string } | { kind: 'no-column'; message: string };

/** What moving a task to a status does, given its project's columns. */
export function statusMovePlan(t: ApiTask, status: ColumnCategory, columns: readonly ApiColumn[], projectName: string | null | undefined): StatusMovePlan {
  if (statusOfTask(t) === status) return { kind: 'same' };
  const columnId = targetColumnFor(columns, status);
  return columnId ? { kind: 'move', columnId } : { kind: 'no-column', message: noStatusColumnText(projectName, status, t.key) };
}

/** The list with one task shown under its new status at once (leaving Done reopens it), before the server answers. */
export function withStatus<T extends ApiTask>(tasks: readonly T[], id: string, columnId: string, status: ColumnCategory): T[] {
  return tasks.map((t) => (t.id === id ? { ...t, columnId, columnCategory: status, ...(status !== 'DONE' ? { completedAt: null } : {}) } : t));
}

/**
 * Send a status move through the task write path (`move`: its lane, its version, kept on this phone
 * when there is no answer): moved; kept on this phone (it shows where it was put meanwhile); or
 * refused by the server (it goes back).
 */
export async function moveToStatus(move: (id: string, columnId: string) => Promise<unknown>, req: { id: string; columnId: string }): Promise<MoveOutcome> {
  try {
    await move(req.id, req.columnId);
    return { kind: 'moved' };
  } catch (e) {
    if (isNetworkError(e)) return { kind: 'kept', message: keptOnPhoneText(e) };
    return { kind: 'refused', message: BOARD_TEXT.moveRefused };
  }
}

// ── "Projects:" — which projects the board shows ─────────────────────────────

/** "Projects: all", or "Projects: 3 of 12". */
export function projectFilterLabel(shownCount: number, total: number): string {
  return shownCount === total ? 'Projects: all' : `Projects: ${shownCount} of ${total}`;
}

/** The projects whose name holds what was typed. */
export function findProjects<P extends { name: string }>(projects: readonly P[], q: string): P[] {
  const needle = q.trim().toLowerCase();
  return needle ? projects.filter((p) => p.name.toLowerCase().includes(needle)) : [...projects];
}

/** Where this phone keeps the projects a person left out of the board. */
export function hiddenProjectsKey(userId: string): string {
  return `mico360.board.hiddenProjects.${userId}`;
}

/** The projects left out, as kept (anything unreadable is none). */
export function readHiddenProjects(raw: string | null | undefined): Set<string> {
  try {
    const ids: unknown = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
