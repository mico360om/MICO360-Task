import { dueDayKey, todayKey, zonedDayKey } from '../../lib/due-date';
import { isTaskDone, isTaskLate } from '../tasks/task-status';
import { resolveMinutesTimeZone } from '../meetings/minutes';
import type { FinalMinutesContent } from '../meetings/final-minutes';
import { clientMinutesContent } from './client-minutes-content';
import type { ClientInspectionSummary } from '../inspections/inspection-client-copy';

/**
 * What a shared client's page shows, built from an explicit allow-list: every field below is copied
 * one by one, so nothing else a row carries (people, descriptions, comments, files, internal notes,
 * column names, ids of anything but the minutes) can reach the client. Only tasks (milestones are
 * tasks), approved final minutes and finished inspection reports marked "Show to client" are listed
 * (a report, opened, shows its item notes and the signers' names: see inspection-client-copy, and
 * the wording of the staff's Share with client panel); the project's % done counts every task
 * without naming any — the same share of tasks finished as the staff's Completion tile.
 */

export interface ClientProjectSource {
  name: string;
  code: string;
  number: string | null;
  clientName: string | null;
  status: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  startDate: Date | null;
  targetDate: Date | null;
}

export interface ClientTaskSource {
  title: string;
  isMilestone: boolean;
  clientVisible: boolean;
  columnCategory: string | null;
  completedAt: Date | null;
  dueDate: Date | null;
  /** It waits for a project manager's approval (task-approval): clients see it as in progress. */
  awaitingApproval?: boolean;
}

export interface ClientMinutesSource {
  meetingId: string;
  title: string;
  startAt: Date;
  /** When it ended (the PDF's time line; the page doesn't show it). */
  endAt?: Date | null;
  timeZone: string | null;
  status: 'APPROVED' | 'DRAFT';
  clientVisible: boolean;
  approvedAt: Date | null;
  content: FinalMinutesContent;
  /** "Risks & open issues" were ticked when the minutes were shown (otherwise they stay internal). */
  showRisks?: boolean;
  /** Names of the project's people and the meeting's attendees: taken off the next steps' owners. */
  people?: string[];
}

export interface ClientViewInput {
  /** The client the page was shared with (their own name and address). */
  viewer: { name: string; email: string };
  project: ClientProjectSource;
  /** Every live task of the project, and how many of them are done. */
  counts: { total: number; done: number };
  items: ClientTaskSource[];
  minutes: ClientMinutesSource[];
  /** Finished inspection reports marked "Show to client": summaries (details load when one is opened). */
  inspections?: ClientInspectionSummary[];
  /** The company time zone (today, due days). */
  timeZone: string;
  now: Date;
  /** Companies: the project's main company (its name and logo), only while the site has 2+ active companies. */
  company?: { name: string; logoUrl: string | null } | null;
}

export type ClientTaskStatus = 'Not started' | 'In progress' | 'In review' | 'On hold' | 'Done';

export interface ClientItem {
  title: string;
  status: ClientTaskStatus;
  /** 'YYYY-MM-DD'. */
  dueDate: string | null;
  /**
   * Past its due day (company time) and not done, as the staff see it — never while it waits for
   * approval (owner, 30 Oct: the client sees that one as "In progress").
   */
  late: boolean;
}

export interface ClientMinutes {
  /** The meeting's id: what the minutes PDF is asked for by. */
  id: string;
  title: string;
  /** The meeting's day ('YYYY-MM-DD', in its own time zone). */
  date: string;
  approvedOn: string | null;
  content: FinalMinutesContent;
}

export interface ClientView {
  viewer: { name: string; email: string };
  project: {
    name: string;
    code: string;
    number: string | null;
    clientName: string | null;
    status: string;
    statusLabel: string;
    color: string;
    icon: string | null;
    imageUrl: string | null;
  };
  progress: { percentDone: number };
  timeline: { startDate: string | null; targetDate: string | null; today: string; elapsedPercent: number | null };
  milestones: ClientItem[];
  tasks: ClientItem[];
  minutes: ClientMinutes[];
  inspections: ClientInspectionSummary[];
  /** When this was read (the page's "Updated 30 Oct 2026, 10:15"). */
  generatedAt: string;
  /** The company time zone, which the page writes that time in. */
  timeZone: string;
  /**
   * Companies: the project's main company — its name and logo (null: the built-in logo) — shown on the
   * page as "Shared by …"; null while the site has one active company (the page is unchanged).
   */
  company: { name: string; logoUrl: string | null } | null;
}

const PROJECT_STATUS: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'In progress', ON_HOLD: 'On hold', COMPLETED: 'Completed' };

