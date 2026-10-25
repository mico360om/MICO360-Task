import { z } from 'zod';
import { shiftDayKey, todayKey, zonedDayKey } from '../../lib/due-date';
import { normalizeForSearch } from '../search/text-normalize';
import { normalizeFinalMinutes, type FinalMinutesContent } from '../meetings/final-minutes';
import type { FinalMinutesRecord } from '../meetings/final-minutes-repository';
import { dayLabel, isCalendarDay, parseClock, resolveDay, zonedInstant } from './mico-ai-dates';
import { fullName, matchPerson, matchProject, personOption, projectOption, type Match } from './mico-ai-resolve';
import type { AiMeetingRec, AiPersonRec, AiProjectRec, AiTaskRec, MicoAiDataPort, Viewer } from './mico-ai-data';
import {
  CHANGE_TYPES,
  MAX_CHANGES,
  PRIORITIES,
  type ChangeType,
  type CreateTaskFields,
  type CreateTaskItem,
  type ItemChoice,
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
  type UndoData,
  type UpdateTaskItem,
} from './mico-ai-actions-types';

/**
 * MICO AI's actions: what makes a "propose" reply into a card, and a confirmed card into changes.
 *
 * - prepare: each proposed change is read with its own schema, its names, projects, tasks and
 *   meetings are resolved with the person's own access (several matches ask which one; no match goes
 *   back to the model once), its days are worked out in company time, and the checks the app makes
 *   are made now, so the card already says what can't go ahead and why.
 * - carryOut: the confirmed card (with the person's edits) is checked again, change by change —
 *   permissions, people, dates, and whether a task or the minutes changed since — and each change is
 *   made through the app's own services as the person (`port`), its history marked "via MICO AI" and
 *   an audit entry written. One refused or failed change never stops the others.
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
  /** Who made its newest history line. */
  lastActor: string | null;
}

export interface ActionColumn {
  id: string;
  name: string;
  category: string;
  position: number;
  enabled: boolean;
}

/** A meeting's state for Undo: `stamp` changes whenever the meeting, its people or its agenda do. */
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
 * as the app's own route does, and sends the usual notifications and live updates.
 */
