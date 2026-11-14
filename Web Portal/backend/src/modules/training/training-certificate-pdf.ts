/**
 * Learning Hub certificates (owner answers 6 and 12; R10). 1.23.35 (owner, 14 Nov: "use similar design for the
 * certificate"): one A4 landscape page laid out like the owner's picture — the logo top left (the learner's company's,
 * else MICO360's), "CERTIFICATE / OF COMPLETION", "THIS CERTIFIES THAT", the learner's name large in a script face in
 * brand red (Noto Naskh Arabic for a name with Arabic letters; a long name shrinks to one line), "has successfully
 * completed" the course, the company with "Issued through MICO360 Tasks · Learning Hub" over a thin red line, the detail
 * rows (certificate-art.ts: Completed and issued, Quiz score, Expires, Certificate ID, Issued by with a small signature),
 * and the QR code of the public check in a laurel wreath with "Scan to verify". An expired or revoked certificate gets a
 * large faint diagonal stamp and its date and reason in the rows. Every shape is a vector drawing (certificate-art.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { drawTextLine, layoutText, measureText, registerPdfFonts, type FontKey } from '../../lib/pdf-text';
import { printableImage } from '../../lib/pdf-image';
import { formatDay, slugPart } from '../../lib/export-format';
import { zonedDayKey } from '../../lib/due-date';
import { resolveBrand } from '../email/brand';
import { qrMatrix } from './training-qr';
import { CERT_COLORS, CERT_PAGE, CERT_SCAN, CERT_SHAPES, CERT_STAMP, CERT_TEXT, CERT_WREATH, certNameSize, certQrBox, certificateRows, certificateStamp, certificateWords, shapePath, type CertFace, type CertMeasure } from './certificate-art';
import type { CertificateStatus } from './training-types';

export interface CertificatePdf {
  code: string;
  learnerName: string;
  courseTitle: string;
  issuedAt: Date;
  /** The day the person finished the course (older certificates: the issue day). */
  completedAt: Date;
  expiresAt: Date | null;
  scorePct: number | null;
  issuerName: string | null;
  issuerTitle: string | null;
  /** A picture pdfkit can print (PNG/JPEG, already made printable by the caller); null: none. */
  signature: Buffer | null;
  /** `<site origin>/verify/<code>` (built by the caller). */
  verifyUrl: string;
  status: CertificateStatus;
  /** When it was revoked (a revoked certificate's "Revoked on" row). */
  revokedAt?: Date | null;
  revokedReason?: string | null;
  /** The learner's company brand (its name + logo), else the site's: name null = the site's default name. */
  company: { companyName: string | null; logo: Buffer | null };
  timeZone: string;
}

/** A picture pdfkit has opened (embedded once), with its size in pixels. */
interface Opened {
  width: number;
  height: number;
}

/**
 * The built-in logo for the certificate: assets/logo-certificate.png, the brand logo flattened onto white at about
 * 300 dpi for its 150 × 58 pt box (the PDF standard's logo-pdf.png is made for a 26 pt header), found next to the
 * server or the source.
 */
let builtInLogo: Buffer | null | undefined;
function certificateLogo(): Buffer | null {
  if (builtInLogo !== undefined) return builtInLogo;
  const name = 'logo-certificate.png';
  const candidates = [resolve(process.cwd(), 'assets', name), resolve(__dirname, '../../../assets', name), resolve(__dirname, '../../../../assets', name)];
  const found = candidates.find((c) => existsSync(c));
  builtInLogo = found ? readFileSync(found) : null;
  return builtInLogo;
}

/** Widths as the PDF sets them (fontkit, the embedded faces): the shared layout's measure. */
const pdfMeasure: CertMeasure = (text, face, size, spacing = 0) => {
  const width = face === 'heading' ? measureText(text, size, false, 'display-black') : face === 'script' ? measureText(text, size, false, 'script') : measureText(text, size, face === 'text-bold');
  return width + spacing * Array.from(text).length;
};

/** The size the learner's name is printed at: 66 pt, or smaller so it fits the column on one line. */
export function certificateNameSize(name: string): number {
  return certNameSize(name, pdfMeasure);
}

/** pdfkit's face for words drawn as they are (the fixed English words with letter spacing, the heading). */
const FIXED_FONT: Record<CertFace, FontKey> = { heading: 'display-black', text: 'latin', 'text-bold': 'latin-bold', script: 'script', arabic: 'arabic' };

