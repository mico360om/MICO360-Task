import { z } from 'zod';
import { shiftDayKey, todayKey, zonedDayKey } from '../../lib/due-date';
import { normalizeForSearch } from '../search/text-normalize';
import { normalizeFinalMinutes, type FinalMinutesContent } from '../meetings/final-minutes';
import type { FinalMinutesRecord } from '../meetings/final-minutes-repository';
import { AiCallStoppedError } from '../ai/ai-network';
import { dayLabel, isCalendarDay, parseClock, resolveDay, zonedInstant } from './mico-ai-dates';
import { fullName, matchPerson, matchProject, personOption, projectOption, type Match } from './mico-ai-resolve';
import type { AiMeetingRec, AiPersonRec, AiProjectRec, AiTaskRec, MicoAiDataPort, Viewer } from './mico-ai-data';
import {
  CHANGE_TYPES,
  MAX_CHANGES,
  MAX_MINUTES_DRAFTS,
  PRIORITIES,
  type ChangeType,
  type CreateTaskFields,
  type CreateTaskItem,
  type ItemChoice,
  type ItemNeed,
  type ItemResult,
  type ItemUndo,
  type MeetingFields,
  type MeetingItem,
  type MinutesItem,
  type Named,
  type Priority,
  type ProposalItem,
  type ProposeOutcome,
  type TaskChangeFields,
  type TaskTouch,
  type UndoData,
  type UpdateTaskItem,
} from './mico-ai-actions-types';

/**
 * MICO AI's actions: what makes a "propose" reply into a card, and a confirmed card into changes.
 *
 * - prepare: each proposed change is read with its own schema; its names, projects, tasks and
 *   meetings are resolved with the person's own access (several matches ask which one; no match goes
 *   back to the model once); the same task (or meeting's minutes) asked for twice becomes one change;
 *   its days are worked out in company time; and the checks the app makes are made now. Whatever
 *   couldn't be read or was refused is a need on its field: the change can't go ahead until the
 *   person edits that field. At most 3 sets of minutes are drafted, side by side, and Stop ends them.
 * - carryOut: the confirmed card (with the person's edits) is checked again, change by change —
 *   permissions, people, dates, and whether a task or the minutes changed since — and each change is
 *   made through the app's own services as the person (`port`), its history marked "via MICO AI" and
 *   an audit entry written. A change is recorded as done the moment its main write lands (what follows
 *   — notices, invitations — can only add a warning). One refused or failed change never stops the others.
 * - revert: Undo, newest first: each change is put back only if nobody changed it since.
 */

/** A task as MICO AI's changes read it. */
export interface ActionTaskState {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  columnId: string;
  columnName: string;
  category: string;
  priority: Priority;
  due: string | null;
  assigneeIds: string[];
  version: number;
  /** How many history lines it has: anything anyone does to it adds one. */
  activity: number;
  tags: number;
  watchers: number;
  /** Blockers, both ways. */
  links: number;
  createdById: string;
  /** The next copy a repeating task made of itself (its key), when there is one. */
  nextCopyKey: string | null;
}

export interface ActionColumn {
  id: string;
  name: string;
  category: string;
  position: number;
  enabled: boolean;
}

/** A meeting's state for Undo: `stamp` changes whenever the meeting, its people, agenda, notes, action items or decisions do. */
export interface ActionMeetingStamp {
  id: string;
  title: string;
  startAt: Date;
  status: string;
  invitesSentAt: Date | null;
  stamp: string;
}

type FinalMinutesWrite = Omit<FinalMinutesRecord, 'savedAt'>;

/**
 * The app's own services, used as the person. Each write checks again that the person may make it,
 * as the app's own route does, and sends the usual notifications and live updates. There is no plain
 * delete: Undo may only take back a task its own card created, untouched (one guarded write).
 */
export interface MicoAiWritePort {
  taskState(taskId: string): Promise<ActionTaskState | null>;
  /** Who wrote the task's history lines after the first `after`, newest first (`via`: through MICO AI). */
  changedBy(taskId: string, after: number): Promise<Array<{ userId: string; name: string; via: boolean }>>;
  columns(projectId: string): Promise<ActionColumn[]>;
  /** Of these people, those who may be assigned in the project (its active members). */
  eligibleAssignees(projectId: string, userIds: string[]): Promise<string[]>;
  projectOwner(projectId: string): Promise<string | null>;
  canViewTask(viewer: Viewer, taskId: string): Promise<boolean>;
  canUseProject(viewer: Viewer, projectId: string): Promise<boolean>;
  canEditMeeting(viewer: Viewer, meetingId: string): Promise<boolean>;
  meetingStamp(meetingId: string): Promise<ActionMeetingStamp | null>;
  minutes(meetingId: string): Promise<FinalMinutesRecord | null>;
  /** The company's working days (0 = Sunday), for "next week". */
  workingDays(): Promise<number[]>;
  /** A first draft of a meeting's final minutes from its notes, agenda and action items (the AI); `signal` stops it. */
  draftMinutes(viewer: Viewer, meetingId: string, signal?: AbortSignal): Promise<FinalMinutesContent>;
  /** The task with its people, in one write (its history line too). Nothing else. */
  createTask(viewer: Viewer, input: { projectId: string; columnId: string; title: string; description: string; priority: Priority; due: string | null; assigneeIds: string[] }): Promise<ActionTaskState>;
  /** What follows a new task: the people assigned are told, and open boards show it. */
  announceTask(viewer: Viewer, taskId: string, assigneeIds: string[]): Promise<void>;
  /** Saved only if the task is still at `expectedVersion`; `warning`: saved, but a step after it failed. */
  updateTask(viewer: Viewer, taskId: string, change: Omit<TaskChangeFields, 'assigneeIds'>, expectedVersion: number): Promise<{ state: ActionTaskState; warning: string | null }>;
  setAssignees(viewer: Viewer, taskId: string, add: string[], remove: string[]): Promise<void>;
  /** Undo of a new task: removed only by its creator, and only while it is exactly `touch` (one guarded write); false otherwise. */
  deleteCreatedTask(viewer: Viewer, taskId: string, touch: TaskTouch): Promise<boolean>;
  createMeeting(
    viewer: Viewer,
    input: { title: string; projectId: string | null; startAt: Date; endAt: Date; description: string; attendeeIds: string[]; agenda: string[] },
  ): Promise<ActionMeetingStamp>;
  sendInvites(viewer: Viewer, meetingId: string): Promise<{ sent: number; failed: number }>;
  /** Undo a new meeting: cancelled (and the people invited told) once invitations went out, else deleted. */
  removeMeeting(viewer: Viewer, meetingId: string, invited: boolean): Promise<'cancelled' | 'deleted'>;
  saveMinutes(viewer: Viewer, meetingId: string, minutes: FinalMinutesWrite): Promise<FinalMinutesRecord>;
  clearMinutes(viewer: Viewer, meetingId: string): Promise<void>;
  audit(entry: { userId: string; ip: string | null; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown }): Promise<void>;
  /** Runs `fn` with every history line it writes marked "via MICO AI". */
  asMicoAi<T>(fn: () => Promise<T>): Promise<T>;
}

export interface MicoAiActionsDeps {
  data: MicoAiDataPort;
  port: MicoAiWritePort;
  timeZone: string;
  now?: () => Date;
  maxChanges?: number;
}

export interface CarryOutOptions {
  /** Which changes the person ticked. */
  include: Record<string, boolean>;
  /** The card's "Email the invitations" tick box. */
  sendInvites: boolean;
  ip: string | null;
  /** Each change's result as soon as it is known (all so far). */
  onResult?: (results: Record<string, ItemResult>) => Promise<void>;
}

