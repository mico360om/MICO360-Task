import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPdf } from '../../lib/pdf-inspect';
import { buildCertificatePdf, certificateFileName, type CertificatePdf } from './training-certificate-pdf';

const LOGO = readFileSync(resolve(__dirname, '../../../assets/logo-pdf.png'));
const TZ = 'Asia/Muscat';

const base: CertificatePdf = {
  code: 'TC-ABCD-EFGH-JKMN',
  learnerName: 'Ana Alpha',
  courseTitle: 'Tasks basics',
  // 23:30 UTC on 10 Nov is 11 Nov in Muscat: the day is read in the site's zone.
  issuedAt: new Date('2026-11-10T23:30:00Z'),
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
const textOf = (buf: Buffer) => inspectPdf(buf).pages.map((p) => p.join('\n'));

describe('certificate PDF (A4, the PDF standard)', () => {
  it('one page: the title, learner, course, completion day, code and the verification link', () => {
    const buf = buildCertificatePdf(base, { now: new Date('2026-11-11T08:00:00Z') });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = textOf(buf);
    expect(pages).toHaveLength(1);
    const text = pages[0]!;
    for (const words of ['Certificate of completion', 'This certifies that', 'Ana Alpha', 'has completed', 'Tasks basics', '11 Nov 2026', 'TC-ABCD-EFGH-JKMN', 'https://task.example.com/verify/TC-ABCD-EFGH-JKMN', 'Printed', 'Issued through MICO360 Tasks · Learning Hub']) {
      expect(text).toContain(words);
    }
    expect(text).not.toContain('Training Center');
    // The verification address is a real link.
    expect(buf.toString('latin1')).toMatch(/\/URI \(https:\/\/task\.example\.com\/verify\/TC-ABCD-EFGH-JKMN\)/);
    // No score, no expiry, nobody named: those lines are left out.
    expect(text).not.toContain('Quiz score');
    expect(text).not.toContain('Valid until');
    expect(text).not.toContain('Issued by');
  });

  it('the score, the expiry, the issuer with a signature picture and the company’s own logo and name', () => {
    const buf = buildCertificatePdf(
      {
        ...base,
        scorePct: 85,
        expiresAt: new Date('2027-11-11T08:00:00Z'),
        issuerName: 'Tariq Training',
        issuerTitle: 'Training manager',
        signature: LOGO,
        company: { companyName: 'Alpha LLC', logo: LOGO },
      },
      { printedBy: 'Ana Alpha', now: new Date('2026-11-11T08:00:00Z') },
    );
    const text = textOf(buf)[0]!;
    for (const words of ['Quiz score', '85%', 'Valid until', '11 Nov 2027', 'Issued by', 'Tariq Training', 'Training manager', 'Alpha LLC', 'by Ana Alpha']) expect(text).toContain(words);
    // The signature (and the logo) are embedded pictures.
    expect(buf.toString('latin1')).toMatch(/\/Subtype \/Image/);
    expect(textOf(buf)).toHaveLength(1);
  });

  it('an expired or revoked certificate says so plainly on a strip', () => {
    const expired = textOf(buildCertificatePdf({ ...base, status: 'EXPIRED', expiresAt: new Date('2026-11-01T08:00:00Z') }))[0]!;
    expect(expired).toContain('Expired on 1 Nov 2026');
    const revoked = textOf(buildCertificatePdf({ ...base, status: 'REVOKED', revokedReason: 'Replaced after the retake' }))[0]!;
    expect(revoked).toContain('Revoked: Replaced after the retake');
    const noReason = textOf(buildCertificatePdf({ ...base, status: 'REVOKED' }))[0]!;
    expect(noReason).toContain('Revoked');
    expect(textOf(buildCertificatePdf(base))[0]!).not.toMatch(/Revoked|Expired on/);
  });

  it('a picture the PDF can’t print is left out, never an error', () => {
    const buf = buildCertificatePdf({ ...base, issuerName: 'Tariq', signature: Buffer.from('not a picture') });
    expect(textOf(buf)[0]!).toContain('Tariq');
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
