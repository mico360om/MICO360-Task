import { z, type ZodTypeAny } from 'zod';
import { dueDayKey, daysUntilDue, isOverdue, shiftDayKey, todayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { CATEGORY_ORDER, categoryLabel, priorityLabel, wallClock } from '../../lib/export-format';
import { isTaskDone } from '../tasks/task-status';
import { matchesNormalized, normalizeForSearch } from '../search/text-normalize';
import { buildTimeline } from '../activity/activity-feed';
import { withoutHiddenBlockers } from '../activity/hidden-blockers';
import { completionStats, projectPerformance, statusBreakdown, userWorkload, type ReportTask } from '../reports/report-service';
import type { ToolInfo } from './mico-ai-loop';
import { MAX_RESULT_ROWS, refKey, type ResultColumn, type ResultRow, type SourceRef, type StoredResult, type ToolResult } from './mico-ai-types';
import type { AiMeetingRec, AiPersonRec, AiProjectRec, AiTaskLink, AiTaskRec, MicoAiDataPort, Viewer } from './mico-ai-data';

/**
 * MICO AI's read-only tools. Each one has a checked argument schema (no free queries), reads
 * through the data port with the person's own scope — the project ids the project-access rule
 * gives them (null for an admin), the meeting rule, the chat module's conversations — and checks
 * every row against that scope again before using it. A row carries the source it came from.
 */

export const TOOL_NAMES = [
  'search_tasks',
  'task_details',
  'list_projects',
  'project_details',
  'project_activity',
  'list_meetings',
  'meeting_details',
  'list_action_items',
  'report_figures',
  'search_chat',
  'find_people',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface MicoAiToolsDeps {
  data: MicoAiDataPort;
  timeZone: string;
  now?: () => Date;
}

type ToolOutput = Omit<ToolResult, 'id' | 'truncated'> & { truncated?: boolean };

/** A tool's own words for a problem the model should hear (bad name, nothing visible by that name). */
class ToolProblem extends Error {}

// ── Arguments ──────────────────────────────────────────────────────────────────
const words = (max = 120) => z.string().trim().min(1).max(max);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month (YYYY-MM)');
const lower = <T extends [string, ...string[]]>(values: T) => z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : v), z.enum(values));

const STATUS = ['open', 'done', 'overdue', 'blocked', 'in_progress', 'todo', 'review', 'backlog', 'any'] as const;
const SCHEMAS: Record<ToolName, ZodTypeAny> = {
  search_tasks: z.object({
    project: words().optional(),
    assignee: words().optional(),
    status: lower([...STATUS]).optional(),
    priority: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])).optional(),
    dueFrom: day.optional(),
    dueTo: day.optional(),
    completedFrom: day.optional(),
    completedTo: day.optional(),
    text: words(200).optional(),
    milestones: z.boolean().optional(),
  }),
  task_details: z.object({ task: words() }),
  list_projects: z.object({ status: lower(['planning', 'active', 'on_hold', 'completed', 'archived', 'any']).optional(), text: words().optional() }),
  project_details: z.object({ project: words() }),
  project_activity: z.object({ project: words().optional(), from: day.optional(), to: day.optional() }),
  list_meetings: z.object({ project: words().optional(), from: day.optional(), to: day.optional(), month: month.optional(), text: words(200).optional() }),
  meeting_details: z.object({ meeting: words(200) }),
  list_action_items: z.object({
    project: words().optional(),
    assignee: words().optional(),
    status: lower(['open', 'done', 'any']).optional(),
    from: day.optional(),
    to: day.optional(),
    month: month.optional(),
  }),
  report_figures: z.object({
    report: lower(['workload', 'projects', 'status', 'completion']),
    project: words().optional(),
    person: words().optional(),
    dueFrom: day.optional(),
    dueTo: day.optional(),
  }),
  search_chat: z.object({ text: words(200).optional(), project: words().optional(), person: words().optional(), from: day.optional(), to: day.optional() }),
  find_people: z.object({ name: words().optional(), project: words().optional() }),
};

const short = (v: unknown, n = 40) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const inProject = (a: Record<string, unknown>) => (a.project ? ` in ${short(a.project)}` : '');

const CATALOGUE: Record<ToolName, Omit<ToolInfo, 'name'>> = {
  search_tasks: {
    purpose: 'Find tasks the user can see. Rows: key, title, project, status, priority, assignees, due, overdueDays, completed, progress.',
    args: '{"project"?: name|code|number, "assignee"?: name|username|"me", "status"?: "open"|"done"|"overdue"|"blocked"|"in_progress"|"todo"|"review"|"backlog", "priority"?: "LOW"|"NORMAL"|"HIGH"|"URGENT", "dueFrom"?, "dueTo"?, "completedFrom"?, "completedTo"?, "text"?, "milestones"?: true}',
    step: (a) => `Checking tasks${inProject(a)}…`,
  },
  task_details: {
    purpose: 'One task in full: description, checklist, comments, history, blockers and its meeting.',
    args: '{"task": key (e.g. RIG-14) or id}',
    step: (a) => `Reading ${short(a.task, 30)}…`,
  },
  list_projects: {
    purpose: 'Projects the user can see, with progress (% done), task counts, overdue and dates.',
    args: '{"status"?: "planning"|"active"|"on_hold"|"completed"|"archived", "text"?}',
    step: () => 'Checking projects…',
  },
  project_details: {
    purpose: 'One project: progress, tasks by status, milestones, deadlines in the next 14 days, owner, manager and members.',
    args: '{"project": name|code|number}',
    step: (a) => `Checking ${short(a.project)}…`,
  },
  project_activity: {
    purpose: 'What changed in tasks (moves, edits, comments, assignments) in a period, newest first. Default: the last 7 days.',
    args: '{"project"?: name|code|number, "from"?, "to"?}',
    step: (a) => `Checking what changed${inProject(a)}…`,
  },
  list_meetings: {
    purpose:
      'Meetings the user can see that start in a period, nearest to today first (upcoming, then the latest past ones), with decisions and open action items. Default: 30 days back to 30 days ahead; "from" alone: 30 days from it; "month": that month.',
    args: '{"project"?: name|code|number, "from"?, "to"?, "month"?: "YYYY-MM", "text"?}',
    step: (a) => `Checking meetings${a.project ? ` for ${short(a.project)}` : ''}…`,
  },
  meeting_details: {
    purpose: 'One meeting in full: attendees, agenda, notes, action items, decisions and its final minutes (Final MOM).',
    args: '{"meeting": its ref (meeting:<id>) or title}',
    step: () => 'Reading the meeting…',
  },
  list_action_items: {
    purpose: 'Action items from meetings the user can see, by the meeting’s date, the latest meetings first (default: the last 30 days; "month": that month).',
    args: '{"project"?: name|code|number, "assignee"?: name|"me", "status"?: "open"|"done", "from"?, "to"?, "month"?: "YYYY-MM"}',
    step: () => 'Checking action items…',
  },
  report_figures: {
    purpose:
      'The Reports page’s figures over the tasks the user can see: "workload" (per person: assigned, open, completed, overdue; colleagues only for admins and for the managers of their projects), "projects" (per project: total, completed, overdue, completionPct), "status" (tasks per status) or "completion" (on time vs late). dueFrom/dueTo count only tasks due in that period.',
    args: '{"report": "workload"|"projects"|"status"|"completion", "project"?: name|code|number, "person"?: name|"me", "dueFrom"?, "dueTo"?}',
    step: (a) => `Working out the figures${a.project ? ` for ${short(a.project)}` : ''}…`,
  },
  search_chat: {
    purpose: 'Team chat messages in the conversations the user is part of (their project channels and their direct messages), newest first. Default: the last 30 days.',
    args: '{"text"?, "project"?: name|code|number (its channel), "person"?: name (messages from or with them), "from"?, "to"?}',
    step: () => 'Searching team chat…',
  },
  find_people: {
    purpose: 'Who is who: names, usernames, and their role in the user’s projects.',
    args: '{"name"?, "project"?: name|code|number}',
    step: () => 'Looking up people…',
  },
};

