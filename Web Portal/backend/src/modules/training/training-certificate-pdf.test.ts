import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPdf, type DrawnLine } from '../../lib/pdf-inspect';
import { measureText } from '../../lib/pdf-text';
import { resolveBrand } from '../email/brand';
import { buildCertificatePdf, certificateFileName, certificateNameSize, type CertificatePdf } from './training-certificate-pdf';
import { CERT_PAGE, CERT_TEXT, certQrBox } from './certificate-art';
import { qrMatrix } from './training-qr';

const LOGO = readFileSync(resolve(__dirname, '../../../assets/logo-pdf.png'));
const TZ = 'Asia/Muscat';
const MM = 72 / 25.4;

const base: CertificatePdf = {
  code: 'TC-ABCD-EFGH-JKMN',
  learnerName: 'Ana Alpha',
  courseTitle: 'Tasks basics',
  // 23:30 UTC on 10 Nov is 11 Nov in Muscat: the day is read in the site's zone.
  issuedAt: new Date('2026-11-10T23:30:00Z'),
  completedAt: new Date('2026-11-02T10:00:00Z'),
  expiresAt: null,
  scorePct: null,
  issuerName: null,
  issuerTitle: null,
  signature: null,
  verifyUrl: 'https://task.example.com/verify/TC-ABCD-EFGH-JKMN',
  status: 'VALID',
  company: { companyName: null, logo: null },
  timeZone: TZ,
};
const sameDay = { ...base, issuedAt: new Date('2026-11-02T12:00:00Z') };
const linesOf = (buf: Buffer): DrawnLine[] => inspectPdf(buf).lines[0] ?? [];
const textOf = (buf: Buffer) => inspectPdf(buf).pages.map((p) => p.join('\n'));
const lineWith = (buf: Buffer, text: string) => linesOf(buf).find((l) => l.text === text);
/** The page boxes (MediaBox) of every page. */
const pageBoxes = (buf: Buffer) => [...buf.toString('latin1').matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1]!.trim().split(/\s+/).map(Number));
/** The pixel widths of the pictures in the file. */
const pictureWidths = (buf: Buffer) => [...inspectPdf(buf).objects.values()].filter((o) => /\/Subtype \/Image/.test(o)).map((o) => Number(/\/Width (\d+)/.exec(o)?.[1]));

const NAMES = {
  short: 'Ana Alpha',
  long: 'Bartholomew Alexander Fitzgerald-Montgomery of Northwind Engineering and Contoso Holdings',
  arabic: 'سارة علي البلوشي',
};