/** The certificate as a PDF (one A4 landscape page). */
export function buildCertificatePdf(c: CertificatePdf, _opts: { printedBy?: string | null; now?: Date } = {}): Buffer {
  const day = (at: Date) => formatDay(zonedDayKey(at, c.timeZone));
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    autoFirstPage: false,
    displayTitle: true,
    info: { Title: `Certificate - ${c.courseTitle} - ${c.learnerName}`, Creator: 'MICO360 Tasks', Producer: 'MICO360 Tasks' },
  });
  registerPdfFonts(doc);
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  const open = (buf: Buffer | null): Opened | null => {
    const printable = buf ? printableImage(buf) : null;
    if (!printable) return null;
    try {
      const img = (doc as unknown as { openImage(src: Buffer): Opened }).openImage(printable);
      return img.width > 0 && img.height > 0 ? img : null;
    } catch {
      return null;
    }
  };
  const draw = (img: Opened, x: number, top: number, w: number, h: number) => (doc as unknown as { image(src: Opened, x: number, y: number, o: { width: number; height: number }): unknown }).image(img, x, top, { width: w, height: h });

  // The paper and its shapes, the wreath (decoration: an artifact, skipped by readers and copy/paste).
  doc.markContent('Artifact', { type: 'Layout' });
  doc.rect(0, 0, CERT_PAGE.width, CERT_PAGE.height).fill(CERT_COLORS.paper);
  for (const shape of CERT_SHAPES) doc.save().fillOpacity(shape.opacity).path(shapePath(shape)).fill(shape.color).restore();
  for (const d of CERT_WREATH.paths) doc.path(d).fill(CERT_WREATH.color);
  doc.endMarkedContent();

  // The logo: the learner's company's, else MICO360's, in the top-left box.
  const logo = open(c.company.logo) ?? open(certificateLogo());
  if (logo) {
    const k = Math.min(CERT_TEXT.logo.width / logo.width, CERT_TEXT.logo.height / logo.height);
    draw(logo, CERT_TEXT.logo.x, CERT_TEXT.logo.top + (CERT_TEXT.logo.height - logo.height * k) / 2, logo.width * k, logo.height * k);
  }

  // The words on the left (certificate-art.ts places them), as large as fits.
  const rows = certificateRows({ ...c, revokedAt: c.revokedAt ?? null, revokedReason: c.revokedReason ?? null }, day);
  const signature = c.issuerName?.trim() ? open(c.signature) : null;
  const plan = certificateWords(
    { learnerName: c.learnerName, courseTitle: c.courseTitle, companyName: c.company.companyName?.trim() || resolveBrand().companyName, productName: resolveBrand().productName, rows, signature },
    pdfMeasure,
  );
  if (signature && plan.signature) draw(signature, plan.signature.x, plan.signature.top, plan.signature.width, plan.signature.height);
  doc.rect(plan.rule.x, plan.rule.y, plan.rule.width, plan.rule.height).fill(CERT_COLORS.red);
  for (const w of plan.words) {
    if (w.spacing > 0 || w.face === 'heading') {
      // Fixed English words, letter-spaced: drawn as they are.
      doc.markContent('Span', { actual: w.text });
      doc.font(FIXED_FONT[w.face]).fontSize(w.size).fillColor(w.color).text(w.text, w.x, w.baseline, { lineBreak: false, baseline: 'alphabetic', characterSpacing: w.spacing });
      doc.endMarkedContent();
    } else {
      // The learner's, the course's and the company's words: shaped and ordered by the text engine (Arabic too).
      const line = layoutText(w.text, { size: w.size, bold: w.face === 'text-bold', family: w.face === 'script' ? 'script' : 'text' })[0];
      if (line) drawTextLine(doc, line, w.x, w.baseline, w.size, w.color);
    }
  }

  // The QR code of the public check, dark on white in the wreath's middle, a link too; "Scan to verify" under it.
  let matrix: boolean[][] | null = null;
  try {
    matrix = c.verifyUrl ? qrMatrix(c.verifyUrl) : null;
  } catch {
    matrix = null; // a link too long for a QR code
  }
  if (matrix && matrix.length > 0) {
    const box = certQrBox(matrix.length);
    doc.save().rect(box.x, box.y, box.size, box.size).fill('#ffffff');
    doc.fillColor('#000000');
    matrix.forEach((row, r) =>
      row.forEach((dark, col) => {
        if (dark) doc.rect(box.x + (col + 4) * box.unit, box.y + (r + 4) * box.unit, box.unit + 0.15, box.unit + 0.15);
      }),
    );
    doc.fill().restore();
    doc.link(box.x, box.y, box.size, box.size, c.verifyUrl);
    const scan = 'Scan to verify';
    const w = measureText(scan, CERT_SCAN.size, true);
    doc.markContent('Span', { actual: scan });
    doc.font('latin-bold').fontSize(CERT_SCAN.size).fillColor(CERT_COLORS.ink).text(scan, CERT_SCAN.cx - w / 2, CERT_SCAN.baseline, { lineBreak: false, baseline: 'alphabetic' });
    doc.endMarkedContent();
  }

  // Expired or revoked: a large faint stamp across the words, turned.
  const stamp = certificateStamp(c.status);
  if (stamp) {
    const size = CERT_STAMP.size;
    const w = measureText(stamp.text, size, false, 'display-black');
    const h = size * 0.686;
    doc.save().translate(CERT_STAMP.cx, CERT_STAMP.cy).rotate(CERT_STAMP.angle);
    doc.fillOpacity(CERT_STAMP.opacity).strokeOpacity(CERT_STAMP.opacity);
    doc.lineWidth(5).roundedRect(-w / 2 - 22, -h / 2 - 20, w + 44, h + 40, 14).stroke(stamp.color);
    doc.markContent('Span', { actual: stamp.text });
    doc.font('display-black').fontSize(size).fillColor(stamp.color).text(stamp.text, -w / 2, h / 2, { lineBreak: false, baseline: 'alphabetic' });
    doc.endMarkedContent();
    doc.restore();
  }

  doc.end();
  // pdfkit writes the whole file synchronously during end(); drain the stream buffer.
  const chunks: Buffer[] = [];
  for (let chunk = doc.read() as Buffer | null; chunk !== null; chunk = doc.read() as Buffer | null) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** certificate-<course>-<learner>-<CODE>.pdf (letters, digits and dashes only). */
export function certificateFileName(c: Pick<CertificatePdf, 'courseTitle' | 'learnerName' | 'code'>): string {
  const code = c.code.replace(/[^A-Za-z0-9-]/g, '');
  return `${['certificate', slugPart(c.courseTitle), slugPart(c.learnerName), code].filter(Boolean).join('-')}.pdf`;
}
