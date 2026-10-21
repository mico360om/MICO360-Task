/**
 * "Describe it in plain English" in the New task form (4a), as on the website
 * (Web Portal/frontend/src/components/task-form/DescribeTask.tsx; task-describe.test.ts checks the
 * rules and words against it): the assistant reads a sentence and suggests a title, a description,
 * a due date, a priority, a repeat and the project. Nothing changes until you choose: a suggestion
 * that would replace something you set yourself starts unticked — what the form filled in itself
 * (the day it was opened on, the project it settled on) isn't yours. A project is offered only when
 * the task's project can still be chosen, and only one of yours. Pure, so it is tested here.
 */
import { ApiError } from './api-client';
import { fullDayLabel } from './calendar';
import { PRIORITY_LABEL } from './calendar-model';
import { aiFailureText } from './task-detail';
import type { Priority, RecurrenceRule } from './types';

/** The task details a description can fill in ('' / null for none). */
export interface DescribedFields {
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  rule: RecurrenceRule | null;
  projectId: string;
}

/** What POST /ai/parse-task answers (read carefully: readTaskDraft). */
export interface AiTaskDraft {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority | null;
  recurrence: RecurrenceRule | null;
  /** One of the person's projects; the server never suggests one outside their list. */
  project: { id: string; code: string; number: string | null; name: string } | null;
}

/** A project the task can go to, as a suggestion shows it. */
export interface DescribeProject {
  id: string;
  name: string;
  code: string;
  number?: string | null;
}

type Key = keyof DescribedFields;

export interface TaskSuggestion {
  key: Key;
  label: string;
  /** How the suggested value reads. */
  shown: string;
  value: DescribedFields[Key];
  /** What it would replace, when something is there already. */
  replaces: string | null;
  checked: boolean;
}

/** The website's words (the test checks each is in its DescribeTask). */
export const DESCRIBE_TEXT = {
  heading: 'Describe it in plain English',
  placeholder: 'e.g. “Send the RIG1 site report to Omar every Monday, with the inspection photos”',
  read: 'Fill task details',
  reading: 'Reading…',
  found: 'Found in your description',
  nothingNew: 'Nothing new to fill in from that description.',
  use: 'Use selected details',
  dismiss: 'Dismiss',
  failed: 'Couldn’t read that description. Try rephrasing it, or fill in the details yourself.',
} as const;

export function describeHint(withProject: boolean): string {
  return `The assistant suggests a title, description, due date, repeat, priority${withProject ? ' and project' : ''} — you choose what to use.`;
}

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** A repeat the form can take, or null: the frequency known, every N at least 1, its parts in range. */
function readRule(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.freq !== 'string' || !FREQS.includes(r.freq)) return null;
  const rule: RecurrenceRule = { freq: r.freq as RecurrenceRule['freq'], interval: int(r.interval, 1, 999) ?? 1 };
  const weekdays = Array.isArray(r.weekdays) ? [...new Set(r.weekdays.filter((d): d is number => int(d, 0, 6) !== null))].sort((a, b) => a - b) : [];
  if (rule.freq === 'WEEKLY' && weekdays.length) rule.weekdays = weekdays;
  const dayOfMonth = int(r.dayOfMonth, 1, 31);
  if ((rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') && dayOfMonth) rule.dayOfMonth = dayOfMonth;
  const until = str(r.until);
  if (until && DAY.test(until.slice(0, 10))) rule.until = until.slice(0, 10);
  const count = int(r.count, 1, 1000);
  if (count) rule.count = count;
  return rule;
}

/** The server's answer as the form can use it: anything odd is left out (never a crash). */
export function readTaskDraft(raw: unknown): AiTaskDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = r.project && typeof r.project === 'object' ? (r.project as Record<string, unknown>) : null;
  const dueDate = str(r.dueDate);
  return {
    title: (str(r.title) ?? '').trim().slice(0, 191),
    description: str(r.description)?.trim() || null,
    dueDate: dueDate && DAY.test(dueDate) ? dueDate : null,
    priority: PRIORITIES.includes(r.priority as Priority) ? (r.priority as Priority) : null,
    recurrence: readRule(r.recurrence),
    project: p && typeof p.id === 'string' && p.id ? { id: p.id, code: str(p.code) ?? '', number: str(p.number), name: str(p.name) ?? '' } : null,
  };
}