export interface MicoAiWritePort {
  taskState(taskId: string): Promise<ActionTaskState | null>;
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
  /** A first draft of a meeting's final minutes from its notes, agenda and action items (the AI). */
  draftMinutes(viewer: Viewer, meetingId: string): Promise<FinalMinutesContent>;
  createTask(viewer: Viewer, input: { projectId: string; columnId: string; title: string; description: string; priority: Priority; due: string | null; assigneeIds: string[] }): Promise<ActionTaskState>;
  /** Saved only if the task is still at `expectedVersion`. */
  updateTask(viewer: Viewer, taskId: string, change: Omit<TaskChangeFields, 'assigneeIds'>, expectedVersion: number): Promise<ActionTaskState>;
  setAssignees(viewer: Viewer, taskId: string, add: string[], remove: string[]): Promise<void>;
  deleteTask(viewer: Viewer, taskId: string): Promise<void>;
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
const uniq = (xs: string[]) => [...new Set(xs)];
const joinProblems = (ps: Array<string | null | undefined>) => ps.filter(Boolean).join(' ') || null;

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

/** What resolving one change's names found: nothing yet (several = ask, missing = tell the model). */
interface Gathered {
  ask: { question: string; options: string[] } | null;
  missing: string[];
}

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
  function priority(words: string | undefined): { value: Priority | undefined; warning: string | null } {
    if (!words) return { value: undefined, warning: null };
    const p = PRIORITY_WORDS[words.toLowerCase()] ?? (PRIORITIES as readonly string[]).find((x) => x === words.toUpperCase());
    return p ? { value: p as Priority, warning: null } : { value: undefined, warning: `“${clip(words, 30)}” isn’t a priority (Low, Normal, High or Urgent), so it was left as it is.` };
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

  // ── The checks, made when proposed and again on Confirm ──
  async function checkCreate(s: Scope, f: CreateTaskFields, ctx: DayCtx): Promise<{ problem: string | null; labels: CreateTaskItem['labels']; columnId: string | null }> {
    const problems: string[] = [];
    if (!f.title.trim()) problems.push('Give the task a title.');
    else if (f.title.length > TITLE_MAX) problems.push(`Keep the title to ${TITLE_MAX} characters.`);
    if (f.due && !isCalendarDay(f.due)) problems.push('Pick a due date that exists.');
    if (f.description.length > TEXT_MAX) problems.push('The description is too long.');
    let columnId: string | null = null;
    const p = f.projectId ? s.projects.find((x) => x.id === f.projectId) : null;
    if (!p || !(await port.canUseProject(s.viewer, p.id))) problems.push('Pick a project you can see.');
    else {
      columnId = firstColumn(await port.columns(p.id))?.id ?? null;
      if (!columnId) problems.push(`${p.name} has no column for new tasks.`);
      const ok = new Set(await port.eligibleAssignees(p.id, f.assigneeIds));
      for (const uid of f.assigneeIds) if (!ok.has(uid)) problems.push(`${nameOf(s, uid)} isn’t on ${p.name}, so they can’t be assigned.`);
    }
    void ctx;
    return { problem: joinProblems(problems), labels: { project: p?.name ?? null, assignees: named(s, f.assigneeIds) }, columnId };
  }

  async function checkUpdate(s: Scope, item: UpdateTaskItem, current: ActionTaskState): Promise<string | null> {
    const problems: string[] = [];
    const f = item.fields;
    if (f.due && !isCalendarDay(f.due)) problems.push('Pick a due date that exists.');
    if (f.columnId) {
      const col = (await port.columns(current.projectId)).find((c) => c.id === f.columnId && c.enabled);
      if (!col) problems.push(`Pick a status from ${current.projectName}.`);
    }
    if (f.assigneeIds) {
      const added = f.assigneeIds.filter((uid) => !current.assigneeIds.includes(uid));
      const ok = new Set(await port.eligibleAssignees(current.projectId, added));
      for (const uid of added) if (!ok.has(uid)) problems.push(`${nameOf(s, uid)} isn’t on ${current.projectName}, so they can’t be assigned.`);
    }
    return joinProblems(problems);
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

  async function checkMeeting(s: Scope, f: MeetingFields): Promise<{ problem: string | null; labels: MeetingItem['labels'] }> {
    const problems: string[] = [];
    if (!f.title.trim()) problems.push('Give the meeting a title.');
    else if (f.title.length > 200) problems.push('Keep the title to 200 characters.');
    if (!f.date || !isCalendarDay(f.date)) problems.push('Pick a day.');
    if (!f.time || !parseClock(f.time)) problems.push('Pick a time.');
    if (f.minutes < 5 || f.minutes > 720) problems.push('A meeting lasts 5 minutes to 12 hours.');
    if (f.date && isCalendarDay(f.date) && f.time && parseClock(f.time) && zonedInstant(f.date, f.time, timeZone).getTime() < now().getTime()) problems.push('That time has passed. Pick a later one.');
    if (f.projectId && (!s.projects.some((p) => p.id === f.projectId) || !(await port.canUseProject(s.viewer, f.projectId)))) problems.push('Pick a project you can see.');
    for (const uid of f.attendeeIds) {
      const p = s.person.get(uid);
      if (!p) problems.push('Someone invited isn’t a user of MICO360.');
      else if (!p.active) problems.push(`${fullName(p)}’s account isn’t active, so they can’t be invited.`);
    }
    return { problem: joinProblems(problems), labels: { project: projectName(s, f.projectId), attendees: named(s, f.attendeeIds) } };
  }

  async function minutesProblem(viewer: Viewer, meetingId: string): Promise<{ problem: string | null; locked: boolean; current: FinalMinutesRecord | null }> {
    if (!(await port.canEditMeeting(viewer, meetingId))) return { problem: MINUTES_EDITORS, locked: true, current: null };
    const current = await port.minutes(meetingId);
    if (current?.status === 'APPROVED') return { problem: MINUTES_FINAL, locked: true, current };
    return { problem: null, locked: false, current };
  }
  const hasContent = (c: FinalMinutesContent) => Boolean(c.summary || c.discussion.length || c.decisions.length || c.risks.length || c.nextSteps.length);
  const savedDay = (at: Date) => dayLabel(zonedDayKey(at, timeZone));

  // ── prepare ──
  type Pending = (s: Scope, ctx: DayCtx, n: string) => Promise<ProposalItem>;

  async function resolveOne(s: Scope, g: Gathered, type: ChangeType, raw: Record<string, unknown>, ctx: DayCtx): Promise<Pending | null> {
    if (type === 'create_task') {
      const r = RAW.create_task.parse(raw);
      const p = r.project ? project(s, g, r.project) : null;
      const projectMissing = r.project && !p ? `No project you can see matches “${clip(r.project, 60)}”. Pick the project.` : !r.project ? 'Pick a project.' : null;
      const assigneeIds = people(s, g, r.assignees);
      const due = day(r.due, ctx);
      const pr = priority(r.priority);
      return async (scope, dctx, cid) => {
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
        const checked = await checkCreate(scope, fields, dctx);
        const unknown = (r.assignees ?? []).filter((nm) => !('found' in matchPerson(scope.people, nm, scope.viewer.userId))).map((nm) => `No one matches “${clip(nm, 60)}”.`);
        const item: CreateTaskItem = {
          id: cid,
          type: 'create_task',
          problem: joinProblems([projectMissing ?? (p ? checked.problem : null), ...(p ? [] : fields.title.trim() ? [] : ['Give the task a title.']), due.problem, ...unknown]),
          locked: false,
          warning: joinProblems([pr.warning, pastWarning(due.day, dctx)]),
          fields,
          labels: checked.labels,
          ...(ownerDefault ? { ownerDefault: true } : {}),
        };
        return item;
      };
    }

    if (type === 'update_task') {
      const r = RAW.update_task.parse(raw);
      const t = await task(s, g, r.task);
      const set = r.assignees ? people(s, g, r.assignees) : null;
      const add = people(s, g, r.addAssignees);
      const remove = people(s, g, r.removeAssignees);
      if (!t) return null;
      return async (scope, dctx, cid) => {
        const current = await port.taskState(t.id);
        if (!current) throw new Error('gone');
        const cols = await port.columns(current.projectId);
        const problems: string[] = [];
        const fields: TaskChangeFields = {};
        if (r.due !== undefined) {
          const d = day(r.due, dctx);
          if (d.problem) problems.push(d.problem);
          else fields.due = d.day;
        } else if (r.shiftDays !== undefined) fields.due = shiftDayKey(current.due ?? dctx.today, r.shiftDays);
        const pr = priority(r.priority);
        if (pr.value) fields.priority = pr.value;
        if (r.status) {
          const col = columnFor(cols, r.status);
          if (col) fields.columnId = col.id;
          else problems.push(`${current.projectName} has no “${clip(r.status, 40)}” status. Pick one.`);
        }
        if (set || add.length || remove.length) fields.assigneeIds = uniq([...(set ?? current.assigneeIds).filter((uid) => !remove.includes(uid)), ...add]);
        const changed = changedFields(fields, current);
        const item: UpdateTaskItem = {
          id: cid,
          type: 'update_task',
          problem: null,
          locked: false,
          warning: joinProblems([pr.warning, pastWarning(changed.due, dctx)]),
          task: { id: current.id, key: current.key, title: current.title, projectId: current.projectId, project: current.projectName, url: `?task=${current.id}` },
          base: { version: current.version, assigneeIds: [...current.assigneeIds] },
          before: { due: current.due, priority: current.priority, columnId: current.columnId, column: current.columnName, assignees: named(scope, current.assigneeIds) },
          fields: changed,
          labels: {
            ...(changed.columnId ? { column: cols.find((c) => c.id === changed.columnId)?.name ?? '' } : {}),
            ...(changed.assigneeIds ? { assignees: named(scope, changed.assigneeIds) } : {}),
          },
        };
        if (Object.keys(changed).length === 0 && problems.length === 0) return { ...item, problem: NOTHING, locked: true };
        return { ...item, problem: joinProblems([...problems, await checkUpdate(scope, item, current)]) };
      };
    }

    if (type === 'draft_minutes') {
      const r = RAW.draft_minutes.parse(raw);
      const m = await meeting(s, g, r.meeting);
      if (!m) return null;
      return async (scope, _dctx, cid) => {
        const base: MinutesItem = {
          id: cid,
          type: 'draft_minutes',
          problem: null,
          locked: false,
          warning: null,
          meeting: { id: m.id, title: m.title, startAt: m.startAt.toISOString(), url: `/meetings/${m.id}` },
          fields: { content: { summary: '', discussion: [], decisions: [], risks: [], nextSteps: [] } },
          base: { status: 'NONE', savedAt: null },
        };
        const check = await minutesProblem(scope.viewer, m.id);
        const state = { status: check.current?.status ?? ('NONE' as const), savedAt: check.current ? check.current.savedAt.toISOString() : null };
        if (check.locked) return { ...base, base: state, problem: check.problem, locked: true };
        let content: FinalMinutesContent;
        try {
          content = await port.draftMinutes(scope.viewer, m.id);
        } catch (err) {
          return { ...base, base: state, problem: `The minutes couldn’t be drafted: ${plain(err, 'the AI didn’t answer.')} You can draft them on the meeting page.`, locked: true };
        }
        return {
          ...base,
          base: state,
          fields: { content },
          problem: hasContent(content) ? null : 'The draft came back empty. Write the minutes here, or on the meeting page.',
          warning: check.current ? `This replaces the draft saved on ${savedDay(check.current.savedAt)} (Undo puts it back).` : null,
        };
      };
    }

    // schedule_meeting
    const r = RAW.schedule_meeting.parse(raw);
    const p = r.project ? project(s, g, r.project) : null;
    const attendees = people(s, g, r.people).filter((uid) => uid !== s.viewer.userId);
    return async (scope, dctx, cid) => {
      const [startDate, startTime] = r.start ? r.start.split(/[T ]/, 2) : [undefined, undefined];
      const d = day(r.date ?? startDate, dctx);
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
      const checked = await checkMeeting(scope, fields);
      const unknown = (r.people ?? []).filter((nm) => !('found' in matchPerson(scope.people, nm, scope.viewer.userId))).map((nm) => `No one matches “${clip(nm, 60)}”.`);
      const projectMissing = r.project && !p ? `No project you can see matches “${clip(r.project, 60)}”.` : null;
      const timeProblem = clockWords && !clock ? `Couldn’t tell what time “${clip(clockWords, 30)}” is. Pick a time.` : null;
      return {
        id: cid,
        type: 'schedule_meeting',
        problem: joinProblems([d.problem && !r.date && !startDate ? null : d.problem, timeProblem ?? checked.problem, projectMissing, ...unknown]),
        locked: false,
        warning: null,
        fields,
        labels: checked.labels,
      } satisfies MeetingItem;
    };
  }

  /**
   * Check a "propose" reply for the person. Several matches for a name ask which one; names nothing
   * matches go back to the model (unless `final`), else they are problems on the card.
   */
  async function prepare(viewer: Viewer, changes: Array<Record<string, unknown>>, opts: { final: boolean }): Promise<ProposeOutcome> {
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
    const pending: Array<Pending | null> = [];
    const leftOut: string[] = [];
    for (const raw of usable.slice(0, maxChanges)) {
      const before = g.missing.length;
      let p: Pending | null = null;
      try {
        p = await resolveOne(s, g, raw.type as ChangeType, raw, ctx);
      } catch {
        leftOut.push('One of the changes was incomplete, so it was left out.');
      }
      if (!p && g.missing.length > before) leftOut.push(...g.missing.slice(before).map((m) => `${m.replace(/\.$/, '')}, so it was left out.`));
      pending.push(p);
    }
    if (g.ask) return { kind: 'clarify', ...g.ask };
    if (!opts.final && g.missing.length) return { kind: 'retry', problems: uniq(g.missing).slice(0, 12) };
    const items: ProposalItem[] = [];
    for (const p of pending) {
      if (!p) continue;
      try {
        items.push(await p(s, ctx, `c${items.length + 1}`));
      } catch {
        leftOut.push('One of the changes couldn’t be checked, so it was left out.');
      }
    }
    const note = uniq([...notes, ...leftOut]).join(' ') || null;
    if (items.length === 0) return { kind: 'answer', text: note ?? 'There was nothing MICO AI could change.' };
    return { kind: 'card', card: { items, note } };
  }

  // ── The person's edits ──
  /** The card with the person's edits put in (fields only; everything is checked again on Confirm). */
  function applyEdits(items: ProposalItem[], choices: ItemChoice[] = []): ProposalItem[] {
    const byId = new Map(choices.map((c) => [c.id, c]));
    return items.map((item) => {
      const edits = byId.get(item.id)?.edits;
      if (!edits || item.locked) return item;
      const parsed = EDITS[item.type].safeParse(edits);
      if (!parsed.success) return { ...item, problem: 'That edit couldn’t be used. Check the values.' };
      const e = parsed.data as Record<string, unknown>;
      switch (item.type) {
        case 'create_task':
          return { ...item, fields: { ...item.fields, ...(e as Partial<CreateTaskFields>) } };
        case 'update_task': {
          const next: TaskChangeFields = { ...item.fields, ...(e as TaskChangeFields) };
          return { ...item, fields: next };
        }
        case 'draft_minutes': {
          if (e.content === undefined) return item;
          try {
            return { ...item, fields: { content: normalizeFinalMinutes(e.content) } };
          } catch {
            return { ...item, problem: 'That edit couldn’t be used. Check the values.' };
          }
        }
        case 'schedule_meeting':
          return { ...item, fields: { ...item.fields, ...(e as Partial<MeetingFields>) } };
      }
    });
  }

  // ── carryOut ──
  async function carryOut(viewer: Viewer, items: ProposalItem[], opts: CarryOutOptions): Promise<{ items: ProposalItem[]; results: Record<string, ItemResult> }> {
    const s = await scopeOf(viewer);
    const ctx = await dayContext();
    const results: Record<string, ItemResult> = {};
    const out: ProposalItem[] = [];
    const audit = (entry: Omit<Parameters<MicoAiWritePort['audit']>[0], 'userId' | 'ip'>) => port.audit({ userId: viewer.userId, ip: opts.ip, ...entry }).catch(() => undefined);
    const refuse = (message: string): ItemResult => ({ status: 'refused', message, link: null });

    async function one(item: ProposalItem): Promise<{ item: ProposalItem; result: ItemResult }> {
      if (!opts.include[item.id]) return { item, result: { status: 'skipped', message: null, link: null } };
      if (item.locked) return { item, result: refuse(item.problem ?? 'This change can’t be made.') };
      if (item.problem && /couldn’t be used/.test(item.problem)) return { item, result: refuse(item.problem) };

      if (item.type === 'create_task') {
        const f = { ...item.fields, title: item.fields.title.trim(), description: item.fields.description.trim(), assigneeIds: uniq(item.fields.assigneeIds) };
        const checked = await checkCreate(s, f, ctx);
        const fresh: CreateTaskItem = { ...item, fields: f, labels: checked.labels };
        if (checked.problem || !checked.columnId) return { item: fresh, result: refuse(checked.problem ?? 'This change can’t be made.') };
        const t = await port.createTask(viewer, { projectId: f.projectId!, columnId: checked.columnId, title: f.title, description: f.description, priority: f.priority, due: f.due, assigneeIds: f.assigneeIds });
        await audit({ action: 'mico-ai.task.create', entityId: t.id, newValue: { via: VIA, key: t.key, title: t.title, projectId: t.projectId, assigneeIds: f.assigneeIds, due: f.due, priority: f.priority } });
        const undo: UndoData = { kind: 'task-created', taskId: t.id, projectId: t.projectId, version: t.version, activity: t.activity, assigneeIds: t.assigneeIds };
        return { item: fresh, result: { status: 'done', message: null, link: { label: t.key, url: `?task=${t.id}` }, undo } };
      }

      if (item.type === 'update_task') {
        const current = await port.taskState(item.task.id);
        if (!current) return { item, result: refuse(`${item.task.key} was deleted, so nothing was changed.`) };
        if (!(await port.canViewTask(viewer, current.id))) return { item, result: refuse(`You can’t change ${item.task.key} any more.`) };
        if (current.version !== item.base.version || !sameSet(current.assigneeIds, item.base.assigneeIds)) {
          const who = current.lastActor ? ` (${current.lastActor} changed it)` : '';
          return { item, result: refuse(`${item.task.key} changed after MICO AI suggested this${who}, so it was left as it is. Ask again to see it as it is now.`) };
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
        if (Object.keys(change).length === 0) return { item: fresh, result: refuse(NOTHING) };
        const problem = await checkUpdate(s, fresh, current);
        if (problem) return { item: fresh, result: refuse(problem) };
        const { assigneeIds, ...fieldsOnly } = change;
        try {
          if (Object.keys(fieldsOnly).length) await port.updateTask(viewer, current.id, fieldsOnly, current.version);
        } catch (err) {
          if (isConflict(err)) return { item: fresh, result: refuse(`${item.task.key} changed after MICO AI suggested this, so it was left as it is. Ask again to see it as it is now.`) };
          throw err;
        }
        if (assigneeIds) {
          await port.setAssignees(
            viewer,
            current.id,
            assigneeIds.filter((uid) => !current.assigneeIds.includes(uid)),
            current.assigneeIds.filter((uid) => !assigneeIds.includes(uid)),
          );
        }
        const after = (await port.taskState(current.id))!;
        const before: TaskChangeFields = {};
        if (change.due !== undefined) before.due = current.due;
        if (change.priority !== undefined) before.priority = current.priority;
        if (change.columnId !== undefined) before.columnId = current.columnId;
        if (change.assigneeIds !== undefined) before.assigneeIds = [...current.assigneeIds];
        await audit({ action: 'mico-ai.task.update', entityId: current.id, oldValue: before, newValue: { via: VIA, key: current.key, ...change } });
        const undo: UndoData = { kind: 'task-updated', taskId: current.id, projectId: current.projectId, version: after.version, activity: after.activity, assigneeIds: after.assigneeIds, before };
        return { item: fresh, result: { status: 'done', message: null, link: { label: current.key, url: `?task=${current.id}` }, undo } };
      }

      if (item.type === 'draft_minutes') {
        if (!(await port.canEditMeeting(viewer, item.meeting.id))) return { item, result: refuse(MINUTES_EDITORS) };
        // Changed since the draft was made (saved again, or marked final): that is the reason to give.
        const latest = await port.minutes(item.meeting.id);
        const now0 = { status: latest?.status ?? 'NONE', savedAt: latest ? latest.savedAt.toISOString() : null };
        if (now0.status !== item.base.status || now0.savedAt !== item.base.savedAt) {
          return { item, result: refuse('The final minutes changed after MICO AI drafted these, so they were left as they are. Ask again for a fresh draft.') };
        }
        const check = await minutesProblem(viewer, item.meeting.id);
        if (check.locked) return { item, result: refuse(check.problem!) };
        if (!hasContent(item.fields.content)) return { item, result: refuse('There’s nothing in the draft.') };
        const previous = check.current
          ? { content: check.current.content, status: check.current.status, approvedById: check.current.approvedById, approvedAt: check.current.approvedAt ? check.current.approvedAt.toISOString() : null }
          : null;
        const saved = await port.saveMinutes(viewer, item.meeting.id, { content: item.fields.content, status: 'DRAFT', approvedById: null, approvedAt: null });
        await audit({ action: 'mico-ai.minutes.draft', entityId: item.meeting.id, newValue: { via: VIA, meeting: item.meeting.title, status: 'DRAFT' } });
        const undo: UndoData = { kind: 'minutes-saved', meetingId: item.meeting.id, savedAt: saved.savedAt.toISOString(), previous };
        return { item, result: { status: 'done', message: 'Saved as a draft on the meeting page, for review. It isn’t final or emailed.', link: { label: 'Open the meeting', url: item.meeting.url }, undo } };
      }

      // schedule_meeting
      const f: MeetingFields = { ...item.fields, title: item.fields.title.trim(), attendeeIds: uniq(item.fields.attendeeIds.filter((uid) => uid !== viewer.userId)), agenda: item.fields.agenda.map((a) => a.trim()).filter(Boolean) };
      const checked = await checkMeeting(s, f);
      const fresh: MeetingItem = { ...item, fields: f, labels: checked.labels };
      if (checked.problem) return { item: fresh, result: refuse(checked.problem) };
      const startAt = zonedInstant(f.date!, f.time!, timeZone);
      const created = await port.createMeeting(viewer, { title: f.title, projectId: f.projectId, startAt, endAt: new Date(startAt.getTime() + f.minutes * 60_000), description: f.description, attendeeIds: f.attendeeIds, agenda: f.agenda });
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
      const stamp = (await port.meetingStamp(created.id)) ?? created;
      await audit({ action: 'mico-ai.meeting.create', entityId: created.id, newValue: { via: VIA, title: f.title, startAt: startAt.toISOString(), projectId: f.projectId, attendeeIds: f.attendeeIds, invitationsEmailed: invited } });
      const undo: UndoData = { kind: 'meeting-created', meetingId: created.id, stamp: stamp.stamp, invited: invited || !!stamp.invitesSentAt };
      return { item: fresh, result: { status: 'done', message, link: { label: f.title, url: `/meetings/${created.id}` }, undo } };
    }

    await port.asMicoAi(async () => {
      for (const item of items) {
        let done: { item: ProposalItem; result: ItemResult };
        try {
          done = await one(item);
        } catch (err) {
          done = { item, result: { status: 'failed', message: plain(err, FAILED), link: null } };
        }
        out.push(done.item);
        results[item.id] = done.result;
        await opts.onResult?.({ ...results });
      }
    });
    return { items: out, results };
  }

  // ── revert (Undo) ──
  async function revert(viewer: Viewer, items: ProposalItem[], results: Record<string, ItemResult>, opts: { ip: string | null; onUndo?: (undo: Record<string, ItemUndo>) => Promise<void> }): Promise<Record<string, ItemUndo>> {
    const undo: Record<string, ItemUndo> = {};
    const audit = (entityId: string, type: ChangeType) => port.audit({ userId: viewer.userId, ip: opts.ip, action: 'mico-ai.undo', entityId, newValue: { via: VIA, change: type } }).catch(() => undefined);
    const refused = (message: string): ItemUndo => ({ status: 'refused', message });

    async function one(item: ProposalItem, data: UndoData): Promise<ItemUndo> {
      if (data.kind === 'task-created' || data.kind === 'task-updated') {
        const key = item.type === 'update_task' ? item.task.key : (results[item.id]?.link?.label ?? 'The task');
        const t = await port.taskState(data.taskId);
        if (!t) return refused(data.kind === 'task-created' ? `${key} was already deleted.` : `${key} was deleted since.`);
        if (!(await port.canViewTask(viewer, t.id))) return refused(`You can’t change ${key} any more, so it was left as it is.`);
        if (t.version !== data.version || t.activity !== data.activity || !sameSet(t.assigneeIds, data.assigneeIds)) {
          return refused(`${t.lastActor ?? 'Someone'} changed ${key} since, so it was left as it is.`);
        }
        if (data.kind === 'task-created') {
          await port.deleteTask(viewer, t.id);
          await audit(t.id, item.type);
          return { status: 'undone', message: `${key} was deleted.` };
        }
        const { assigneeIds, ...fieldsOnly } = data.before;
        if (Object.keys(fieldsOnly).length) await port.updateTask(viewer, t.id, fieldsOnly, t.version);
        if (assigneeIds) await port.setAssignees(viewer, t.id, assigneeIds.filter((uid) => !t.assigneeIds.includes(uid)), t.assigneeIds.filter((uid) => !assigneeIds.includes(uid)));
        await audit(t.id, item.type);
        return { status: 'undone', message: `${key} is back as it was.` };
      }
      if (data.kind === 'meeting-created') {
        const m = await port.meetingStamp(data.meetingId);
        if (!m || m.status === 'CANCELLED') return refused('The meeting was already deleted or cancelled.');
        if (!(await port.canEditMeeting(viewer, m.id))) return refused('You can’t change the meeting any more, so it was left as it is.');
        if (m.stamp !== data.stamp) return refused('The meeting was changed since, so it was left as it is.');
        const how = await port.removeMeeting(viewer, m.id, data.invited || !!m.invitesSentAt);
        await audit(m.id, item.type);
        return { status: 'undone', message: how === 'cancelled' ? 'The meeting was cancelled, and the people invited were told.' : 'The meeting was deleted.' };
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
