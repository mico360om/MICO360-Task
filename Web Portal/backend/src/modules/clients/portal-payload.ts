import { dueDayKey, todayKey, zonedDayKey } from '../../lib/due-date';
import { isTaskLate } from '../tasks/task-status';
import { clientTaskStatus, type ClientTaskStatus } from '../client-view/client-view-payload';
import { canSignOff, currentAcceptance } from './sign-off';
import type { GrantRow } from './client-grants';
import type { FinalMinutesContent } from '../meetings/final-minutes';
import { resolveMinutesTimeZone } from '../meetings/minutes';
import { clientMinutesContent } from '../client-view/client-minutes-content';

/**
 * 1.23 Client portal answers, built from explicit allow-lists like the client page's
 * (client-view-payload.ts): every field below is copied one by one, so nothing else a row carries —
 * staff names, assignees, column names, internal notes, files, other clients' comments — can reach a
 * client. Ids are given only for the things the client may act on (their project, its shared tasks,
 * their meetings and their own action items), and every id is checked again on the way back in.
 */

const PROJECT_STATUS: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'In progress', ON_HOLD: 'On hold', COMPLETED: 'Completed' };

export interface PortalModules {
  progress: boolean;
  meetings: boolean;
}
export interface PortalActions {
  comment: boolean;
  signOff: boolean;
  respond: boolean;
  download: boolean;
}

export const modulesOf = (g: GrantRow): PortalModules => ({ progress: g.progress === true, meetings: g.meetings === true });
export const actionsOf = (g: GrantRow): PortalActions => ({
  comment: g.progress === true && g.canComment === true,
  signOff: g.progress === true && g.canSignOff === true,
  respond: g.meetings === true && g.canRespond === true,
  download: (g.progress === true || g.meetings === true) && g.canDownload === true,
});

export interface PortalProjectSource {
  id: string;
  code: string;
  number: string | null;
  name: string;
  clientName: string | null;
  status: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  company: { name: string; logoUrl: string | null } | null;
}

export interface PortalProjectCard {
  id: string;
  code: string;
  number: string | null;
  name: string;
  status: string;
  statusLabel: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  company: { name: string; logoUrl: string | null } | null;
  /** Null without the Progress module (the card shows no figure). */
  percentDone: number | null;
  modules: PortalModules;
  actions: PortalActions;
}

const percent = (c: { total: number; done: number }) => {
  const total = Math.max(0, c.total);
  const done = Math.min(total, Math.max(0, c.done));
  return total ? Math.round((done / total) * 100) : 0;
};

function projectLook(p: PortalProjectSource) {
  return {
    id: String(p.id),
    code: String(p.code),
    number: p.number ?? null,
    name: String(p.name),
    status: String(p.status),
    statusLabel: PROJECT_STATUS[p.status] ?? 'In progress',
    color: String(p.color),
    icon: p.icon ?? null,
    imageUrl: p.imageUrl ?? null,
    company: p.company ? { name: String(p.company.name), logoUrl: p.company.logoUrl ?? null } : null,
  };
}

export function portalCard(p: PortalProjectSource, grant: GrantRow, counts: { total: number; done: number } | null): PortalProjectCard {
  const modules = modulesOf(grant);
  return { ...projectLook(p), percentDone: modules.progress && counts ? percent(counts) : null, modules, actions: actionsOf(grant) };
}

export interface PortalTaskSource {
  id: string;
  key: string;
  title: string;
  description: string | null;
  isMilestone: boolean;
  clientVisible: boolean;
  clientShowDescription: boolean;
  columnCategory: string | null;
  completedAt: Date | null;
  dueDate: Date | null;
  approvalRequestedAt: Date | null;
  clientAcceptedAt: Date | null;
}

export interface PortalTaskItem {
  id: string;
  /** The task number (MICO-142). */
  key: string;
  title: string;
  status: ClientTaskStatus;
  dueDate: string | null;
  late: boolean;
  /** When the client accepted this finish ('YYYY-MM-DD', company time); null when not. */
  acceptedOn: string | null;
  /** Done and not yet accepted: Accept / Send back are offered (with the Sign off action). */
  awaitingSignOff: boolean;
  /** Its description is shared (opened, the task shows it). */
  hasDescription: boolean;
}

export function portalTask(t: PortalTaskSource, timeZone: string, now: Date): PortalTaskItem {
  const awaitingApproval = t.approvalRequestedAt !== null && t.approvalRequestedAt !== undefined;
  const accepted = currentAcceptance({ columnCategory: t.columnCategory, completedAt: t.completedAt, approvalRequestedAt: t.approvalRequestedAt, clientAcceptedAt: t.clientAcceptedAt });
  const status = clientTaskStatus({ columnCategory: t.columnCategory, completedAt: t.completedAt, awaitingApproval });
  return {
    id: String(t.id),
    key: String(t.key),
    title: String(t.title),
    status,
    dueDate: dueDayKey(t.dueDate, timeZone),
    late: isTaskLate({ columnCategory: t.columnCategory, completedAt: t.completedAt, dueDate: t.dueDate, approvalRequestedAt: t.approvalRequestedAt }, timeZone, now),
    acceptedOn: accepted ? zonedDayKey(accepted, timeZone) : null,
    awaitingSignOff: !accepted && canSignOff({ columnCategory: t.columnCategory, completedAt: t.completedAt, approvalRequestedAt: t.approvalRequestedAt }),
    hasDescription: t.clientShowDescription === true && !!t.description?.trim(),
  };
}

