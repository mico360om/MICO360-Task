import { PdfDocument, type RGB } from '../../lib/pdf-document';
import { isolate, textDirection } from '../../lib/pdf-text';
import { isValidTimeZone } from './meeting-validation';

export interface MinutesMeeting {
  title: string;
  statusLabel: string;
  organizerName: string | null;
  location: string | null;
  onlineLink: string | null;
  startAt: string; // ISO
  endAt: string | null; // ISO
  timeZone: string | null;
  description: string | null;
}

export interface MinutesAttendee {
  name: string;
  roleLabel: string;
  /** The answer to the invitation (Accepted / Maybe / Declined / No response). */
  responseLabel: string;
  attendanceLabel: string;
  external: boolean;
  email: string | null;
}

export interface MinutesAgendaItem {
  title: string;
  presenterName: string | null;
  expectedMinutes: number | null;
  completed: boolean;
}

export interface MinutesNote {
  type: string; // raw enum, used for grouping
  typeLabel: string;
  body: string;
  authorName: string;
  createdAt: string; // ISO
  highlighted: boolean;
  /** An action note already listed among the action items (so it isn't printed twice). */
  trackedAsActionItem?: boolean;
}

/** A tracked action item of the meeting (the Action Items card), as opposed to a note of type "Action Item". */
export interface MinutesActionItem {
  description: string;
  ownerName: string | null;
  /** Calendar day, 'YYYY-MM-DD' (no time, so it never shifts with the zone). */
  dueDate: string | null;
  statusLabel: string;
  priorityLabel: string;
  /** Key of the board task this item is tracked as. */
  taskKey?: string | null;
  /** Still to do (not completed or cancelled); derived from the status label when absent. */
  open?: boolean;
}

export interface MinutesBrand {
  productName: string;
  companyName: string;
  tagline?: string;
  websiteUrl?: string;
  supportEmail?: string;
  companyAddress?: string;
  /** Hex brand colors used to theme the document. */
  colors?: { brand?: string; brand2?: string; ink?: string; muted?: string; line?: string };
}

export interface MinutesProject {
  name: string;
  code?: string | null;
  clientName?: string | null;
  statusLabel?: string | null;
  ownerName?: string | null;
  startDate?: string | null; // ISO
  targetDate?: string | null; // ISO
}

export interface MinutesData {
  brand: MinutesBrand;
  meeting: MinutesMeeting;
  /** Present for a project-linked meeting; omitted/undefined for a standalone one. */
  project?: MinutesProject | null;
  attendees: MinutesAttendee[];
  agenda: MinutesAgendaItem[];
  notes: MinutesNote[];
  /** The meeting's tracked action items — who owns each, when it is due, where it stands. */
  actionItems?: MinutesActionItem[];
  generatedAt: string; // ISO
  generatedByName?: string | null;
  /**
   * The company time zone (the server's COMPANY_TIMEZONE), used when the meeting has
   * no valid zone of its own. Falls back to the COMPANY_TIMEZONE env var, then Asia/Muscat.
   */
  companyTimeZone?: string | null;
}

const MUTED: RGB = [0.42, 0.4, 0.38];
const INK: RGB = [0.11, 0.1, 0.09];

/** The company's home zone (Oman) when nothing more specific is configured. */
export const DEFAULT_COMPANY_TIMEZONE = 'Asia/Muscat';

/**
 * The zone every time in the minutes is shown in: the meeting's own zone, else the
 * company zone passed by the caller, else COMPANY_TIMEZONE from the environment, else
 * Asia/Muscat. Invalid names are skipped. Never silently UTC.
 */
export function resolveMinutesTimeZone(meetingTimeZone?: string | null, companyTimeZone?: string | null): string {
  for (const tz of [meetingTimeZone, companyTimeZone, process.env.COMPANY_TIMEZONE, DEFAULT_COMPANY_TIMEZONE]) {
    const name = tz?.trim();
    if (name && isValidTimeZone(name)) return name;
  }
  return DEFAULT_COMPANY_TIMEZONE;
}

function fmtDay(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(d);
}

export function fmtDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone,
  }).format(d);
}

