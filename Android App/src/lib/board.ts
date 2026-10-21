import { appTimeZone, dueDayKey, isOverdue } from './due-date';
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
  /** In a Done column, or completed: never overdue. */
  done: boolean;
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
    done: column.category === 'DONE' || !!t.completedAt,
  };
}

/** A due day as the website's card writes it: "Oct 20, 2026" (its own calendar day, company time). */
export function cardDueText(due: string | null, timeZone: string = appTimeZone()): string | null {
  const key = dueDayKey(due, timeZone);
  if (!key) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`));
}

export interface CardBadge {
  kind: 'checklist' | 'comments' | 'files';
  value: string;
  /** What TalkBack says. */
  label: string;
}

export interface CardView {
  overdue: boolean;
  hasDue: boolean;
  /** "Oct 20, 2026", "Overdue · Oct 20, 2026", or null with no due date. */
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
  const overdue = !card.done && isOverdue({ dueDate: card.dueDate }, opts.now ?? new Date(), timeZone);
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
    `${PRIORITY_WORD[card.priority] ?? card.priority} priority.`,
    card.blocked ? 'Blocked.' : null,
    card.milestone ? 'Milestone.' : null,
    card.recurring ? 'Repeats.' : null,
    day ? (overdue ? `Overdue, due ${day}.` : `Due ${day}.`) : null,
    card.done ? 'Done.' : `${card.progress}% done.`,
    card.assignees.length ? `${card.assignees.map((a) => a.name).join(', ')}.` : 'Nobody assigned.',
    ...counts.map((b) => `${b.label}.`),
  ];
  return {
    overdue,
    hasDue: !!day,
    dueText,
    shown,
    extra: card.assignees.length - shown.length,
    singleName: card.assignees.length === 1 ? card.assignees[0]!.name : null,
    counts,
    label: words.filter(Boolean).join(' '),
  };
}