const byDueThenTitle = (a: PortalTaskItem, b: PortalTaskItem) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.title.localeCompare(b.title);

const dayNumber = (key: string) => Date.parse(`${key}T12:00:00Z`) / 86_400_000;
function elapsedPercent(start: string | null, target: string | null, today: string): number | null {
  if (!start || !target) return null;
  const span = dayNumber(target) - dayNumber(start);
  if (span <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(((dayNumber(today) - dayNumber(start)) / span) * 100)));
}

export interface PortalProjectView {
  project: ReturnType<typeof projectLook> & { clientName: string | null };
  modules: PortalModules;
  actions: PortalActions;
  /** The Progress module (null without it). */
  progress: {
    percentDone: number;
    timeline: { startDate: string | null; targetDate: string | null; today: string; elapsedPercent: number | null };
    milestones: PortalTaskItem[];
    tasks: PortalTaskItem[];
  } | null;
  generatedAt: string;
  timeZone: string;
}

export function portalProject(input: {
  project: PortalProjectSource;
  grant: GrantRow;
  counts: { total: number; done: number } | null;
  tasks: PortalTaskSource[];
  timeZone: string;
  now: Date;
}): PortalProjectView {
  const { project: p, grant, timeZone, now } = input;
  const modules = modulesOf(grant);
  const today = todayKey(timeZone, now);
  const startDate = dueDayKey(p.startDate, timeZone);
  const targetDate = dueDayKey(p.targetDate, timeZone);
  // Only tasks marked "Show to client", whatever the source handed over.
  const shown = modules.progress ? input.tasks.filter((t) => t.clientVisible === true).map((t) => ({ t, item: portalTask(t, timeZone, now) })) : [];
  return {
    project: { ...projectLook(p), clientName: p.clientName ?? null },
    modules,
    actions: actionsOf(grant),
    progress: modules.progress
      ? {
          percentDone: percent(input.counts ?? { total: 0, done: 0 }),
          timeline: { startDate, targetDate, today, elapsedPercent: elapsedPercent(startDate, targetDate, today) },
          milestones: shown.filter((s) => s.t.isMilestone).map((s) => s.item).sort(byDueThenTitle),
          tasks: shown.filter((s) => !s.t.isMilestone).map((s) => s.item).sort(byDueThenTitle),
        }
      : null,
    generatedAt: now.toISOString(),
    timeZone,
  };
}

export interface PortalCommentSource {
  id: string;
  userId: string;
  parentId: string | null;
  body: string;
  fromClient: boolean;
  clientVisible: boolean;
  createdAt: Date;
  editedAt: Date | null;
}

export interface PortalComment {
  id: string;
  /** 'you': the client's own; 'team': a team reply marked "Visible to client" (never a staff name). */
  from: 'you' | 'team';
  /** For a team reply: the client comment it answers. */
  replyTo: string | null;
  body: string;
  createdAt: string;
  edited: boolean;
}

/**
 * The comments a client sees on a task: their own, and the team's replies to them marked "Visible to
 * client" — never anyone else's (another client's, a staff comment, a reply that isn't ticked).
 */
