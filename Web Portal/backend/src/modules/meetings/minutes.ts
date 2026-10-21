import { BULLET, PdfDocument, hexToRgb, type PdfRichBlock, type RGB } from '../../lib/pdf-document';
import { linkNeedsAddress, listMarkers, noteText, parseRichHtml } from '../../lib/rich-text';
import type { StyledRun } from '../../lib/pdf-text';
import { PROJECT_ICON_PATHS, projectInitials, type ProjectIcon } from '../projects/project-icons';
import { isolate, textDirection } from '../../lib/pdf-text';
import { isValidTimeZone } from './meeting-validation';
import type { FinalMinutesContent } from './final-minutes';

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
  /** RICH: `body` is formatted (lib/rich-text.ts) and is printed with its formatting. */
  format?: 'PLAIN' | 'RICH';
  authorName: string;
  createdAt: string; // ISO
  highlighted: boolean;
  /** An action note already listed among the action items (so it isn't printed twice). */
  trackedAsActionItem?: boolean;
  /** The agenda item the note was taken under, if any. */
  agendaTitle?: string | null;
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
  /** The project's own number (e.g. the client's job number). */
  number?: string | null;
  /** Hex colour of its icon or initials tile, when it has no picture that can be printed. */
  color?: string | null;
  /** The project's picture (bytes as stored); printed in the header when it can be (JPEG/PNG). */
  image?: Buffer | null;
  /** The project's icon (one of PROJECT_ICONS), drawn on its colour when there is no picture. */
  icon?: string | null;
  clientName?: string | null;
  statusLabel?: string | null;
  ownerName?: string | null;
  startDate?: string | null; // ISO
  targetDate?: string | null; // ISO
}

/** The final minutes (Final MOM) as written, and whether they are approved. */
export interface MinutesFinal {
  content: FinalMinutesContent;
  /** FINAL: approved. DRAFT: written but not approved yet. */
  status: 'FINAL' | 'DRAFT';
  approvedByName: string | null;
  approvedAt: string | null; // ISO
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
   * The Final MOM, printed first when there is one: approved (the minutes are then final) or, in
   * the organizer's own copy, still a draft. Without it the minutes are a draft from the notes.
   */
  final?: MinutesFinal | null;
  /**
   * The company time zone (the server's COMPANY_TIMEZONE), used when the meeting has
   * no valid zone of its own. Falls back to the COMPANY_TIMEZONE env var, then Asia/Muscat.
   */
  companyTimeZone?: string | null;
}

/**
 * A formatted note as the PDF prints it: its blocks with their list markers, each run in its faces
 * and decorations, and a link followed by its address (so a printed copy keeps it).
 */
