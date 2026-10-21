/**
 * The task activity timeline: turns raw activity rows (newest first) into short readable lines —
 * "moved this task To Do → In Progress", "assigned Omar Ahmed", "changed priority from Normal to
 * High" — and collapses repetitive runs by one person (several quick moves, people assigned at once,
 * successive edits) into a single line.
 */

export interface FeedEntry {
  id: string;
  action: string;
  actorName: string;
  createdAt?: string;
  meta?: Record<string, unknown> | null;
}

export type TimelineKind =
  | 'created'
  | 'moved'
  | 'completed'
  | 'reopened'
  | 'assigned'
  | 'unassigned'
  | 'updated'
  | 'checklist'
  | 'comment'
  | 'file'
  | 'blocker'
  | 'other';

export interface TimelineItem {
  /** The newest entry's id. */
  id: string;
  kind: TimelineKind;
  actorName: string;
  /** What they did, to follow their name ("assigned Omar Ahmed"). */
  text: string;
  /** For status changes: the statuses the task went through, oldest first. */
  path?: string[];
  /** When the newest entry happened. */
  createdAt?: string;
  /** How many raw entries this line stands for. */
  count: number;
}

/** Entries by one person this close together (or closer) read as one action. */
const MERGE_WINDOW_MS = 30 * 60_000;

const KIND_OF: Record<string, TimelineKind> = {
  CREATED: 'created',
  'task.created': 'created',
  MOVED: 'moved',
  'task.moved': 'moved',
  COMPLETED: 'completed',
  'task.completed': 'completed',
  REOPENED: 'reopened',
  'task.reopened': 'reopened',
  ASSIGNED: 'assigned',
  'assignee.added': 'assigned',
  UNASSIGNED: 'unassigned',
  'assignee.removed': 'unassigned',
  UPDATED: 'updated',
  'task.updated': 'updated',
  CHECKLIST_ADDED: 'checklist',
  CHECKLIST_DONE: 'checklist',
  CHECKLIST_REOPENED: 'checklist',
  CHECKLIST_RENAMED: 'checklist',
  CHECKLIST_REMOVED: 'checklist',
  CHECKLIST_REORDERED: 'checklist',
  COMMENTED: 'comment',
  ATTACHED: 'file',
  ATTACHMENT_REMOVED: 'file',
  BLOCKER_ADDED: 'blocker',
  BLOCKER_REMOVED: 'blocker',
};
/** Older rows from before the timeline had details. */
const OTHER_TEXT: Record<string, string> = {
  'comment.added': 'left a comment',
  'attachment.added': 'added an attachment',
  'checklist.added': 'added a checklist item',
};

const isMove = (k: TimelineKind) => k === 'moved' || k === 'completed' || k === 'reopened';
/**
 * What a run is "of" — entries with the same key, by one person, close together, become one line:
 * any status moves; assignments; edits; and each kind of checklist, comment, file or blocker change.
 */
