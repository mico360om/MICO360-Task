/**
 * Training Center certificates (owner answers 6 and 12; R10): one A4 page in the 1.23.11 PDF standard —
 * the learner's company logo and name (else the site's), the learner, the course, the day they completed
 * it, the quiz score when the course has one, when it stops being valid, the certificate's code and the
 * public verification link, and "Issued by" a Training manager or administrator with an optional
 * signature picture. An expired or revoked certificate says so on a strip under the header.
 */
import { PdfDocument, PDF_STANDARD, type KeyValueRow, type RGB } from '../../lib/pdf-document';
import { BRAND, formatDay, printedLine, slugPart } from '../../lib/export-format';
import { zonedDayKey } from '../../lib/due-date';
import { resolveBrand } from '../email/brand';
import type { CertificateStatus } from './training-types';

export interface CertificatePdf {
  code: string;
  learnerName: string;
  courseTitle: string;
  issuedAt: Date;
  expiresAt: Date | null;
  scorePct: number | null;
  issuerName: string | null;
  issuerTitle: string | null;
  /** A picture pdfkit can print (PNG/JPEG, already made printable by the caller); null: none. */
  signature: Buffer | null;
  /** `<site origin>/verify/<code>` (built by the caller). */
  verifyUrl: string;
  status: CertificateStatus;
  revokedReason?: string | null;
  /** The learner's company brand (its name + logo), else the site's: name null = the site's default name. */
  company: { companyName: string | null; logo: Buffer | null };
  timeZone: string;
}

const MUTED: RGB = [0.42, 0.4, 0.38];

/** The certificate as a PDF (one A4 portrait page). */
export function buildCertificatePdf(c: CertificatePdf, opts: { printedBy?: string | null; now?: Date } = {}): Buffer {
  const companyName = c.company.companyName ?? resolveBrand().companyName;
  const day = (at: Date) => formatDay(zonedDayKey(at, c.timeZone));
  const doc = new PdfDocument({
    title: `Certificate - ${c.courseTitle} - ${c.learnerName}`,
    runningTitle: 'Certificate of completion',
    footer: { company: companyName, printed: printedLine(opts.now ?? new Date(), c.timeZone, opts.printedBy ?? null) },
    palette: { brand: BRAND },
    ...(c.company.logo ? { logo: c.company.logo } : {}),
  });
  doc.reportHeader({ title: 'Certificate of completion', subtitle: companyName, details: ['Training Center'] });

  if (c.status === 'REVOKED') doc.statusStrip(c.revokedReason?.trim() ? `Revoked: ${c.revokedReason.trim()}` : 'Revoked', 'warning');
  else if (c.status === 'EXPIRED') doc.statusStrip(c.expiresAt ? `Expired on ${day(c.expiresAt)}` : 'Expired', 'warning');

  const S = PDF_STANDARD.space;
  doc.spacer(S.xl * 3);
  doc.text('This certifies that', { align: 'center', color: MUTED, gap: S.m });
  doc.text(c.learnerName, { align: 'center', bold: true, size: 22, gap: S.l });
  doc.text('has completed', { align: 'center', color: MUTED, gap: S.m });
  doc.text(c.courseTitle, { align: 'center', bold: true, size: 16, gap: S.s });
  doc.text(`on ${day(c.issuedAt)}`, { align: 'center', gap: S.xl * 2 });

  const left: KeyValueRow[] = [['Completed', day(c.issuedAt)]];
  if (c.scorePct !== null) left.push(['Quiz score', `${c.scorePct}%`]);
  if (c.expiresAt) left.push([c.status === 'EXPIRED' ? 'Expired on' : 'Valid until', day(c.expiresAt)]);
  const right: KeyValueRow[] = [['Certificate code', c.code]];
  doc.rule();
  doc.spacer(S.s);
  doc.keyValueColumns(left, right);
  doc.spacer(S.m);
  // The whole link on one line of its own (a narrow column would break it).
  doc.styledText([{ text: 'Check this certificate at ' }, { text: c.verifyUrl, href: c.verifyUrl }], { size: PDF_STANDARD.type.data, gap: S.s });
  doc.rule();

  if (c.issuerName) {
    doc.spacer(S.xl * 2);
    doc.text('Issued by', { color: MUTED, size: PDF_STANDARD.type.small, gap: S.xs });
    const picture = c.signature ? doc.prepareImage(c.signature) : null;
    const who = c.issuerTitle ? `${c.issuerName}, ${c.issuerTitle}` : c.issuerName;
    if (picture) doc.imageGrid([{ image: picture, caption: who }], { columns: 3, height: 48 });
    else {
      doc.text(c.issuerName, { bold: true, gap: S.xs });
      if (c.issuerTitle) doc.text(c.issuerTitle, { color: MUTED });
    }
  }
  return doc.build();
}

/** certificate-<course>-<learner>-<CODE>.pdf (letters, digits and dashes only). */
export function certificateFileName(c: Pick<CertificatePdf, 'courseTitle' | 'learnerName' | 'code'>): string {
  const code = c.code.replace(/[^A-Za-z0-9-]/g, '');
  return `${['certificate', slugPart(c.courseTitle), slugPart(c.learnerName), code].filter(Boolean).join('-')}.pdf`;
}
