import type { BulkAction, BulkActionType, BulkResult, BulkSkipped, BulkUndoResult } from '../api/bulk';
import { statusMeta } from './taskStatus';
import { dayText } from './day-words';
import { limitReason } from './bulk-selection';

/**
 * Bulk task changes in words and rules the website shows: which actions the bar offers to whom, the
 * confirmation ("Move 12 tasks to Done? 2 will be skipped: …"), the summary ("18 updated · 2 not
 * changed") and Undo's answer ("12 put back · 1 left as it was: changed since").
 */

/** How long the summary offers Undo (the server keeps it a little longer). */
export const BULK_UNDO_SECONDS = 15;

export type BulkBarActionId = Exclude<BulkActionType, never> | 'merge';

export interface BarAction {
  id: BulkBarActionId;
  label: string;
  /** Shown but unavailable: why (null when it can be used). */
  unavailable: string | null;
}

export interface BarContext {
  /** How many are selected. */
  count: number;
  /** The selected tasks' projects (as known). */
  projectIds: string[];
  /** Some selected task's project isn't known (a task brought back by its id alone). */
  unknownProject: boolean;
  /** An administrator (the work, not settings: Manager View doesn't change it). */
  isAdmin: boolean;
  /** The projects this person runs (the project payload's canManage). */
  managedProjectIds: readonly string[];
  /** Move to another project: today's rule (null: not offered here). */
  move: { canMove: boolean; reason: string | null } | null;
  /** Merge: today's rule (null or show false: not offered). */
  merge: { show: boolean; reason: string | null } | null;
}

const LABELS: Record<BulkBarActionId, string> = {
  status: 'Status',
  priority: 'Priority',
  assign: 'Assign',
  reassign: 'Reassign',
  unassign: 'Unassign',
  dueDate: 'Due date',
  project: 'Project',
  category: 'Category',
  guests: 'Guests',
  duplicate: 'Duplicate',
  archive: 'Archive',
  unarchive: 'Unarchive',
  delete: 'Delete',
  merge: 'Merge',
};

/**
 * The bar's actions, in its order. Everyone may try a change (each task is checked on its own, the
 * skipped ones listed after); Archive, Unarchive and Delete are offered only to administrators and the
 * people who run at least one selected task's project (employees never see them, as Merge). Category
 * and Guests need one project; more than 500 tasks (Duplicate: 50) and nothing can be applied.
 */
export function bulkBarActions(ctx: BarContext): BarAction[] {
  const oneProject = ctx.projectIds.length === 1 && !ctx.unknownProject;
  const managed = new Set(ctx.managedProjectIds);
  const runs = ctx.isAdmin || ctx.projectIds.some((id) => managed.has(id));
  const ids: BulkBarActionId[] = ['status', 'priority', 'assign', 'reassign', 'unassign', 'dueDate'];
  if (ctx.move) ids.push('project');
  ids.push('category', 'guests', 'duplicate');
  if (runs) ids.push('archive', 'unarchive', 'delete');
  if (ctx.merge?.show) ids.push('merge');
  return ids.map((id) => {
    const limit = limitReason(ctx.count, id);
    let why: string | null = limit;
    if (!why && id === 'category' && !oneProject) why = 'Select tasks of one project to change their categories.';
    if (!why && id === 'guests' && !oneProject) why = 'Select tasks of one project to add guests.';
    if (!why && id === 'project') why = ctx.move?.canMove ? null : (ctx.move?.reason ?? null);
    if (!why && id === 'merge') why = ctx.merge?.reason ?? null;
    return { id, label: LABELS[id], unavailable: why };
  });
}

const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;

/** "Sara", "Sara and Omar", "Sara, Omar and Lina". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const PRIORITY_WORD = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' } as const;

/** What the confirmation's question needs to name things (people, categories, guests, the project, today). */
export interface ConfirmNames {
  people?: Record<string, string>;
  categories?: Record<string, string>;
  guests?: Record<string, string>;
  projectName?: string;
  /** The company's today ('YYYY-MM-DD'): a date this year says no year. */
  today?: string;
}

