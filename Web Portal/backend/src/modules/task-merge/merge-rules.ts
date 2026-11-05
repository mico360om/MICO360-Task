/**
 * 1.23.1 Merge tasks — the rules, with no database: which fields differ and the choices for them,
 * what counts as a duplicate (kept once), how descriptions are combined, which blocker links move and
 * which are dropped, and how Undo decides each field of the main task. The store (prisma-merge-store)
 * and the service apply them; the website shows what they say.
 */
import { dayText } from '../activity/day-words';
import { dueDayKey } from '../../lib/due-date';
import { recurrenceSummary } from '../tasks/recurrence-summary';
import type { RecurrenceRule } from '../tasks/recurrence';

/** At most this many tasks in one merge (the main task included). */
export const MAX_MERGE_TASKS = 10;
/** At least this many. */
export const MIN_MERGE_TASKS = 2;
/** A TEXT column holds 65,535 bytes: the combined description must fit. */
export const DESCRIPTION_MAX_BYTES = 65_535;

/** The fields the person chooses between when the tasks differ (in the dialog's order). */
export const MERGE_FIELDS = ['title', 'project', 'status', 'priority', 'startDate', 'dueDate', 'milestone', 'clientVisible', 'repeat', 'inspectionForm', 'meeting', 'needsApproval'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** The words for each field in the dialog. */
export const FIELD_LABELS: Record<MergeField, string> = {
  title: 'Title',
  project: 'Project',
  status: 'Status',
  priority: 'Priority',
  startDate: 'Start date',
  dueDate: 'Due date',
  milestone: 'Milestone',
  clientVisible: 'Show to client',
  repeat: 'Repeat',
  inspectionForm: 'Inspection form',
  meeting: 'Linked meeting',
  needsApproval: 'Needs approval',
};

/** A task as the merge rules read it. */
export interface MergeTaskFacts {
  id: string;
  key: string;
  title: string;
  description: string | null;
  projectId: string;
  projectName: string;
  columnId: string;
  columnName: string;
  columnCategory: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  isMilestone: boolean;
  clientVisible: boolean;
  clientShowDescription: boolean;
  recurrenceRule: RecurrenceRule | null;
  inspectionFormId: string | null;
  inspectionFormTitle: string | null;
  meetingId: string | null;
  meetingTitle: string | null;
  needsApproval: boolean;
  createdAt: Date;
}

/** One choice for a field: take the value of this task (or `none`: no repeat). */
export interface MergeOption {
  /** The task whose value it is, or 'none' (the repeat only). */
  value: string;
  /** The value in words ("High", "3 Nov 2026", "No due date"). */
  label: string;
  /** The numbers of the tasks that have this value. */
  keys: string[];
}

/** A field the tasks differ in: one option per distinct value (the main task's first). */
export interface MergeDifference {
  field: MergeField;
  label: string;
  options: MergeOption[];
}

const PRIORITY_WORDS: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const STATUS_WORDS: Record<string, string> = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', REVIEW: 'Review', DONE: 'Done' };

/** A day ("3 Nov 2026") in the company's time zone, or the words for none. */
function dayWords(d: Date | null, timeZone: string, none: string): string {
  const key = dueDayKey(d, timeZone);
  return key ? dayText(key) : none;
}

/** What a field's value is for one task: a key to compare by and its words. */
export function fieldValue(task: MergeTaskFacts, field: MergeField, timeZone: string): { key: string; label: string } {
  switch (field) {
    case 'title':
      return { key: task.title.trim(), label: task.title.trim() };
    case 'project':
      return { key: task.projectId, label: task.projectName };
    case 'status': {
      // The kind of column (completion follows it); its kind in words too when the column is named otherwise.
      const kind = STATUS_WORDS[task.columnCategory];
      const named = kind && kind.toLowerCase() !== task.columnName.trim().toLowerCase() ? ` (${kind})` : '';
      return { key: `${task.columnCategory}|${task.columnName}`, label: `${task.columnName}${named}` };
    }
    case 'priority':
      return { key: task.priority, label: PRIORITY_WORDS[task.priority] ?? task.priority };
    case 'startDate': {
      const key = dueDayKey(task.startDate, timeZone) ?? '';
      return { key, label: dayWords(task.startDate, timeZone, 'No start date') };
    }
    case 'dueDate': {
      const key = dueDayKey(task.dueDate, timeZone) ?? '';
      return { key, label: dayWords(task.dueDate, timeZone, 'No due date') };
    }
    case 'milestone':
      return { key: String(task.isMilestone), label: task.isMilestone ? 'A milestone' : 'Not a milestone' };
    case 'clientVisible':
      return task.clientVisible
        ? { key: `true|${task.clientShowDescription}`, label: task.clientShowDescription ? 'Shown to client, with its description' : 'Shown to client' }
        : { key: 'false', label: 'Not shown to client' };
    case 'repeat':
      return task.recurrenceRule ? { key: JSON.stringify(sortedRule(task.recurrenceRule)), label: recurrenceSummary(task.recurrenceRule) } : { key: '', label: 'Doesn’t repeat' };
    case 'inspectionForm':
      return { key: task.inspectionFormId ?? '', label: task.inspectionFormId ? (task.inspectionFormTitle ?? 'An inspection form') : 'No inspection form' };
    case 'meeting':
      return { key: task.meetingId ?? '', label: task.meetingId ? (task.meetingTitle ?? 'A meeting') : 'No linked meeting' };
    case 'needsApproval':
      return { key: String(task.needsApproval), label: task.needsApproval ? 'Needs approval' : 'Doesn’t need approval' };
  }
}

/** A rule with its keys in one order, so two equal rules compare equal. */
function sortedRule(rule: RecurrenceRule): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rule as unknown as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null).sort(([a], [b]) => a.localeCompare(b)));
}