/** A task's stage in plain words, from its column's category (a column's own name is internal). */
export function clientTaskStatus(t: { columnCategory?: string | null; completedAt?: Date | string | null; awaitingApproval?: boolean }): ClientTaskStatus {
  if (isTaskDone(t)) return 'Done';
  // Finished but waiting for a manager's OK: still being worked on, as far as the client is concerned.
  if (t.awaitingApproval) return 'In progress';
  switch (t.columnCategory) {
    case 'IN_PROGRESS':
      return 'In progress';
    case 'REVIEW':
      return 'In review';
    case 'BLOCKED':
      return 'On hold';
    default:
      return 'Not started';
  }
}

const dayNumber = (key: string) => Date.parse(`${key}T12:00:00Z`) / 86_400_000;

function elapsedPercent(start: string | null, target: string | null, today: string): number | null {
  if (!start || !target) return null;
  const span = dayNumber(target) - dayNumber(start);
  if (span <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(((dayNumber(today) - dayNumber(start)) / span) * 100)));
}

const byDueThenTitle = (a: ClientItem, b: ClientItem) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.title.localeCompare(b.title);

function item(t: ClientTaskSource, timeZone: string, now: Date): ClientItem {
  return {
    title: String(t.title),
    status: clientTaskStatus(t),
    dueDate: dueDayKey(t.dueDate, timeZone),
    late: isTaskLate({ columnCategory: t.columnCategory, completedAt: t.completedAt, dueDate: t.dueDate, approvalRequestedAt: t.awaitingApproval ? now : null }, timeZone, now),
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** The approved minutes' sections, each copied on its own. */
function minutesContent(c: FinalMinutesContent): FinalMinutesContent {
  return {
    summary: typeof c.summary === 'string' ? c.summary : '',
    discussion: (Array.isArray(c.discussion) ? c.discussion : []).map((d) => ({ topic: String(d?.topic ?? ''), text: String(d?.text ?? '') })),
    decisions: strings(c.decisions),
    risks: strings(c.risks),
    nextSteps: strings(c.nextSteps),
  };
}

/** A shown inspection report's summary, copied field by field again (whatever else its object carries stays behind). */
function inspectionCopy(i: ClientInspectionSummary): ClientInspectionSummary {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    id: String(i.id),
    title: String(i.title),
    date: String(i.date),
    place: typeof i.place === 'string' ? i.place : null,
    result: String(i.result),
    counts: { total: n(i.counts?.total), passed: n(i.counts?.passed), failed: n(i.counts?.failed), na: n(i.counts?.na) },
    revisionNumber: Math.max(1, n(i.revisionNumber)),
    reopenedOn: typeof i.reopenedOn === 'string' ? i.reopenedOn : null,
  };
}

export function buildClientView(input: ClientViewInput): ClientView {
  const { project: p, timeZone, now } = input;
  const today = todayKey(timeZone, now);
  const startDate = dueDayKey(p.startDate, timeZone);
  const targetDate = dueDayKey(p.targetDate, timeZone);
  const shown = input.items.filter((t) => t.clientVisible === true);
  const total = Math.max(0, input.counts.total);
  const done = Math.min(total, Math.max(0, input.counts.done));

  return {
    viewer: { name: String(input.viewer.name), email: String(input.viewer.email) },
    project: {
      name: p.name,
      code: p.code,
      number: p.number ?? null,
      clientName: p.clientName ?? null,
      status: p.status,
      statusLabel: PROJECT_STATUS[p.status] ?? 'In progress',
      color: p.color,
      icon: p.icon ?? null,
      imageUrl: p.imageUrl ?? null,
    },
    progress: { percentDone: total ? Math.round((done / total) * 100) : 0 },
    timeline: { startDate, targetDate, today, elapsedPercent: elapsedPercent(startDate, targetDate, today) },
    milestones: shown.filter((t) => t.isMilestone).map((t) => item(t, timeZone, now)).sort(byDueThenTitle),
    tasks: shown.filter((t) => !t.isMilestone).map((t) => item(t, timeZone, now)).sort(byDueThenTitle),
    minutes: input.minutes
      .filter((m) => m.status === 'APPROVED' && m.clientVisible === true)
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
      .map((m) => {
        const tz = resolveMinutesTimeZone(m.timeZone, timeZone);
        return {
          id: String(m.meetingId),
          title: String(m.title),
          date: zonedDayKey(m.startAt, tz),
          approvedOn: m.approvedAt ? zonedDayKey(m.approvedAt, tz) : null,
          content: clientMinutesContent(minutesContent(m.content), { names: m.people ?? [], includeRisks: m.showRisks === true }),
        };
      }),
    inspections: (input.inspections ?? []).map(inspectionCopy),
    generatedAt: now.toISOString(),
    timeZone,
    company: input.company ? { name: String(input.company.name), logoUrl: input.company.logoUrl ?? null } : null,
  };
}
