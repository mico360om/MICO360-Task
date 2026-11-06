/**
 * The task activity timeline: turns raw activity rows (newest first) into short readable lines —
 * "moved this task To Do → In Progress", "assigned Omar Ahmed", "changed priority from Normal to
 * High" — and collapses repetitive runs by one person (several quick moves, people assigned at once,
 * successive edits) into a single line. A change the person made through MICO AI (meta.via
 * "mico-ai") ends "via MICO AI", and never folds into a line they made by hand.
 */
import { dayText as dayWords } from './day-words';

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
  | 'external'
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
  /** 1.23.3: a deleted checklist item or checklist — its Restore (while it can still be restored). */
  batchId?: string;
}

/** Entries by one person this close together (or closer) read as one action. */
const MERGE_WINDOW_MS = 30 * 60_000;
/** 1.23.3: checklist items added one by one to one checklist read as one line within a couple of minutes. */
const ADD_WINDOW_MS = 2 * 60_000;

const KIND_OF: Record<string, TimelineKind> = {
  CREATED: 'created',
  'task.created': 'created',
  MOVED: 'moved',
  'task.moved': 'moved',
  COMPLETED: 'completed',
  'task.completed': 'completed',
  // Task approvals: an approval completes the task (the request, a send-back and a withdrawal are lines of their own).
  APPROVED: 'completed',
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
  // 1.23.3 nested checklists: people, dates, moves, copies, restores and whole checklists.
  CHECKLIST_ASSIGNED: 'checklist',
  CHECKLIST_UNASSIGNED: 'checklist',
  CHECKLIST_DUE: 'checklist',
  CHECKLIST_MOVED: 'checklist',
  CHECKLIST_DUPLICATED: 'checklist',
  CHECKLIST_RESTORED: 'checklist',
  CHECKLIST_LIST_ADDED: 'checklist',
  CHECKLIST_LIST_RENAMED: 'checklist',
  CHECKLIST_LIST_DUPLICATED: 'checklist',
  CHECKLIST_LIST_REMOVED: 'checklist',
  COMMENTED: 'comment',
  ATTACHED: 'file',
  ATTACHMENT_REMOVED: 'file',
  BLOCKER_ADDED: 'blocker',
  BLOCKER_REMOVED: 'blocker',
  EXTERNAL_CONTACT_ADDED: 'external',
  EXTERNAL_CONTACT_CHANGED: 'external',
  EXTERNAL_CONTACT_REMOVED: 'external',
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
 * any status moves; assignments; edits; and each kind of checklist, comment, file, blocker or
 * external-contact change.
 */
function mergeKey(entry: FeedEntry): string | null {
  const key = runKey(entry);
  return key !== null && viaMicoAi(entry) ? `${key}|mico-ai` : key;
}
function runKey(entry: FeedEntry): string | null {
  const kind = KIND_OF[entry.action] ?? 'other';
  if (isMove(kind)) return 'move';
  if (kind === 'assigned' || kind === 'unassigned' || kind === 'updated') return kind;
  if (kind === 'checklist') return checklistRunKey(entry);
  if (kind === 'comment' || kind === 'file' || kind === 'blocker' || kind === 'external') return entry.action;
  return null;
}
/**
 * Checklist runs (1.23.3): items added to one checklist; ticks; unticks; renames; old reorders and
 * old deletes. A delete that can be restored, and every other new kind, is a line of its own.
 */
function checklistRunKey(entry: FeedEntry): string | null {
  switch (entry.action) {
    case 'CHECKLIST_ADDED': {
      const list = str(entry.meta?.listTitle);
      return list ? `CHECKLIST_ADDED|${list}` : entry.action;
    }
    case 'CHECKLIST_REMOVED':
      return str(entry.meta?.batchId) ? null : entry.action;
    case 'CHECKLIST_DONE':
    case 'CHECKLIST_REOPENED':
    case 'CHECKLIST_RENAMED':
    case 'CHECKLIST_REORDERED':
      return entry.action;
    default:
      return null;
  }
}
/** How close together two of a person's entries must be to read as one line. */
const windowOf = (entry: FeedEntry) => (entry.action === 'CHECKLIST_ADDED' && str(entry.meta?.listTitle) ? ADD_WINDOW_MS : MERGE_WINDOW_MS);
/** Made through MICO AI (the person confirmed it there). */
const viaMicoAi = (entry: FeedEntry) => entry.meta?.via === 'mico-ai';

/** "2026-10-12" → "12 Oct 2026" (the website's day words, the same in every locale and time zone); anything else as it came. */
function dayText(key: unknown): string {
  return dayWords(String(key ?? '')) || String(key ?? '');
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
/** Some of `total` names when only a few are known: "“A”, “B”, “C” and 4 more". */
function someOfTotal(names: string[], total: number, shown = 3): string {
  return names.length === total && total <= shown + 1 ? listText(names) : `${names.slice(0, shown).join(', ')} and ${total - Math.min(shown, names.length)} more`;
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A few names, then "and N more": "“A”, “B”, “C” and 2 more". */
function someOf(names: string[], shown = 3): string {
  return names.length <= shown + 1 ? listText(names) : `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}
const quote = (s: string) => `“${s}”`;
/** An external contact as a line names them: "Ahmed Al Said (OXY)", or just the name. */
const contactName = (e: FeedEntry): string | null => {
  const name = str(e.meta?.name);
  const company = str(e.meta?.company);
  return name ? (company ? `${name} (${company})` : name) : null;
};
const EXTERNAL_VERB: Record<string, string> = { EXTERNAL_CONTACT_ADDED: 'added', EXTERNAL_CONTACT_CHANGED: 'changed', EXTERNAL_CONTACT_REMOVED: 'removed' };
const blockerName = (e: FeedEntry) => [str(e.meta?.key), str(e.meta?.title) ? quote(str(e.meta?.title)!) : null].filter(Boolean).join(' ') || 'a task';

/** A project and the task's key in it: "Rig Inspection (RIG-4)" (either alone when the other is missing). */
function projectAndKey(project: unknown, key: unknown): string | null {
  const name = str(project);
  const k = str(key);
  return name && k ? `${name} (${k})` : name ?? k;
}
/** "moved this task from Rig Inspection (RIG-4) to Operations (OPS-17)" — a move to another project. */
function projectMoveText(e: FeedEntry): string {
  const from = projectAndKey(e.meta?.fromProject, e.meta?.fromKey);
  const to = projectAndKey(e.meta?.toProject, e.meta?.toKey);
  if (from && to) return `moved this task from ${from} to ${to}`;
  return to ? `moved this task to ${to}` : 'moved this task to another project';
}
/** 1.23.1: the numbers named on a merge line ("MICO-14 and MICO-15"). */
function keysOf(e: FeedEntry): string[] {
  const keys = e.meta?.keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string' && k !== '') : [];
}
/** "merged MICO-14 and MICO-15 into this task" (moving it, and the people left off, when that happened). */
function mergedText(e: FeedEntry): string {
  const keys = keysOf(e);
  const what = keys.length ? someOf(keys) : 'other tasks';
  const toProject = str(e.meta?.toProject);
  const moved = toProject && str(e.meta?.fromKey) ? `, moving it to ${toProject} as ${str(e.meta?.mainKey) ?? 'a new number'}` : '';
  const leftOff = Array.isArray(e.meta?.leftOff) ? (e.meta!.leftOff as unknown[]).filter((n): n is string => typeof n === 'string') : [];
  return `merged ${what} into this task${moved}${leftOff.length ? `; left ${someOf(leftOff)} off (not on the team)` : ''}`;
}
/** An undone merge, on the main task ("undid the merge of MICO-14") or on a task it gave back. */
function mergeUndoneText(e: FeedEntry): string {
  const main = str(e.meta?.mainKey);
  if (e.meta?.fromMain) return `undid its merge into ${main ?? 'another task'}: this is a separate task again`;
  const keys = keysOf(e);
  return keys.length ? `undid the merge of ${someOf(keys)}` : 'undid a merge';
}
/** An inspection named in a task's history: "the inspection “Rig daily check”", or "an inspection". */
function inspectionName(e: FeedEntry): string {
  const name = str(e.meta?.inspection);
  return name ? `the inspection ${quote(name)}` : 'an inspection';
}
/** "finished the inspection “Rig daily check”: 2 items failed" (or ": passed"). */
function inspectionFinishedText(e: FeedEntry): string {
  const failed = typeof e.meta?.failed === 'number' ? e.meta.failed : null;
  const result = failed === null ? '' : failed === 0 ? ': passed' : `: ${failed} ${failed === 1 ? 'item' : 'items'} failed`;
  return `finished ${inspectionName(e)}${result}`;
}
/** "made this a follow-up of “Guard rails fitted” in the inspection “Rig daily check”". */
function followUpText(e: FeedEntry): string {
  const item = str(e.meta?.item);
  return item && str(e.meta?.inspection) ? `made this a follow-up of ${quote(item)} in ${inspectionName(e)}` : `made this a follow-up of ${inspectionName(e)}`;
}

/** The old project's line: "moved RIG-4 to Operations (OPS-17)" — by the key the task had there. */
function movedOutText(e: FeedEntry): string {
  const to = projectAndKey(e.meta?.toProject, e.meta?.toKey);
  return `moved ${str(e.meta?.key) ?? 'a task'} to ${to ?? 'another project'}`;
}

/** Company names in a line's details (anything else left out). */
const companyNames = (v: unknown): string[] => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string' && n !== '') : []);
/**
 * A project's companies changed (its history): "changed this project’s companies — added Beta Co;
 * removed Gamma Co; main company now Alpha Co". Parts with nothing in them are left out.
 */
function companiesChangedText(e: FeedEntry): string {
  const added = companyNames(e.meta?.added);
  const removed = companyNames(e.meta?.removed);
  const main = str(e.meta?.main);
  const parts = [added.length ? `added ${listText(added)}` : null, removed.length ? `removed ${listText(removed)}` : null, main ? `main company now ${main}` : null].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? `changed this project’s companies — ${parts.join('; ')}` : 'changed this project’s companies';
}

interface Change {
  field: string;
  from?: unknown;
  to?: unknown;
  /** Why it changed, when it wasn't edited directly ('moved': the task moved to another project). */
  reason?: unknown;
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
    case 'milestone':
      return c.to ? 'made it a milestone' : 'cleared its milestone';
    case 'clientVisible':
      if (c.to) return 'made this visible to the client';
      return c.reason === 'moved' ? 'hid this from the client (moved to another project)' : 'hid this from the client';
    // A scheduled check: the inspection form it is carried out with (ids, not named), and where.
    case 'inspectionForm':
      if (!from && to) return 'gave it an inspection form';
      if (from && !to) return 'took off its inspection form';
      return 'changed its inspection form';
    case 'needsApproval':
      return c.to ? 'turned on Needs approval' : 'turned off Needs approval';
    case 'inspectionPlace':
      if (!from && to) return `set the place to ${quote(to)}`;
      if (from && !to) return 'removed the place';
      return `changed the place to ${quote(to ?? '')}`;
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
      byField.set(c.field, seen ? { field: c.field, from: seen.from, to: c.to, ...(c.reason !== undefined ? { reason: c.reason } : {}) } : { ...c });
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

/** A status line's words: "moved this task", "approved this task", "completed this task (approved)". */
function moveText(kind: TimelineKind, newest: FeedEntry): string {
  if (newest.action === 'APPROVED') return 'approved this task';
  if (kind === 'completed' && newest.meta?.approved === true) return 'completed this task (approved)';
  return `${kind === 'moved' ? 'moved' : kind} this task`;
}

function toItem(kind: TimelineKind, entries: FeedEntry[]): TimelineItem | null {
  const item = lineOf(kind, entries);
  return item && viaMicoAi(entries[0]!) ? { ...item, text: `${item.text} via MICO AI` } : item;
}

function lineOf(kind: TimelineKind, entries: FeedEntry[]): TimelineItem | null {
  const newest = entries[0]!;
  const chronological = [...entries].reverse();
  const base = { id: newest.id, kind, actorName: newest.actorName, createdAt: newest.createdAt, count: entries.length };
  switch (kind) {
    case 'created':
      return { ...base, text: 'created this task' };
    case 'moved':
    case 'completed':
    case 'reopened':
      return { ...base, text: moveText(kind, newest), path: statusPath(chronological) };
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
    case 'checklist':
      return { ...base, ...checklistLine(entries, chronological) };
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
    case 'external': {
      // "added an external contact: Ahmed Al Said (OXY)"; a run names each person once.
      const verb = EXTERNAL_VERB[newest.action] ?? 'changed';
      const names = [...new Set(chronological.map(contactName).filter((n): n is string => Boolean(n)))];
      if (names.length <= 1) return { ...base, text: names[0] ? `${verb} an external contact: ${names[0]}` : `${verb} an external contact` };
      return { ...base, text: `${verb} ${names.length} external contacts: ${someOf(names)}` };
    }
    default:
      // A move to another project is a line of its own (never merged with status moves or edits).
      if (newest.action === 'PROJECT_CHANGED') return { ...base, text: projectMoveText(newest) };
      if (newest.action === 'PROJECT_MOVED_OUT') return { ...base, text: movedOutText(newest) };
      if (newest.action === 'PROJECT_COMPANIES_CHANGED') return { ...base, text: companiesChangedText(newest) };
      // 1.23.1 Merge tasks: on the main task, on each merged one, and an undo on both.
      if (newest.action === 'TASKS_MERGED') return { ...base, text: mergedText(newest) };
      if (newest.action === 'MERGED_INTO') return { ...base, text: `merged this task into ${str(newest.meta?.intoKey) ?? 'another task'}` };
      if (newest.action === 'MERGE_UNDONE') return { ...base, text: mergeUndoneText(newest) };
      // Inspections: one carried out for this task, or the one whose failed item this task follows up.
      if (newest.action === 'INSPECTION_ATTACHED') return { ...base, text: `attached ${inspectionName(newest)}` };
      if (newest.action === 'INSPECTION_FINISHED') return { ...base, text: inspectionFinishedText(newest) };
      if (newest.action === 'INSPECTION_FOLLOW_UP') return { ...base, text: followUpText(newest) };
      // Task approvals: asked for, sent back (with why), the request withdrawn.
      if (newest.action === 'APPROVAL_REQUESTED') return { ...base, text: 'finished this task and asked for approval', path: statusPath([newest]) };
      if (newest.action === 'SENT_BACK') {
        const reason = str(newest.meta?.reason);
        return { ...base, text: reason ? `sent this task back: ${quote(reason)}` : 'sent this task back', path: statusPath([newest]) };
      }
      if (newest.action === 'APPROVAL_WITHDRAWN') return { ...base, text: 'withdrew the approval request', path: statusPath([newest]) };
      // 1.23: a client's sign-off in the Client portal (their name ends "(client)" from the server).
      if (newest.action === 'CLIENT_ACCEPTED') return { ...base, text: 'accepted this task (client sign-off)' };
      if (newest.action === 'CLIENT_SENT_BACK') {
        const reason = str(newest.meta?.reason);
        return { ...base, text: reason ? `sent this task back: ${quote(reason)}` : 'sent this task back' };
      }
      return { ...base, text: OTHER_TEXT[newest.action] ?? (newest.action || '').toLowerCase().replace(/[._]/g, ' ') };
  }
}

/** A checklist line's words (and, for a delete that may be restored, its batch). */
function checklistLine(entries: FeedEntry[], chronological: FeedEntry[]): { text: string; batchId?: string } {
  const newest = entries[0]!;
  const n = entries.length;
  const m = newest.meta ?? {};
  const named = (e: FeedEntry) => quote(str(e.meta?.text) ?? 'a step');
  const steps = chronological.map(named);
  const it = named(newest);
  const withSubItems = (count: number | null) => (count !== null && count > 1 ? ` and its ${plural(count - 1, 'sub-item')}` : '');
  switch (newest.action) {
    case 'CHECKLIST_ADDED': {
      const list = str(m.listTitle);
      if (!list) return { text: n === 1 ? `added the step ${steps[0]}` : `added ${n} steps: ${someOf(steps)}` };
      // A batch names up to five; single adds name themselves.
      const texts = chronological.flatMap((e) => (num(e.meta?.count) !== null && Array.isArray(e.meta?.texts) ? (e.meta!.texts as unknown[]).map(str) : [str(e.meta?.text)])).filter((t): t is string => Boolean(t));
      const total = chronological.reduce((a, e) => a + (num(e.meta?.count) ?? 1), 0);
      const parent = n === 1 ? str(m.parentText) : null;
      const where = parent ? `under ${quote(parent)} in ${list}` : `to ${list}`;
      if (total === 1 && texts.length === 1) return { text: `added ${quote(texts[0]!)} ${where}` };
      return { text: `added ${total} items ${where}: ${someOfTotal(texts.map(quote), total)}` };
    }
    case 'CHECKLIST_DONE':
      return { text: n === 1 ? `ticked ${steps[0]}` : `ticked ${n} items: ${someOf(steps)}` };
    case 'CHECKLIST_REOPENED':
      return { text: n === 1 ? `unticked ${steps[0]}` : `unticked ${n} items: ${someOf(steps)}` };
    case 'CHECKLIST_REMOVED': {
      const batchId = str(m.batchId);
      if (batchId) return { text: `deleted ${it}${withSubItems(num(m.count))}`, batchId };
      return { text: n === 1 ? `removed the step ${steps[0]}` : `removed ${n} steps: ${someOf(steps)}` };
    }
    case 'CHECKLIST_RESTORED':
      return { text: `restored ${it}${withSubItems(num(m.count))}` };
    case 'CHECKLIST_REORDERED':
      return { text: 'reordered the checklist' };
    case 'CHECKLIST_ASSIGNED':
      return { text: str(m.assignee) ? `assigned ${it} to ${str(m.assignee)}` : `assigned ${it}` };
    case 'CHECKLIST_UNASSIGNED':
      return { text: str(m.assignee) ? `took ${str(m.assignee)} off ${it}` : `took the person off ${it}` };
    case 'CHECKLIST_DUE': {
      const from = str(m.from);
      const to = str(m.to);
      if (!from && to) return { text: `set ${it} due on ${dayText(to)}` };
      if (from && !to) return { text: `removed the due date of ${it}` };
      return { text: `moved the due date of ${it} from ${dayText(from)} to ${dayText(to)}` };
    }
    case 'CHECKLIST_MOVED':
      switch (str(m.how)) {
        case 'indent':
          return { text: `indented ${it}` };
        case 'outdent':
          return { text: `outdented ${it}` };
        case 'up':
          return { text: `moved ${it} up` };
        case 'down':
          return { text: `moved ${it} down` };
        default:
          return { text: `moved ${it}` };
      }
    case 'CHECKLIST_DUPLICATED':
      return { text: `duplicated ${it}${withSubItems(num(m.count))}` };
    case 'CHECKLIST_LIST_ADDED':
      return { text: `added the checklist ${quote(str(m.title) ?? 'Checklist')}` };
    case 'CHECKLIST_LIST_RENAMED':
      return { text: `renamed the checklist ${quote(str(m.from) ?? '')} to ${quote(str(m.to) ?? '')}` };
    case 'CHECKLIST_LIST_DUPLICATED': {
      const count = num(m.count);
      return { text: `duplicated the checklist ${quote(str(m.title) ?? 'Checklist')}${count ? ` (${plural(count, 'item')})` : ''}` };
    }
    case 'CHECKLIST_LIST_REMOVED': {
      const count = num(m.count);
      const batchId = str(m.batchId);
      return { text: `deleted the checklist ${quote(str(m.title) ?? 'Checklist')}${count ? ` (${plural(count, 'item')})` : ''}`, ...(batchId ? { batchId } : {}) };
    }
    default:
      return { text: listText(chronological.map((e) => `renamed the step ${quote(str(e.meta?.from) ?? '')} to ${quote(str(e.meta?.to) ?? '')}`)) };
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
    const close = oldest ? Math.abs(timeOf(oldest) - timeOf(entry)) <= windowOf(entry) : false;
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