const VIA = 'MICO AI';
const FAILED = 'Something went wrong while making this change. Nothing else was affected.';
const UNDO_FAILED = 'Something went wrong while putting this back.';
const NOTHING = 'Nothing to change: it’s already like this.';
const MINUTES_EDITORS = 'Only the organizer, the project manager or an admin can write the final minutes.';
const MINUTES_FINAL = 'These minutes are final. Reopen them on the meeting page to change them.';
const BAD_EDIT = 'That edit couldn’t be used. Check the values.';
const TITLE_MAX = 190;
const TEXT_MAX = 4000;
const AGENDA_MAX = 20;

// ── The model's changes, read leniently (the checks below decide what is usable) ──
const said = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string().max(4000)).transform((s) => s.trim());
const nameList = z
  .preprocess((v) => (typeof v === 'string' ? (v.trim() ? [v] : []) : v), z.array(z.unknown()).max(100))
  .transform((xs) => xs.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean));
const RAW = {
  create_task: z.object({ title: said.default(''), project: said.optional(), assignees: nameList.optional(), due: said.nullable().optional(), priority: said.optional(), description: said.optional() }),
  update_task: z.object({
    task: said,
    due: said.nullable().optional(),
    shiftDays: z.coerce.number().int().min(-3650).max(3650).optional(),
    priority: said.optional(),
    status: said.optional(),
    assignees: nameList.optional(),
    addAssignees: nameList.optional(),
    removeAssignees: nameList.optional(),
  }),
  draft_minutes: z.object({ meeting: said }),
  schedule_meeting: z.object({
    title: said.default(''),
    date: said.optional(),
    time: said.optional(),
    start: said.optional(),
    minutes: z.coerce.number().int().optional(),
    people: nameList.optional(),
    project: said.optional(),
    agenda: nameList.optional(),
    description: said.optional(),
  }),
} as const;
type CreateRaw = z.infer<typeof RAW.create_task>;
type UpdateRaw = z.infer<typeof RAW.update_task>;
type MeetingRaw = z.infer<typeof RAW.schedule_meeting>;

// ── The person's edits on the card: ids and values only, each field checked again on Confirm ──
const id = z.string().min(1).max(191);
const dayEdit = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const priorityEdit = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const EDITS = {
  create_task: z
    .object({ title: z.string().max(400), projectId: id, assigneeIds: z.array(id).max(50), due: dayEdit.nullable(), priority: priorityEdit, description: z.string().max(TEXT_MAX) })
    .partial(),
  update_task: z.object({ due: dayEdit.nullable(), priority: priorityEdit, columnId: id, assigneeIds: z.array(id).max(50) }).partial(),
  draft_minutes: z.object({ content: z.unknown() }).partial(),
  schedule_meeting: z
    .object({
      title: z.string().max(400),
      projectId: id.nullable(),
      date: dayEdit,
      time: z.string().regex(/^\d{2}:\d{2}$/),
      minutes: z.number().int().min(5).max(720),
      attendeeIds: z.array(id).max(100),
      agenda: z.array(z.string().max(300)).max(AGENDA_MAX),
      description: z.string().max(TEXT_MAX),
    })
    .partial(),
} as const;