function mergeKey(entry: FeedEntry): string | null {
  const kind = KIND_OF[entry.action] ?? 'other';
  if (isMove(kind)) return 'move';
  if (kind === 'assigned' || kind === 'unassigned' || kind === 'updated') return kind;
  if (kind === 'checklist' || kind === 'comment' || kind === 'file' || kind === 'blocker') return entry.action;
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-12" → "12 Oct 2026" (the same in every locale and time zone). */
function dayText(key: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key ?? ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : String(key ?? '');
}
const titleCase = (s: unknown) => {
  const t = String(s ?? '');
  return t.charAt(0) + t.slice(1).toLowerCase();
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** "a", "a and b", "a, b and c". */
function listText(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
/** A few names, then "and N more": "“A”, “B”, “C” and 2 more". */
function someOf(names: string[], shown = 3): string {
  return names.length <= shown + 1 ? listText(names) : `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}
const quote = (s: string) => `“${s}”`;
const blockerName = (e: FeedEntry) => [str(e.meta?.key), str(e.meta?.title) ? quote(str(e.meta?.title)!) : null].filter(Boolean).join(' ') || 'a task';

interface Change {
  field: string;
  from?: unknown;
  to?: unknown;
}

function changeText(c: Change): string | null {
  const from = str(c.from);
  const to = str(c.to);
  switch (c.field) {
    case 'title':
      return to ? `renamed it to “${to}”` : 'renamed it';
    case 'description':
      return 'edited the description';
    case 'priority':
      return from && to ? `changed priority from ${titleCase(from)} to ${titleCase(to)}` : `changed the priority`;
    case 'dueDate':
      if (!from && to) return `set the due date to ${dayText(to)}`;
      if (from && !to) return 'removed the due date';
      return `moved the due date from ${dayText(from)} to ${dayText(to)}`;
    case 'repeat': {
      // The server words a repeat as "Repeats every week on Mon"; say "made it repeat every week on Mon".
      const rule = (to ?? '').replace(/^repeats\s+/i, '');
      if (!from && to) return `made it repeat ${rule}`;
      if (from && !to) return 'stopped the repeat';
      return `changed the repeat to ${rule}`;
    }
    default:
      return null;
  }
}

const changesOf = (e: FeedEntry): Change[] => (Array.isArray(e.meta?.changes) ? (e.meta!.changes as Change[]) : []);

/** Successive edits, oldest first, folded per field: the first old value and the last new one. */
function foldChanges(chronological: FeedEntry[]): Change[] {
  const byField = new Map<string, Change>();
  for (const entry of chronological) {
    for (const c of changesOf(entry)) {
      const seen = byField.get(c.field);
      byField.set(c.field, seen ? { field: c.field, from: seen.from, to: c.to } : { ...c });
    }
  }
  // A value changed and changed back again is no change at all (descriptions carry no values).
  return [...byField.values()].filter((c) => c.field === 'description' || (c.from ?? null) !== (c.to ?? null));
}

function statusPath(chronological: FeedEntry[]): string[] | undefined {
  const path: string[] = [];
  for (const entry of chronological) {
    const from = str(entry.meta?.from);
    const to = str(entry.meta?.to);
    if (from && path[path.length - 1] !== from) path.push(from);
    if (to && path[path.length - 1] !== to) path.push(to);
  }
  return path.length > 0 ? path : undefined;
}

function toItem(kind: TimelineKind, entries: FeedEntry[]): TimelineItem | null {
  const newest = entries[0]!;
  const chronological = [...entries].reverse();
  const base = { id: newest.id, kind, actorName: newest.actorName, createdAt: newest.createdAt, count: entries.length };
  switch (kind) {
    case 'created':
      return { ...base, text: 'created this task' };
    case 'moved':
    case 'completed':
    case 'reopened':
      return { ...base, text: `${kind === 'moved' ? 'moved' : kind} this task`, path: statusPath(chronological) };
    case 'assigned':
    case 'unassigned': {
      const names = chronological.map((e) => str(e.meta?.assignee)).filter((n): n is string => Boolean(n));
      return { ...base, text: names.length > 0 ? `${kind} ${listText(names)}` : kind === 'assigned' ? 'assigned a teammate' : 'removed an assignee' };
    }
    case 'updated': {
      const phrases = foldChanges(chronological).map(changeText).filter((t): t is string => Boolean(t));
      // Older rows have no details; a run whose changes cancelled out says nothing at all.
      if (phrases.length === 0) return changesOf(newest).length === 0 && entries.length === 1 ? { ...base, text: 'updated this task' } : null;
      return { ...base, text: listText(phrases) };
    }
    case 'checklist': {
      const n = entries.length;
      const steps = chronological.map((e) => quote(str(e.meta?.text) ?? 'a step'));
      switch (newest.action) {
        case 'CHECKLIST_ADDED':
          return { ...base, text: n === 1 ? `added the step ${steps[0]}` : `added ${n} steps: ${someOf(steps)}` };
        case 'CHECKLIST_DONE':
          return { ...base, text: n === 1 ? `ticked off ${steps[0]}` : `ticked off ${n} steps: ${someOf(steps)}` };
        case 'CHECKLIST_REOPENED':
          return { ...base, text: n === 1 ? `unticked ${steps[0]}` : `unticked ${n} steps: ${someOf(steps)}` };
        case 'CHECKLIST_REMOVED':
          return { ...base, text: n === 1 ? `removed the step ${steps[0]}` : `removed ${n} steps: ${someOf(steps)}` };
        case 'CHECKLIST_REORDERED':
          return { ...base, text: 'reordered the checklist' };
        default:
          return {
            ...base,
            text: listText(chronological.map((e) => `renamed the step ${quote(str(e.meta?.from) ?? '')} to ${quote(str(e.meta?.to) ?? '')}`)),
          };
      }
    }
    case 'comment':
      return { ...base, text: entries.length === 1 ? 'commented' : `left ${entries.length} comments` };
    case 'file': {
      const files = chronological.map((e) => str(e.meta?.filename) ?? 'a file');
      return newest.action === 'ATTACHED'
        ? { ...base, text: `attached ${someOf(files)}` }
        : { ...base, text: files.length === 1 ? `removed the file ${files[0]}` : `removed ${files.length} files: ${someOf(files)}` };
    }
    case 'blocker': {
      const names = chronological.map(blockerName);
      const verb = newest.action === 'BLOCKER_ADDED' ? 'added' : 'removed';
      // The server keeps only the other task's id (naming it could reveal a task you can't open).
      if (names.every((n) => n === 'a task')) return { ...base, text: names.length === 1 ? `${verb} a blocker` : `${verb} ${names.length} blockers` };
      return { ...base, text: names.length === 1 ? `${verb} the blocker ${names[0]}` : `${verb} the blockers ${someOf(names)}` };
    }
    default:
      return { ...base, text: OTHER_TEXT[newest.action] ?? (newest.action || '').toLowerCase().replace(/[._]/g, ' ') };
  }
}

const timeOf = (e: FeedEntry) => (e.createdAt ? new Date(e.createdAt).getTime() : NaN);

/** Readable timeline lines from activity rows given newest first. */
export function buildTimeline(entries: FeedEntry[]): TimelineItem[] {
  const groups: { kind: TimelineKind; entries: FeedEntry[] }[] = [];
  for (const entry of entries) {
    const kind = KIND_OF[entry.action] ?? 'other';
    const last = groups[groups.length - 1];
    const oldest = last?.entries[last.entries.length - 1];
    const close = oldest ? Math.abs(timeOf(oldest) - timeOf(entry)) <= MERGE_WINDOW_MS : false;
    const key = mergeKey(entry);
    if (last && oldest && close && oldest.actorName === entry.actorName && key !== null && key === mergeKey(oldest)) {
      last.entries.push(entry);
    } else {
      groups.push({ kind, entries: [entry] });
    }
  }
  // A merged run of moves reads as its newest step (a run ending in "completed" completed the task).
  return groups
    .map((g) => toItem(isMove(g.kind) ? (KIND_OF[g.entries[0]!.action] ?? 'moved') : g.kind, g.entries))
    .filter((item): item is TimelineItem => item !== null);
}