/** The main task first, then the others in the order given. */
export function mainFirst<T extends { id: string }>(tasks: T[], mainId: string): T[] {
  const main = tasks.find((t) => t.id === mainId);
  return main ? [main, ...tasks.filter((t) => t.id !== mainId)] : tasks;
}

/** The fields the tasks differ in, each with one option per distinct value — the main task's first. */
export function differences(tasks: MergeTaskFacts[], mainId: string, timeZone: string): MergeDifference[] {
  const ordered = mainFirst(tasks, mainId);
  const out: MergeDifference[] = [];
  for (const field of MERGE_FIELDS) {
    const options = new Map<string, MergeOption>();
    for (const t of ordered) {
      const v = fieldValue(t, field, timeZone);
      const seen = options.get(v.key);
      if (seen) seen.keys.push(t.key);
      else options.set(v.key, { value: t.id, label: v.label, keys: [t.key] });
    }
    if (options.size < 2) continue;
    const list = [...options.values()];
    // The repeat may also be none at all ("Doesn't repeat"), even when every task repeats.
    if (field === 'repeat' && !list.some((o) => fieldValue(tasks.find((t) => t.id === o.value)!, 'repeat', timeZone).key === '')) {
      list.push({ value: 'none', label: 'Doesn’t repeat', keys: [] });
    }
    out.push({ field, label: FIELD_LABELS[field], options: list });
  }
  return out;
}

export type MergeChoices = Partial<Record<MergeField, string>>;

/**
 * Each field's source: the task chosen for it (or 'none' for the repeat), the main task where nothing
 * was chosen. A choice of a task that isn't in the merge is refused (the caller's 400).
 */
export function resolveChoices(tasks: MergeTaskFacts[], mainId: string, choices: MergeChoices = {}): { ok: true; sources: Record<MergeField, string> } | { ok: false; field: MergeField } {
  const ids = new Set(tasks.map((t) => t.id));
  const sources = {} as Record<MergeField, string>;
  for (const field of MERGE_FIELDS) {
    const chosen = choices[field];
    if (chosen === undefined || chosen === '') sources[field] = mainId;
    else if (chosen === 'none' && field === 'repeat') sources[field] = 'none';
    else if (ids.has(chosen)) sources[field] = chosen;
    else return { ok: false, field };
  }
  return { ok: true, sources };
}

