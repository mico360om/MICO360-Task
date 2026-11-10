import { PdfDocument } from '../../lib/pdf-document';
import { isolate } from '../../lib/pdf-text';
import {
  MINUTES_TYPE,
  fmtDate,
  fmtDay,
  fmtTimeRange,
  minutesFooter,
  minutesProjectHeader,
  minutesTitle,
  printFinalMinutes,
  printedAt,
  projectFacts,
  resolveMinutesTimeZone,
  type MinutesBrand,
} from '../meetings/minutes';
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
  /** Companies: the project's company logo (printable), on the right of the header; null = none, as before. */
  logo?: Buffer | null;
}

export function buildClientMinutesPdf(data: ClientMinutesPdfData): Buffer {
  const { brand, project, meeting, content: c } = data;
  const tz = resolveMinutesTimeZone(meeting.timeZone, data.companyTimeZone);
  // The staff minutes' look (see meetings/minutes.ts). 1.23.10 footer: the company, when it was
  // printed — no one's name, a client's copy — and the page; the website, address and "Shared with you through …".
  const doc = new PdfDocument({
    title: `Minutes of Meeting: ${meeting.title}`,
    runningTitle: `Minutes of Meeting · ${meeting.title} · ${project.name}`,
    palette: { brand: brand.colors?.brand, ink: brand.colors?.ink, muted: brand.colors?.muted, line: brand.colors?.line },
    footer: minutesFooter(brand, printedAt(data.generatedAt, tz), true),
    ...(data.logo ? { logo: data.logo } : {}),
  });

  minutesProjectHeader(doc, project, brand.colors?.brand, { text: 'Final', tone: 'success' });
  minutesTitle(doc, meeting.title);
  // When on the left; the project (its name, code, number and client) on the right.
  doc.keyValueColumns(
    [
      ['Date', fmtDate(meeting.startAt, tz)],
      ['Time', fmtTimeRange(meeting.startAt, meeting.endAt, tz)],
      ['Time zone', tz],
    ],
    projectFacts(project),
    { size: MINUTES_TYPE.facts },
  );

  doc.spacer(6);
  doc.statusStrip(data.approvedAt ? `FINAL · Approved on ${isolate(fmtDay(data.approvedAt, tz))}` : 'FINAL', 'success');
  printFinalMinutes(doc, c);
  return doc.build();
}
