import { describe, expect, it } from 'vitest';
import { CERT_PAGE, CERT_SHAPES, CERT_WREATH, CERT_WREATH_AT, certQrBox, certificateDay, certificateRows, certificateStamp, certificateWords, hasArabicLetters, shapePath } from './certificate-art';

const day = (d: string) => d;
const facts = { code: 'TC-AAAA-BBBB-CCCC', completedAt: '3 Nov 2026', issuedAt: '3 Nov 2026', expiresAt: null, scorePct: null, issuerName: null, issuerTitle: null, status: 'VALID' as const };
const rows = (over: Partial<Parameters<typeof certificateRows<string>>[0]> = {}) => certificateRows({ ...facts, ...over }, day).map((r) => [r.label, r.value]);

describe('the certificate’s detail rows (shared by the PDF and the website)', () => {
  it('the picture’s four rows: Completed and issued, Quiz score, Expires (Never), Certificate ID', () => {
    expect(rows({ scorePct: 96 })).toEqual([
      ['Completed and issued', '3 Nov 2026'],
      ['Quiz score', '96%'],
      ['Expires', 'Never'],
      ['Certificate ID', 'TC-AAAA-BBBB-CCCC'],
    ]);
  });

  it('no quiz: no score row (a score of 0 is still a score); an expiry day; issued another day: Completed then Issued', () => {
    expect(rows().map((r) => r[0])).toEqual(['Completed and issued', 'Expires', 'Certificate ID']);
    expect(rows({ scorePct: 0 })).toContainEqual(['Quiz score', '0%']);
    expect(rows({ expiresAt: '3 Nov 2027' })).toContainEqual(['Expires', '3 Nov 2027']);
    expect(rows({ issuedAt: '5 Nov 2026' }).slice(0, 2)).toEqual([
      ['Completed', '3 Nov 2026'],
      ['Issued', '5 Nov 2026'],
    ]);
  });

  it('Issued by (name, title) last when a course has an issuer', () => {
    expect(rows({ issuerName: 'Tariq Training', issuerTitle: 'Training manager' }).at(-1)).toEqual(['Issued by', 'Tariq Training, Training manager']);
    expect(rows({ issuerName: 'Tariq Training', issuerTitle: '  ' }).at(-1)).toEqual(['Issued by', 'Tariq Training']);
    expect(rows({ issuerName: '  ' }).map((r) => r[0])).not.toContain('Issued by');
  });

  it('expired: “Expired on”; revoked: the day and the reason before the ID', () => {
    expect(rows({ status: 'EXPIRED', expiresAt: '1 Nov 2026' })).toContainEqual(['Expired on', '1 Nov 2026']);
    expect(rows({ status: 'REVOKED', revokedAt: '12 Nov 2026', revokedReason: ' Replaced after the retake ' }).slice(-3)).toEqual([
      ['Revoked on', '12 Nov 2026'],
      ['Reason', 'Replaced after the retake'],
      ['Certificate ID', 'TC-AAAA-BBBB-CCCC'],
    ]);
    expect(rows({ status: 'REVOKED' }).map((r) => r[0])).not.toContain('Reason');
    expect(certificateStamp('VALID')).toBeNull();
    expect(certificateStamp('REVOKED')?.text).toBe('REVOKED');
    expect(certificateStamp('EXPIRED')?.text).toBe('EXPIRED');
  });
});

describe('the certificate’s dates (owner, 14 Nov: in full, as on his picture)', () => {
  it('a day as "14 November 2026" (the rest of the site keeps "14 Nov 2026")', () => {
    expect(certificateDay('2026-11-14')).toBe('14 November 2026');
    expect(certificateDay('2027-01-03')).toBe('3 January 2027');
    expect(certificateDay('2026-09-30T00:00:00')).toBe('30 September 2026');
    expect(certificateDay('not a day')).toBe('');
  });
});

