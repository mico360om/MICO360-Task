/**
 * Manage columns (4b), as the website's ColumnManager: add a column, rename it, give it a colour,
 * map it to a status, show or hide it, move it up or down, delete it. Who may do it is the
 * server's rule — an administrator, or a manager of the project (modules/projects/project-authz;
 * the app asks lib/project-team canManageProject, never roles alone) — and the server has the last
 * word. Every change needs a connection, as on the website. Pure, so it is tested here.
 */
import { ApiError } from './api-client';
import { COLOR_NAMES, PROJECT_COLORS } from './project-identity';
import { canManageProject } from './project-team';
import type { ApiColumn } from './types';

export const COLUMN_TEXT = {
  nameRequired: 'Column name is required.',
  addNote: 'New columns start as a “To do” stage — set its mapped status after adding.',
  connection: 'Couldn’t save that column change. Check your connection and try again.',
  refused: 'Only an administrator or a manager of this project can change its columns.',
  /** Offline, with the project's team not kept on this phone: who manages it can't be checked (4b review #13). */
  needsConnection: 'Needs a connection to check who can manage columns. Check your connection and try again.',
} as const;

/** What an empty board says (4b review #13): no columns at all, or every one switched off. */
export function emptyBoardText({ columns, canManage }: { columns: number; canManage: boolean }): { title: string; subtitle: string } {
  if (columns === 0) return { title: 'No columns', subtitle: canManage ? 'This project has no board columns yet. Add one in Manage columns.' : 'This project has no board columns yet.' };
  return { title: 'All columns are hidden', subtitle: canManage ? 'Every column of this project is switched off. Turn one on in Manage columns.' : 'Every column of this project is switched off.' };
}

/**
 * May this person manage the columns (the server's rule, lib/project-team)? An administrator
 * always; anyone else by the project's team — and when that couldn't be read (offline, nothing
 * kept), it can't be said: 'needs-connection', never a refusal.
 */
export function manageColumnsGate(
  user: { id: string; roles: string[] } | null,
  members: readonly { id: string; role: 'MEMBER' | 'MANAGER' }[],
  o: { membersKnown: boolean },
): 'ok' | 'refused' | 'needs-connection' {
  if (user?.roles.includes('ADMIN')) return 'ok';
  if (!o.membersKnown) return 'needs-connection';
  return canManageProject(user, [...members]) ? 'ok' : 'refused';
}

/** Every column, hidden ones too, in board order. */
export function orderedColumns(columns: readonly ApiColumn[]): ApiColumn[] {
  return [...columns].sort((a, b) => a.position - b.position);
}

/** Why a column name can't be used (null: it can). */
export function columnNameProblem(name: string): string | null {
  return name.trim() ? null : COLUMN_TEXT.nameRequired;
}

/**
 * Up or down one: the column swaps places with its neighbour. The server keeps each place in a
 * project unique, so (as the website does) it goes to a free place first: three changes, in order.
 * None at an edge.
 */
export function columnSwapSteps(columns: readonly ApiColumn[], id: string, dir: 'up' | 'down'): { id: string; position: number }[] {
  const cols = orderedColumns(columns);
  const i = cols.findIndex((c) => c.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= cols.length) return [];
  const a = cols[i]!;
  const b = cols[j]!;
  return [
    { id: a.id, position: -1 - a.position },
    { id: b.id, position: a.position },
    { id: a.id, position: b.position },
  ];
}

/** A whole new order, in two passes (out of the way, then into place), as the website's drag sends it. */
export function columnOrderSteps(orderedIds: readonly string[]): { id: string; position: number }[] {
  return [...orderedIds.map((id, i) => ({ id, position: -1000 - i })), ...orderedIds.map((id, i) => ({ id, position: i }))];
}

/** Why a column change didn't happen: the server's own words (a column that still has tasks), else plain words. */
export function columnActionError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return COLUMN_TEXT.refused;
    if (e.message && e.code !== 'ERROR' && !/^Request failed/.test(e.message) && e.status < 500) return e.message;
  }
  return COLUMN_TEXT.connection;
}

/** The colours offered for a column (the website's colours, each with its name); any other is kept as it is. */
export const COLUMN_COLORS: { value: string; name: string }[] = PROJECT_COLORS.map((value) => ({ value, name: COLOR_NAMES[value] ?? value }));
