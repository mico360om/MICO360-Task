/**
 * 1.23.10 — the PDF standard every PDF is set on (owner, 10 Nov): A4, 14 mm side and 12 mm top/bottom
 * margins, one font family, body 9.5 pt, headings 11 pt, tables 8.5 pt (never under 7.5 pt), a slim
 * header (project picture left, company logo right, ≤ 26 pt), a running header and a footer on every
 * page (company · Printed … by … · Page X of Y), one slim summary strip, automatic landscape for a
 * table that won't fit, rows never split, no orphan headings, no blank pages.
 */
import { describe, it, expect } from 'vitest';
import { MM, PDF_STANDARD, PdfDocument, type TableColumn } from './pdf-document';
import { inspectPdf, type DrawnLine } from './pdf-inspect';
import { solidPng } from './test-images';

const footer = { company: 'Prolens Projects LLC', printed: 'Printed 10 Nov 2026, 14:05 by Khurram Mumtaz' };
const body = (lines: DrawnLine[]) => lines.filter((l) => !l.artifact);
const chrome = (lines: DrawnLine[]) => lines.filter((l) => l.artifact);
const sizesOf = (pdf: Buffer) => inspectPdf(pdf).lines.flat().map((l) => l.size);
/** Each image drawn on a page: its box (x, y from the top, width, height) in points (pdfkit draws in top-down space). */
function imageBoxes(content: string): Array<{ x: number; y: number; w: number; h: number }> {
  return [...content.matchAll(/([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/I\d+ Do/g)].map((m) => {
    const w = Number(m[1]);
    const h = Math.abs(Number(m[2]));
    return { x: Number(m[3]), y: Number(m[2]) < 0 ? Number(m[4]) - h : Number(m[4]), w, h };
  });
}

describe('the PDF standard: page, margins and type', () => {
  it('is A4 portrait with 14 mm side margins and a 12 mm top margin', () => {
    const doc = new PdfDocument({ footer });
    doc.text('First line');
    const pdf = doc.build();
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    expect(doc.margin).toBeCloseTo(14 * MM, 2);
    const first = inspectPdf(pdf).lines[0]!.find((l) => l.text === 'First line')!;
    expect(first.x).toBeCloseTo(14 * MM, 1);
    expect(first.y - first.size).toBeLessThan(12 * MM + 4); // the first line starts at the top margin
    expect(PDF_STANDARD.margin).toEqual({ side: 14 * MM, top: 12 * MM, bottom: 12 * MM });
  });

  it('sets text at 9.5 pt, small text at 8 pt, section headings at 11 pt and tables at 8.5 pt', () => {
    const doc = new PdfDocument({ footer });
    doc.heading('Details').text('Body words').text('A note', { size: PDF_STANDARD.type.small }).table([{ header: 'Name' }, { header: 'Owner' }], [['Alpha', 'Omar']]);
    const lines = inspectPdf(doc.build()).lines[0]!;
    const size = (t: string) => lines.find((l) => l.text === t)!.size;
    expect(size('Details')).toBe(11);
    expect(size('Body words')).toBe(9.5);
    expect(size('A note')).toBe(8);
    expect(size('Alpha')).toBe(8.5);
  });

  it('uses one font family: IBM Plex Sans (Arabic in Noto Naskh), no second display face', () => {
    const doc = new PdfDocument({ footer, title: 'T' });
    doc.reportHeader({ title: 'Tasks report', subtitle: 'All projects' }).heading('Summary').partBand('Final Minutes of Meeting').text('Words').text('كلمات');
    const pdf = doc.build().toString('latin1');
    expect(pdf).not.toMatch(/Archivo/);
    expect(pdf).toMatch(/IBMPlexSans-SemiBold/);
  });

  it('never sets type under 7.5 pt: header eyebrows and badges, strip labels, squeezed tables, asides, footers', () => {
    const doc = new PdfDocument({ footer: { ...footer, extra: ['https://mico360.com · info@mico360.com', 'A very long postal address line '.repeat(8)] }, runningTitle: 'Running title' });
    doc.identityHeader({ initials: 'RG', title: 'Rig 3 Overhaul', eyebrow: 'Minutes of Meeting', subtitle: 'RIG · Project no. 14', badge: { text: 'Final', tone: 'success' } });
    doc.statTiles([{ label: 'Status', value: 'In Progress', note: 'Overdue' }, { label: 'Priority', value: 'Normal' }]);
    doc.text('Words').aside('Key point');
    const cols: TableColumn[] = Array.from({ length: 9 }, (_, i) => ({ header: `Column ${i}` }));
    doc.table(cols, [cols.map(() => 'Supercalifragilistic')], { fit: { minSize: 6 } });
    for (let i = 0; i < 80; i++) doc.text(`Line ${i}`);
    const sizes = sizesOf(doc.build());
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(PDF_STANDARD.type.min);
    expect(PDF_STANDARD.type.min).toBe(7.5);
  });
});

describe('the PDF standard: header, running header and footer', () => {
  it('puts the project picture on the left and the company logo on the right of one slim band, both at most 26 pt tall', async () => {
    const logo = await solidPng(600, 240, [200, 120, 20]);
    const picture = await solidPng(400, 400, [30, 90, 140]);
    const doc = new PdfDocument({ footer, logo });
    doc.identityHeader({ image: picture, initials: 'MS', title: 'MICO360 Services (Sub Projects)', eyebrow: 'Task', subtitle: 'MSSP' });
    const { contents } = inspectPdf(doc.build());
    const boxes = imageBoxes(contents[0]!);
    expect(boxes.length).toBe(2);
    for (const b of boxes) expect(b.h).toBeLessThanOrEqual(26.01);
    const [left, right] = [...boxes].sort((a, b) => a.x - b.x);
    expect(left!.x).toBeCloseTo(14 * MM, 1);
    expect(right!.x + right!.w).toBeCloseTo(595.28 - 14 * MM, 1);
    expect(Math.abs(left!.h - right!.h)).toBeLessThan(0.5); // the same height
    // The band, its rule and the gap under it take less than 15 mm.
    expect(doc.cursor).toBeLessThan(12 * MM + 15 * MM);
  });

  it('shows the built-in logo on the right when the company has none', () => {
    const doc = new PdfDocument({ footer });
    doc.identityHeader({ initials: 'MS', title: 'MICO360 Services' });
    const boxes = imageBoxes(inspectPdf(doc.build()).contents[0]!);
    expect(boxes.length).toBe(1);
    expect(boxes[0]!.x + boxes[0]!.w).toBeCloseTo(595.28 - 14 * MM, 1);
    expect(boxes[0]!.h).toBeLessThanOrEqual(26.01);
  });

  it('every page has the footer: the company, "Printed … by …" and "Page X of Y"', () => {
    const doc = new PdfDocument({ footer });
    for (let i = 0; i < 160; i++) doc.text(`Line number ${i} with enough words to take some room.`);
    const { lines } = inspectPdf(doc.build());
    expect(lines.length).toBeGreaterThan(2);
    lines.forEach((page, i) => {
      const words = chrome(page).map((l) => l.text);
      expect(words).toContain('Prolens Projects LLC');
      expect(words).toContain('Printed 10 Nov 2026, 14:05 by Khurram Mumtaz');
      expect(words).toContain(`Page ${i + 1} of ${lines.length}`);
      // The footer sits in the bottom margin's band, under every body line.
      const lowestBody = Math.max(...body(page).map((l) => l.y));
      for (const l of chrome(page).filter((c) => c.y > 400)) expect(l.y).toBeGreaterThan(lowestBody);
    });
  });

  it('pages after the first carry a slim running header: the project picture, the title and project, the company logo', async () => {
    const logo = await solidPng(600, 240, [200, 120, 20]);
    const doc = new PdfDocument({ footer, logo, runningTitle: 'MSSP-34 · MICO360 Services (Sub Projects)' });
    doc.identityHeader({ initials: 'MS', title: 'MICO360 Services (Sub Projects)', eyebrow: 'Task' });
    for (let i = 0; i < 120; i++) doc.text(`Line ${i}`);
    const { lines, contents } = inspectPdf(doc.build());
    expect(chrome(lines[0]!).map((l) => l.text)).not.toContain('MSSP-34 · MICO360 Services (Sub Projects)');
    for (let p = 1; p < lines.length; p++) {
      const running = chrome(lines[p]!).find((l) => l.text === 'MSSP-34 · MICO360 Services (Sub Projects)')!;
      expect(running).toBeDefined();
      expect(running.y).toBeLessThan(12 * MM + 16);
      expect(chrome(lines[p]!).map((l) => l.text)).toContain('MS'); // the project's initials tile, small
      const logos = imageBoxes(contents[p]!);
      expect(logos.length).toBe(1);
      expect(logos[0]!.h).toBeLessThanOrEqual(14.01);
      // Body text starts under it.
      expect(Math.min(...body(lines[p]!).map((l) => l.y - l.size))).toBeGreaterThan(running.y + 4);
    }
    expect(lines.flat().filter((l) => l.text.startsWith('Line '))).toHaveLength(120);
  });

  it('a document without a running title repeats its title', () => {
    const doc = new PdfDocument({ footer, title: 'Minutes of Meeting: Weekly review' });
    for (let i = 0; i < 120; i++) doc.text(`Line ${i}`);
    const { lines } = inspectPdf(doc.build());
    expect(chrome(lines[1]!).map((l) => l.text)).toContain('Minutes of Meeting: Weekly review');
  });

  it('extra footer lines (website, address, "Shared with you through …") are kept, never cut', () => {
    const long = 'Prolens Projects LLC, Building 12, Way 3456, Al Khuwair, Muscat, Sultanate of Oman — PO Box 123, PC 112 — Tel +968 2400 0000';
    const doc = new PdfDocument({ footer: { ...footer, extra: ['https://mico360.com · info@mico360.com', long] } });
    doc.text('Body');
    const words = chrome(inspectPdf(doc.build()).lines[0]!).map((l) => l.text).join(' ');
    expect(words).toContain('https://mico360.com · info@mico360.com');
    expect(words.replace(/\s+/g, '')).toContain(long.replace(/\s+/g, ''));
    expect(words).not.toContain('…');
  });
});

describe('the PDF standard: summary strip', () => {
  it('draws the tiles as one slim strip: label over value, value 10.5 pt, label 7.5 pt, at most 32 pt tall', () => {
    const doc = new PdfDocument({ footer });
    const top = doc.cursor;
    doc.statTiles([
      { label: 'Status', value: 'In Progress', colors: { fill: '#2F6DB5', text: '#2B64A6', soft: '#EAF0F8' } },
      { label: 'Priority', value: 'Normal' },
      { label: 'Due', value: '12 Nov 2026' },
      { label: 'Progress', value: '0%' },
    ]);
    const height = doc.cursor - top;
    expect(height).toBeLessThanOrEqual(32 + 6);
    const lines = inspectPdf(doc.build()).lines[0]!;
    const value = lines.find((l) => l.text === 'In Progress')!;
    const label = lines.find((l) => l.text === 'Status')!;
    expect(value.size).toBe(10.5);
    expect(label.size).toBe(7.5);
    expect(label.y).toBeLessThan(value.y); // label over value
    expect(label.x).toBeCloseTo(value.x, 1);
  });

  it('colours a tile by the scheme it is given (the status word in its text tone)', () => {
    const doc = new PdfDocument({ footer });
    doc.statTiles([{ label: 'Status', value: 'In Progress', colors: { fill: '#2F6DB5', text: '#2B64A6', soft: '#EAF0F8' } }]);
    const content = inspectPdf(doc.build()).contents[0]!;
    expect(content).toMatch(/0\.16862\d* 0\.39215\d* 0\.65098\d* (rg|scn)/); // #2B64A6 for the word
    expect(content).toMatch(/0\.91764\d* 0\.94117\d* 0\.97254\d* (rg|scn)/); // #EAF0F8 behind it
  });
});

describe('the PDF standard: tables', () => {
  const wide: TableColumn[] = Array.from({ length: 10 }, (_, i) => ({ header: `Heading${i}` }));
  const wideRows = [wide.map((_, i) => `Unbreakableword${i}withmoreletters`)];

  it('chooses landscape only for a table whose words cannot fit across a portrait page at 7.5 pt', () => {
    expect(PdfDocument.needsLandscape([{ header: 'Name' }, { header: 'Owner' }, { header: 'Due' }], [['Alpha', 'Omar', '12 Nov 2026']])).toBe(false);
    expect(PdfDocument.needsLandscape(wide, wideRows)).toBe(true);
  });

  it('turns a section landscape on its own page and back to portrait after it, with no blank page', () => {
    const doc = new PdfDocument({ footer });
    doc.text('Before the wide table');
    doc.orient('landscape');
    doc.heading('Wide section').table(wide, wideRows);
    doc.orient('portrait');
    doc.text('After the wide table');
    const pdf = doc.build();
    const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => `${m[1]}x${m[2]}`);
    expect(boxes).toEqual(['595.28x841.89', '841.89x595.28', '595.28x841.89']);
    const pages = inspectPdf(pdf).pages;
    expect(pages[1]).toContain('Wide section');
    expect(pages[2]).toContain('After the wide table');
    // A fresh page just turns: no empty page is left behind.
    const fresh = new PdfDocument({ footer });
    fresh.orient('landscape');
    fresh.text('Only page');
    expect([...fresh.build().toString('latin1').matchAll(/\/MediaBox \[0 0 841\.89 595\.28\]/g)]).toHaveLength(1);
    expect(fresh.pageCount).toBe(1);
  });

  it('repeats the header row on every page and never splits a row across pages', () => {
    const doc = new PdfDocument({ footer });
    // Every word of a row names its row (r12w5), so each wrapped line can be traced to its row.
    const rows = Array.from({ length: 70 }, (_, i) => [`Row ${i}`, Array.from({ length: 45 }, (_, k) => `r${i}w${k}`).join(' ')]);
    doc.table([{ header: 'Row' }, { header: 'Words' }], rows);
    const { lines } = inspectPdf(doc.build());
    expect(lines.length).toBeGreaterThan(1);
    for (const page of lines) expect(body(page).filter((l) => l.text === 'Row' || l.text === 'Words')).toHaveLength(2);
    const pageOf = new Map<string, Set<number>>();
    lines.forEach((page, p) => {
      for (const l of page) for (const m of l.text.matchAll(/(?:^Row |\br)(\d+)(?:w|$)/g)) pageOf.set(m[1]!, (pageOf.get(m[1]!) ?? new Set()).add(p));
    });
    expect(pageOf.size).toBe(70);
    for (const [, pages] of pageOf) expect(pages.size).toBe(1);
    // and the rows wrapped: a row takes two or more lines
    expect(lines.flat().filter((l) => /\br5w/.test(l.text)).length).toBeGreaterThanOrEqual(2);
  });

  it('never breaks a date inside itself, however much the other columns have to say (a note after it may go under it)', () => {
    const doc = new PdfDocument({ footer });
    const long = 'Prepare the handover dossier with as-built drawings, test certificates and the punch list';
    const cols: TableColumn[] = ['Key', 'Title', 'Project', 'Status', 'Priority', 'Assignees', 'Due', 'Completed'].map((header) => ({ header }));
    const rows = Array.from({ length: 6 }, (_, i) => [`RIG-${i}`, long, 'MICO360 Services (Sub Projects)', 'In Progress', 'Urgent', 'Omar Ahmed, Bilal Ahmed', i % 2 ? '12 Nov 2026 · Overdue' : '3 Dec 2026', i % 3 ? '—' : '5 Nov 2026']);
    doc.table(cols, rows);
    const texts = inspectPdf(doc.build()).lines[0]!.map((l) => l.text);
    expect(texts.filter((t) => t.startsWith('12 Nov 2026'))).toHaveLength(3);
    expect(texts.filter((t) => t === '3 Dec 2026')).toHaveLength(3);
    expect(texts.filter((t) => t === '5 Nov 2026')).toHaveLength(2);
  });

  it('a row taller than a page continues under the repeated header with "(continued)", every word kept', () => {
    const words = Array.from({ length: 2500 }, (_, i) => `w${i}`);
    const doc = new PdfDocument({ footer });
    doc.table([{ header: 'Id' }, { header: 'Notes' }], [['1', words.join(' ')], ['2', 'after']]);
    const { lines } = inspectPdf(doc.build());
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((page, p) => {
      const texts = body(page).map((l) => l.text);
      expect(texts.slice(0, 2)).toEqual(['Id', 'Notes']);
      if (p > 0) expect(texts[2]).toBe('(continued)');
    });
    expect(lines.flat().filter((l) => /^w\d/.test(l.text)).map((l) => l.text).join(' ')).toBe(words.join(' '));
    for (const page of lines) for (const l of body(page)) expect(l.y).toBeLessThan(841.89 - 12 * MM - 14);
  });

  it('right-aligns numbers and centres dates, the header with its column', () => {
    const doc = new PdfDocument({ footer });
    doc.table([{ header: 'Task' }, { header: 'Due' }, { header: 'Hours' }], [['Order spare gaskets', '12 Nov 2026', '4'], ['Client walk-down', '3 Dec 2026', '12']]);
    const lines = inspectPdf(doc.build()).lines[0]!;
    const right = (t: string) => { const l = lines.find((x) => x.text === t)!; return l.x; };
    // Hours: right edges line up (4 and 12 end at the same x).
    const four = lines.find((l) => l.text === '4')!;
    const twelve = lines.find((l) => l.text === '12')!;
    expect(four.x).toBeGreaterThan(twelve.x);
    // Dates: centred — the shorter date starts further in than the longer one, by half the difference.
    expect(right('3 Dec 2026')).toBeGreaterThan(right('12 Nov 2026'));
  });
});

describe('the PDF standard: pagination', () => {
  const fill = (doc: PdfDocument, until: number) => {
    let i = 0;
    while (doc.cursor < until) doc.text(`Filler ${i++}`);
  };

  it('never leaves a heading alone at the bottom: it moves with its first two lines', () => {
    const doc = new PdfDocument({ footer });
    const page = 841.89;
    fill(doc, page - 12 * MM - 60);
    doc.heading('Orphan candidate');
    doc.text('First line under it. '.repeat(30));
    const { lines } = inspectPdf(doc.build());
    const headingPage = lines.findIndex((p) => p.some((l) => l.text === 'Orphan candidate'));
    const page0Body = body(lines[headingPage]!);
    const at = page0Body.findIndex((l) => l.text === 'Orphan candidate');
    expect(page0Body.length - at - 1).toBeGreaterThanOrEqual(2);
  });

  it('keeps a small section (under a third of a page) whole on one page', () => {
    const doc = new PdfDocument({ footer });
    fill(doc, 700);
    doc.section(() => {
      doc.heading('Small section');
      for (let i = 0; i < 8; i++) doc.text(`Small section line ${i}`);
    });
    const { lines } = inspectPdf(doc.build());
    const pagesWith = lines.map((p, i) => (p.some((l) => l.text.startsWith('Small section')) ? i : -1)).filter((i) => i >= 0);
    expect(pagesWith).toHaveLength(1);
  });

  it('lets a big section start where it is (it is not pushed to a new page)', () => {
    const doc = new PdfDocument({ footer });
    fill(doc, 500);
    const before = doc.pageCount;
    doc.section(() => {
      doc.heading('Big section');
      for (let i = 0; i < 60; i++) doc.text(`Big section line ${i}`);
    });
    const { lines } = inspectPdf(doc.build());
    expect(lines[before - 1]!.some((l) => l.text === 'Big section')).toBe(true);
  });

  it('never ends on a blank page: room kept or space added at the very end adds no page', () => {
    const doc = new PdfDocument({ footer });
    fill(doc, 760);
    const pages = doc.pageCount;
    doc.spacer(200);
    doc.keepTogether(400);
    expect(doc.build()).toBeTruthy();
    expect(doc.pageCount).toBe(pages);
    expect(inspectPdf(doc.build()).pages).toHaveLength(pages);
  });
});

describe('the PDF standard: print quality', () => {
  it('draws rules as crisp 0.5 pt hairlines on half-point positions', () => {
    const doc = new PdfDocument({ footer });
    doc.heading('Section').text('x').rule();
    const content = inspectPdf(doc.build()).contents[0]!;
    const rects = [...content.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)].map((m) => m.slice(1, 5).map(Number));
    const hairlines = rects.filter(([, , w, h]) => w! > 100 && h! > 0 && h! < 1);
    expect(hairlines.length).toBeGreaterThanOrEqual(2);
    for (const [, y, , h] of hairlines) {
      expect(h).toBe(0.5);
      expect(Math.abs(y! * 2 - Math.round(y! * 2))).toBeLessThan(1e-6);
    }
  });
});