describe('the certificate’s drawing', () => {
  it('the QR square: modules at least 30 mm for every size of code, centred in the wreath', () => {
    for (const n of [21, 25, 29, 33, 37, 57]) {
      const box = certQrBox(n);
      expect(box.unit * n).toBeGreaterThanOrEqual((30 * 72) / 25.4);
      expect(box.x + box.size / 2).toBeCloseTo(CERT_WREATH_AT.cx);
      expect(box.y + box.size / 2).toBeCloseTo(CERT_WREATH_AT.cy);
    }
  });

  it('shapes and the wreath are closed vector paths on the page; the wreath clears the QR square', () => {
    for (const s of CERT_SHAPES) {
      expect(shapePath(s)).toMatch(/^M[\d. ]+( L[\d. ]+)+ Z$/);
      for (const [x, y] of s.points) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CERT_PAGE.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(CERT_PAGE.height);
      }
    }
    expect(CERT_WREATH.paths.length).toBeGreaterThan(30);
    const box = certQrBox(29);
    for (const d of CERT_WREATH.paths) {
      expect(d).toMatch(/^M.* Z$/);
      // Every point of every leaf and stem is outside the white square (with 1 pt to spare) and on the page.
      for (const m of d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
        const [x, y] = [Number(m[1]), Number(m[2])];
        const inside = x > box.x - 1 && x < box.x + box.size + 1 && y > box.y - 1 && y < box.y + box.size + 1;
        expect(inside, `${x},${y}`).toBe(false);
        expect(x).toBeLessThan(CERT_PAGE.width);
      }
    }
  });

  it('Arabic letters are told apart from Latin ones', () => {
    expect(hasArabicLetters('سارة علي')).toBe(true);
    expect(hasArabicLetters('Sara Ali علي')).toBe(true);
    expect(hasArabicLetters('Zoë Ωmega')).toBe(false);
  });
});

describe('the words’ layout (certificateWords, the same for the PDF and the screen)', () => {
  // A stand-in measure: every character half its size wide (plus the letter spacing).
  const measure = (text: string, _face: string, size: number, spacing = 0) => Array.from(text).length * (size * 0.5 + spacing);
  const input = { learnerName: 'Nadia Ahmed', courseTitle: 'MICO360 Tasks User Training', companyName: 'Contoso LLC', productName: 'MICO360 Tasks', rows: certificateRows(facts, day), signature: null };

  it('as in the picture: the heading, the name, the course, the company, then the rows, top to bottom, at full size', () => {
    const plan = certificateWords(input, measure);
    expect(plan.scale).toBe(1);
    expect(plan.words.map((w) => w.role)).toEqual(['heading', 'subheading', 'certifies', 'name', 'completed', 'course', 'company', 'through', 'label', 'value', 'label', 'value', 'label', 'value']);
    const name = plan.words.find((w) => w.role === 'name')!;
    expect(name).toMatchObject({ face: 'script', size: 66, color: '#8B1E1E' });
    expect(plan.words.find((w) => w.role === 'through')!.text).toBe('Issued through MICO360 Tasks · Learning Hub');
    const ys = plan.words.filter((w) => w.role !== 'value').map((w) => w.baseline);
    expect(ys.every((y, i) => i === 0 || y > ys[i - 1]!)).toBe(true);
    expect(plan.rule.y).toBeLessThan(plan.words.find((w) => w.role === 'label')!.baseline);
  });

  it('a long name shrinks onto one line; an Arabic name takes Naskh', () => {
    const long = certificateWords({ ...input, learnerName: 'N'.repeat(40) }, measure).words.find((w) => w.role === 'name')!;
    expect(measure(long.text, 'script', long.size)).toBeLessThanOrEqual(505 - 58 + 0.01);
    expect(long.size).toBeLessThan(66);
    expect(certificateWords({ ...input, learnerName: 'سارة علي' }, measure).words.find((w) => w.role === 'name')).toMatchObject({ face: 'arabic', x: 63 });
  });

  it('a long course title wraps (each line fits the column); a very long one is cut with “…” on its third line', () => {
    const wrapped = certificateWords({ ...input, courseTitle: 'word '.repeat(30).trim() }, measure).words.filter((w) => w.role === 'course');
    expect(wrapped.length).toBeGreaterThan(1);
    for (const w of wrapped) expect(measure(w.text, w.face, w.size)).toBeLessThanOrEqual(505 - 63 + 0.01);
    const cut = certificateWords({ ...input, courseTitle: 'word '.repeat(200).trim() }, measure).words.filter((w) => w.role === 'course');
    expect(cut).toHaveLength(3);
    expect(cut[2]!.text.endsWith('…')).toBe(true);
  });

  it('more to say than fits (revoked with a reason, issued another day, an issuer with a signature): everything under the logo shrinks together, the last line above the margin', () => {
    const rows = certificateRows({ ...facts, issuedAt: '5 Nov 2026', scorePct: 90, status: 'REVOKED', revokedAt: '9 Nov 2026', revokedReason: 'Replaced', issuerName: 'Tariq Training', issuerTitle: 'Training manager' }, day);
    const plan = certificateWords({ ...input, rows, signature: { width: 300, height: 100 } }, measure);
    expect(plan.scale).toBeLessThan(1);
    expect(plan.bottom).toBeLessThanOrEqual(566);
    expect(plan.signature).toMatchObject({ x: 240 });
    const issuer = plan.words.find((w) => w.role === 'label' && w.row === 'issuer')!;
    expect(plan.signature!.top + plan.signature!.height).toBeLessThan(issuer.baseline);
  });
});