export function portalComments(rows: readonly PortalCommentSource[], clientId: string): PortalComment[] {
  const mine = new Set(rows.filter((c) => c.fromClient === true && c.userId === clientId).map((c) => c.id));
  return rows
    .filter((c) => mine.has(c.id) || (c.fromClient !== true && c.clientVisible === true && c.parentId !== null && mine.has(c.parentId)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => ({
      id: String(c.id),
      from: mine.has(c.id) ? ('you' as const) : ('team' as const),
      replyTo: mine.has(c.id) ? null : String(c.parentId),
      body: String(c.body),
      createdAt: c.createdAt.toISOString(),
      edited: c.editedAt !== null,
    }));
}

export interface PortalTaskView {
  task: PortalTaskItem & { description: string | null };
  /** Null without the Comment action (the thread isn't shown). */
  comments: PortalComment[] | null;
  can: { comment: boolean; signOff: boolean };
}

export function portalTaskView(t: PortalTaskSource, grant: GrantRow, comments: readonly PortalCommentSource[] | null, clientId: string, timeZone: string, now: Date): PortalTaskView {
  const item = portalTask(t, timeZone, now);
  const actions = actionsOf(grant);
  return {
    task: { ...item, description: item.hasDescription ? String(t.description) : null },
    comments: actions.comment && comments ? portalComments(comments, clientId) : null,
    can: { comment: actions.comment, signOff: actions.signOff && item.awaitingSignOff },
  };
}

// ── Meetings and minutes ─────────────────────────────────────────────────────

export interface PortalMinutesSource {
  approvedAt: Date | null;
  content: FinalMinutesContent;
  showRisks: boolean;
  /** Names the minutes may mention (taken off the next steps' owners). */
  people: string[];
}

export interface PortalMeetingSource {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startAt: Date;
  endAt: Date | null;
  timeZone: string | null;
  location: string | null;
  onlineLink: string | null;
  /** The client's own attendee row (null: not invited — the meeting is here for its shown minutes). */
  invitation: { response: string } | null;
  agenda: { title: string; expectedMinutes: number | null }[];
  /** Approved minutes marked "Show to client" for this project (null: none shown). */
  minutes: PortalMinutesSource | null;
}

const MEETING_STATUS: Record<string, string> = { DRAFT: 'Planned', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In progress', COMPLETED: 'Held', CANCELLED: 'Cancelled' };
const RESPONSES = new Set(['PENDING', 'ACCEPTED', 'TENTATIVE', 'DECLINED']);

export interface PortalMeetingItem {
  id: string;
  title: string;
  /** Its day ('YYYY-MM-DD', in its own time zone). */
  date: string;
  startAt: string;
  endAt: string | null;
  timeZone: string;
  status: string;
  cancelled: boolean;
  invited: boolean;
  /** Their answer to the invitation (null when not invited). */
  response: 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | null;
  hasMinutes: boolean;
}

export function portalMeetingItem(m: PortalMeetingSource, companyTimeZone: string): PortalMeetingItem {
  const tz = resolveMinutesTimeZone(m.timeZone, companyTimeZone);
  const response = m.invitation && RESPONSES.has(m.invitation.response) ? (m.invitation.response as PortalMeetingItem['response']) : m.invitation ? 'PENDING' : null;
  return {
    id: String(m.id),
    title: String(m.title),
    date: zonedDayKey(m.startAt, tz),
    startAt: m.startAt.toISOString(),
    endAt: m.endAt ? m.endAt.toISOString() : null,
    timeZone: tz,
    status: MEETING_STATUS[m.status] ?? 'Scheduled',
    cancelled: m.status === 'CANCELLED',
    invited: m.invitation !== null,
    response,
    hasMinutes: m.minutes !== null,
  };
}

export interface PortalActionItemSource {
  id: string;
  description: string;
  status: string;
  dueDate: Date | null;
}
export interface PortalActionItem {
  id: string;
  description: string;
  dueDate: string | null;
  done: boolean;
  cancelled: boolean;
}

export interface PortalMeetingView {
  meeting: PortalMeetingItem & { location: string | null; onlineLink: string | null; description: string | null };
  /** The agenda's topics (invited only; never who leads them). */
  agenda: { title: string; minutes: number | null }[];
  minutes: { approvedOn: string | null; content: FinalMinutesContent } | null;
  /** Their own action items from this meeting. */
  actionItems: PortalActionItem[];
  can: { respond: boolean; markDone: boolean; downloadMinutes: boolean };
}

export function portalMeetingView(m: PortalMeetingSource, items: readonly PortalActionItemSource[], grant: GrantRow, companyTimeZone: string): PortalMeetingView {
  const item = portalMeetingItem(m, companyTimeZone);
  const actions = actionsOf(grant);
  const invited = m.invitation !== null;
  return {
    meeting: {
      ...item,
      // The invitation's details (what their invitation email already said), only to someone invited.
      location: invited ? (m.location ?? null) : null,
      onlineLink: invited ? (m.onlineLink ?? null) : null,
      description: invited ? (m.description ?? null) : null,
    },
    agenda: invited ? m.agenda.map((a) => ({ title: String(a.title), minutes: typeof a.expectedMinutes === 'number' ? a.expectedMinutes : null })) : [],
    minutes: m.minutes
      ? {
          approvedOn: m.minutes.approvedAt ? zonedDayKey(m.minutes.approvedAt, item.timeZone) : null,
          content: clientMinutesContent(copyMinutes(m.minutes.content), { names: m.minutes.people, includeRisks: m.minutes.showRisks === true }),
        }
      : null,
    actionItems: items.map((a) => ({
      id: String(a.id),
      description: String(a.description),
      dueDate: a.dueDate ? zonedDayKey(a.dueDate, item.timeZone) : null,
      done: a.status === 'COMPLETED',
      cancelled: a.status === 'CANCELLED',
    })),
    can: { respond: actions.respond && invited && !item.cancelled, markDone: actions.respond, downloadMinutes: actions.download && m.minutes !== null },
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
/** The approved minutes' sections, each copied on its own. */
function copyMinutes(c: FinalMinutesContent): FinalMinutesContent {
  return {
    summary: typeof c.summary === 'string' ? c.summary : '',
    discussion: (Array.isArray(c.discussion) ? c.discussion : []).map((d) => ({ topic: String(d?.topic ?? ''), text: String(d?.text ?? '') })),
    decisions: strings(c.decisions),
    risks: strings(c.risks),
    nextSteps: strings(c.nextSteps),
  };
}