export function printableNote(body: string): PdfRichBlock[] {
  const blocks = parseRichHtml(body);
  const markers = listMarkers(blocks);
  return blocks.map((b, i) => ({
    kind: b.kind,
    ...(b.kind === 'item' ? { level: b.level, marker: markers[i] ?? BULLET } : {}),
    runs: b.runs.flatMap((r): StyledRun[] => {
      const run: StyledRun = {
        text: r.text,
        bold: r.marks.includes('bold'),
        italic: r.marks.includes('italic'),
        underline: r.marks.includes('underline'),
        highlight: r.marks.includes('highlight'),
        ...(r.href ? { href: r.href } : {}),
      };
      return linkNeedsAddress(r) ? [run, { text: ` (${r.href})` }] : [run];
    }),
  }));
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

export function fmtDay(iso: string | null | undefined, timeZone: string): string {
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
 * Compose the Minutes of Meeting PDF — one document: when there is a Final MOM it comes first
 * (marked FINAL with who approved it, or DRAFT while it is not approved), followed by the
 * record of the meeting (attendance, agenda, action items, the notes taken); without one, the
 * minutes from the notes, marked as a draft. Arabic titles, names and notes render with real
 * joined glyphs in right-to-left order; all times are shown in the meeting's zone (see
 * `resolveMinutesTimeZone`).
 */
export function buildMinutesPdf(data: MinutesData): Buffer {
  const { meeting, brand, project } = data;
  const tz = resolveMinutesTimeZone(meeting.timeZone, data.companyTimeZone);
  const final = data.final ?? null;
  const approved = final?.status === 'FINAL';

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

  // Header: the project's picture (or its icon, or its initials, on its colour), name, code and
  // number for a project meeting; the product masthead for a standalone one. The badge says Final
  // once the Final MOM is approved, Draft until then.
  const badge = approved ? { text: 'Final', tone: 'success' as const } : { text: 'Draft', tone: 'warning' as const };
  if (project) {
    const subtitle = [project.code, project.number ? `Project no. ${project.number}` : null, project.clientName]
      .filter((b): b is string => Boolean(b))
      .map(isolate)
      .join('  ·  ');
    doc.identityHeader({
      image: project.image ?? null, // shown when the PDF can print it, else the icon or the initials
      icon: project.icon && project.icon in PROJECT_ICON_PATHS ? PROJECT_ICON_PATHS[project.icon as ProjectIcon] : null,
      initials: projectInitials(project.name),
      color: project.color ? hexToRgb(project.color, hexToRgb(brand.colors?.brand ?? '#8B1E1E')) : undefined,
      eyebrow: 'Minutes of Meeting',
      title: project.name,
      subtitle: subtitle || undefined,
      badge,
    });
  } else {
    doc.brandHeader({ eyebrow: 'Minutes of Meeting', title: brand.productName, subtitle: brand.tagline, badge });
  }

  // Meeting title (an Arabic title is set right-to-left, flush right)
  doc.text(meeting.title, { bold: true, size: 20, color: INK, gap: 6, family: 'display' });

  // Meeting details in two columns: when on the left; who, where and how it stands on the right.
  doc.keyValueColumns(
    [
      ['Date', fmtDate(meeting.startAt, tz)],
      ['Time', fmtTimeRange(meeting.startAt, meeting.endAt, tz)],
      ['Time zone', tz],
      ['Project', project ? project.name : 'Standalone meeting'],
    ],
    [
      ['Organizer', meeting.organizerName ?? '—'],
      ...(meeting.location ? [['Location', meeting.location] as const] : []),
      ...(meeting.onlineLink ? [['Online', meeting.onlineLink] as const] : []),
      ['Status', meeting.statusLabel],
    ],
  );

  const decisions = data.notes.filter((n) => n.type === 'DECISION');
  // Action notes already tracked as action items appear once, in the table.
  const actionNotes = data.notes.filter((n) => n.type === 'ACTION' && !n.trackedAsActionItem);
  const discussion = data.notes.filter((n) => n.type !== 'DECISION' && n.type !== 'ACTION');
  const issues = discussion.filter((n) => n.type === 'ISSUE');
  const questions = discussion.filter((n) => n.type === 'QUESTION');
  const talk = discussion.filter((n) => n.type !== 'ISSUE' && n.type !== 'QUESTION');
  const items = data.actionItems ?? [];
  const present = data.attendees.filter((a) => /^(present|late)$/i.test(a.attendanceLabel)).length;
  const covered = data.agenda.filter((a) => a.completed).length;
  const isOpen = (i: MinutesActionItem) => i.open ?? !/^(completed|cancelled)$/i.test(i.statusLabel);
  const openItems = items.filter(isOpen).length;

  // At a glance
  doc.spacer(8);
  doc.statTiles([
    { label: 'Attendees present', value: `${present}/${data.attendees.length}`, tone: 'brand' },
    { label: 'Agenda items covered', value: `${covered}/${data.agenda.length}`, tone: 'success' },
    { label: 'Decisions made', value: String(final ? final.content.decisions.length || decisions.length : decisions.length), tone: 'muted' },
    { label: 'Open action items', value: String(openItems), tone: openItems > 0 ? 'warning' : 'success' },
  ]);

  // Attribution line under a note, aligned with the note (right for an Arabic note).
  const byline = (n: MinutesNote): string =>
    `— ${isolate(n.authorName)} · ${isolate(fmtTimestamp(n.createdAt, tz))}${n.highlighted ? ' · Key point' : ''}`;

  /**
   * A note as an item of a list, after a bullet or its number: a formatted note keeps its
   * formatting. Returns the direction its byline follows.
   */
  const noteItem = (n: MinutesNote, lead: string = BULLET): 'ltr' | 'rtl' => {
    if (n.format === 'RICH') {
      doc.richBlocks(printableNote(n.body), { lead });
      return textDirection(noteText({ body: n.body, bodyFormat: n.format }));
    }
    const direction = textDirection(n.body);
    if (lead === BULLET) doc.bullet(n.body, { direction });
    else doc.numbered(lead, n.body, { direction });
    return direction;
  };

  // Notes grouped by kind, with a sub-heading per kind when a section has more than one.
  const noteGroups = (groups: Array<[string, MinutesNote[]]>) => {
    const shown = groups.filter(([, notes]) => notes.length > 0);
    for (const [label, notes] of shown) {
      if (shown.length > 1) doc.text(label, { bold: true, size: 10.5, color: INK, gap: 2 });
      for (const n of notes) {
        const direction = noteItem(n);
        doc.text(byline(n), { color: MUTED, size: 8.5, indent: 12, gap: 2, direction });
      }
    }
  };

  const projectDetails = () => {
    if (!project) return;
    doc.heading('Project details');
    if (project.code) doc.keyValue('Code', project.code);
    if (project.number) doc.keyValue('Project no.', project.number);
    if (project.clientName) doc.keyValue('Client', project.clientName);
    if (project.ownerName) doc.keyValue('Owner', project.ownerName);
    if (project.statusLabel) doc.keyValue('Project status', project.statusLabel);
    if (project.startDate || project.targetDate) {
      doc.keyValue('Timeline', `${fmtDay(project.startDate, tz)}  –  ${fmtDay(project.targetDate, tz)}`);
    }
  };

  // Attendees — role (required/optional), the answer to the invitation and attendance on the day
  // are three different things, so each has its own column.
  const attendees = () => {
    doc.heading('Attendees', { keepWith: 40 });
    if (data.attendees.length === 0) {
      doc.text('No attendees recorded.', { color: MUTED });
      return;
    }
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
  };

  const agenda = () => {
    doc.heading('Agenda', { keepWith: 40 });
    if (data.agenda.length === 0) {
      doc.text('No agenda items were recorded.', { color: MUTED });
      return;
    }
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
  };

  if (final) {
    // ── The Final MOM first: what was agreed, as approved (or, in the organizer's copy, as drafted) ──
    const c = final.content;
    doc.partBand('Final Minutes of Meeting', { keepWith: 70 });
    const when = final.approvedAt ? ` on ${isolate(fmtTimestamp(final.approvedAt, tz))}` : '';
    doc.statusStrip(
      approved ? `FINAL · Approved by ${isolate(final.approvedByName ?? '—')}${when}` : 'DRAFT · Not yet approved — these minutes may still change',
      approved ? 'success' : 'warning',
    );
    if (c.summary) {
      doc.subheading('Summary');
      doc.text(c.summary, { direction: textDirection(c.summary) });
    }
    if (c.discussion.length > 0) {
      doc.subheading('Discussion', { keepWith: 30 });
      for (const d of c.discussion) {
        doc.text(d.topic, { bold: true, size: 10.5, color: INK, gap: 1, direction: textDirection(d.topic) });
        for (const line of d.text.split('\n').filter((l) => l.trim())) doc.text(line.trim(), { gap: 1, direction: textDirection(line) });
        doc.spacer(4);
      }
    }
    if (c.decisions.length > 0) {
      doc.subheading('Decisions', { keepWith: 30 });
      c.decisions.forEach((d, i) => doc.numbered(`${i + 1}.`, d, { direction: textDirection(d) }));
    }
    if (c.risks.length > 0) {
      doc.subheading('Risks & Open Issues', { keepWith: 30 });
      for (const r of c.risks) doc.bullet(r, { direction: textDirection(r) });
    }
    if (c.nextSteps.length > 0) {
      doc.subheading('Next Steps', { keepWith: 30 });
      for (const n of c.nextSteps) doc.bullet(n, { direction: textDirection(n) });
    }
    if (approved) {
      // Who wrote and who approved these minutes closes them.
      doc.spacer(10);
      doc.text(`Prepared by ${isolate(meeting.organizerName ?? '—')}  ·  Approved by ${isolate(final.approvedByName ?? '—')}${when}`, { color: MUTED, size: 9.5, gap: 2 });
    }

    // ── Then the record of the meeting: who came, the agenda, the action items and every note ──
    doc.partBand('Meeting record', { keepWith: 70 });
    attendees();
    agenda();
    if (items.length > 0) {
      doc.heading('Action Items', { keepWith: 40 });
      actionItemsTable(doc, items);
    }
    doc.heading('Notes taken during the meeting', { keepWith: 30 });
    if (data.notes.length === 0) {
      doc.text('No notes were taken.', { color: MUTED });
    } else {
      noteGroups([
        ['Decisions', decisions],
        ['Action items noted', actionNotes],
        ['Issues', issues],
        ['Questions', questions],
        ['Discussion', talk.filter((n) => n.type !== 'INFORMATION')],
        ['Information', talk.filter((n) => n.type === 'INFORMATION')],
      ]);
    }
    projectDetails();
    return doc.build();
  }

  // ── No Final MOM yet: the minutes from the notes, marked as a draft ──
  projectDetails();
  const summaryText = meeting.description?.trim() ?? '';
  if (summaryText) {
    doc.heading('Summary');
    doc.text(summaryText);
  }
  attendees();
  agenda();

  if (decisions.length > 0) {
    doc.heading('Decisions', { keepWith: 30 });
    decisions.forEach((n, i) => {
      const direction = noteItem(n, `${i + 1}.`);
      doc.text(byline(n), { color: MUTED, size: 8.5, indent: 16, gap: 2, direction });
    });
  }

  if (items.length > 0 || actionNotes.length > 0) {
    doc.heading('Action Items', { keepWith: 40 });
    if (items.length > 0) actionItemsTable(doc, items);
    if (actionNotes.length > 0) {
      if (items.length > 0) doc.text('Also noted during the meeting', { bold: true, size: 9.5, color: INK, gap: 2 });
      for (const n of actionNotes) {
        const direction = noteItem(n);
        doc.text(byline(n), { color: MUTED, size: 8.5, indent: 12, gap: 1, direction });
      }
    }
  }

  // Risks & open issues: what could go wrong, and what is still unanswered.
  if (issues.length + questions.length > 0) {
    doc.heading('Risks & Open Issues', { keepWith: 30 });
    noteGroups([['Issues', issues], ['Questions', questions]]);
  }

  // The rest of the discussion.
  doc.heading('Discussion & Notes', { keepWith: 30 });
  if (talk.length === 0) {
    doc.text('No discussion notes were recorded.', { color: MUTED });
  } else {
    noteGroups([
      ['Discussion', talk.filter((n) => n.type !== 'INFORMATION')],
      ['Information', talk.filter((n) => n.type === 'INFORMATION')],
    ]);
  }

  // Next steps: the open action items, soonest first, each with its owner and due day.
  const next = items.filter(isOpen).sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
  if (next.length > 0) {
    doc.heading('Next Steps', { keepWith: 30 });
    for (const i of next) {
      const who = i.ownerName ? isolate(i.ownerName) : 'unassigned';
      doc.bullet(`${i.description} — ${who}${i.dueDate ? `, by ${fmtDay(i.dueDate, 'UTC')}` : ''}`, { direction: textDirection(i.description) });
    }
  }

  return doc.build();
}

/** The meeting's tracked action items: what, who, when it is due, how urgent, where it stands, its task. */
function actionItemsTable(doc: PdfDocument, items: MinutesActionItem[]): void {
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