/** The default main task: the oldest (created first), then the first chosen. */
export function defaultMainId(tasks: Pick<MergeTaskFacts, 'id' | 'createdAt'>[]): string | null {
  if (tasks.length === 0) return null;
  return [...tasks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!.id;
}

// ---- Descriptions -----------------------------------------------------------------------------

/** The plain heading line before each merged task's part ("— From MICO-14 · Inspect the rig —"). */
export function descriptionHeading(key: string, title: string): string {
  return `— From ${key} · ${title.trim()} —`;
}

/** One merged task's part of the combined description: its heading line, then its own text. */
export function descriptionPart(key: string, title: string, description: string): string {
  return `${descriptionHeading(key, title)}\n${description.trim()}`;
}

/**
 * The main task's description first, then each other task's under its heading; empty ones skipped.
 * Returns the parts added too (Undo takes them out again).
 */
export function combineDescriptions(main: Pick<MergeTaskFacts, 'description'>, others: Pick<MergeTaskFacts, 'key' | 'title' | 'description'>[]): { text: string | null; parts: string[] } {
  const parts = others.filter((t) => t.description && t.description.trim()).map((t) => descriptionPart(t.key, t.title, t.description!));
  if (parts.length === 0) return { text: main.description, parts: [] };
  const head = main.description && main.description.trim() ? main.description.replace(/\s+$/, '') : '';
  return { text: [head, ...parts].filter(Boolean).join('\n\n'), parts };
}

/**
 * Undo's description for the main task: back to what it was when nobody changed it since the merge;
 * otherwise each merged part still there word for word is taken out (with the blank line before it),
 * and anything else written since stays.
 */
export function undoDescription(current: string | null, merged: string | null, before: string | null, parts: string[]): string | null {
  if (current === merged) return before;
  if (current === null) return null;
  let text = current;
  for (const part of parts) {
    const withGap = `\n\n${part}`;
    if (text.includes(withGap)) text = text.replace(withGap, '');
    else if (text.startsWith(part)) text = text.slice(part.length).replace(/^\s+/, '');
  }
  const trimmed = text.replace(/\s+$/, '');
  return trimmed === '' ? (before === null ? null : '') : trimmed;
}

/** Bytes of a text in UTF-8 (what a TEXT column counts). */
export const utf8Bytes = (s: string | null) => (s ? Buffer.byteLength(s, 'utf8') : 0);

// ---- Duplicates -------------------------------------------------------------------------------

/** Text as compared for duplicates: trimmed, spaces folded, letter case ignored. */
export const sameText = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

/** A checklist item's duplicate key: the same text and the same state (ticked or not). */
export const checklistKey = (item: { text: string; done: boolean }) => `${sameText(item.text)}\u0000${item.done ? 1 : 0}`;

/** Digits only ("+968 9123-4567" → "96891234567"). */
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** A name's first word, as compared ("Ahmed" in "Ahmed Al Said"). */
const firstName = (name: string | null | undefined) => sameText(name).split(' ')[0] ?? '';

/**
 * The same person: the same first name, and the same email (letter case aside) or the same phone number
 * — digits only, the shorter at least 8 digits and the end of the longer (a country code written on one
 * copy only). Two people sharing a mailbox or a switchboard are two contacts: both are kept.
 */
export function sameContact(a: { name?: string | null; email: string | null; phone: string | null }, b: { name?: string | null; email: string | null; phone: string | null }): boolean {
  if (firstName(a.name) !== firstName(b.name)) return false;
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return true;
  const pa = digits(a.phone);
  const pb = digits(b.phone);
  if (pa.length < 8 || pb.length < 8) return false;
  return pa === pb || (pa.length > pb.length ? pa.endsWith(pb) : pb.endsWith(pa));
}

export const CONTACT_FIELDS = ['name', 'company', 'designation', 'email', 'phone', 'remarks'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type ContactValues = Record<ContactField, string | null>;

/** The fields a kept contact is missing that the other copy has: they are filled in from it. */
export function contactFill(kept: ContactValues, other: ContactValues): Partial<ContactValues> {
  const fill: Partial<ContactValues> = {};
  for (const f of CONTACT_FIELDS) {
    if ((kept[f] === null || kept[f]!.trim() === '') && other[f] && other[f]!.trim() !== '') fill[f] = other[f];
  }
  return fill;
}

/** A file's duplicate key before its content is compared: the same name (letter case aside) and size. */
export const fileKey = (f: { filename: string; sizeBytes: number }) => `${f.filename.trim().toLowerCase()}\u0000${f.sizeBytes}`;

// ---- Blocker links ----------------------------------------------------------------------------

/** A blocker link: `taskId` is blocked by `dependsOnTaskId`. */
export interface DependencyEdge {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
}

export interface DependencyPlan {
  /** Links moved to the main task: the merged task's end becomes the main task. */
  move: { edge: DependencyEdge; side: 'blocked' | 'blocking'; fromTaskId: string }[];
  /** Links kept on their own task: between the merged tasks themselves, the same link twice, or one that would make a loop. */
  dropped: { edge: DependencyEdge; reason: 'between' | 'duplicate' | 'loop'; fromTaskId: string }[];
}

/**
 * Which blocker links of the merged tasks move to the main task. A link between two of the tasks being
 * merged is dropped (it would join the main task to itself); one the main task already has is kept
 * once; one that would make the main task (indirectly) block itself is dropped and named. `edges` are
 * every live link that touches the tasks, and `graph` the live links around them (to find loops).
 */
export function dependencyPlan(edges: DependencyEdge[], mainId: string, mergedIds: string[], graph: DependencyEdge[] = edges): DependencyPlan {
  const merging = new Set([mainId, ...mergedIds]);
  const as = (id: string) => (merging.has(id) ? mainId : id);
  // Links as they will be: every end in the merge becomes the main task.
  const links = new Map<string, Set<string>>(); // blocked → its blockers
  const add = (blocked: string, blocker: string) => {
    let s = links.get(blocked);
    if (!s) links.set(blocked, (s = new Set()));
    s.add(blocker);
  };
  const has = (blocked: string, blocker: string) => links.get(blocked)?.has(blocker) ?? false;
  for (const e of graph) {
    const from = merging.has(e.taskId) && e.taskId !== mainId ? null : e.taskId;
    const to = merging.has(e.dependsOnTaskId) && e.dependsOnTaskId !== mainId ? null : e.dependsOnTaskId;
    if (from && to) add(from, to); // links that stay as they are (the main task's own, and others')
  }
  /** Is `target` reachable from `start` along blocked → blocker? */
  const reaches = (start: string, target: string) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === target) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of links.get(n) ?? []) stack.push(m);
    }
    return false;
  };
  const plan: DependencyPlan = { move: [], dropped: [] };
  const merged = new Set(mergedIds);
  for (const e of edges) {
    const blockedMerged = merged.has(e.taskId);
    const blockingMerged = merged.has(e.dependsOnTaskId);
    if (!blockedMerged && !blockingMerged) continue; // the main task's own (or nobody's here)
    const fromTaskId = blockedMerged ? e.taskId : e.dependsOnTaskId;
    const blocked = as(e.taskId);
    const blocker = as(e.dependsOnTaskId);
    if (blocked === blocker) {
      plan.dropped.push({ edge: e, reason: 'between', fromTaskId });
      continue;
    }
    if (has(blocked, blocker)) {
      plan.dropped.push({ edge: e, reason: 'duplicate', fromTaskId });
      continue;
    }
    // blocked ← blocker: a loop when the blocker is already (indirectly) blocked by `blocked`.
    if (reaches(blocker, blocked)) {
      plan.dropped.push({ edge: e, reason: 'loop', fromTaskId });
      continue;
    }
    add(blocked, blocker);
    plan.move.push({ edge: e, side: blockedMerged ? 'blocked' : 'blocking', fromTaskId });
  }
  return plan;
}

// ---- Undo -------------------------------------------------------------------------------------

/** A field the merge changed on the main task: what it was before and what the merge made it. */
export interface FieldChange {
  before: unknown;
  after: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Undo, for one field the merge changed on the main task (call 2): back to its value before the merge
 * when nobody has changed it since; otherwise it keeps what it has now.
 */
export function undoValue(change: FieldChange, current: unknown): { restore: boolean; value: unknown } {
  return same(current, change.after) ? { restore: true, value: change.before } : { restore: false, value: current };
}

/** "A", "A and B", "A, B and C". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "1 file", "2 checklist items". */
export function countWords(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Merged MICO-14 and MICO-15 into MICO-12". */
export function mergedText(mergedKeys: string[], mainKey: string): string {
  return `Merged ${listWords(mergedKeys)} into ${mainKey}`;
}

/** The watchers' notice: "MICO-14 and MICO-15 were merged into MICO-12". */
export function mergedNoticeTitle(mergedKeys: string[], mainKey: string): string {
  return `${listWords(mergedKeys)} ${mergedKeys.length === 1 ? 'was' : 'were'} merged into ${mainKey}`;
}
