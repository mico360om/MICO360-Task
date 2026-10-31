import { appTimeZone, formatDueDay, isOverdue } from './due-date';
import { DECISION_WORDS } from './approvals';
import { displayName, type ApiColumn, type ApiTask, type Priority } from './types';

export interface BoardColumn {
  column: ApiColumn;
  tasks: ApiTask[];
}

/**
 * Compose the shown columns (in order) with their tasks (in order) for the Kanban board (A4), as
 * the website's composeBoard: a column switched off in Manage columns isn't on the board.
 */
export function composeBoard(columns: ApiColumn[], tasks: ApiTask[]): BoardColumn[] {
  return [...columns]
    .filter((c) => c.enabled !== false)
    .sort((a, b) => a.position - b.position)
    .map((column) => ({
      column,
      tasks: tasks.filter((t) => t.columnId === column.id).sort((a, b) => a.position - b.position),
    }));
}

// ── Cards (4b): the website's board card (frontend lib/board.ts composeBoard, components/TaskCard.tsx) ──

/** The counts a list answer carries for a card's badges. */
export interface CardCounts {
  comments: number;
  attachments: number;
  checklistDone: number;
  checklistTotal: number;
}

/** What one card shows, as the website's composeBoard makes it (a drift test keeps them equal). */
export interface BoardCard {
  id: string;
  key: string;
  title: string;
  priority: Priority;
  dueDate: string | null;
  progress: number;
  assignees: { id: string; name: string }[];
  counts?: CardCounts;
  /** The column's colour: the card's stripe. */
  accentColor: string;
  /** In a Blocked column. */
  blocked: boolean;
  /** The newest copy of a repeating task. */
  recurring: boolean;
  milestone: boolean;
  /** Shown on the project's client page (the eye). */
  clientVisible: boolean;
  /** Carried out with an inspection form (a check): the "Inspection" mark. */
  inspection: boolean;
  /** Finished, waiting for a project manager's approval (not done yet): never overdue while it waits. */
  awaitingApproval: boolean;
  /** In a Done column, or completed: never overdue. */
  done: boolean;
  /** Its project, on a board showing several projects (the All projects board, 4c). */
  project?: { name: string; code: string; color?: string | null; icon?: string | null; imageUrl?: string | null };
}

type AnyAssignee = { id: string; name?: string; username?: string; firstName?: string; lastName?: string };

/** A person on a card: the list's { id, name }, or the full person a create answer carries. */
function personRef(a: AnyAssignee): { id: string; name: string } {
  return { id: a.id, name: typeof a.name === 'string' ? a.name : displayName({ username: a.username ?? '', firstName: a.firstName, lastName: a.lastName }) };
}

export function boardCard(t: ApiTask, column: ApiColumn): BoardCard {
  const raw = t as ApiTask & { counts?: CardCounts; assignees?: AnyAssignee[] };
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    priority: t.priority,
    dueDate: t.dueDate,
    progress: t.progress,
    assignees: (raw.assignees ?? []).map(personRef),
    counts: raw.counts,
    accentColor: column.color,
    blocked: column.category === 'BLOCKED',
    recurring: Boolean(t.recurrenceRule),
    milestone: !!t.isMilestone,
    clientVisible: !!t.clientVisible,
    inspection: !!t.inspectionFormId,
    awaitingApproval: !!t.approvalRequestedAt,
    done: column.category === 'DONE' || !!t.completedAt,
  };
}

/** A face without a photo: the first letters of the first two words, from letters only, as the website's Avatar (lib/initials). */
export { personInitials } from './initials';

/** A due day as the website's card writes it: "20 Oct 2026" (its own calendar day, company time). */
export function cardDueText(due: string | null, timeZone: string = appTimeZone()): string | null {
  return formatDueDay(due, timeZone);
}

export interface CardBadge {
  kind: 'checklist' | 'comments' | 'files';
  value: string;
  /** What TalkBack says. */
  label: string;
}

export interface CardView {
  overdue: boolean;
  /** Waiting for approval: its due day is shown plainly, never "Overdue". */
  waiting: boolean;
  hasDue: boolean;
  /** "20 Oct 2026", "Overdue · 20 Oct 2026", or null with no due date. */
  dueText: string | null;
  /** Up to three people's faces, then "+N". */
  shown: { id: string; name: string }[];
  extra: number;
  /** The one person's name, written beside the face (only when there is one). */
  singleName: string | null;
  /** Subtasks done, comments and files — each only when there is some. */
  counts: CardBadge[];
  /** Everything the card shows, in words (TalkBack). */
  label: string;
}

const PRIORITY_WORD: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the card shows, by the website's card rules (TaskCard). */
export function cardView(card: BoardCard, opts: { now?: Date; timeZone?: string } = {}): CardView {
  const timeZone = opts.timeZone ?? appTimeZone();
  // The website's card: finished work and work waiting for approval are never overdue.
  const waiting = !card.done && card.awaitingApproval;
  const overdue = !card.done && !waiting && isOverdue({ dueDate: card.dueDate }, opts.now ?? new Date(), timeZone);
  const day = cardDueText(card.dueDate, timeZone);
  const dueText = day ? (overdue ? `Overdue · ${day}` : day) : null;
  const shown = card.assignees.slice(0, 3);
  const c = card.counts;
  const counts: CardBadge[] = [];
  if (c && c.checklistTotal > 0) counts.push({ kind: 'checklist', value: `${c.checklistDone}/${c.checklistTotal}`, label: `Subtasks done: ${c.checklistDone} of ${c.checklistTotal}` });
  if (c && c.comments > 0) counts.push({ kind: 'comments', value: String(c.comments), label: plural(c.comments, 'comment', 'comments') });
  if (c && c.attachments > 0) counts.push({ kind: 'files', value: String(c.attachments), label: plural(c.attachments, 'file', 'files') });
  const words = [
    `${card.key}, ${card.title}.`,
    card.project ? `In ${card.project.name}.` : null,
    `${PRIORITY_WORD[card.priority] ?? card.priority} priority.`,
    card.blocked ? 'Blocked.' : null,
    card.milestone ? 'Milestone.' : null,
    card.clientVisible ? 'Visible to client.' : null,
    card.recurring ? 'Repeats.' : null,
    waiting ? `${DECISION_WORDS.waiting}.` : null,
    card.inspection ? 'Inspection.' : null,
    day ? (overdue ? `Overdue, due ${day}.` : `Due ${day}.`) : null,
    card.done ? 'Done.' : `${card.progress}% done.`,
    card.assignees.length ? `${card.assignees.map((a) => a.name).join(', ')}.` : 'Nobody assigned.',
    ...counts.map((b) => `${b.label}.`),
  ];
  return {
    overdue,
    waiting,
    hasDue: !!day,
    dueText,
    shown,
    extra: card.assignees.length - shown.length,
    singleName: card.assignees.length === 1 ? card.assignees[0]!.name : null,
    counts,
    label: words.filter(Boolean).join(' '),
  };
}

/** Below this width (the website's `md`, 768 px) a board's columns keep their own height. */
export const COLUMN_FIT_BELOW = 768;

/**
 * How tall a column is: as tall as the board ('fill', its cards scroll inside it), or — an empty
 * column on a phone — only as tall as its "No tasks" ('fit'), as the website's `max-md:items-start`.
 */
export function columnFill(o: { cards: number; screenWidth: number }): 'fill' | 'fit' {
  return o.cards === 0 && o.screenWidth < COLUMN_FIT_BELOW ? 'fit' : 'fill';
}
