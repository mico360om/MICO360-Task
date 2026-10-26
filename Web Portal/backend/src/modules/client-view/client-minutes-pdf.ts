import { PdfDocument, hexToRgb } from '../../lib/pdf-document';
import { isolate, textDirection } from '../../lib/pdf-text';
import { PROJECT_ICON_PATHS, projectInitials, type ProjectIcon } from '../projects/project-icons';
import { fmtDate, fmtDay, fmtTimeRange, resolveMinutesTimeZone, type MinutesBrand } from '../meetings/minutes';
import type { FinalMinutesContent } from '../meetings/final-minutes';

/**
 * The minutes PDF a shared client downloads. The staff PDF (meetings/minutes.ts) is the whole meeting
 * record: the organizer, the approver, every attendee with their answer and attendance (and a
 * guest's email address), the agenda's presenters, every note with its author, the action items
 * with their owners, the project's owner, the place and online link, and who made the PDF. None of
 * that is for a client. This copy is the approved Final MOM alone, under the project's header —
 * and its data has no field for a person's name, so it cannot print one.
 */
export interface ClientMinutesPdfData {
  brand: Pick<MinutesBrand, 'productName' | 'companyName' | 'websiteUrl' | 'supportEmail' | 'companyAddress' | 'colors'>;
  project: {
    name: string;
    code: string | null;
    number: string | null;
    clientName: string | null;
    color: string | null;
    icon: string | null;
    /** The project's picture (bytes as stored), printed when the PDF can take it. */
    image: Buffer | null;
  };
  meeting: { title: string; startAt: string; endAt: string | null; timeZone: string | null };
  approvedAt: string | null;
  content: FinalMinutesContent;
  companyTimeZone?: string | null;
  generatedAt: string;
}

const INK: [number, number, number] = [0.11, 0.1, 0.09];

export function buildClientMinutesPdf(data: ClientMinutesPdfData): Buffer {
  const { brand, project, meeting, content: c } = data;
  const tz = resolveMinutesTimeZone(meeting.timeZone, data.companyTimeZone);
  const footer = [
    [brand.companyName, brand.websiteUrl, brand.supportEmail].filter((b): b is string => Boolean(b)).map(isolate).join('  ·  '),
    brand.companyAddress,
    `Shared with you through ${isolate(brand.productName)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const doc = new PdfDocument({
    title: `Minutes of Meeting: ${meeting.title}`,
    palette: { brand: brand.colors?.brand, ink: brand.colors?.ink, muted: brand.colors?.muted, line: brand.colors?.line },
    footerLeft: footer,
  });

  const subtitle = [project.code, project.number ? `Project no. ${project.number}` : null, project.clientName]
    .filter((b): b is string => Boolean(b))
    .map(isolate)
    .join('  ·  ');
  doc.identityHeader({
    image: project.image,
    icon: project.icon && project.icon in PROJECT_ICON_PATHS ? PROJECT_ICON_PATHS[project.icon as ProjectIcon] : null,
    initials: projectInitials(project.name),
    color: project.color ? hexToRgb(project.color, hexToRgb(brand.colors?.brand ?? '#8B1E1E')) : undefined,
    eyebrow: 'Minutes of Meeting',
    title: project.name,
    subtitle: subtitle || undefined,
    badge: { text: 'Final', tone: 'success' },
  });

  doc.text(meeting.title, { bold: true, size: 20, color: INK, gap: 6, family: 'display' });
  doc.keyValueColumns(
    [
      ['Date', fmtDate(meeting.startAt, tz)],
      ['Time', fmtTimeRange(meeting.startAt, meeting.endAt, tz)],
    ],
    [['Project', project.name]],
  );

  doc.spacer(6);
  doc.statusStrip(data.approvedAt ? `FINAL · Approved on ${isolate(fmtDay(data.approvedAt, tz))}` : 'FINAL', 'success');

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
  return doc.build();
}