/** The confirmation's question: what changes, on how many tasks ("Move 12 tasks to Done?"). */
export function confirmTitle(action: BulkAction, count: number, names: ConfirmNames = {}): string {
  const n = tasks(count);
  const named = (list: string[] | undefined, from: Record<string, string> | undefined, fallback: string) =>
    listNames((list ?? []).map((id) => from?.[id] ?? fallback));
  switch (action.type) {
    case 'status':
      return `Move ${n} to ${statusMeta(action.status).label}?`;
    case 'priority':
      return `Set the priority of ${n} to ${PRIORITY_WORD[action.priority]}?`;
    case 'assign':
      return `Assign ${named(action.userIds, names.people, 'someone')} to ${n}?`;
    case 'reassign':
      return `Reassign ${n} to ${named(action.userIds, names.people, 'someone')} only?`;
    case 'unassign':
      return action.userIds?.length ? `Unassign ${named(action.userIds, names.people, 'someone')} from ${n}?` : `Unassign everyone from ${n}?`;
    case 'dueDate': {
      if (action.mode === 'clear') return `Clear the due date of ${n}?`;
      if (action.mode === 'set') {
        const sameYear = !names.today || action.date.slice(0, 4) === names.today.slice(0, 4);
        return `Set the due date of ${n} to ${dayText(action.date, { year: !sameYear })}?`;
      }
      const d = Math.abs(action.days);
      return `Move the due dates of ${n} ${d} day${d === 1 ? '' : 's'} ${action.days > 0 ? 'later' : 'earlier'}?`;
    }
    case 'project':
      return `Move ${n} to ${names.projectName ?? 'another project'}?`;
    case 'category': {
      const add = named(action.add, names.categories, 'a category');
      const remove = named(action.remove, names.categories, 'a category');
      if (add && remove) return `Add ${add} and take ${remove} off ${n}?`;
      return add ? `Add ${add} to ${n}?` : `Take ${remove} off ${n}?`;
    }
    case 'guests': {
      const many = action.add.length > 1;
      return `Add ${named(action.add, names.guests, 'a guest')} to ${n} as ${many ? 'guests' : 'a guest'}?`;
    }
    case 'duplicate':
      return `Duplicate ${n}?`;
    case 'archive':
      return `Archive ${n}?`;
    case 'unarchive':
      return `Unarchive ${n}?`;
    case 'delete':
      return `Move ${n} to the Recycle Bin?`;
  }
}

/** "You can’t …" → "you can’t …" (a word in capitals, like "RIG", stays as it is). */
function lowerFirst(s: string): string {
  if (s.length > 1 && s[1] === s[1]!.toUpperCase() && s[1] !== s[1]!.toLowerCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** The skipped tasks grouped by their reason, in the order first met: [reason, how many]. */
function byReason(skipped: BulkSkipped[]): [string, number][] {
  const m = new Map<string, number>();
  for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  return [...m];
}

/**
 * The confirmation's lines from the dry run: how many will change, how many will be skipped and why
 * ("2 will be skipped: you can’t move tasks in Rig 3."), and the notes ("2 will wait for approval.").
 */
export function confirmLines(result: BulkResult): string[] {
  const lines = [result.changed.length === 0 ? 'Nothing would change.' : `${tasks(result.changed.length)} will change.`];
  for (const [reason, n] of byReason(result.skipped)) lines.push(`${n} will be skipped: ${lowerFirst(reason)}`);
  const notes = new Map<string, { text: string; n: number }>();
  for (const c of result.changed) {
    if (!c.note) continue;
    const had = notes.get(c.note.code);
    notes.set(c.note.code, { text: c.note.text, n: (had?.n ?? 0) + 1 });
  }
  for (const [code, { text, n }] of notes) lines.push(code === 'WAITS_FOR_APPROVAL' ? `${n} will wait for approval.` : `${text} (${n}).`);
  return lines;
}

const DONE_WORD: Partial<Record<BulkActionType, [string, string]>> = {
  duplicate: ['copied', 'not copied'],
  delete: ['moved to the Recycle Bin', 'not changed'],
  archive: ['archived', 'not changed'],
  unarchive: ['unarchived', 'not changed'],
};

/** "18 updated · 2 not changed" (each action in its own words: "4 copied · 1 not copied"). */
export function summaryText(result: BulkResult): string {
  const [done, left] = DONE_WORD[result.action] ?? ['updated', 'not changed'];
  const head = `${result.changed.length} ${done}`;
  return result.skipped.length ? `${head} · ${result.skipped.length} ${left}` : head;
}

/** A skipped task in the summary's list: "RIG-2 Set out" — never naming one the person can't open. */
export function skippedLabel(s: BulkSkipped): string {
  return s.key ? `${s.key} ${s.title ?? ''}`.trim() : 'A task you can’t open';
}

/** Undo's answer: "12 put back · 1 left as it was: changed since". */
export function undoText(result: BulkUndoResult): string {
  const head = `${result.restored.length} put back`;
  if (result.skipped.length === 0) return head;
  const why = (s: BulkSkipped) => (s.code === 'CHANGED_SINCE' ? 'changed since' : lowerFirst(s.reason).replace(/[.\s]+$/, ''));
  const groups = new Map<string, number>();
  for (const s of result.skipped) groups.set(why(s), (groups.get(why(s)) ?? 0) + 1);
  const reasons = groups.size === 1 ? [...groups.keys()][0]! : [...groups].map(([w, n]) => `${n} ${w}`).join('; ');
  const n = result.skipped.length;
  return `${head} · ${n} left as ${n === 1 ? 'it was' : 'they were'}: ${reasons}`;
}

/**
 * The tasks a live `task:*` event is about: a bulk change sends one event per project naming its tasks
 * in `ids` (and no `id`); a single change names its task in `id`.
 */
export function taskIdsOfLiveEvent(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { id?: unknown; ids?: unknown };
  if (Array.isArray(p.ids)) return p.ids.filter((x): x is string => typeof x === 'string');
  return typeof p.id === 'string' ? [p.id] : [];
}