const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const projectText = (p: DescribeProject) => [p.name, p.code, p.number].filter(Boolean).join(' · ');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What the sentence fills in, weighed against the form now (`current`) and as it opened (`initial`). */
export function taskSuggestions(
  draft: AiTaskDraft,
  o: {
    current: DescribedFields;
    initial: DescribedFields;
    /** The projects the task may go to; omitted when its project is fixed (a board). */
    projects?: readonly DescribeProject[];
    /** The project was picked by hand (even the one the form started with): it is yours. */
    projectChosen: boolean;
    /** How a repeat reads ("Repeats every week on Mon"), given the due date it would start from. */
    repeatText: (rule: RecurrenceRule, dueDate: string) => string;
  },
): TaskSuggestion[] {
  const { current, initial, projects } = o;
  const out: TaskSuggestion[] = [];
  const title = draft.title.trim().slice(0, 191);
  if (title && title !== current.title.trim()) {
    const mine = current.title.trim() !== '';
    out.push({ key: 'title', label: 'Title', shown: title, value: title, replaces: mine ? `“${current.title.trim()}”` : null, checked: !mine });
  }
  const description = draft.description?.trim();
  if (description && description !== current.description.trim()) {
    const mine = current.description.trim() !== '' && current.description !== initial.description;
    out.push({ key: 'description', label: 'Description', shown: clip(description, 200), value: description, replaces: current.description.trim() ? `“${clip(current.description.trim(), 60)}”` : null, checked: !mine });
  }
  if (draft.dueDate && draft.dueDate !== current.dueDate) {
    const mine = current.dueDate !== '' && current.dueDate !== initial.dueDate;
    out.push({ key: 'dueDate', label: 'Due date', shown: fullDayLabel(draft.dueDate), value: draft.dueDate, replaces: current.dueDate ? fullDayLabel(current.dueDate) : null, checked: !mine });
  }
  if (draft.recurrence && !sameRule(draft.recurrence, current.rule)) {
    const startsOn = draft.dueDate ?? current.dueDate;
    const mine = current.rule !== null && !sameRule(current.rule, initial.rule);
    out.push({ key: 'rule', label: 'Repeat', shown: o.repeatText(draft.recurrence, startsOn), value: draft.recurrence, replaces: current.rule ? o.repeatText(current.rule, current.dueDate) : null, checked: !mine });
  }
  if (draft.priority && draft.priority !== current.priority) {
    const mine = current.priority !== initial.priority;
    out.push({ key: 'priority', label: 'Priority', shown: PRIORITY_LABEL[draft.priority], value: draft.priority, replaces: PRIORITY_LABEL[current.priority], checked: !mine });
  }
  const project = draft.project ? projects?.find((p) => p.id === draft.project!.id) : undefined;
  if (project && project.id !== current.projectId) {
    const mine = o.projectChosen || (current.projectId !== '' && current.projectId !== initial.projectId);
    const now = projects?.find((p) => p.id === current.projectId);
    out.push({ key: 'projectId', label: 'Project', shown: projectText({ ...project, number: project.number ?? draft.project!.number }), value: project.id, replaces: now ? now.name : null, checked: !mine });
  }
  return out;
}

/** "Use selected details": the ticked suggestions only. */
export function chosenTaskPatch(found: readonly TaskSuggestion[]): Partial<DescribedFields> {
  const patch: Partial<DescribedFields> = {};
  for (const s of found) if (s.checked) (patch as Record<Key, unknown>)[s.key] = s.value;
  return patch;
}

/** Why the sentence couldn't be read: the AI being slow (130 s), offline, the server's own reason, or the website's words. */
export function describeFailure(e: unknown): string {
  if (e instanceof ApiError && (!e.message || /^Request failed/.test(e.message))) return DESCRIBE_TEXT.failed;
  return aiFailureText(e, DESCRIBE_TEXT.failed);
}