describe('certificate PDF: one A4 landscape page like the owner’s picture (1.23.35)', () => {
  it('is one landscape page in every case: short, long and Arabic names; with and without the extras; valid, expired and revoked; either logo', () => {
    const statuses = [
      { status: 'VALID' as const },
      { status: 'EXPIRED' as const, expiresAt: new Date('2026-11-01T08:00:00Z') },
      { status: 'REVOKED' as const, revokedAt: new Date('2026-11-12T08:00:00Z'), revokedReason: 'Replaced after the retake of the whole course by the training team at Fabrikam' },
    ];
    const extras = [
      {},
      { scorePct: 96, expiresAt: new Date('2027-11-11T08:00:00Z'), issuerName: 'Tariq Training of Contoso Engineering', issuerTitle: 'Training manager', signature: LOGO },
    ];
    const companies = [{ companyName: null, logo: null }, { companyName: 'Contoso Engineering LLC', logo: LOGO }];
    let built = 0;
    for (const learnerName of Object.values(NAMES)) {
      for (const s of statuses) {
        for (const x of extras) {
          for (const company of companies) {
            const buf = buildCertificatePdf({ ...base, learnerName, ...x, ...s, company, courseTitle: 'MICO360 Tasks User Training' });
            const where = `${learnerName} ${s.status} ${Object.keys(x).length} ${company.companyName}`;
            expect(pageBoxes(buf), where).toEqual([[0, 0, CERT_PAGE.width, CERT_PAGE.height]]);
            const lines = linesOf(buf);
            expect(lines.some((l) => l.text === learnerName), where).toBe(true);
            // Every line on the paper, the last one above the bottom margin (the stamp is drawn turned, in its own frame).
            for (const l of lines.filter((x) => x.text !== 'REVOKED' && x.text !== 'EXPIRED')) {
              expect(l.y, `${where}: ${l.text}`).toBeLessThanOrEqual(CERT_TEXT.bottom + 6);
              expect(l.y, `${where}: ${l.text}`).toBeGreaterThan(20);
              expect(l.x, `${where}: ${l.text}`).toBeGreaterThanOrEqual(0);
            }
            built++;
          }
        }
      }
    }
    expect(built).toBe(36);
  });

  it('the picture’s words: CERTIFICATE / OF COMPLETION, THIS CERTIFIES THAT, the name, the course, the issuer block and the rows', () => {
    const buf = buildCertificatePdf(sameDay, { now: new Date('2026-11-11T08:00:00Z') });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = textOf(buf);
    expect(pages).toHaveLength(1);
    const text = pages[0]!;
    for (const words of ['CERTIFICATE', 'OF COMPLETION', 'THIS CERTIFIES THAT', 'Ana Alpha', 'has successfully completed', 'Tasks basics', resolveBrand().companyName, 'Issued through MICO360 Tasks · Learning Hub', 'Completed and issued', '2 Nov 2026', 'Expires', 'Never', 'Certificate ID', 'TC-ABCD-EFGH-JKMN', 'Scan to verify']) {
      expect(text).toContain(words);
    }
    // The order of the left column, as in the picture.
    const order = ['CERTIFICATE', 'OF COMPLETION', 'THIS CERTIFIES THAT', 'Ana Alpha', 'has successfully completed', 'Tasks basics', resolveBrand().companyName, 'Issued through MICO360 Tasks · Learning Hub', 'Completed and issued', 'Expires', 'Certificate ID'];
    const ys = order.map((t) => lineWith(buf, t)?.y ?? NaN);
    expect(ys.every((y, i) => i === 0 || y > ys[i - 1]!), JSON.stringify(ys)).toBe(true);
    // No score, no expiry, nobody named: those rows are left out; no stamp.
    expect(text).not.toContain('Quiz score');
    expect(text).not.toContain('Issued by');
    expect(text).not.toMatch(/REVOKED|EXPIRED|Revoked on|Reason/);
    expect(text).not.toContain('Training Center');
  });

  it('fonts: the heading in Archivo Black, the name in Great Vibes in brand red, the labels and values in IBM Plex Sans', () => {
    const buf = buildCertificatePdf(sameDay);
    expect(lineWith(buf, 'CERTIFICATE')!.fonts).toEqual(['Archivo-Black']);
    expect(lineWith(buf, 'OF COMPLETION')!.fonts).toEqual(['Archivo-Black']);
    const name = lineWith(buf, 'Ana Alpha')!;
    expect(name.fonts.every((f) => f === 'GreatVibes-Regular')).toBe(true);
    expect(name.size).toBeGreaterThanOrEqual(60);
    expect(lineWith(buf, 'Completed and issued')!.fonts).toEqual(['IBMPlexSans-Regular']);
    expect(lineWith(buf, 'TC-ABCD-EFGH-JKMN')!.fonts).toEqual(['IBMPlexSans-SemiBold']);
    expect(lineWith(buf, 'Tasks basics')!.fonts).toEqual(['IBMPlexSans-SemiBold']);
    // Brand red (#8B1E1E = 0.545 0.118 0.118) is set for the name.
    const content = inspectPdf(buf).contents[0]!;
    const nameAt = content.indexOf('Ana Alpha');
    expect(nameAt).toBeGreaterThan(0);
    expect(content.slice(nameAt, nameAt + 300)).toMatch(/0\.545\d* 0\.117\d* 0\.117\d* (rg|scn)/);
  });

  it('a long name shrinks to fit one line; an Arabic name is set in Noto Naskh Arabic', () => {
    const long = buildCertificatePdf({ ...base, learnerName: NAMES.long });
    const name = linesOf(long).filter((l) => l.text.includes('Bartholomew') || l.text.includes('Holdings'));
    expect(name).toHaveLength(1);
    expect(name[0]!.text).toBe(NAMES.long);
    expect(name[0]!.size).toBeLessThan(40);
    expect(measureText(NAMES.long, name[0]!.size, false, 'script')).toBeLessThanOrEqual(CERT_TEXT.right - CERT_TEXT.name.x + 0.5);
    expect(certificateNameSize(NAMES.long)).toBeCloseTo(name[0]!.size, 2);
    expect(certificateNameSize('Ana Alpha')).toBe(CERT_TEXT.name.size);

    const arabic = buildCertificatePdf({ ...base, learnerName: NAMES.arabic });
    const a = lineWith(arabic, NAMES.arabic)!;
    expect(a).toBeTruthy();
    expect(a.fonts.every((f) => f.startsWith('NotoNaskhArabic'))).toBe(true);
    // A name with a letter the script face lacks still prints whole.
    const mixed = buildCertificatePdf({ ...base, learnerName: 'Zoë Ωmega' });
    expect(textOf(mixed)[0]).toContain('Zoë Ωmega');
  });

  it('the score, the expiry, the issuer with a small signature above its row, and the company’s own name and logo', () => {
    const buf = buildCertificatePdf(
      { ...base, scorePct: 85, expiresAt: new Date('2027-11-11T08:00:00Z'), issuerName: 'Tariq Training', issuerTitle: 'Training manager', signature: LOGO, company: { companyName: 'Contoso LLC', logo: LOGO } },
      { printedBy: 'Ana Alpha', now: new Date('2026-11-11T08:00:00Z') },
    );
    const text = textOf(buf)[0]!;
    for (const words of ['Quiz score', '85%', 'Expires', '11 Nov 2027', 'Issued by', 'Tariq Training, Training manager', 'Contoso LLC', 'Completed', '2 Nov 2026', 'Issued', '11 Nov 2026']) expect(text).toContain(words);
    // Issued on another day than finished: two rows, Completed then Issued.
    expect(lineWith(buf, 'Completed and issued')).toBeUndefined();
    // The company's logo and the signature (both the 155 px test picture); the built-in logo isn't used.
    expect(pictureWidths(buf)).toContain(155);
    expect(pictureWidths(buf)).not.toContain(620);
    // The signature sits small above the Issued by row (under the row before it).
    const content = inspectPdf(buf).contents[0]!;
    const issuedBy = lineWith(buf, 'Issued by')!;
    const code = lineWith(buf, 'TC-ABCD-EFGH-JKMN')!;
    const draws = [...content.matchAll(/([\d.]+) 0 0 (-?[\d.]+) ([\d.]+) ([\d.]+) cm\s*\/I\w+ Do/g)].map((m) => {
      const h = Math.abs(Number(m[2]));
      // pdfkit draws a picture as "w 0 0 -h x bottom cm" in the page's top-down space.
      return { w: Number(m[1]), h, x: Number(m[3]), top: Number(m[4]) - h };
    });
    const signature = draws.find((d) => d.top > code.y && d.top + d.h < issuedBy.y);
    expect(signature, JSON.stringify({ draws, code: code.y, issuedBy: issuedBy.y })).toBeTruthy();
    expect(signature!.h).toBeLessThanOrEqual(30);
  });

  it('the MICO360 logo when the company has none (a sharper copy made for the certificate)', () => {
    expect(pictureWidths(buildCertificatePdf(base))).toEqual([620]);
  });

  it('the QR code: dark on white, at least 30 mm, centred in the wreath, the same code as the link; the QR is a link to it', () => {
    const buf = buildCertificatePdf(base);
    const matrix = qrMatrix(base.verifyUrl);
    const box = certQrBox(matrix.length);
    expect(box.unit * matrix.length).toBeGreaterThanOrEqual(30 * MM);
    const content = inspectPdf(buf).contents[0]!;
    const rects = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)].map((m) => m.slice(1, 5).map(Number));
    const square = rects.find(([, , w, h]) => Math.abs(w! - box.size) < 0.01 && Math.abs(h! - box.size) < 0.01);
    expect(square).toBeTruthy();
    const dark = matrix.flat().filter(Boolean).length;
    const modules = rects.filter(([, , w, h]) => Math.abs(w! - (box.unit + 0.15)) < 0.01 && Math.abs(h! - (box.unit + 0.15)) < 0.01);
    expect(modules).toHaveLength(dark);
    // Each module at its place in the code.
    for (const [x, y] of modules) {
      const c = Math.round((x! - square![0]!) / box.unit) - 4;
      const r = Math.round((y! - square![1]!) / box.unit) - 4;
      expect(matrix[r]?.[c]).toBe(true);
    }
    // A click on it opens the check page.
    expect(buf.toString('latin1')).toMatch(/\/URI \(https:\/\/task\.example\.com\/verify\/TC-ABCD-EFGH-JKMN\)/);
    expect(lineWith(buf, 'Scan to verify')!.y).toBeGreaterThan(box.y + box.size);
    // No link (or one too long for a QR code): no square, still one page.
    expect(textOf(buildCertificatePdf({ ...base, verifyUrl: '' }))).toHaveLength(1);
    expect(textOf(buildCertificatePdf({ ...base, verifyUrl: `https://x.example/${'a'.repeat(4000)}` }))).toHaveLength(1);
  });

  it('expired or revoked: a large faint diagonal stamp, and the date and reason in the rows', () => {
    const expired = buildCertificatePdf({ ...base, status: 'EXPIRED', expiresAt: new Date('2026-11-01T08:00:00Z') });
    for (const words of ['EXPIRED', 'Expired on', '1 Nov 2026']) expect(textOf(expired)[0]).toContain(words);
    const revoked = buildCertificatePdf({ ...base, status: 'REVOKED', revokedAt: new Date('2026-11-12T08:00:00Z'), revokedReason: 'Replaced after the retake' });
    const text = textOf(revoked)[0]!;
    for (const words of ['REVOKED', 'Revoked on', '12 Nov 2026', 'Reason', 'Replaced after the retake']) expect(text).toContain(words);
    expect(lineWith(revoked, 'REVOKED')!.size).toBeGreaterThanOrEqual(60);
    // Faint (a fill opacity under 0.2) and turned (a rotation in its transform).
    expect(revoked.toString('latin1')).toMatch(/\/ca 0\.1\d*/);
    const content = inspectPdf(revoked).contents[0]!;
    expect(content).toMatch(/0\.95\d* -?0\.30\d* -?0\.30\d* 0\.95\d* [\d.-]+ [\d.-]+ cm/);
    // No reason or date given: the stamp only.
    const bare = textOf(buildCertificatePdf({ ...base, status: 'REVOKED' }))[0]!;
    expect(bare).toContain('REVOKED');
    expect(bare).not.toContain('Reason');
    expect(textOf(buildCertificatePdf(base))[0]).not.toMatch(/REVOKED|EXPIRED/);
  });

  it('keeps the title in the PDF’s properties', () => {
    const buf = buildCertificatePdf(base);
    const objects = inspectPdf(buf).objects;
    const info = [...objects.values()].find((o) => /\/Title/.test(o) && /\/Producer/.test(o)) ?? '';
    const ref = /\/Title (\d+) 0 R/.exec(info)?.[1];
    const title = (ref ? objects.get(Number(ref)) : /\/Title (<[0-9a-fA-F]+>|\([^)]*\))/.exec(info)?.[1]) ?? '';
    const t = title.trim();
    const decoded = t.startsWith('<') ? Buffer.from(t.slice(5, -1), 'hex').swap16().toString('utf16le') : t.slice(1, -1);
    expect(decoded).toBe('Certificate - Tasks basics - Ana Alpha');
  });

  it('a picture the PDF can’t print is left out, never an error', () => {
    const buf = buildCertificatePdf({ ...base, issuerName: 'Tariq', signature: Buffer.from('not a picture'), company: { companyName: 'Contoso', logo: Buffer.from('nope') } });
    expect(textOf(buf)[0]!).toContain('Tariq');
    expect(textOf(buf)).toHaveLength(1);
  });

  it('a very long course title wraps (never into the wreath), still one page', () => {
    const title = 'Site safety, permits to work and the handover of every task between shifts on Northwind offshore platforms and Fabrikam yards';
    const buf = buildCertificatePdf({ ...base, courseTitle: title });
    const parts = linesOf(buf).filter((l) => title.includes(l.text) && l.text.length > 3 && l.fonts.includes('IBMPlexSans-SemiBold'));
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.map((p) => p.text).join(' ')).toBe(title);
    for (const p of parts) expect(measureText(p.text, p.size, true)).toBeLessThanOrEqual(CERT_TEXT.right - CERT_TEXT.x + 0.5);
    expect(textOf(buf)).toHaveLength(1);
  });
});

describe('certificate file name', () => {
  it('is safe to save anywhere: course, learner and the code', () => {
    expect(certificateFileName(base)).toBe('certificate-tasks-basics-ana-alpha-TC-ABCD-EFGH-JKMN.pdf');
    const odd = certificateFileName({ courseTitle: 'Meetings & minutes: "how" / why?', learnerName: 'سارة علي', code: 'TC-AAAA-BBBB-CCCC' });
    expect(odd).toMatch(/^[A-Za-z0-9-]+\.pdf$/);
    expect(odd).toContain('meetings-minutes');
    expect(odd).toContain('TC-AAAA-BBBB-CCCC');
  });
});