describe('the layout’s cost (1.23.35 review)', () => {
  it('measures each piece of text once per face, however many sizes and scales it tries', () => {
    let calls = 0;
    const counting = (text: string, _face: string, size: number, spacing = 0) => {
      calls++;
      return Array.from(text).length * (size * 0.5 + spacing);
    };
    const rows = certificateRows({ ...facts, issuedAt: '5 Nov 2026', scorePct: 90, status: 'REVOKED', revokedAt: '9 Nov 2026', revokedReason: 'word '.repeat(60).trim(), issuerName: 'Tariq Training '.repeat(8).trim(), issuerTitle: 'Training manager' }, day);
    const plan = certificateWords({ learnerName: 'Bartholomew '.repeat(6).trim(), courseTitle: 'word '.repeat(80).trim(), companyName: 'Contoso '.repeat(20).trim(), productName: 'MICO360 Tasks', rows, signature: { width: 300, height: 100 } }, counting);
    expect(plan.bottom).toBeLessThanOrEqual(566);
    expect(calls).toBeLessThan(2500);
  });
});

describe('the wreath’s curves stay clear of the QR square', () => {
  it('every point along every leaf’s and stem’s curve (sampled) is outside the white square', () => {
    const box = certQrBox(21);
    for (const d of CERT_WREATH.paths) {
      const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g)!;
      let i = 0;
      let cur = [0, 0];
      let start = [0, 0];
      const pts: number[][] = [];
      const num = () => Number(tokens[i++]);
      while (i < tokens.length) {
        const cmd = tokens[i++];
        if (cmd === 'M' || cmd === 'L') {
          const p = [num(), num()];
          if (cmd === 'M') start = p;
          pts.push(p);
          cur = p;
        } else if (cmd === 'C') {
          const [c1, c2, e] = [[num(), num()], [num(), num()], [num(), num()]];
          for (let t = 0; t <= 1; t += 0.05) {
            const u = 1 - t;
            pts.push([0, 1].map((k) => u * u * u * cur[k]! + 3 * u * u * t * c1[k]! + 3 * u * t * t * c2[k]! + t * t * t * e[k]!));
          }
          cur = e;
        } else if (cmd === 'Z') cur = start;
      }
      for (const [x, y] of pts) expect(x! > box.x - 1 && x! < box.x + box.size + 1 && y! > box.y - 1 && y! < box.y + box.size + 1, `${x},${y}`).toBe(false);
    }
  });
});