const PRIORITY_WORDS: Record<string, Priority> = { low: 'LOW', normal: 'NORMAL', medium: 'NORMAL', high: 'HIGH', urgent: 'URGENT', critical: 'URGENT' };
const STATUS_WORDS: Record<string, string> = {
  todo: 'TODO', 'to do': 'TODO', open: 'TODO', 'not started': 'TODO',
  in_progress: 'IN_PROGRESS', 'in progress': 'IN_PROGRESS', doing: 'IN_PROGRESS', started: 'IN_PROGRESS', progress: 'IN_PROGRESS',
  review: 'REVIEW', 'in review': 'REVIEW',
  blocked: 'BLOCKED', waiting: 'BLOCKED', 'on hold': 'BLOCKED',
  done: 'DONE', complete: 'DONE', completed: 'DONE', finished: 'DONE', closed: 'DONE',
  backlog: 'BACKLOG',
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const need = (fields: string[], message: string): ItemNeed => ({ fields, message });
const problemOf = (needs: ItemNeed[]) => needs.map((n) => n.message).join(' ') || null;
const joinWarnings = (ws: Array<string | null | undefined>) => ws.filter(Boolean).join(' ') || null;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "a", "a and b", "a, b and c". */
const listText = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const touchOf = (t: ActionTaskState): TaskTouch => ({ version: t.version, activity: t.activity, tags: t.tags, watchers: t.watchers, links: t.links, assigneeIds: [...t.assigneeIds] });
const sameTouch = (t: ActionTaskState, w: TaskTouch) =>
  t.version === w.version && t.activity === w.activity && t.tags === w.tags && t.watchers === w.watchers && t.links === w.links && sameSet(t.assigneeIds, w.assigneeIds);

/** A failure in words the person may see: the app's own refusals as they are, anything else plain. */
function plain(err: unknown, fallback: string): string {
  const e = err as { status?: unknown; message?: unknown };
  return typeof e?.status === 'number' && e.status < 500 && typeof e.message === 'string' && e.message ? e.message : fallback;
}
const isConflict = (err: unknown) => (err as { status?: unknown })?.status === 409 || (err as { code?: unknown })?.code === 'VERSION_CONFLICT';

interface Scope {
  viewer: Viewer;
  projectIds: string[] | null;
  projects: AiProjectRec[];
  people: AiPersonRec[];
  person: Map<string, AiPersonRec>;
  allowed: (projectId: string | null | undefined) => boolean;
}

/** What resolving the changes' names found: a question to ask, and names nothing matched (for the model). */
interface Gathered {
  ask: { question: string; options: string[] } | null;
  missing: string[];
}

/** One change after its target was found (the same task or meeting twice is merged into one). */
type Spec =
  | { type: 'create_task'; raw: CreateRaw }
  | { type: 'update_task'; raw: UpdateRaw; task: AiTaskRec }
  | { type: 'draft_minutes'; meeting: AiMeetingRec }
  | { type: 'schedule_meeting'; raw: MeetingRaw };

export function createMicoAiActions({ data, port, timeZone, now = () => new Date(), maxChanges = MAX_CHANGES }: MicoAiActionsDeps) {
  async function scopeOf(viewer: Viewer): Promise<Scope> {
    const projectIds = await data.accessibleProjectIds(viewer);
    const [projects, people] = await Promise.all([data.projects(projectIds), data.people()]);
    const allowed = (projectId: string | null | undefined) => !!projectId && (projectIds === null || projectIds.includes(projectId));
    return { viewer, projectIds, projects: projects.filter((p) => allowed(p.id)), people, person: new Map(people.map((p) => [p.id, p])), allowed };
  }
  const named = (s: Scope, ids: string[]): Named[] => ids.map((uid) => ({ id: uid, name: s.person.has(uid) ? fullName(s.person.get(uid)!) : 'Someone' }));
  const nameOf = (s: Scope, uid: string) => named(s, [uid])[0]!.name;
  const projectName = (s: Scope, pid: string | null) => s.projects.find((p) => p.id === pid)?.name ?? null;

  // ── Resolving names: one record, or ask which, or tell the model ──
  function person(s: Scope, g: Gathered, said: string): AiPersonRec | null {
    const m = matchPerson(s.people, said, s.viewer.userId);
    if ('found' in m) return m.found;
    if ('several' in m) g.ask ??= { question: `Which ${clip(said, 40)} do you mean?`, options: m.several.map(personOption).sort((a, b) => a.localeCompare(b)).slice(0, 4) };
    else g.missing.push(`No one matches “${clip(said, 60)}”.`);
    return null;
  }
  function project(s: Scope, g: Gathered, said: string): AiProjectRec | null {
    const m = matchProject(s.projects, said);
    if ('found' in m) return m.found;
    if ('several' in m) g.ask ??= { question: `Which project do you mean by “${clip(said, 40)}”?`, options: m.several.map(projectOption).sort((a, b) => a.localeCompare(b)).slice(0, 4) };
    else g.missing.push(`No project you can see matches “${clip(said, 60)}”.`);
    return null;
  }
  const people = (s: Scope, g: Gathered, names: string[] | undefined) => uniq((names ?? []).map((n) => person(s, g, n)?.id ?? '').filter(Boolean));
  /** Each name of these nothing matched, as a need on `field` (several matches were asked about already). */
  const unknownNames = (s: Scope, names: string[] | undefined, field: string) =>
    (names ?? []).filter((nm) => 'none' in matchPerson(s.people, nm, s.viewer.userId)).map((nm) => need([field], `No one matches “${clip(nm, 60)}”.`));

  async function task(s: Scope, g: Gathered, said: string): Promise<AiTaskRec | null> {
    const raw = said.replace(/^task:/i, '').trim();
    const key = /^([A-Za-z][A-Za-z0-9]*-\d+)\b/.exec(raw)?.[1];
    for (const handle of uniq([raw, ...(key ? [key] : [])])) {
      const t = await data.findTask(s.projectIds, handle);
      if (t && s.allowed(t.projectId)) return t;
    }
    // By its title (the model may name a task by what it says).
    const n = normalizeForSearch(raw);
    const all = (await data.tasks({ projectIds: s.projectIds })).filter((t) => s.allowed(t.projectId));
    const exact = all.filter((t) => normalizeForSearch(t.title) === n);
    const found: Match<AiTaskRec> = exact.length === 1 ? { found: exact[0]! } : exact.length > 1 ? { several: exact } : n.length >= 4 ? oneOf(all.filter((t) => normalizeForSearch(t.title).includes(n))) : { none: true };
    if ('found' in found) return found.found;
    if ('several' in found) g.ask ??= { question: `Which task do you mean by “${clip(said, 40)}”?`, options: found.several.slice(0, 4).map((t) => `${t.key} ${clip(t.title, 50)}`) };
    else g.missing.push(`No task you can see matches “${clip(said, 60)}”.`);
    return null;
  }
  const oneOf = <T,>(xs: T[]): Match<T> => (xs.length === 1 ? { found: xs[0]! } : xs.length ? { several: xs } : { none: true });

  async function meeting(s: Scope, g: Gathered, said: string): Promise<AiMeetingRec | null> {
    const raw = said.replace(/^meeting:/i, '').trim();
    if (raw && !/\s/.test(raw)) {
      const byId = await data.meetingDetail(raw);
      if (byId && (await data.canViewMeeting(s.viewer, raw))) return byId;
    }
    const hint = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(raw);
    const title = (hint?.[1] || raw).trim();
    const n = normalizeForSearch(title);
    const { rows } = await data.meetings(s.viewer, { projectIds: s.projectIds, from: new Date(0), to: new Date(Date.UTC(2100, 0, 1)), limit: 200, around: now(), text: title });
    const rank = (m: AiMeetingRec) => {
      const t = normalizeForSearch(m.title);
      return t === n ? 0 : t.startsWith(n) ? 1 : t.includes(n) ? 2 : 3;
    };
    const best = Math.min(3, ...rows.map(rank));
    let found = best < 3 ? rows.filter((m) => rank(m) === best) : [];
    if (found.length > 1 && hint) {
      const day = (m: AiMeetingRec) => zonedDayKey(m.startAt, timeZone);
      const onDay = found.filter((m) => dayLabel(day(m)) === hint[2]!.trim() || day(m) === hint[2]!.trim());
      if (onDay.length) found = onDay;
    }
    if (found.length === 1 && (await data.canViewMeeting(s.viewer, found[0]!.id))) return found[0]!;
    if (found.length > 1) g.ask ??= { question: 'Which meeting do you mean?', options: found.slice(0, 4).map((m) => `${m.title} (${dayLabel(zonedDayKey(m.startAt, timeZone))})`) };
    else g.missing.push(`No meeting you can see matches “${clip(said, 60)}”.`);
    return null;
  }

  // ── Words to values ──
  async function dayContext() {
    return { today: todayKey(timeZone, now()), workingDays: await port.workingDays().catch(() => undefined) };
  }
  type DayCtx = Awaited<ReturnType<typeof dayContext>>;
  function day(words: string | null | undefined, ctx: DayCtx): { day: string | null; problem: string | null } {
    if (words === null || words === undefined || words === '') return { day: null, problem: null };
    const r = resolveDay(words, ctx);
    return 'day' in r ? { day: r.day, problem: null } : { day: null, problem: r.problem };
  }
  function priority(words: string | undefined): { value: Priority | undefined; problem: string | null } {
    if (!words) return { value: undefined, problem: null };
    const p = PRIORITY_WORDS[words.toLowerCase()] ?? (PRIORITIES as readonly string[]).find((x) => x === words.toUpperCase());
    return p ? { value: p as Priority, problem: null } : { value: undefined, problem: `“${clip(words, 30)}” isn’t a priority. Pick Low, Normal, High or Urgent.` };
  }
  const pastWarning = (d: string | null | undefined, ctx: DayCtx) => (d && d < ctx.today ? `${dayLabel(d)} has already passed.` : null);

  /** The column a new task goes into: the first open To Do column, else the first open one that isn't Done. */
  const firstColumn = (cols: ActionColumn[]) => {
    const open = cols.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
    return open.find((c) => c.category === 'TODO') ?? open.find((c) => c.category !== 'DONE' && c.category !== 'BACKLOG') ?? open.find((c) => c.category !== 'DONE') ?? null;
  };
  /** A status the person named: a stage ("done") or a column's own name, among the open columns. */
  function columnFor(cols: ActionColumn[], words: string): ActionColumn | null {
    const open = cols.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
    const w = words.trim().toLowerCase().replace(/[-_]+/g, ' ');
    const byName = open.find((c) => normalizeForSearch(c.name) === normalizeForSearch(words));
    if (byName) return byName;
    const category = STATUS_WORDS[w] ?? STATUS_WORDS[w.replace(/ /g, '_')];
    return (category && open.find((c) => c.category === category)) || open.find((c) => normalizeForSearch(c.name).includes(normalizeForSearch(words))) || null;
  }

  // ── The checks, made when proposed and again on Confirm (each problem a need on its field) ──
  async function checkCreate(s: Scope, f: CreateTaskFields): Promise<{ needs: ItemNeed[]; labels: CreateTaskItem['labels']; columnId: string | null }> {
    const needs: ItemNeed[] = [];
    if (!f.title.trim()) needs.push(need(['title'], 'Give the task a title.'));
    else if (f.title.length > TITLE_MAX) needs.push(need(['title'], `Keep the title to ${TITLE_MAX} characters.`));
    if (f.due && !isCalendarDay(f.due)) needs.push(need(['due'], 'Pick a due date that exists.'));
    if (f.description.length > TEXT_MAX) needs.push(need(['description'], 'The description is too long.'));
    let columnId: string | null = null;
    const p = f.projectId ? s.projects.find((x) => x.id === f.projectId) : null;
    if (!p || !(await port.canUseProject(s.viewer, p.id))) needs.push(need(['projectId'], 'Pick a project you can see.'));
    else {
      columnId = firstColumn(await port.columns(p.id))?.id ?? null;
      if (!columnId) needs.push(need(['projectId'], `${p.name} has no column for new tasks.`));
      const ok = new Set(await port.eligibleAssignees(p.id, f.assigneeIds));
      for (const uid of f.assigneeIds) if (!ok.has(uid)) needs.push(need(['assigneeIds'], `${nameOf(s, uid)} isn’t on ${p.name}, so they can’t be assigned.`));
    }
    return { needs, labels: { project: p?.name ?? null, assignees: named(s, f.assigneeIds) }, columnId };
  }

  async function checkUpdate(s: Scope, f: TaskChangeFields, current: ActionTaskState): Promise<ItemNeed[]> {
    const needs: ItemNeed[] = [];
    if (f.due && !isCalendarDay(f.due)) needs.push(need(['due'], 'Pick a due date that exists.'));
    if (f.columnId) {
      const col = (await port.columns(current.projectId)).find((c) => c.id === f.columnId && c.enabled);
      if (!col) needs.push(need(['columnId'], `Pick a status from ${current.projectName}.`));
    }
    if (f.assigneeIds) {
      const added = f.assigneeIds.filter((uid) => !current.assigneeIds.includes(uid));
      const ok = new Set(await port.eligibleAssignees(current.projectId, added));
      for (const uid of added) if (!ok.has(uid)) needs.push(need(['assigneeIds'], `${nameOf(s, uid)} isn’t on ${current.projectName}, so they can’t be assigned.`));
    }
    return needs;
  }
  /** Only the fields that differ from the task as it is. */
  function changedFields(f: TaskChangeFields, t: Pick<ActionTaskState, 'due' | 'priority' | 'columnId' | 'assigneeIds'>): TaskChangeFields {
    const out: TaskChangeFields = {};
    if (f.due !== undefined && f.due !== t.due) out.due = f.due;
    if (f.priority !== undefined && f.priority !== t.priority) out.priority = f.priority;
    if (f.columnId !== undefined && f.columnId !== t.columnId) out.columnId = f.columnId;
    if (f.assigneeIds !== undefined && !sameSet(f.assigneeIds, t.assigneeIds)) out.assigneeIds = uniq(f.assigneeIds);
    return out;
  }

  async function checkMeeting(s: Scope, f: MeetingFields): Promise<{ needs: ItemNeed[]; labels: MeetingItem['labels'] }> {
    const needs: ItemNeed[] = [];
    if (!f.title.trim()) needs.push(need(['title'], 'Give the meeting a title.'));
    else if (f.title.length > 200) needs.push(need(['title'], 'Keep the title to 200 characters.'));
    const dayOk = !!f.date && isCalendarDay(f.date);
    const timeOk = !!f.time && !!parseClock(f.time);
    if (!dayOk) needs.push(need(['date'], 'Pick a day.'));
    if (!timeOk) needs.push(need(['time'], 'Pick a time.'));
    if (f.minutes < 5 || f.minutes > 720) needs.push(need(['minutes'], 'A meeting lasts 5 minutes to 12 hours.'));
    if (dayOk && timeOk && zonedInstant(f.date!, f.time!, timeZone).getTime() < now().getTime()) needs.push(need(['date', 'time'], 'That time has passed. Pick a later one.'));
    if (f.projectId && (!s.projects.some((p) => p.id === f.projectId) || !(await port.canUseProject(s.viewer, f.projectId)))) needs.push(need(['projectId'], 'Pick a project you can see.'));
    for (const uid of f.attendeeIds) {
      const p = s.person.get(uid);
      if (!p) needs.push(need(['attendeeIds'], 'Someone invited isn’t a user of MICO360.'));
      else if (!p.active) needs.push(need(['attendeeIds'], `${fullName(p)}’s account isn’t active, so they can’t be invited.`));
    }
    return { needs, labels: { project: projectName(s, f.projectId), attendees: named(s, f.attendeeIds) } };
  }

  async function minutesProblem(viewer: Viewer, meetingId: string): Promise<{ problem: string | null; locked: boolean; current: FinalMinutesRecord | null }> {
    if (!(await port.canEditMeeting(viewer, meetingId))) return { problem: MINUTES_EDITORS, locked: true, current: null };
    const current = await port.minutes(meetingId);
    if (current?.status === 'APPROVED') return { problem: MINUTES_FINAL, locked: true, current };
    return { problem: null, locked: false, current };
  }
  const hasContent = (c: FinalMinutesContent) => Boolean(c.summary || c.discussion.length || c.decisions.length || c.risks.length || c.nextSteps.length);
  const savedDay = (at: Date) => dayLabel(zonedDayKey(at, timeZone));

  /** Who changed a task after its first `after` history lines: names, "you" for the person by hand, or "someone". */
  async function whoChanged(viewer: Viewer, taskId: string, after: number): Promise<string> {
    const names: string[] = [];
    for (const r of await port.changedBy(taskId, after).catch(() => [])) {
      const label = r.userId === viewer.userId ? (r.via ? 'another of your MICO AI changes' : 'you') : r.name;
      if (!names.includes(label)) names.push(label);
    }
    return names.length ? listText(names) : 'someone';
  }

  // ── prepare ──
  const withNeeds = <T extends ProposalItem>(item: T, needs: ItemNeed[]): T => ({ ...item, needs, problem: item.locked ? item.problem : problemOf(needs) });

  async function buildCreate(s: Scope, g: Gathered, r: CreateRaw, ctx: DayCtx): Promise<CreateTaskItem> {
    const p = r.project ? project(s, g, r.project) : null;
    const assigneeIds = people(s, g, r.assignees);
    const due = day(r.due, ctx);
    const pr = priority(r.priority);
    let ids = assigneeIds;
    let ownerDefault = false;
    if (!r.assignees?.length && p) {
      const owner = await port.projectOwner(p.id);
      if (owner) {
        ids = await port.eligibleAssignees(p.id, [owner]);
        ownerDefault = ids.length > 0;
      }
    }
    const fields: CreateTaskFields = { title: r.title.slice(0, 400), projectId: p?.id ?? null, assigneeIds: ids, due: due.day, priority: pr.value ?? 'NORMAL', description: (r.description ?? '').slice(0, TEXT_MAX) };
    const checked = await checkCreate(s, fields);
    const read: ItemNeed[] = [
      ...(!r.project ? [need(['projectId'], 'Pick a project.')] : !p ? [need(['projectId'], `No project you can see matches “${clip(r.project, 60)}”. Pick the project.`)] : []),
      ...(due.problem ? [need(['due'], due.problem)] : []),
      ...(pr.problem ? [need(['priority'], pr.problem)] : []),
      ...unknownNames(s, r.assignees, 'assigneeIds'),
    ];
    // The project the model named couldn't be read: that is the need, not "pick a project you can see" as well.
    const checks = p ? checked.needs : checked.needs.filter((n) => !n.fields.includes('projectId'));
    const item: CreateTaskItem = { id: '', type: 'create_task', needs: [], problem: null, locked: false, warning: pastWarning(due.day, ctx), fields, labels: checked.labels, ...(ownerDefault ? { ownerDefault: true } : {}) };
    return withNeeds(item, [...read, ...checks]);
  }

  async function buildUpdate(s: Scope, g: Gathered, r: UpdateRaw, t: AiTaskRec, ctx: DayCtx): Promise<UpdateTaskItem> {
    const set = r.assignees ? people(s, g, r.assignees) : null;
    const add = people(s, g, r.addAssignees);
    const remove = people(s, g, r.removeAssignees);
    const current = await port.taskState(t.id);
    if (!current) throw new Error('gone');
    const cols = await port.columns(current.projectId);
    const read: ItemNeed[] = [];
    const fields: TaskChangeFields = {};
    if (r.due !== undefined) {
      const d = day(r.due, ctx);
      if (d.problem) read.push(need(['due'], d.problem));
      else fields.due = d.day;
    } else if (r.shiftDays !== undefined) fields.due = shiftDayKey(current.due ?? ctx.today, r.shiftDays);
    const pr = priority(r.priority);
    if (pr.value) fields.priority = pr.value;
    else if (pr.problem) read.push(need(['priority'], pr.problem));
    if (r.status) {
      const col = columnFor(cols, r.status);
      if (col) fields.columnId = col.id;
      else read.push(need(['columnId'], `${current.projectName} has no “${clip(r.status, 40)}” status. Pick one.`));
    }
    read.push(...unknownNames(s, [...(r.assignees ?? []), ...(r.addAssignees ?? []), ...(r.removeAssignees ?? [])], 'assigneeIds'));
    if (set || add.length || remove.length) fields.assigneeIds = uniq([...(set ?? current.assigneeIds).filter((uid) => !remove.includes(uid)), ...add]);
    const changed = changedFields(fields, current);
    const item: UpdateTaskItem = {
      id: '',
      type: 'update_task',
      needs: [],
      problem: null,
      locked: false,
      warning: pastWarning(changed.due, ctx),
      task: { id: current.id, key: current.key, title: current.title, projectId: current.projectId, project: current.projectName, url: `?task=${current.id}` },
      base: { version: current.version, assigneeIds: [...current.assigneeIds], activity: current.activity },
      before: { due: current.due, priority: current.priority, columnId: current.columnId, column: current.columnName, assignees: named(s, current.assigneeIds) },
      fields: changed,
      labels: {
        ...(changed.columnId ? { column: cols.find((c) => c.id === changed.columnId)?.name ?? '' } : {}),
        ...(changed.assigneeIds ? { assignees: named(s, changed.assigneeIds) } : {}),
      },
    };
    if (Object.keys(changed).length === 0 && read.length === 0) return { ...item, problem: NOTHING, locked: true };
    return withNeeds(item, [...read, ...(await checkUpdate(s, changed, current))]);
  }

  async function buildMinutes(s: Scope, m: AiMeetingRec, signal: AbortSignal | undefined): Promise<MinutesItem> {
    const base: MinutesItem = {
      id: '',
      type: 'draft_minutes',
      needs: [],
      problem: null,
      locked: false,
      warning: null,
      meeting: { id: m.id, title: m.title, startAt: m.startAt.toISOString(), url: `/meetings/${m.id}` },
      fields: { content: { summary: '', discussion: [], decisions: [], risks: [], nextSteps: [] } },
      base: { status: 'NONE', savedAt: null },
    };
    const check = await minutesProblem(s.viewer, m.id);
    const state = { status: check.current?.status ?? ('NONE' as const), savedAt: check.current ? check.current.savedAt.toISOString() : null };
    if (check.locked) return { ...base, base: state, problem: check.problem, locked: true };
    let content: FinalMinutesContent;
    try {
      content = await port.draftMinutes(s.viewer, m.id, signal);
    } catch (err) {
      if (signal?.aborted) throw new AiCallStoppedError();
      return { ...base, base: state, problem: `The minutes couldn’t be drafted: ${plain(err, 'the AI didn’t answer.')} You can draft them on the meeting page.`, locked: true };
    }
    if (signal?.aborted) throw new AiCallStoppedError();
    const item: MinutesItem = { ...base, base: state, fields: { content }, warning: check.current ? `This replaces the draft saved on ${savedDay(check.current.savedAt)} (Undo puts it back).` : null };
    return withNeeds(item, hasContent(content) ? [] : [need(['content'], 'The draft came back empty. Write the minutes here, or on the meeting page.')]);
  }

  async function buildMeeting(s: Scope, g: Gathered, r: MeetingRaw, ctx: DayCtx): Promise<MeetingItem> {
    const p = r.project ? project(s, g, r.project) : null;
    const attendees = people(s, g, r.people).filter((uid) => uid !== s.viewer.userId);
    const [startDate, startTime] = r.start ? r.start.split(/[T ]/, 2) : [undefined, undefined];
    const dayWords = r.date ?? startDate;
    const d = day(dayWords, ctx);
    const clockWords = r.time ?? startTime;
    const clock = clockWords ? parseClock(clockWords) : null;
    const fields: MeetingFields = {
      title: r.title.slice(0, 400),
      projectId: p?.id ?? null,
      date: d.day,
      time: clock,
      minutes: Math.min(720, Math.max(5, r.minutes ?? 30)),
      attendeeIds: attendees,
      agenda: (r.agenda ?? []).map((x) => x.slice(0, 300)).filter(Boolean).slice(0, AGENDA_MAX),
      description: (r.description ?? '').slice(0, TEXT_MAX),
    };
    const checked = await checkMeeting(s, fields);
    const read: ItemNeed[] = [
      ...(dayWords && d.problem ? [need(['date'], d.problem)] : []),
      ...(clockWords && !clock ? [need(['time'], `Couldn’t tell what time “${clip(clockWords, 30)}” is. Pick a time.`)] : []),
      ...(r.project && !p ? [need(['projectId'], `No project you can see matches “${clip(r.project, 60)}”.`)] : []),
      ...unknownNames(s, r.people, 'attendeeIds'),
    ];
    // What couldn't be read is the need for its field ("pick a day" as well would say it twice).
    const readFields = new Set(read.flatMap((n) => n.fields));
    const checks = checked.needs.filter((n) => !(n.fields.length === 1 && readFields.has(n.fields[0]!)));
    return withNeeds({ id: '', type: 'schedule_meeting', needs: [], problem: null, locked: false, warning: null, fields, labels: checked.labels } satisfies MeetingItem, [...read, ...checks]);
  }

  /** The same task asked for twice: one change, the later value kept where the two differ. */
  function mergeUpdate(a: UpdateRaw, b: UpdateRaw): { raw: UpdateRaw; conflict: boolean } {
    const out: Record<string, unknown> = { ...a };
    let conflict = false;
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined || k === 'task') continue;
      if (k === 'addAssignees' || k === 'removeAssignees') {
        out[k] = uniq([...((out[k] as string[] | undefined) ?? []), ...(v as string[])]);
        continue;
      }
      if (out[k] !== undefined && JSON.stringify(out[k]) !== JSON.stringify(v)) conflict = true;
      out[k] = v;
    }
    return { raw: out as UpdateRaw, conflict };
  }

  /**
   * Check a "propose" reply for the person. Several matches for a name ask which one; names nothing
   * matches go back to the model (unless `final`), else they are needs on the card. `signal` stops it
   * (and the minutes drafts in it).
   */
  async function prepare(viewer: Viewer, changes: Array<Record<string, unknown>>, opts: { final: boolean; signal?: AbortSignal }): Promise<ProposeOutcome> {
    const { signal } = opts;
    const s = await scopeOf(viewer);
    const ctx = await dayContext();
    const g: Gathered = { ask: null, missing: [] };
    const notes: string[] = [];
    const usable = changes.filter((c) => {
      const ok = (CHANGE_TYPES as readonly string[]).includes(String(c?.type));
      if (!ok) notes.push(/delete|remove/i.test(String(c?.type)) ? 'MICO AI can’t delete anything, so that was left out.' : `MICO AI can’t make a “${clip(String(c?.type ?? 'unknown'), 30)}” change, so it was left out.`);
      return ok;
    });
    if (usable.length > maxChanges) notes.push(`MICO AI makes at most ${maxChanges} changes at a time: the first ${maxChanges} are here. Ask again for the rest.`);

    // Targets first, so the same task (or meeting's minutes) asked for twice becomes one change.
    const specs: Spec[] = [];
    const leftOut: string[] = [];
    const byTask = new Map<string, number>();
    const byMeeting = new Set<string>();
    const tooManyMinutes: string[] = [];
    for (const raw of usable.slice(0, maxChanges)) {
      const before = g.missing.length;
      try {
        const type = raw.type as ChangeType;
        if (type === 'update_task') {
          const r = RAW.update_task.parse(raw);
          const t = await task(s, g, r.task);
          if (t) {
            const at = byTask.get(t.id);
            if (at === undefined) {
              byTask.set(t.id, specs.length);
              specs.push({ type, raw: r, task: t });
            } else {
              const prev = specs[at] as Extract<Spec, { type: 'update_task' }>;
              const merged = mergeUpdate(prev.raw, r);
              specs[at] = { ...prev, raw: merged.raw };
              notes.push(`${t.key} was asked for twice: they are one change here${merged.conflict ? ', and where the two differed, the later one is used' : ''}.`);
            }
          }
        } else if (type === 'draft_minutes') {
          const m = await meeting(s, g, RAW.draft_minutes.parse(raw).meeting);
          if (m && byMeeting.has(m.id)) notes.push(`The minutes of ${m.title} were asked for twice: they are drafted once.`);
          else if (m && byMeeting.size >= MAX_MINUTES_DRAFTS) tooManyMinutes.push(m.title);
          else if (m) {
            byMeeting.add(m.id);
            specs.push({ type, meeting: m });
          }
        } else if (type === 'create_task') specs.push({ type, raw: RAW.create_task.parse(raw) });
        else specs.push({ type, raw: RAW.schedule_meeting.parse(raw) });
      } catch {
        leftOut.push('One of the changes was incomplete, so it was left out.');
      }
      if (g.missing.length > before && (raw.type === 'update_task' || raw.type === 'draft_minutes')) {
        leftOut.push(...g.missing.slice(before).filter((m) => /^No (task|meeting)/.test(m)).map((m) => `${m.replace(/\.$/, '')}, so it was left out.`));
      }
    }
    if (tooManyMinutes.length) notes.push(`MICO AI drafts at most ${MAX_MINUTES_DRAFTS} sets of minutes at a time: ask for the minutes of ${listText(tooManyMinutes.map((t) => `“${t}”`))} separately.`);

    // Every change's names, so an unclear one is asked about before anything is drafted.
    for (const sp of specs) {
      if (sp.type === 'create_task') {
        if (sp.raw.project) project(s, g, sp.raw.project);
        people(s, g, sp.raw.assignees);
      } else if (sp.type === 'update_task') people(s, g, [...(sp.raw.assignees ?? []), ...(sp.raw.addAssignees ?? []), ...(sp.raw.removeAssignees ?? [])]);
      else if (sp.type === 'schedule_meeting') {
        if (sp.raw.project) project(s, g, sp.raw.project);
        people(s, g, sp.raw.people);
      }
    }
    if (g.ask) return { kind: 'clarify', ...g.ask };
    if (!opts.final && g.missing.length) return { kind: 'retry', problems: uniq(g.missing).slice(0, 12) };

    // Build the card: the minutes drafts (AI calls) side by side, everything else in order.
    const quiet: Gathered = { ask: null, missing: [] };
    const out: Array<ProposalItem | null> = specs.map(() => null);
    let stoppedDrafts = false;
    const drafts = Promise.all(
      specs.map((sp, i) =>
        sp.type === 'draft_minutes'
          ? buildMinutes(s, sp.meeting, signal).then(
              (item) => void (out[i] = item),
              (err) => {
                if (err instanceof AiCallStoppedError || signal?.aborted) stoppedDrafts = true;
                else leftOut.push('One of the changes couldn’t be checked, so it was left out.');
              },
            )
          : null,
      ),
    );
    for (const [i, sp] of specs.entries()) {
      if (signal?.aborted) break;
      try {
        if (sp.type === 'create_task') out[i] = await buildCreate(s, quiet, sp.raw, ctx);
        else if (sp.type === 'update_task') out[i] = await buildUpdate(s, quiet, sp.raw, sp.task, ctx);
        else if (sp.type === 'schedule_meeting') out[i] = await buildMeeting(s, quiet, sp.raw, ctx);
      } catch {
        leftOut.push('One of the changes couldn’t be checked, so it was left out.');
      }
    }
    await drafts;
    if (stoppedDrafts || signal?.aborted) throw new AiCallStoppedError();
    const items = out.filter((x): x is ProposalItem => !!x).map((x, k) => ({ ...x, id: `c${k + 1}` }));
    const note = uniq([...notes, ...leftOut]).join(' ') || null;
    if (items.length === 0) return { kind: 'answer', text: note ?? 'There was nothing MICO AI could change.' };
    return { kind: 'card', card: { items, note } };
  }

  // ── The person's edits ──
  /**
   * The card with the person's edits put in (fields only; everything is checked again on Confirm).
   * An edit to a field clears the needs it answers; a bad edit is a need that can't be cleared.
   */
  function applyEdits(items: ProposalItem[], choices: ItemChoice[] = []): ProposalItem[] {
    const byId = new Map(choices.map((c) => [c.id, c]));
    return items.map((raw) => {
      const item = { ...raw, needs: raw.needs ?? [] } as ProposalItem;
      const edits = byId.get(item.id)?.edits;
      if (!edits || item.locked) return item;
      const parsed = EDITS[item.type].safeParse(edits);
      const bad = (it: ProposalItem) => withNeeds(it, [...it.needs, need([], BAD_EDIT)]);
      if (!parsed.success) return bad(item);
      const e = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([, v]) => v !== undefined));
      const edited = new Set(Object.keys(e));
      const answered = item.needs.filter((n) => !n.fields.some((f) => edited.has(f)));
      switch (item.type) {
        case 'create_task':
          return withNeeds({ ...item, fields: { ...item.fields, ...(e as Partial<CreateTaskFields>) } }, answered);
        case 'update_task':
          return withNeeds({ ...item, fields: { ...item.fields, ...(e as TaskChangeFields) } }, answered);
        case 'draft_minutes': {
          if (e.content === undefined) return item;
          try {
            return withNeeds({ ...item, fields: { content: normalizeFinalMinutes(e.content) } }, answered);
          } catch {
            return bad(item);
          }
        }
        case 'schedule_meeting':
          return withNeeds({ ...item, fields: { ...item.fields, ...(e as Partial<MeetingFields>) } }, answered);
      }
    });
  }

  // ── carryOut ──
  async function carryOut(viewer: Viewer, items: ProposalItem[], opts: CarryOutOptions): Promise<{ items: ProposalItem[]; results: Record<string, ItemResult> }> {
    const s = await scopeOf(viewer);
    const results: Record<string, ItemResult> = {};
    const out: ProposalItem[] = [];
    const audit = (entry: Omit<Parameters<MicoAiWritePort['audit']>[0], 'userId' | 'ip'>) => port.audit({ userId: viewer.userId, ip: opts.ip, ...entry }).catch(() => undefined);
    const refuse = (message: string): ItemResult => ({ status: 'refused', message, link: null });
    /** Record a change's result at once (a confirm cut off later still knows what was made). */
    const mark = async (itemId: string, r: ItemResult) => {
      results[itemId] = r;
      await opts.onResult?.({ ...results });
    };
    const stale = async (key: string, taskId: string, since: number) =>
      refuse(`${key} changed after MICO AI suggested this (${await whoChanged(viewer, taskId, since)} changed it), so it was left as it is. Ask again to see it as it is now.`);
    /** Refuse a change (and say what is on the card for it). */
    const refused = async <T extends ProposalItem>(item: T, message: string): Promise<T> => {
      await mark(item.id, refuse(message));
      return item;
    };

    async function one(item: ProposalItem): Promise<ProposalItem> {
      if (!opts.include[item.id]) {
        await mark(item.id, { status: 'skipped', message: null, link: null });
        return item;
      }
      if (item.locked) return refused(item, item.problem ?? 'This change can’t be made.');
      const needs = item.needs ?? [];
      if (needs.length) return refused(item, `Put this right first: ${problemOf(needs)}`);

      if (item.type === 'create_task') {
        const f = { ...item.fields, title: item.fields.title.trim(), description: item.fields.description.trim(), assigneeIds: uniq(item.fields.assigneeIds) };
        const checked = await checkCreate(s, f);
        const fresh: CreateTaskItem = { ...item, fields: f, labels: checked.labels };
        if (checked.needs.length || !checked.columnId) return refused(fresh, problemOf(checked.needs) ?? 'This change can’t be made.');
        await mark(item.id, { status: 'started', message: null, link: null });
        const t = await port.createTask(viewer, { projectId: f.projectId!, columnId: checked.columnId, title: f.title, description: f.description, priority: f.priority, due: f.due, assigneeIds: f.assigneeIds });
        const link = { label: t.key, url: `?task=${t.id}` };
        // Made: done from here on, whatever follows.
        await mark(item.id, { status: 'done', message: null, link, undo: { kind: 'task-created', taskId: t.id, projectId: t.projectId, touch: touchOf(t) } });
        let warning: string | null = null;
        try {
          await port.announceTask(viewer, t.id, f.assigneeIds);
        } catch (err) {
          warning = `The task was made, but the usual notices couldn’t be sent: ${plain(err, 'something went wrong')}.`;
        }
        const after = (await port.taskState(t.id).catch(() => null)) ?? t;
        await audit({ action: 'mico-ai.task.create', entityId: t.id, newValue: { via: VIA, key: t.key, title: t.title, projectId: t.projectId, assigneeIds: f.assigneeIds, due: f.due, priority: f.priority } });
        await mark(item.id, { status: 'done', message: warning, link, undo: { kind: 'task-created', taskId: t.id, projectId: t.projectId, touch: touchOf(after) } });
        return fresh;
      }

      if (item.type === 'update_task') {
        const current = await port.taskState(item.task.id);
        if (!current) return refused(item, `${item.task.key} was deleted, so nothing was changed.`);
        if (!(await port.canViewTask(viewer, current.id))) return refused(item, `You can’t change ${item.task.key} any more.`);
        if (current.version !== item.base.version || !sameSet(current.assigneeIds, item.base.assigneeIds)) {
          await mark(item.id, await stale(item.task.key, current.id, item.base.activity ?? 0));
          return item;
        }
        const change = changedFields(item.fields, current);
        const cols = await port.columns(current.projectId);
        const fresh: UpdateTaskItem = {
          ...item,
          fields: change,
          labels: {
            ...(change.columnId ? { column: cols.find((c) => c.id === change.columnId)?.name ?? '' } : {}),
            ...(change.assigneeIds ? { assignees: named(s, change.assigneeIds) } : {}),
          },
        };
        if (Object.keys(change).length === 0) return refused(fresh, NOTHING);
        const problems = await checkUpdate(s, change, current);
        if (problems.length) return refused(fresh, problemOf(problems)!);
        const link = { label: current.key, url: `?task=${current.id}` };
        const { assigneeIds, ...fieldsOnly } = change;
        const before: TaskChangeFields = {};
        if (change.due !== undefined) before.due = current.due;
        if (change.priority !== undefined) before.priority = current.priority;
        if (change.columnId !== undefined) before.columnId = current.columnId;
        if (change.assigneeIds !== undefined) before.assigneeIds = [...current.assigneeIds];
        const add = assigneeIds ? assigneeIds.filter((uid) => !current.assigneeIds.includes(uid)) : [];
        const remove = assigneeIds ? current.assigneeIds.filter((uid) => !assigneeIds.includes(uid)) : [];
        await mark(item.id, { status: 'started', message: null, link });
        const warnings: Array<string | null> = [];
        let state = current;
        if (Object.keys(fieldsOnly).length) {
          try {
            const r = await port.updateTask(viewer, current.id, fieldsOnly, current.version);
            state = r.state;
            warnings.push(r.warning);
          } catch (err) {
            if (!isConflict(err)) throw err;
            await mark(item.id, await stale(item.task.key, current.id, item.base.activity ?? 0));
            return fresh;
          }
          // The fields are saved: done from here on, whatever follows.
          await mark(item.id, { status: 'done', message: joinWarnings(warnings), link, undo: { kind: 'task-updated', taskId: current.id, projectId: current.projectId, touch: touchOf(state), before } });
          if (assigneeIds) {
            try {
              await port.setAssignees(viewer, current.id, add, remove);
            } catch (err) {
              warnings.push(`The other changes were saved, but the people couldn’t be changed: ${plain(err, 'something went wrong')}.`);
            }
          }
        } else await port.setAssignees(viewer, current.id, add, remove);
        const after = (await port.taskState(current.id).catch(() => null)) ?? state;
        const nextCopy = !current.nextCopyKey && after.nextCopyKey ? after.nextCopyKey : null;
        await audit({ action: 'mico-ai.task.update', entityId: current.id, oldValue: before, newValue: { via: VIA, key: current.key, ...change } });
        await mark(item.id, {
          status: 'done',
          message: joinWarnings(warnings),
          link,
          undo: { kind: 'task-updated', taskId: current.id, projectId: current.projectId, touch: touchOf(after), before, ...(nextCopy ? { nextCopy } : {}) },
        });
        return fresh;
      }

      if (item.type === 'draft_minutes') {
        if (!(await port.canEditMeeting(viewer, item.meeting.id))) return refused(item, MINUTES_EDITORS);
        // Changed since the draft was made (saved again, or marked final): that is the reason to give.
        const latest = await port.minutes(item.meeting.id);
        const now0 = { status: latest?.status ?? 'NONE', savedAt: latest ? latest.savedAt.toISOString() : null };
        if (now0.status !== item.base.status || now0.savedAt !== item.base.savedAt) {
          return refused(item, 'The final minutes changed after MICO AI drafted these, so they were left as they are. Ask again for a fresh draft.');
        }
        const check = await minutesProblem(viewer, item.meeting.id);
        if (check.locked) return refused(item, check.problem!);
        if (!hasContent(item.fields.content)) return refused(item, 'There’s nothing in the draft.');
        const previous = check.current
          ? { content: check.current.content, status: check.current.status, approvedById: check.current.approvedById, approvedAt: check.current.approvedAt ? check.current.approvedAt.toISOString() : null }
          : null;
        const link = { label: 'Open the meeting', url: item.meeting.url };
        await mark(item.id, { status: 'started', message: null, link });
        const saved = await port.saveMinutes(viewer, item.meeting.id, { content: item.fields.content, status: 'DRAFT', approvedById: null, approvedAt: null });
        await mark(item.id, {
          status: 'done',
          message: 'Saved as a draft on the meeting page, for review. It isn’t final or emailed.',
          link,
          undo: { kind: 'minutes-saved', meetingId: item.meeting.id, savedAt: saved.savedAt.toISOString(), previous },
        });
        await audit({ action: 'mico-ai.minutes.draft', entityId: item.meeting.id, newValue: { via: VIA, meeting: item.meeting.title, status: 'DRAFT' } });
        return item;
      }

      // schedule_meeting
      const f: MeetingFields = { ...item.fields, title: item.fields.title.trim(), attendeeIds: uniq(item.fields.attendeeIds.filter((uid) => uid !== viewer.userId)), agenda: item.fields.agenda.map((a) => a.trim()).filter(Boolean) };
      const checked = await checkMeeting(s, f);
      const fresh: MeetingItem = { ...item, fields: f, labels: checked.labels };
      if (checked.needs.length) return refused(fresh, problemOf(checked.needs)!);
      const startAt = zonedInstant(f.date!, f.time!, timeZone);
      await mark(item.id, { status: 'started', message: null, link: null });
      const created = await port.createMeeting(viewer, { title: f.title, projectId: f.projectId, startAt, endAt: new Date(startAt.getTime() + f.minutes * 60_000), description: f.description, attendeeIds: f.attendeeIds, agenda: f.agenda });
      const link = { label: f.title, url: `/meetings/${created.id}` };
      await mark(item.id, { status: 'done', message: null, link, undo: { kind: 'meeting-created', meetingId: created.id, stamp: created.stamp, invited: false } });
      let message: string | null = null;
      let invited = false;
      if (opts.sendInvites) {
        try {
          const r = await port.sendInvites(viewer, created.id);
          invited = r.sent > 0;
          message = r.failed ? `Invitations emailed to ${r.sent}; ${r.failed} couldn’t be sent.` : `Invitations emailed to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`;
        } catch (err) {
          message = `The meeting was made, but the invitations couldn’t be emailed: ${plain(err, 'email isn’t working right now.')} Send them from the meeting page.`;
        }
      } else message = 'No invitations were emailed. Send them from the meeting page when you’re ready.';
      const stamp = (await port.meetingStamp(created.id).catch(() => null)) ?? created;
      await audit({ action: 'mico-ai.meeting.create', entityId: created.id, newValue: { via: VIA, title: f.title, startAt: startAt.toISOString(), projectId: f.projectId, attendeeIds: f.attendeeIds, invitationsEmailed: invited } });
      await mark(item.id, { status: 'done', message, link, undo: { kind: 'meeting-created', meetingId: created.id, stamp: stamp.stamp, invited: invited || !!stamp.invitesSentAt } });
      return fresh;
    }

    await port.asMicoAi(async () => {
      for (const item of items) {
        let shown: ProposalItem = item;
        try {
          shown = await one(item);
        } catch (err) {
          const r = results[item.id];
          // Done already (its main write landed): what failed after it is a warning, not a failure.
          if (r?.status === 'done') await mark(item.id, { ...r, message: joinWarnings([r.message, `A step after the change failed: ${plain(err, 'something went wrong')}.`]) });
          else await mark(item.id, { status: 'failed', message: plain(err, FAILED), link: r?.link ?? null });
        }
        out.push(shown);
      }
    });
    return { items: out, results };
  }

  // ── revert (Undo) ──
  async function revert(viewer: Viewer, items: ProposalItem[], results: Record<string, ItemResult>, opts: { ip: string | null; onUndo?: (undo: Record<string, ItemUndo>) => Promise<void> }): Promise<Record<string, ItemUndo>> {
    const undo: Record<string, ItemUndo> = {};
    const audit = (entityId: string, type: ChangeType) => port.audit({ userId: viewer.userId, ip: opts.ip, action: 'mico-ai.undo', entityId, newValue: { via: VIA, change: type } }).catch(() => undefined);
    const refused = (message: string): ItemUndo => ({ status: 'refused', message });
    const changedSince = async (key: string, taskId: string, since: number) => refused(`${capital(await whoChanged(viewer, taskId, since))} changed ${key} since, so it was left as it is.`);

    async function one(item: ProposalItem, data: UndoData): Promise<ItemUndo> {
      if (data.kind === 'task-created' || data.kind === 'task-updated') {
        const key = item.type === 'update_task' ? item.task.key : (results[item.id]?.link?.label ?? 'The task');
        const t = await port.taskState(data.taskId);
        if (!t) return refused(data.kind === 'task-created' ? `${key} was already deleted.` : `${key} was deleted since.`);
        if (!(await port.canViewTask(viewer, t.id))) return refused(`You can’t change ${key} any more, so it was left as it is.`);
        if (!sameTouch(t, data.touch)) return changedSince(key, t.id, data.touch.activity);
        if (data.kind === 'task-created') {
          // One guarded write: if anything touched it since the check above, it stays.
          if (!(await port.deleteCreatedTask(viewer, t.id, data.touch))) return changedSince(key, t.id, data.touch.activity);
          await audit(t.id, item.type);
          return { status: 'undone', message: `${key} was deleted.`, gone: true };
        }
        const { assigneeIds, ...fieldsOnly } = data.before;
        if (Object.keys(fieldsOnly).length) await port.updateTask(viewer, t.id, fieldsOnly, t.version);
        if (assigneeIds) {
          const add = assigneeIds.filter((uid) => !t.assigneeIds.includes(uid));
          const remove = t.assigneeIds.filter((uid) => !assigneeIds.includes(uid));
          if (add.length || remove.length) await port.setAssignees(viewer, t.id, add, remove);
        }
        await audit(t.id, item.type);
        return data.nextCopy
          ? { status: 'undone', message: `${key} has its changes put back. The next copy made when it was completed, ${data.nextCopy}, stays.` }
          : { status: 'undone', message: `${key} is back as it was.` };
      }
      if (data.kind === 'meeting-created') {
        const m = await port.meetingStamp(data.meetingId);
        if (!m || m.status === 'CANCELLED') return refused('The meeting was already deleted or cancelled.');
        if (!(await port.canEditMeeting(viewer, m.id))) return refused('You can’t change the meeting any more, so it was left as it is.');
        if (m.stamp !== data.stamp) return refused('The meeting was changed since, so it was left as it is.');
        const how = await port.removeMeeting(viewer, m.id, data.invited || !!m.invitesSentAt);
        await audit(m.id, item.type);
        return how === 'cancelled' ? { status: 'undone', message: 'The meeting was cancelled, and the people invited were told.' } : { status: 'undone', message: 'The meeting was deleted.', gone: true };
      }
      // minutes-saved
      if (!(await port.canEditMeeting(viewer, data.meetingId))) return refused('You can’t change these minutes any more, so they were left as they are.');
      const now0 = await port.minutes(data.meetingId);
      if (!now0 || now0.status !== 'DRAFT' || now0.savedAt.toISOString() !== data.savedAt) return refused('The final minutes were changed since, so they were left as they are.');
      if (data.previous) {
        await port.saveMinutes(viewer, data.meetingId, { ...data.previous, approvedAt: data.previous.approvedAt ? new Date(data.previous.approvedAt) : null });
        await audit(data.meetingId, item.type);
        return { status: 'undone', message: 'The earlier draft is back.' };
      }
      await port.clearMinutes(viewer, data.meetingId);
      await audit(data.meetingId, item.type);
      return { status: 'undone', message: 'The draft was removed.' };
    }

    await port.asMicoAi(async () => {
      // Newest first, as the person would put them back by hand.
      for (const item of [...items].reverse()) {
        const r = results[item.id];
        if (r?.status !== 'done' || !r.undo) continue;
        undo[item.id] = { status: 'started', message: null };
        await opts.onUndo?.({ ...undo });
        try {
          undo[item.id] = await one(item, r.undo);
        } catch (err) {
          undo[item.id] = { status: 'failed', message: plain(err, UNDO_FAILED) };
        }
        await opts.onUndo?.({ ...undo });
      }
    });
    // In the card's order.
    return Object.fromEntries(items.filter((i) => undo[i.id]).map((i) => [i.id, undo[i.id]!]));
  }

  return { prepare, applyEdits, carryOut, revert };
}

export type MicoAiActions = ReturnType<typeof createMicoAiActions>;