/** "10:00 AM – 11:30 AM (GMT+4)" in the given zone. */
export function fmtTimeRange(startIso: string, endIso: string | null, tz: string): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '—';
  const time = (d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
  const zone = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: tz, timeZoneName: 'short' }).formatToParts(start).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  if (!endIso) return `${time(start)} (${zone})`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${time(start)} (${zone})`;
  return `${time(start)} – ${time(end)} (${zone})`;
}

export function fmtTimestamp(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(d);
}

/**
 * Compose a polished, multi-page Minutes of Meeting PDF from assembled data. Arabic
 * titles, names and notes render with real joined glyphs in right-to-left order; all
 * times are shown in the meeting's zone (see `resolveMinutesTimeZone`).
 */
export function buildMinutesPdf(data: MinutesData): Buffer {
  const { meeting, brand, project } = data;
  const tz = resolveMinutesTimeZone(meeting.timeZone, data.companyTimeZone);

  // Branded footer: company · website · support on line 1, address on line 2, generated credit on line 3.
  // Each user-supplied fragment is bidi-isolated so an Arabic name can't reorder its neighbours.
  const footerBits = [brand.companyName, brand.websiteUrl, brand.supportEmail].filter((b): b is string => Boolean(b)).map(isolate);
  const generated = `Generated ${isolate(fmtTimestamp(data.generatedAt, tz))}${data.generatedByName ? ` by ${isolate(data.generatedByName)}` : ''} · ${isolate(brand.productName)}`;
  const footerLeft = [footerBits.join('  ·  '), brand.companyAddress, generated].filter(Boolean).join('\n');

  const doc = new PdfDocument({
    title: `Minutes of Meeting: ${meeting.title}`,
    palette: {
      brand: brand.colors?.brand,
      ink: brand.colors?.ink,
      muted: brand.colors?.muted,
      line: brand.colors?.line,
    },
    footerLeft,
  });

  // Branded masthead: logo mark + product name + tagline + eyebrow.
  doc.brandHeader({ eyebrow: 'Minutes of Meeting', title: brand.productName, subtitle: brand.tagline });

  // Meeting title (an Arabic title is set right-to-left, flush right)
  doc.text(meeting.title, { bold: true, size: 20, color: INK, gap: 4 });

  // Meeting metadata
  doc.keyValue('Date', fmtDate(meeting.startAt, tz));
  doc.keyValue('Time', fmtTimeRange(meeting.startAt, meeting.endAt, tz));
  doc.keyValue('Time zone', tz);
  doc.keyValue('Project', project ? project.name : 'Standalone meeting');
  doc.keyValue('Organizer', meeting.organizerName ?? '—');
  if (meeting.location) doc.keyValue('Location', meeting.location);
  if (meeting.onlineLink) doc.keyValue('Online', meeting.onlineLink);
  doc.keyValue('Status', meeting.statusLabel);

  const decisions = data.notes.filter((n) => n.type === 'DECISION');
  // Action notes already tracked as action items appear once, in the table.
  const actionNotes = data.notes.filter((n) => n.type === 'ACTION' && !n.trackedAsActionItem);
  const discussion = data.notes.filter((n) => n.type !== 'DECISION' && n.type !== 'ACTION');
  const items = data.actionItems ?? [];
  const present = data.attendees.filter((a) => /^(present|late)$/i.test(a.attendanceLabel)).length;
  const covered = data.agenda.filter((a) => a.completed).length;
  const openItems = items.filter((i) => i.open ?? !/^(completed|cancelled)$/i.test(i.statusLabel)).length;

  // At a glance
  doc.spacer(6);
  doc.statTiles([
    { label: 'Attendees present', value: `${present}/${data.attendees.length}`, tone: 'brand' },
    { label: 'Agenda items covered', value: `${covered}/${data.agenda.length}`, tone: 'success' },
    { label: 'Decisions made', value: String(decisions.length), tone: 'muted' },
    { label: 'Open action items', value: String(openItems), tone: openItems > 0 ? 'warning' : 'success' },
  ]);

  // Project details (only for a project-linked meeting)
  if (project) {
    doc.heading('Project details');
    if (project.code) doc.keyValue('Code', project.code);
    if (project.clientName) doc.keyValue('Client', project.clientName);
    if (project.ownerName) doc.keyValue('Owner', project.ownerName);
    if (project.statusLabel) doc.keyValue('Status', project.statusLabel);
    if (project.startDate || project.targetDate) {
      doc.keyValue('Timeline', `${fmtDay(project.startDate, tz)}  –  ${fmtDay(project.targetDate, tz)}`);
    }
  }

  // Summary / description
  if (meeting.description && meeting.description.trim()) {
    doc.heading('Summary');
    doc.text(meeting.description.trim());
  }

  // Attendees — role (required/optional), the answer to the invitation and attendance on the day
  // are three different things, so each has its own column.
  doc.heading('Attendees', { keepWith: 40 });
  if (data.attendees.length === 0) {
    doc.text('No attendees recorded.', { color: MUTED });
  } else {
    doc.text(`${data.attendees.length} invited · ${present} present`, { color: MUTED, size: 9.5, gap: 4 });
    const withEmail = data.attendees.some((a) => a.email);
    doc.table(
      [{ header: 'Name' }, ...(withEmail ? [{ header: 'Email' }] : []), { header: 'Role' }, { header: 'Response' }, { header: 'Attendance' }],
      data.attendees.map((a) => [
        a.name,
        ...(withEmail ? [a.email ?? '—'] : []),
        a.external ? `${a.roleLabel} · Guest` : a.roleLabel,
        a.responseLabel,
        a.attendanceLabel,
      ]),
    );
  }

  // Agenda
  doc.heading('Agenda', { keepWith: 40 });
  if (data.agenda.length === 0) {
    doc.text('No agenda items were recorded.', { color: MUTED });
  } else {
    doc.table(
      [{ header: '#' }, { header: 'Item' }, { header: 'Presenter' }, { header: 'Planned' }, { header: 'Covered' }],
      data.agenda.map((item, i) => [
        String(i + 1),
        item.title,
        item.presenterName ?? '—',
        item.expectedMinutes != null ? `${item.expectedMinutes} min` : '—',
        item.completed ? 'Yes' : 'No',
      ]),
    );
    const planned = data.agenda.reduce((sum, a) => sum + (a.expectedMinutes ?? 0), 0);
    const length = meeting.endAt ? Math.round((new Date(meeting.endAt).getTime() - new Date(meeting.startAt).getTime()) / 60000) : 0;
    if (planned > 0) {
      doc.text(`Planned time: ${planned} min${length > 0 ? ` of a ${length} min meeting` : ''}`, { color: MUTED, size: 9, gap: 2 });
    }
  }

  // Attribution line under a note, aligned with the note (right for an Arabic note).
  const byline = (n: MinutesNote): string =>
    `— ${isolate(n.authorName)} · ${isolate(fmtTimestamp(n.createdAt, tz))}${n.highlighted ? ' · Key point' : ''}`;

  if (decisions.length > 0) {
    doc.heading('Decisions', { keepWith: 30 });
    decisions.forEach((n, i) => {
      const direction = textDirection(n.body);
      doc.numbered(`${i + 1}.`, n.body, { direction });
      doc.text(byline(n), { color: MUTED, size: 8.5, indent: 16, gap: 2, direction });
    });
  }

  if (items.length > 0 || actionNotes.length > 0) {
    doc.heading('Action Items', { keepWith: 40 });
    if (items.length > 0) {
      const withTask = items.some((i) => i.taskKey);
      doc.table(
        [{ header: 'Action' }, { header: 'Owner' }, { header: 'Due' }, { header: 'Priority' }, { header: 'Status' }, ...(withTask ? [{ header: 'Task' }] : [])],
        items.map((i) => [
          i.description,
          i.ownerName || 'Unassigned',
          i.dueDate ? fmtDay(i.dueDate, 'UTC') : '—',
          i.priorityLabel,
          i.statusLabel,
          ...(withTask ? [i.taskKey ?? '—'] : []),
        ]),
      );
    }
    if (actionNotes.length > 0) {
      if (items.length > 0) doc.text('Also noted during the meeting', { bold: true, size: 9.5, color: INK, gap: 2 });
      for (const n of actionNotes) {
        doc.bullet(n.body, { direction: textDirection(n.body) });
        doc.text(byline(n), { color: MUTED, size: 8.5, indent: 12, gap: 1, direction: textDirection(n.body) });
      }
    }
  }

  // Discussion, grouped by kind (sub-headings only when there is more than one kind).
  doc.heading('Discussion & Notes', { keepWith: 30 });
  if (discussion.length === 0) {
    doc.text('No discussion notes were recorded.', { color: MUTED });
  } else {
    const groups: Array<[string, MinutesNote[]]> = [
      ['Discussion', discussion.filter((n) => !['ISSUE', 'QUESTION', 'INFORMATION'].includes(n.type))],
      ['Issues', discussion.filter((n) => n.type === 'ISSUE')],
      ['Questions', discussion.filter((n) => n.type === 'QUESTION')],
      ['Information', discussion.filter((n) => n.type === 'INFORMATION')],
    ].filter((g): g is [string, MinutesNote[]] => (g[1] as MinutesNote[]).length > 0) as Array<[string, MinutesNote[]]>;
    for (const [label, notes] of groups) {
      if (groups.length > 1) doc.text(label, { bold: true, size: 10.5, color: INK, gap: 2 });
      for (const n of notes) {
        const direction = textDirection(n.body);
        doc.bullet(n.body, { direction });
        doc.text(byline(n), { color: MUTED, size: 8.5, indent: 12, gap: 2, direction });
      }
    }
  }

  return doc.build();
}
