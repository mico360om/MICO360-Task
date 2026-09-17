import { PdfDocument, type RGB } from '../../lib/pdf-document';

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
  generatedAt: string; // ISO
  generatedByName?: string | null;
}

const MUTED: RGB = [0.42, 0.4, 0.38];
const INK: RGB = [0.11, 0.1, 0.09];

function fmtDay(iso: string | null | undefined, timeZone: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: timeZone || 'UTC' }).format(d);
}

function fmtDate(iso: string, timeZone: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timeZone || 'UTC',
  }).format(d);
}

function fmtTimeRange(startIso: string, endIso: string | null, timeZone: string | null): string {
  const tz = timeZone || 'UTC';
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '—';
  const time = (d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
  const zone = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: tz, timeZoneName: 'short' }).formatToParts(start).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  if (!endIso) return `${time(start)} (${zone})`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${time(start)} (${zone})`;
  return `${time(start)} – ${time(end)} (${zone})`;
}

function fmtTimestamp(iso: string, timeZone: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timeZone || 'UTC' }).format(d);
}

/** Compose a polished, multi-page Minutes of Meeting PDF from assembled data. */
export function buildMinutesPdf(data: MinutesData): Buffer {
  const { meeting, brand, project } = data;
  const tz = meeting.timeZone;

  // Branded footer: company · website · support on line 1, address on line 2, generated credit on line 3.
  const footerBits = [brand.companyName, brand.websiteUrl, brand.supportEmail].filter(Boolean);
  const generated = `Generated ${fmtTimestamp(data.generatedAt, tz)}${data.generatedByName ? ` by ${data.generatedByName}` : ''} · ${brand.productName}`;
  const footerLeft = [footerBits.join('  ·  '), brand.companyAddress, generated].filter(Boolean).join('\n');

  const doc = new PdfDocument({
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

  // Meeting title
  doc.text(meeting.title, { bold: true, size: 20, color: INK, gap: 4 });

  // Meeting metadata
  doc.keyValue('Date', fmtDate(meeting.startAt, tz));
  doc.keyValue('Time', fmtTimeRange(meeting.startAt, meeting.endAt, tz));
  doc.keyValue('Project', project ? project.name : 'Standalone meeting');
  doc.keyValue('Organizer', meeting.organizerName ?? '—');
  if (meeting.location) doc.keyValue('Location', meeting.location);
  if (meeting.onlineLink) doc.keyValue('Online', meeting.onlineLink);
  doc.keyValue('Status', meeting.statusLabel);

  // Project details (only for a project-linked meeting)
  if (project) {
    doc.heading('Project details');
    if (project.code) doc.keyValue('Code', project.code);
    if (project.clientName) doc.keyValue('Client', project.clientName);
    if (project.ownerName) doc.keyValue('Owner', project.ownerName);
    if (project.statusLabel) doc.keyValue('Status', project.statusLabel);
    if (project.startDate || project.targetDate) {
      doc.keyValue('Timeline', `${fmtDay(project.startDate, tz)}  →  ${fmtDay(project.targetDate, tz)}`);
    }
  }

  // Summary / description
  if (meeting.description && meeting.description.trim()) {
    doc.heading('Summary');
    doc.text(meeting.description.trim());
  }

  // Attendees
  doc.heading('Attendees');
  if (data.attendees.length === 0) {
    doc.text('No attendees recorded.', { color: MUTED });
  } else {
    const present = data.attendees.filter((a) => a.attendanceLabel.toLowerCase() === 'present').length;
    doc.text(`${data.attendees.length} invited · ${present} present`, { color: MUTED, size: 9.5, gap: 2 });
    for (const a of data.attendees) {
      const tags = [a.roleLabel, a.attendanceLabel];
      if (a.external) tags.unshift('Guest');
      const suffix = a.email ? `  <${a.email}>` : '';
      doc.bullet(`${a.name}${suffix}  —  ${tags.join(' · ')}`);
    }
  }

  // Agenda
  doc.heading('Agenda');
  if (data.agenda.length === 0) {
    doc.text('No agenda items were recorded.', { color: MUTED });
  } else {
    data.agenda.forEach((item, i) => {
      const meta: string[] = [];
      if (item.presenterName) meta.push(item.presenterName);
      if (item.expectedMinutes != null) meta.push(`${item.expectedMinutes} min`);
      if (item.completed) meta.push('done');
      const suffix = meta.length ? `  (${meta.join(' · ')})` : '';
      doc.numbered(`${i + 1}.`, `${item.title}${suffix}`);
    });
  }

  const decisions = data.notes.filter((n) => n.type === 'DECISION');
  const actions = data.notes.filter((n) => n.type === 'ACTION');
  const discussion = data.notes.filter((n) => n.type !== 'DECISION' && n.type !== 'ACTION');

  if (decisions.length > 0) {
    doc.heading('Decisions');
    for (const n of decisions) {
      doc.bullet(n.body);
      doc.text(`— ${n.authorName} · ${fmtTimestamp(n.createdAt, tz)}`, { color: MUTED, size: 8.5, indent: 12, gap: 1 });
    }
  }

  if (actions.length > 0) {
    doc.heading('Action Items');
    for (const n of actions) {
      doc.bullet(n.body);
      doc.text(`— ${n.authorName} · ${fmtTimestamp(n.createdAt, tz)}`, { color: MUTED, size: 8.5, indent: 12, gap: 1 });
    }
  }

  doc.heading('Discussion & Notes');
  if (discussion.length === 0) {
    doc.text('No discussion notes were recorded.', { color: MUTED });
  } else {
    for (const n of discussion) {
      doc.text(`[${n.typeLabel}] ${n.body}`, { gap: 0 });
      doc.text(`— ${n.authorName} · ${fmtTimestamp(n.createdAt, tz)}`, { color: MUTED, size: 8.5, gap: 2 });
    }
  }

  return doc.build();
}