// ── Columns ────────────────────────────────────────────────────────────────────
const TASK_COLUMNS: ResultColumn[] = [
  { key: 'key', label: 'Task', kind: 'key' },
  { key: 'title', label: 'Title' },
  { key: 'project', label: 'Project' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignees', label: 'Assigned to' },
  { key: 'due', label: 'Due', kind: 'date' },
  { key: 'overdueDays', label: 'Overdue', kind: 'days' },
  { key: 'completed', label: 'Completed', kind: 'date' },
  { key: 'progress', label: 'Progress', kind: 'percent' },
];
const PROJECT_COLUMNS: ResultColumn[] = [
  { key: 'code', label: 'Code', kind: 'key' },
  { key: 'name', label: 'Project' },
  { key: 'number', label: 'Number' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Done', kind: 'percent' },
  { key: 'tasks', label: 'Tasks', kind: 'number' },
  { key: 'open', label: 'Open', kind: 'number' },
  { key: 'overdue', label: 'Overdue', kind: 'number' },
  { key: 'start', label: 'Start', kind: 'date' },
  { key: 'target', label: 'Target', kind: 'date' },
  { key: 'manager', label: 'Manager' },
];
const MEETING_COLUMNS: ResultColumn[] = [
  { key: 'when', label: 'When', kind: 'datetime' },
  { key: 'title', label: 'Meeting' },
  { key: 'project', label: 'Project' },
  { key: 'organizer', label: 'Organizer' },
  { key: 'status', label: 'Status' },
  { key: 'decisions', label: 'Decisions', kind: 'number' },
  { key: 'openActions', label: 'Open action items', kind: 'number' },
];

const PROJECT_STATUS: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
const MEETING_STATUS: Record<string, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const ACTION_STATUS: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', PENDING: 'Pending', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const NOTE_TYPE: Record<string, string> = { DISCUSSION: 'Discussion', DECISION: 'Decision', ACTION: 'Action', ISSUE: 'Issue', QUESTION: 'Question', INFORMATION: 'Information' };
const ROLE_LABEL = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Member' } as const;
const ROLE_RANK = { OWNER: 0, MANAGER: 1, MEMBER: 2 } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nameOf = (p: Pick<AiPersonRec, 'firstName' | 'lastName' | 'username'> | undefined) => (p ? `${p.firstName} ${p.lastName}`.trim() || p.username : '');
const taskRef = (t: Pick<AiTaskLink, 'id' | 'key'>): SourceRef => ({ type: 'task', id: t.id, label: t.key, url: `?task=${t.id}` });
const projectRef = (p: Pick<AiProjectRec, 'id' | 'name'>): SourceRef => ({ type: 'project', id: p.id, label: p.name, url: `/projects/${p.id}` });
const OPEN_ACTION = new Set(['OPEN', 'IN_PROGRESS', 'PENDING']);
/** At most this many blockers (and tasks it blocks) are listed for a task. */
const MAX_LINKS = 10;
const empty = (tool: string, args: Record<string, unknown>, error: string): ToolOutput => ({ tool, args, title: tool, columns: [], rows: [], total: 0, error });


export function createMicoAiTools({ data, timeZone, now = () => new Date() }: MicoAiToolsDeps) {
  const catalogue: ToolInfo[] = TOOL_NAMES.map((name) => ({ name, ...CATALOGUE[name] }));

  const today = () => todayKey(timeZone, now());
  const startOf = (key: string) => zonedStartOfDay(key, timeZone);
  const endOf = (key: string) => new Date(zonedStartOfDay(shiftDayKey(key, 1), timeZone).getTime() - 1);
  const shortDay = (at: Date) => {
    const k = zonedDayKey(at, timeZone);
    return `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]}`;
  };
  const meetingRef = (m: Pick<AiMeetingRec, 'id' | 'title' | 'startAt'>): SourceRef => ({ type: 'meeting', id: m.id, label: `${clip(m.title, 50)} · ${shortDay(m.startAt)}`, url: `/meetings/${m.id}` });

  /** Everything a tool needs to know about who is asking. */
  async function scopeOf(viewer: Viewer) {
    const projectIds = await data.accessibleProjectIds(viewer);
    const [projects, people] = await Promise.all([data.projects(projectIds), data.people()]);
    const visible = projectIds === null ? projects : projects.filter((p) => projectIds.includes(p.id));
    const allowed = (projectId: string | null | undefined) => !!projectId && (projectIds === null || projectIds.includes(projectId));
    return { viewer, projectIds, projects: visible, people, allowed, person: new Map(people.map((p) => [p.id, p])) };
  }
  type Scope = Awaited<ReturnType<typeof scopeOf>>;

  function resolveProject(s: Scope, said: string): AiProjectRec {
    const n = normalizeForSearch(said);
    const exact = s.projects.filter((p) => [p.code, p.number, p.name].some((x) => x && normalizeForSearch(x) === n));
    const found = exact.length ? exact : s.projects.filter((p) => matchesNormalized(n, p.name, p.code, p.number));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new ToolProblem(`Several projects match “${said}”: ${found.slice(0, 6).map((p) => `${p.name} (${p.code})`).join(', ')}. Ask which one.`);
    throw new ToolProblem(`No project you can see matches “${said}”.`);
  }

  function resolvePerson(s: Scope, said: string): AiPersonRec {
    if (/^(me|myself|my|i|mine)$/i.test(said.trim())) {
      const me = s.person.get(s.viewer.userId);
      if (me) return me;
    }
    const n = normalizeForSearch(said);
    const exact = s.people.filter((p) => [p.username, p.firstName, p.lastName, `${p.firstName} ${p.lastName}`].some((x) => normalizeForSearch(x) === n));
    const found = exact.length ? exact : s.people.filter((p) => matchesNormalized(n, `${p.firstName} ${p.lastName}`, p.username));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new ToolProblem(`Several people match “${said}”: ${found.slice(0, 6).map((p) => `${nameOf(p)} (${p.username})`).join(', ')}. Ask which one.`);
    throw new ToolProblem(`No one matches “${said}”.`);
  }

  const assigneesText = (s: Scope, ids: string[]) => ids.map((id) => nameOf(s.person.get(id))).filter(Boolean).join(', ');
  function taskRow(s: Scope, t: AiTaskRec): ResultRow {
    const done = isTaskDone({ columnCategory: t.category, completedAt: t.completedAt });
    const until = daysUntilDue(t.dueDate, timeZone, now());
    return {
      ref: taskRef(t),
      values: {
        key: t.key,
        title: t.title,
        project: t.projectName,
        status: t.columnName || categoryLabel(t.category),
        priority: priorityLabel(t.priority),
        assignees: assigneesText(s, t.assigneeIds),
        due: dueDayKey(t.dueDate, timeZone),
        overdueDays: !done && until !== null && until < 0 ? -until : null,
        completed: done && t.completedAt ? zonedDayKey(t.completedAt, timeZone) : null,
        progress: done ? 100 : Math.max(0, Math.min(100, t.progress)),
      },
    };
  }
  const byDue = (a: AiTaskRec, b: AiTaskRec) => {
    const da = isTaskDone({ columnCategory: a.category, completedAt: a.completedAt });
    const db = isTaskDone({ columnCategory: b.category, completedAt: b.completedAt });
    return (
      Number(da) - Number(db) ||
      (dueDayKey(a.dueDate, timeZone) ?? '9999').localeCompare(dueDayKey(b.dueDate, timeZone) ?? '9999') ||
      a.key.localeCompare(b.key, undefined, { numeric: true })
    );
  };
  const toReportTask = (t: AiTaskRec): ReportTask => ({
    id: t.id,
    projectId: t.projectId,
    projectName: t.projectName,
    columnCategory: t.category,
    createdAt: t.createdAt,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    assigneeIds: t.assigneeIds,
  });
  const dueWithin = (t: AiTaskRec, from?: string, to?: string) => {
    if (!from && !to) return true;
    const due = dueDayKey(t.dueDate, timeZone);
    return !!due && (!from || due >= from) && (!to || due <= to);
  };

  /** The person's tasks, checked against their scope again (a row from another project never gets through). */
  async function visibleTasks(s: Scope, filter: { projectId?: string; assigneeId?: string } = {}) {
    const rows = await data.tasks({ projectIds: s.projectIds, ...filter });
    return rows.filter((t) => s.allowed(t.projectId) && (!filter.projectId || t.projectId === filter.projectId) && (!filter.assigneeId || t.assigneeIds.includes(filter.assigneeId)));
  }

  /** The meeting rule, on a listed meeting's own facts. */
  const meetingVisible = (s: Scope, m: AiMeetingRec) =>
    s.viewer.roles.includes('ADMIN') || m.organizerId === s.viewer.userId || m.createdById === s.viewer.userId || m.attendeeUserIds.includes(s.viewer.userId) || s.allowed(m.projectId);

  /** Meetings the person may see, nearest to today first (upcoming soonest, then the latest past); `total` counts all. */
  async function visibleMeetings(s: Scope, filter: { projectId?: string; from: Date; to: Date; text?: string }) {
    const found = await data.meetings(s.viewer, { projectIds: s.projectIds, ...filter, limit: MAX_RESULT_ROWS, around: now() });
    const rows = found.rows.filter((m) => meetingVisible(s, m) && (!filter.projectId || m.projectId === filter.projectId) && m.startAt >= filter.from && m.startAt <= filter.to);
    return { rows, total: Math.max(rows.length, found.total - (found.rows.length - rows.length)) };
  }

  /** May this person see a colleague's workload? Admins: anyone; a project's managers: its people; anyone else: themselves. */
  async function workloadPeople(s: Scope, projectId: string | null): Promise<Set<string> | null> {
    if (s.viewer.roles.includes('ADMIN')) return null;
    const all = (await data.memberships(s.projectIds)).filter((m) => s.allowed(m.projectId) && (!projectId || m.projectId === projectId));
    const managed = new Set(all.filter((m) => m.userId === s.viewer.userId && (m.role === 'OWNER' || m.role === 'MANAGER')).map((m) => m.projectId));
    const people = new Set([s.viewer.userId, ...all.filter((m) => managed.has(m.projectId)).map((m) => m.userId)]);
    return people;
  }

  const projectName = (s: Scope, id: string | null) => (id ? (s.projects.find((p) => p.id === id)?.name ?? '') : '');
  const range = (from: string | undefined, to: string | undefined, back: number, ahead: number) => {
    const t = today();
    const f = from ?? (to ? shiftDayKey(to, -back) : shiftDayKey(t, -back));
    const e = to ?? (from && ahead === 0 ? t : shiftDayKey(t, ahead));
    return { fromKey: f, toKey: e, from: startOf(f), to: endOf(e) };
  };
  /** A named month ("2026-02") from its first to its last day. */
  const monthRange = (m: string) => {
    const first = `${m}-01`;
    const last = shiftDayKey(`${shiftDayKey(first, 32).slice(0, 7)}-01`, -1);
    return { fromKey: first, toKey: last, from: startOf(first), to: endOf(last) };
  };
  /** A meeting period: a month, "from" alone (30 days from it), or around today. */
  const meetingRange = (a: Record<string, unknown>) => {
    if (a.month) return monthRange(a.month as string);
    if (a.from && !a.to) return range(a.from as string, shiftDayKey(a.from as string, 30), 30, 30);
    return range(a.from as string | undefined, a.to as string | undefined, 30, 30);
  };
  const dropped = <T,>(page: { rows: T[]; total: number }, kept: T[]) => Math.max(kept.length, page.total - (page.rows.length - kept.length));

  // ── The tools ────────────────────────────────────────────────────────────────
  const run: Record<ToolName, (s: Scope, a: Record<string, unknown>) => Promise<ToolOutput>> = {
    async search_tasks(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const person = a.assignee ? resolvePerson(s, a.assignee as string) : null;
      const status = (a.status as (typeof STATUS)[number] | undefined) ?? 'any';
      const q = normalizeForSearch(a.text as string | undefined);
      const rows = (await visibleTasks(s, { projectId: project?.id, assigneeId: person?.id }))
        .filter((t) => {
          const done = isTaskDone({ columnCategory: t.category, completedAt: t.completedAt });
          if (status === 'open' && done) return false;
          if (status === 'done' && !done) return false;
          if (status === 'overdue' && (done || !isOverdue(t.dueDate, timeZone, now()))) return false;
          const cat: Record<string, string> = { blocked: 'BLOCKED', in_progress: 'IN_PROGRESS', todo: 'TODO', review: 'REVIEW', backlog: 'BACKLOG' };
          if (cat[status] && (done || t.category !== cat[status])) return false;
          if (a.priority && t.priority !== a.priority) return false;
          if (a.milestones && !t.isMilestone) return false;
          if (!dueWithin(t, a.dueFrom as string | undefined, a.dueTo as string | undefined)) return false;
          if (a.completedFrom || a.completedTo) {
            const c = done && t.completedAt ? zonedDayKey(t.completedAt, timeZone) : null;
            if (!c || (a.completedFrom && c < (a.completedFrom as string)) || (a.completedTo && c > (a.completedTo as string))) return false;
          }
          if (q && !matchesNormalized(q, t.title, t.key)) return false;
          return true;
        })
        .sort(byDue);
      const label = { open: 'Open tasks', done: 'Completed tasks', overdue: 'Overdue tasks', blocked: 'Blocked tasks', in_progress: 'Tasks in progress', todo: 'To-do tasks', review: 'Tasks in review', backlog: 'Backlog tasks', any: 'Tasks' }[status];
      const title = `${label}${project ? ` in ${project.name}` : ''}${person ? ` assigned to ${nameOf(person)}` : ''}`;
      return { tool: 'search_tasks', args: a, title, columns: TASK_COLUMNS, rows: rows.slice(0, MAX_RESULT_ROWS).map((t) => taskRow(s, t)), total: rows.length };
    },

    async task_details(s, a) {
      const said = String(a.task).replace(/^task:/, '');
      const t = await data.findTask(s.projectIds, said);
      if (!t || !s.allowed(t.projectId)) throw new ToolProblem(`No task you can see matches “${said}”.`);
      const x = await data.taskExtras(t.id);
      const link = (l: AiTaskLink) => ({ ref: `task:${l.id}`, key: l.key, title: clip(l.title, 120), status: l.columnName || categoryLabel(l.category) });
      // A blocker in a project the person can't see is left out silently, as the task panel does.
      const blockedBy = x.blockedBy.filter((l) => s.allowed(l.projectId)).slice(0, MAX_LINKS);
      const blocks = x.blocks.filter((l) => s.allowed(l.projectId)).slice(0, MAX_LINKS);
      const canOpen = async (taskId: string) => {
        const other = await data.findTask(s.projectIds, taskId);
        return !!other && s.allowed(other.projectId);
      };
      const activity = await withoutHiddenBlockers(x.activity, canOpen);
      const history = buildTimeline(activity.slice(0, 60).map((e) => ({ id: e.id, action: e.action, actorName: nameOf(s.person.get(e.userId)) || 'Someone', createdAt: e.createdAt.toISOString(), meta: (e.meta as Record<string, unknown> | null) ?? null })))
        .slice(0, 15)
        .map((h) => ({ at: h.createdAt ? wallClock(new Date(h.createdAt), timeZone) : null, who: h.actorName, what: clip(`${h.text}${h.path ? ` (${h.path.join(' → ')})` : ''}`, 200) }));
      const meeting = x.meeting && (await data.canViewMeeting(s.viewer, x.meeting.id)) ? x.meeting : null;
      const detailRefs = [...blockedBy, ...blocks].map(taskRef);
      if (meeting) detailRefs.push(meetingRef(meeting));
      return {
        tool: 'task_details',
        args: a,
        title: `${t.key} ${t.title}`,
        columns: TASK_COLUMNS,
        rows: [taskRow(s, t)],
        total: 1,
        details: {
          description: clip(x.description, 1200) || null,
          milestone: t.isMilestone,
          start: dueDayKey(t.startDate, timeZone),
          checklist: x.checklist.slice(0, 25).map((c) => ({ item: clip(c.text, 150), done: c.done })),
          comments: x.comments.slice(-10).map((c) => ({ by: nameOf(s.person.get(c.userId)) || 'Someone', at: wallClock(c.createdAt, timeZone), text: clip(c.body, 300) })),
          history,
          blockedBy: blockedBy.map(link),
          blocks: blocks.map(link),
          meeting: meeting ? { ref: `meeting:${meeting.id}`, title: meeting.title, date: zonedDayKey(meeting.startAt, timeZone) } : null,
        },
        detailRefs,
      };
    },

    async list_projects(s, a) {
      const status = (a.status as string | undefined) ?? 'any';
      const q = normalizeForSearch(a.text as string | undefined);
      const projects = s.projects
        .filter((p) => (status === 'any' || p.status === status.toUpperCase()) && (!q || matchesNormalized(q, p.name, p.code, p.number, p.clientName)))
        .sort((x, y) => x.name.localeCompare(y.name));
      const tasks = await visibleTasks(s);
      const rows = projects.map((p): ResultRow => {
        const mine = tasks.filter((t) => t.projectId === p.id);
        const perf = projectPerformance(mine.map(toReportTask), timeZone, now())[0];
        const completed = perf?.completed ?? 0;
        return {
          ref: projectRef(p),
          values: {
            code: p.code,
            name: p.name,
            number: p.number,
            status: PROJECT_STATUS[p.status] ?? p.status,
            progress: perf?.completionPct ?? 0,
            tasks: mine.length,
            open: mine.length - completed,
            overdue: perf?.overdue ?? 0,
            start: dueDayKey(p.startDate, timeZone),
            target: dueDayKey(p.targetDate, timeZone),
            manager: nameOf(s.person.get(p.managerId ?? '')) || null,
          },
        };
      });
      return { tool: 'list_projects', args: a, title: 'Projects', columns: PROJECT_COLUMNS, rows, total: rows.length };
    },

    async project_details(s, a) {
      const p = resolveProject(s, a.project as string);
      const [tasks, members] = await Promise.all([visibleTasks(s, { projectId: p.id }), data.memberships([p.id])]);
      const listed = (await run.list_projects(s, {})).rows.filter((r) => r.ref?.id === p.id);
      const byStatus: Record<string, number> = {};
      for (const t of tasks) {
        const label = t.columnName || categoryLabel(t.category);
        byStatus[label] = (byStatus[label] ?? 0) + 1;
      }
      const t0 = today();
      const open = tasks.filter((t) => !isTaskDone({ columnCategory: t.category, completedAt: t.completedAt }));
      const milestones = tasks.filter((t) => t.isMilestone).sort(byDue);
      const deadlines = open.filter((t) => {
        const due = dueDayKey(t.dueDate, timeZone);
        return !!due && due >= t0 && due <= shiftDayKey(t0, 14);
      }).sort(byDue);
      const people = members
        .filter((m) => m.projectId === p.id)
        .sort((x, y) => ROLE_RANK[x.role] - ROLE_RANK[y.role] || nameOf(s.person.get(x.userId)).localeCompare(nameOf(s.person.get(y.userId))))
        .map((m) => ({ name: nameOf(s.person.get(m.userId)), role: ROLE_LABEL[m.role] }))
        .filter((m) => m.name)
        .slice(0, 40);
      const mini = (t: AiTaskRec) => ({ ref: `task:${t.id}`, key: t.key, title: clip(t.title, 120), due: dueDayKey(t.dueDate, timeZone), status: t.columnName || categoryLabel(t.category) });
      return {
        tool: 'project_details',
        args: a,
        title: p.name,
        columns: PROJECT_COLUMNS,
        rows: listed,
        total: listed.length,
        details: {
          description: clip(p.description, 800) || null,
          client: p.clientName,
          owner: nameOf(s.person.get(p.ownerId ?? '')) || null,
          manager: nameOf(s.person.get(p.managerId ?? '')) || null,
          members: people,
          byStatus,
          milestones: milestones.slice(0, 15).map(mini),
          dueInNext14Days: deadlines.slice(0, 15).map(mini),
        },
        detailRefs: [...milestones.slice(0, 15), ...deadlines.slice(0, 15)].map(taskRef),
      };
    },

    async project_activity(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const { from, to, fromKey, toKey } = range(a.from as string | undefined, a.to as string | undefined, 6, 0);
      const page = await data.activity({ projectIds: s.projectIds, projectId: project?.id, from, to, limit: MAX_RESULT_ROWS });
      const raw = page.rows
        .filter((e) => s.allowed(e.projectId) && (!project || e.projectId === project.id) && e.createdAt >= from && e.createdAt <= to)
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
      const canOpen = async (taskId: string) => {
        const other = await data.findTask(s.projectIds, taskId);
        return !!other && s.allowed(other.projectId);
      };
      const entries = await withoutHiddenBlockers(raw, canOpen);
      const rows = entries.map((e): ResultRow => {
        const item = buildTimeline([{ id: e.id, action: e.action, actorName: nameOf(s.person.get(e.userId)) || 'Someone', createdAt: e.createdAt.toISOString(), meta: (e.meta as Record<string, unknown> | null) ?? null }])[0];
        return {
          ref: e.task ? taskRef(e.task) : null,
          values: {
            when: wallClock(e.createdAt, timeZone),
            who: nameOf(s.person.get(e.userId)) || 'Someone',
            task: e.task?.key ?? null,
            title: e.task?.title ?? null,
            project: projectName(s, e.projectId),
            change: clip(item ? `${item.text}${item.path ? ` (${item.path.join(' → ')})` : ''}` : e.action, 200),
          },
        };
      });
      return {
        tool: 'project_activity',
        args: a,
        title: `What changed${project ? ` in ${project.name}` : ''}, ${fromKey === toKey ? fromKey : `${fromKey} to ${toKey}`}`,
        columns: [
          { key: 'when', label: 'When', kind: 'datetime' },
          { key: 'who', label: 'Who' },
          { key: 'task', label: 'Task', kind: 'key' },
          { key: 'title', label: 'Title' },
          { key: 'project', label: 'Project' },
          { key: 'change', label: 'What changed' },
        ],
        rows,
        total: dropped(page, raw),
      };
    },

    async list_meetings(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const { from, to, fromKey, toKey } = meetingRange(a);
      const q = normalizeForSearch(a.text as string | undefined);
      const found = await visibleMeetings(s, { projectId: project?.id, from, to, text: a.text as string | undefined });
      const meetings = found.rows.filter((m) => !q || matchesNormalized(q, m.title));
      const rows = meetings.map(
        (m): ResultRow => ({
          ref: meetingRef(m),
          values: {
            when: wallClock(m.startAt, timeZone),
            title: m.title,
            project: projectName(s, m.projectId) || null,
            organizer: nameOf(s.person.get(m.organizerId)) || null,
            status: MEETING_STATUS[m.status] ?? m.status,
            decisions: m.decisions,
            openActions: m.openActionItems,
          },
        }),
      );
      return {
        tool: 'list_meetings',
        args: a,
        title: `Meetings${project ? ` for ${project.name}` : ''}, ${fromKey} to ${toKey}`,
        columns: MEETING_COLUMNS,
        rows,
        total: dropped(found, meetings),
      };
    },

    async meeting_details(s, a) {
      const said = String(a.meeting).replace(/^meeting:/, '').trim();
      let m = null;
      // An id only when such a meeting exists (an admin may view any id, so the check alone proves nothing).
      if (!/\s/.test(said)) {
        const byId = await data.meetingDetail(said);
        if (byId && (await data.canViewMeeting(s.viewer, said))) m = byId;
      }
      if (!m) {
        // By title in the database, nearest to today first; the best matches win (same title, then starts with it).
        const n = normalizeForSearch(said);
        const { rows: all } = await visibleMeetings(s, { from: new Date(0), to: new Date(Date.UTC(2100, 0, 1)), text: said });
        const rank = (x: AiMeetingRec) => {
          const t = normalizeForSearch(x.title);
          return t === n ? 0 : t.startsWith(n) ? 1 : matchesNormalized(n, x.title) ? 2 : 3;
        };
        const best = Math.min(3, ...all.map(rank));
        const found = best < 3 ? all.filter((x) => rank(x) === best) : [];
        if (found.length > 1) throw new ToolProblem(`Several meetings match “${said}”: ${found.slice(0, 6).map((x) => `${x.title} on ${zonedDayKey(x.startAt, timeZone)} (meeting:${x.id})`).join(', ')}. Ask which one, or use its ref.`);
        if (found.length === 1 && (await data.canViewMeeting(s.viewer, found[0]!.id))) m = await data.meetingDetail(found[0]!.id);
      }
      if (!m) throw new ToolProblem(`No meeting you can see matches “${said}”.`);
      const who = (uid: string | null) => (uid ? nameOf(s.person.get(uid)) || null : null);
      const taskRefs = m.actionItems.filter((i) => i.taskId && i.taskKey).map((i) => ({ id: i.taskId!, key: i.taskKey! }));
      const visibleTaskRefs: SourceRef[] = [];
      for (const t of taskRefs) {
        const found = await data.findTask(s.projectIds, t.id);
        if (found && s.allowed(found.projectId)) visibleTaskRefs.push(taskRef(found));
      }
      // As the meeting page: final minutes for everyone who can see the meeting, a draft only for those who can change it.
      const fm = m.finalMinutes && (m.finalMinutes.status === 'APPROVED' || (await data.canEditMeeting(s.viewer, m.id))) ? m.finalMinutes : null;
      const meeting = m;
      return {
        tool: 'meeting_details',
        args: a,
        title: meeting.title,
        columns: MEETING_COLUMNS,
        rows: [
          {
            ref: meetingRef(meeting),
            values: {
              when: wallClock(meeting.startAt, timeZone),
              title: meeting.title,
              project: projectName(s, meeting.projectId) || null,
              organizer: who(meeting.organizerId),
              status: MEETING_STATUS[meeting.status] ?? meeting.status,
              decisions: meeting.decisions,
              openActions: meeting.openActionItems,
            },
          },
        ],
        total: 1,
        details: {
          ends: meeting.endAt ? wallClock(meeting.endAt, timeZone) : null,
          location: meeting.location,
          description: clip(meeting.description, 800) || null,
          attendees: meeting.attendees.slice(0, 40).map((x) => ({ name: who(x.userId) ?? x.name ?? 'Guest', response: x.response.toLowerCase(), attendance: x.attendance.toLowerCase() })),
          agenda: meeting.agenda.slice(0, 25).map((x) => ({ item: clip(x.title, 150), lead: who(x.ownerId), minutes: x.minutes, done: x.completed })),
          notes: meeting.notes.slice(0, 30).map((x) => ({ type: NOTE_TYPE[x.type] ?? x.type, agendaItem: x.agendaTitle ? clip(x.agendaTitle, 100) : null, by: who(x.authorId), text: clip(x.text, 300) })),
          actionItems: meeting.actionItems.slice(0, 30).map((x) => ({
            item: clip(x.description, 200),
            owner: who(x.assigneeId),
            due: dueDayKey(x.dueDate, timeZone),
            status: ACTION_STATUS[x.status] ?? x.status,
            task: x.taskId && visibleTaskRefs.some((r) => r.id === x.taskId) ? x.taskKey : null,
          })),
          decisions: meeting.decisionsList.slice(0, 20).map((x) => ({ decision: clip(x.title, 200), detail: clip(x.description, 200) || null, status: x.status.toLowerCase() })),
          finalMinutes: fm
            ? {
                status: fm.status === 'APPROVED' ? 'Final' : 'Draft',
                summary: clip(fm.summary, 1000),
                discussion: fm.discussion.slice(0, 10).map((x) => ({ topic: clip(x.topic, 120), text: clip(x.text, 400) })),
                decisions: fm.decisions.slice(0, 15).map((x) => clip(x, 250)),
                risks: fm.risks.slice(0, 15).map((x) => clip(x, 250)),
                nextSteps: fm.nextSteps.slice(0, 15).map((x) => clip(x, 250)),
              }
            : null,
        },
        detailRefs: visibleTaskRefs,
      };
    },

    async list_action_items(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const person = a.assignee ? resolvePerson(s, a.assignee as string) : null;
      const status = (a.status as string | undefined) ?? 'any';
      const { from, to, fromKey, toKey } = a.month ? monthRange(a.month as string) : range(a.from as string | undefined, a.to as string | undefined, 30, 0);
      const page = await data.actionItems(s.viewer, {
        projectIds: s.projectIds,
        projectId: project?.id,
        from,
        to,
        assigneeId: person?.id,
        status: status === 'any' ? undefined : (status as 'open' | 'done'),
        limit: MAX_RESULT_ROWS,
      });
      // Each item's meeting is checked again with the meeting rule.
      const items = page.rows
        .filter((i) => meetingVisible(s, i.meeting) && (!project || i.meeting.projectId === project.id) && i.meeting.startAt >= from && i.meeting.startAt <= to)
        .filter((i) => (!person || i.assigneeId === person.id) && (status === 'any' || (status === 'open' ? OPEN_ACTION.has(i.status) : !OPEN_ACTION.has(i.status))));
      const rows = items.slice(0, MAX_RESULT_ROWS).map((i): ResultRow => {
        const m = i.meeting;
        return {
          ref: meetingRef(m),
          values: {
            item: clip(i.description, 300),
            owner: nameOf(s.person.get(i.assigneeId ?? '')) || null,
            due: dueDayKey(i.dueDate, timeZone),
            status: ACTION_STATUS[i.status] ?? i.status,
            meeting: clip(m.title, 120),
            meetingDate: zonedDayKey(m.startAt, timeZone),
            task: i.taskKey,
          },
        };
      });
      return {
        tool: 'list_action_items',
        args: a,
        title: `Action items from meetings${project ? ` for ${project.name}` : ''}, ${fromKey} to ${toKey}`,
        columns: [
          { key: 'item', label: 'Action item' },
          { key: 'owner', label: 'Owner' },
          { key: 'due', label: 'Due', kind: 'date' },
          { key: 'status', label: 'Status' },
          { key: 'meeting', label: 'Meeting' },
          { key: 'meetingDate', label: 'Meeting date', kind: 'date' },
          { key: 'task', label: 'Task', kind: 'key' },
        ],
        rows,
        total: dropped(page, items),
      };
    },

    async report_figures(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const person = a.person ? resolvePerson(s, a.person as string) : null;
      const dueFrom = a.dueFrom as string | undefined;
      const dueTo = a.dueTo as string | undefined;
      const tasks = (await visibleTasks(s, { projectId: project?.id, assigneeId: person?.id })).filter((t) => dueWithin(t, dueFrom, dueTo));
      const rt = tasks.map(toReportTask);
      const period = dueFrom || dueTo ? `, tasks due ${dueFrom ?? '…'} to ${dueTo ?? '…'}` : '';
      const where = `${project ? ` for ${project.name}` : ''}${person ? ` (${nameOf(person)})` : ''}${period}`;
      const report = a.report as 'workload' | 'projects' | 'status' | 'completion';
      if (report === 'workload') {
        // Admins see everyone; a project's owner, named manager or MANAGER members see its people; anyone else only themselves.
        const mayView = await workloadPeople(s, project?.id ?? null);
        if (person && mayView && !mayView.has(person.id)) throw new ToolProblem('Only administrators and project managers can see a colleague’s workload. You can see your own.');
        const ids = new Set(tasks.flatMap((t) => t.assigneeIds));
        if (!person) for (const m of await data.memberships(project ? [project.id] : s.projectIds)) if (s.allowed(m.projectId)) ids.add(m.userId);
        const users = [...ids]
          .filter((id) => !mayView || mayView.has(id))
          .map((id) => s.person.get(id))
          .filter((p): p is AiPersonRec => !!p && (!person || p.id === person.id))
          .map((p) => ({ id: p.id, username: p.username, name: nameOf(p) }))
          .sort((x, y) => x.name.localeCompare(y.name));
        const rows = userWorkload(rt, users, timeZone, now()).map(
          (w): ResultRow => ({ ref: { type: 'person', id: w.userId, label: w.name, url: null }, values: { person: w.name, assigned: w.assigned, open: w.assigned - w.completed, completed: w.completed, overdue: w.overdue } }),
        );
        return {
          tool: 'report_figures',
          args: a,
          title: `Workload${where}`,
          columns: [
            { key: 'person', label: 'Person' },
            { key: 'assigned', label: 'Assigned', kind: 'number' },
            { key: 'open', label: 'Open', kind: 'number' },
            { key: 'completed', label: 'Completed', kind: 'number' },
            { key: 'overdue', label: 'Overdue', kind: 'number' },
          ],
          rows,
          total: rows.length,
        };
      }
      if (report === 'projects') {
        const rows = projectPerformance(rt, timeZone, now())
          .sort((x, y) => x.projectName.localeCompare(y.projectName))
          .map((p): ResultRow => {
            const proj = s.projects.find((x) => x.id === p.projectId);
            return { ref: proj ? projectRef(proj) : null, values: { project: p.projectName, total: p.total, completed: p.completed, overdue: p.overdue, completionPct: p.completionPct } };
          });
        return {
          tool: 'report_figures',
          args: a,
          title: `Project performance${where}`,
          columns: [
            { key: 'project', label: 'Project' },
            { key: 'total', label: 'Tasks', kind: 'number' },
            { key: 'completed', label: 'Completed', kind: 'number' },
            { key: 'overdue', label: 'Overdue', kind: 'number' },
            { key: 'completionPct', label: 'Completion', kind: 'percent' },
          ],
          rows,
          total: rows.length,
        };
      }
      if (report === 'status') {
        const counts = statusBreakdown(rt);
        const order = [...CATEGORY_ORDER, ...Object.keys(counts).filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c))];
        const rows = order.filter((c) => counts[c]).map((c): ResultRow => ({ ref: null, values: { status: categoryLabel(c), count: counts[c]! } }));
        return {
          tool: 'report_figures',
          args: a,
          title: `Tasks by status${where}`,
          columns: [
            { key: 'status', label: 'Status' },
            { key: 'count', label: 'Tasks', kind: 'number' },
          ],
          rows,
          total: rows.length,
        };
      }
      const c = completionStats(rt, timeZone);
      return {
        tool: 'report_figures',
        args: a,
        title: `Completion${where}`,
        columns: [
          { key: 'total', label: 'Tasks', kind: 'number' },
          { key: 'completed', label: 'Completed', kind: 'number' },
          { key: 'onTime', label: 'On time', kind: 'number' },
          { key: 'late', label: 'Late', kind: 'number' },
          { key: 'onTimeRate', label: 'On-time rate', kind: 'percent' },
        ],
        rows: [{ ref: null, values: { total: c.total, completed: c.completed, onTime: c.onTime, late: c.late, onTimeRate: c.onTimeRate } }],
        total: 1,
      };
    },

    async search_chat(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const person = a.person ? resolvePerson(s, a.person as string) : null;
      const { from, to, fromKey, toKey } = range(a.from as string | undefined, a.to as string | undefined, 30, 0);
      const mine = await data.conversations(s.viewer);
      // The chat module's own list, with its rule again: a direct conversation needs the person in it.
      const allowedConvs = mine.filter((c) => (c.kind === 'DIRECT' ? c.participantIds.includes(s.viewer.userId) : s.viewer.roles.includes('ADMIN') || s.allowed(c.projectId)));
      const allowedIds = new Set(allowedConvs.map((c) => c.id));
      const text = (a.text as string | undefined)?.trim();
      let convs = allowedConvs;
      if (project) convs = convs.filter((c) => c.kind === 'PROJECT' && c.projectId === project.id);
      const base = { text, from, to, limit: MAX_RESULT_ROWS };
      const none = { rows: [], total: 0 };
      let found;
      let matched = 0;
      if (person) {
        const direct = convs.filter((c) => c.kind === 'DIRECT' && c.participantIds.includes(person.id)).map((c) => c.id);
        const channels = convs.filter((c) => c.kind === 'PROJECT').map((c) => c.id);
        const [withThem, fromThem] = await Promise.all([
          direct.length ? data.chatMessages({ ...base, conversationIds: direct }) : none,
          channels.length ? data.chatMessages({ ...base, conversationIds: channels, senderIds: [person.id] }) : none,
        ]);
        found = [...withThem.rows, ...fromThem.rows.filter((m) => m.userId === person.id)];
        matched = withThem.total + fromThem.total;
      } else {
        const page = convs.length ? await data.chatMessages({ ...base, conversationIds: convs.map((c) => c.id) }) : none;
        found = page.rows;
        matched = page.total;
      }
      const scoped = new Set(convs.map((c) => c.id));
      const q = normalizeForSearch(text);
      const messages = found
        .filter((m) => allowedIds.has(m.conversationId) && scoped.has(m.conversationId) && m.createdAt >= from && m.createdAt <= to && (!q || matchesNormalized(q, m.body)))
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
      const total = Math.max(messages.length, matched - (found.length - messages.length));
      const byConv = new Map(allowedConvs.map((c) => [c.id, c]));
      const convName = (id: string) => {
        const c = byConv.get(id);
        if (!c) return '';
        if (c.kind === 'PROJECT') return projectName(s, c.projectId) || 'Project channel';
        const other = c.participantIds.filter((u) => u !== s.viewer.userId).map((u) => nameOf(s.person.get(u))).filter(Boolean);
        return `Direct: ${other.join(', ') || 'yourself'}`;
      };
      const rows = messages.slice(0, MAX_RESULT_ROWS).map((m): ResultRow => {
        const sender = nameOf(s.person.get(m.userId)) || 'Someone';
        return {
          ref: { type: 'chat', id: m.id, label: `${sender} · ${shortDay(m.createdAt)}`, url: `/chat?conversation=${m.conversationId}` },
          values: { when: wallClock(m.createdAt, timeZone), from: sender, conversation: convName(m.conversationId), message: clip(m.body, 400) },
        };
      });
      return {
        tool: 'search_chat',
        args: a,
        title: `Chat messages${text ? ` about “${clip(text, 40)}”` : ''}, ${fromKey} to ${toKey}`,
        columns: [
          { key: 'when', label: 'When', kind: 'datetime' },
          { key: 'from', label: 'From' },
          { key: 'conversation', label: 'Conversation' },
          { key: 'message', label: 'Message' },
        ],
        rows,
        total,
      };
    },

    async find_people(s, a) {
      const project = a.project ? resolveProject(s, a.project as string) : null;
      const memberships = (await data.memberships(project ? [project.id] : s.projectIds)).filter((m) => s.allowed(m.projectId) && (!project || m.projectId === project.id));
      const q = normalizeForSearch(a.name as string | undefined);
      const people = s.people
        .filter((p) => (!project || memberships.some((m) => m.userId === p.id)) && (!q || matchesNormalized(q, `${p.firstName} ${p.lastName}`, p.username)))
        .sort((x, y) => nameOf(x).localeCompare(nameOf(y)));
      const rows = people.slice(0, MAX_RESULT_ROWS).map((p): ResultRow => {
        const roles = memberships
          .filter((m) => m.userId === p.id)
          .sort((x, y) => ROLE_RANK[x.role] - ROLE_RANK[y.role])
          .map((m) => `${projectName(s, m.projectId)} (${ROLE_LABEL[m.role]})`);
        return { ref: { type: 'person', id: p.id, label: nameOf(p), url: null }, values: { name: nameOf(p), username: p.username, active: p.active ? 'Yes' : 'No', projects: roles.join(', ') } };
      });
      return {
        tool: 'find_people',
        args: a,
        title: project ? `People in ${project.name}` : 'People',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'username', label: 'Username' },
          { key: 'active', label: 'Active' },
          { key: 'projects', label: 'Projects (role)' },
        ],
        rows,
        total: people.length,
      };
    },
  };

  /**
   * Run one tool for the person asking. Bad arguments and "nothing by that name" come back as `error`.
   * `total` is how many matched in all; `truncated` says the rows kept are fewer than that.
   */
  async function runTool(viewer: Viewer, name: string, rawArgs: Record<string, unknown>): Promise<Omit<ToolResult, 'id'>> {
    if (!(TOOL_NAMES as readonly string[]).includes(name)) return { ...empty('unknown', rawArgs, `There is no tool called “${clip(name, 60)}”.`), truncated: false };
    const tool = name as ToolName;
    const parsed = SCHEMAS[tool].safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`.trim()).join('; ');
      return { ...empty(tool, rawArgs, `Check the arguments: ${problems}.`), truncated: false };
    }
    const args = parsed.data as Record<string, unknown>;
    try {
      const out = await run[tool](await scopeOf(viewer), args);
      return { ...out, truncated: out.total > out.rows.length };
    } catch (err) {
      if (err instanceof ToolProblem) return { ...empty(tool, args, err.message), truncated: false };
      throw err;
    }
  }

  /**
   * Results kept from earlier questions in a chat, checked against what the person can see NOW: a
   * row of a task, project, meeting or conversation they have lost access to is dropped. Figures
   * (report_figures) can't be checked row by row, so they are not reused: the model asks again.
   */
  async function recheck(viewer: Viewer, results: StoredResult[]): Promise<StoredResult[]> {
    const usable = results.filter((r) => !r.error && r.tool !== 'report_figures');
    if (!usable.length) return [];
    const s = await scopeOf(viewer);
    const refs = usable.flatMap((r) => [...r.rows.map((x) => x.ref), ...(r.detailRefs ?? [])]).filter((x): x is SourceRef => !!x);
    const conversationOf = (ref: SourceRef) => new URLSearchParams((ref.url ?? '').split('?')[1] ?? '').get('conversation');
    const ids = (type: SourceRef['type']) => [...new Set(refs.filter((x) => x.type === type).map((x) => x.id))];
    const [taskProjects, meetings, convs] = await Promise.all([
      ids('task').length ? data.taskProjectIds(ids('task')) : new Map<string, string>(),
      ids('meeting').length ? data.meetingsByIds(ids('meeting')) : [],
      ids('chat').length ? data.conversations(viewer) : [],
    ]);
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    const openConvs = new Set(convs.filter((c) => (c.kind === 'DIRECT' ? c.participantIds.includes(viewer.userId) : viewer.roles.includes('ADMIN') || s.allowed(c.projectId))).map((c) => c.id));
    const stillVisible = (ref: SourceRef): boolean => {
      switch (ref.type) {
        case 'task':
          return s.allowed(taskProjects.get(ref.id));
        case 'project':
          return s.allowed(ref.id);
        case 'meeting': {
          const m = meetingById.get(ref.id);
          return !!m && meetingVisible(s, m);
        }
        case 'chat': {
          const c = conversationOf(ref);
          return !!c && openConvs.has(c);
        }
        case 'person':
          return s.person.has(ref.id);
        default:
          return false;
      }
    };
    return usable.map((r) => {
      const rows = r.rows.filter((x) => !!x.ref && stillVisible(x.ref));
      const total = Math.max(rows.length, r.total - (r.rows.length - rows.length));
      return { ...r, rows, total, truncated: total > rows.length, detailRefs: r.detailRefs?.filter(stillVisible) };
    });
  }

  return { catalogue, run: runTool, recheck };
}

export type MicoAiTools = ReturnType<typeof createMicoAiTools>;
