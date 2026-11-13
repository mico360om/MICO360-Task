import { describe, it, expect } from 'vitest';
import { PdfDocument, hexToRgb } from './pdf-document';
import { inspectPdf } from './pdf-inspect';
import { measureText } from './pdf-text';
import { solidPng } from './test-images';

describe('PdfDocument', () => {
  it('produces a valid PDF envelope whose xref offsets point at each object', () => {
    const doc = new PdfDocument();
    doc.heading('Section').bullet('One').bullet('Two').keyValue('Owner', 'Ada Lovelace');
    const buf = doc.build();
    const pdf = buf.toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(pdf.match(/startxref\s+(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) \d{5} n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(5);
    offsets.forEach((off, i) => {
      expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(inspectPdf(buf).pages[0]).toEqual(expect.arrayContaining(['Section', 'One', 'Two', 'Owner', 'Ada Lovelace']));
  });

  it('embeds subsetted Unicode fonts (IBM Plex Sans + Noto Naskh Arabic), not WinAnsi Helvetica', () => {
    const doc = new PdfDocument();
    doc.text('Hello world').text('مرحبا بكم');
    const pdf = doc.build().toString('latin1');
    expect(pdf).toMatch(/\/FontName \/[A-Z]{6}\+IBMPlexSans-Regular/);
    expect(pdf).toMatch(/\/FontName \/[A-Z]{6}\+NotoNaskhArabic-Regular/);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/ToUnicode');
    expect(pdf).not.toContain('/BaseFont /Helvetica');
  });

  it('keeps Arabic text as Arabic (never "?"), with the logical text recorded for copy/search', () => {
    const doc = new PdfDocument({ title: 'اجتماع' });
    doc.text('اجتماع مراجعة الميزانية', { bold: true, size: 20 }).text('الموعد 10:30 in Room B');
    const { pages } = inspectPdf(doc.build());
    expect(pages[0]).toContain('اجتماع مراجعة الميزانية');
    expect(pages[0]).toContain('الموعد 10:30 in Room B');
    expect(pages[0]!.join('')).not.toContain('?');
  });

  it('flows onto multiple pages and numbers them "Page N of M"', () => {
    // tpdf: 1.23.11 — the footer's words come from `footer` (company · "Printed … by …"), was footerLeft.
    const doc = new PdfDocument({ footer: { company: 'MICO360', printed: 'Printed 1 Oct 2026, 09:00 by Ada' } });
    for (let i = 0; i < 160; i++) doc.text(`Line number ${i} with enough text to take vertical room on the page.`);
    const buf = doc.build();
    const { pages } = inspectPdf(buf);
    expect(pages.length).toBeGreaterThan(1);
    expect(doc.pageCount).toBe(pages.length);
    expect(pages[0]).toContain(`Page 1 of ${pages.length}`);
    expect(pages[pages.length - 1]).toContain(`Page ${pages.length} of ${pages.length}`);
    expect(pages[1]).toContain('Printed 1 Oct 2026, 09:00 by Ada');
    // every line made it into the document, in order
    const lines = pages.flat().filter((t) => t.startsWith('Line number'));
    expect(lines).toHaveLength(160);
    expect(lines[159]).toContain('Line number 159');
  });

  it('wraps a long word wider than the line by hard-breaking it', () => {
    const doc = new PdfDocument();
    doc.text('x'.repeat(400));
    const runs = inspectPdf(doc.build()).pages[0]!.filter((t) => /^x+$/.test(t));
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.join('')).toBe('x'.repeat(400));
  });

  it('wraps long paragraphs instead of running off the page edge', () => {
    const doc = new PdfDocument();
    const para = 'Parens ( ) and a backslash \\ must not break anything; '.repeat(12).trim();
    doc.text(para);
    const lines = inspectPdf(doc.build()).pages[0]!.filter((t) => !t.startsWith('Page '));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(para);
  });

  it('measures bold text as wider than regular for the same string', () => {
    const doc = new PdfDocument();
    expect(doc.textWidth('Meeting', 12, true)).toBeGreaterThan(doc.textWidth('Meeting', 12, false));
  });

  it('parses hex colors to normalized RGB triples', () => {
    expect(hexToRgb('#8B1E1E')).toEqual([139 / 255, 30 / 255, 30 / 255]);
    expect(hexToRgb('not-a-color', [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('renders a branded header with a vector logo mark (rounded clip, gradient, check stroke)', () => {
    const doc = new PdfDocument({ palette: { brand: '#0057B8' } });
    doc.brandHeader({ eyebrow: 'Minutes of Meeting', title: 'Acme Tasks', subtitle: 'Get it done' });
    const buf = doc.build();
    const { pages, contents, objects } = inspectPdf(buf);
    expect(pages[0]).toEqual(expect.arrayContaining(['MINUTES OF MEETING', 'Acme Tasks', 'Get it done']));
    const content = contents[0]!;
    expect(content).toMatch(/ c\n/); // bezier corners of the rounded tile
    expect(content).toMatch(/W n/); // clip for the gradient fill
    expect(content).toMatch(/1 1 1 SCN/); // white check stroke
    // the brand color (#0057B8 → 0 0.341 0.722) drives the eyebrow + brand rule fill
    expect(content).toMatch(/0 0\.34\d* 0\.72\d* scn/);
    expect([...objects.values()].some((d) => /\/ShadingType 2/.test(d))).toBe(true); // axial gradient
  });

  it('builds idempotently', () => {
    const doc = new PdfDocument();
    doc.text('Once');
    expect(doc.build()).toBe(doc.build());
  });
});

describe('PdfDocument.table', () => {
  const columns = [{ header: 'Project' }, { header: 'Total' }];

  it('paginates long tables, repeating the header on every page and keeping every row', () => {
    const rows = Array.from({ length: 150 }, (_, i) => [i % 2 ? `مشروع رقم ${i}` : `Project ${i}`, String(i)]);
    const doc = new PdfDocument();
    doc.table(columns, rows);
    const { pages } = inspectPdf(doc.build());
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const p of pages) expect(p.slice(0, 2)).toEqual(['Project', 'Total']);
    const cells = pages.flat();
    for (let i = 0; i < 150; i++) {
      expect(cells).toContain(i % 2 ? `مشروع رقم ${i}` : `Project ${i}`);
      expect(cells).toContain(String(i));
    }
  });

  it('wraps a long cell inside its column instead of overflowing', () => {
    const long = 'A very long description that certainly does not fit on a single line of a narrow column in the table';
    const doc = new PdfDocument();
    doc.table([{ header: 'Id' }, { header: 'Description' }, { header: 'Owner' }], [['1', long + ' ' + long, 'Ada']]);
    const cells = inspectPdf(doc.build()).pages[0]!;
    const descLines = cells.filter((t) => !['Id', 'Description', 'Owner', '1', 'Ada', 'Page 1 of 1'].includes(t));
    expect(descLines.length).toBeGreaterThan(1);
    expect(descLines.join(' ')).toBe(long + ' ' + long);
  });
});

describe('PdfDocument — report layout', () => {
  it('lays out landscape A4 pages when asked', () => {
    const doc = new PdfDocument({ orientation: 'landscape' });
    doc.text('Wide');
    const pdf = doc.build().toString('latin1');
    expect(pdf).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
  });

  it('puts the company logo (an embedded PNG) and the title in the report header', () => {
    const doc = new PdfDocument();
    doc.reportHeader({ title: 'Tasks report', subtitle: 'MICO360 Platform', details: ['Generated 1 Oct 2026, 09:00'] });
    const buf = doc.build();
    const { pages, objects } = inspectPdf(buf);
    expect(pages[0]).toEqual(expect.arrayContaining(['Tasks report', 'MICO360 Platform', 'Generated 1 Oct 2026, 09:00']));
    // tpdf: 1.23.11 — the built-in logo is stored at 200 dpi for its 26 pt header (155 pixels wide, was 900),
    // and titles are set in the one font family (IBM Plex Sans SemiBold, was Archivo).
    expect([...objects.values()].some((d) => /\/Subtype \/Image/.test(d) && /\/Width 155/.test(d))).toBe(true);
    expect(buf.toString('latin1')).toMatch(/\/FontName \/[A-Z]{6}\+IBMPlexSans-SemiBold/);
    expect(buf.toString('latin1')).not.toMatch(/Archivo/);
  });

  it('repeats a slim header (logo + title) on every page after the first', () => {
    const doc = new PdfDocument({ runningTitle: 'Tasks report · MICO360 Platform' });
    doc.reportHeader({ title: 'Tasks report' });
    for (let i = 0; i < 120; i++) doc.text(`Line ${i}`);
    const { pages, contents } = inspectPdf(doc.build());
    expect(pages.length).toBeGreaterThan(1);
    for (let p = 1; p < pages.length; p++) {
      expect(pages[p]).toContain('Tasks report · MICO360 Platform');
      expect(contents[p]).toMatch(/\/I\d+ Do/); // the logo image is drawn
    }
    // Body text never runs under the running header: every line is still there exactly once.
    const all = pages.flat().filter((t) => t.startsWith('Line '));
    expect(all).toHaveLength(120);
  });

  describe('a company logo (companies)', () => {
    const images = (buf: Buffer) => [...inspectPdf(buf).objects.values()].filter((d) => /\/Subtype \/Image/.test(d));
    const widths = (buf: Buffer) => images(buf).map((d) => Number(/\/Width (\d+)/.exec(d)?.[1]));

    it('replaces the built-in logo in the report header and the running header, embedded once', () => {
      const doc = new PdfDocument({ runningTitle: 'Tasks report', logo: solidPng(300, 100) });
      doc.reportHeader({ title: 'Tasks report' });
      for (let i = 0; i < 120; i++) doc.text(`Line ${i}`);
      const buf = doc.build();
      const { pages, contents } = inspectPdf(buf);
      expect(pages.length).toBeGreaterThan(1);
      expect(widths(buf)).toEqual([300]); // no built-in logo (155 wide), and the company's only once
      for (let p = 0; p < pages.length; p++) expect(contents[p]).toMatch(/\/I\d+ Do/);
      expect(pages[1]).toContain('Tasks report');
    });

    it('sits on the right of a project header and of the product header, beside the badge', () => {
      for (const draw of [
        (d: PdfDocument) => d.identityHeader({ initials: 'PA', title: 'Project Alpha', eyebrow: 'Minutes of Meeting', badge: { text: 'Draft', tone: 'warning' } }),
        (d: PdfDocument) => d.brandHeader({ title: 'MICO360 Tasks', eyebrow: 'Minutes of Meeting' }),
      ]) {
        const doc = new PdfDocument({ logo: solidPng(240, 80) });
        draw(doc);
        const buf = doc.build();
        expect(widths(buf)).toEqual([240]);
        expect(inspectPdf(buf).pages[0]).toEqual(expect.arrayContaining(['MINUTES OF MEETING']));
      }
    });

    // tpdf: 1.23.11 (owner) — every header carries a logo: without the company's, the built-in one
    // (a project header had none before); the built-in logo is 155 pixels wide now (was 900).
    it('without one, a project header and the report header show the built-in logo', () => {
      const plain = new PdfDocument();
      plain.identityHeader({ initials: 'PA', title: 'Project Alpha' });
      expect(widths(plain.build())).toEqual([155]);
      const report = new PdfDocument({ logo: null });
      report.reportHeader({ title: 'Tasks report' });
      expect(widths(report.build())).toEqual([155]);
    });

    it('a logo the PDF can’t print falls back to the built-in one', () => {
      const doc = new PdfDocument({ logo: Buffer.from('not a picture') });
      doc.reportHeader({ title: 'Tasks report' });
      expect(widths(doc.build())).toEqual([155]);
    });
  });

  it('draws stat tiles with their values and labels', () => {
    const doc = new PdfDocument();
    doc.statTiles([{ label: 'Total tasks', value: '42' }, { label: 'Completed', value: '27', note: '64%' }, { label: 'Overdue', value: '5', tone: 'danger' }]);
    expect(inspectPdf(doc.build()).pages[0]).toEqual(expect.arrayContaining(['42', 'Total tasks', '27', 'Completed', '64%', '5', 'Overdue']));
  });

  it('draws a bar list with labels and values, scaled to the largest', () => {
    const doc = new PdfDocument();
    doc.barList([{ label: 'Done', value: 12 }, { label: 'In progress', value: 6 }, { label: 'مراجعة', value: 0 }]);
    expect(inspectPdf(doc.build()).pages[0]).toEqual(expect.arrayContaining(['Done', '12', 'In progress', '6', 'مراجعة', '0']));
  });

  it('draws a line chart with a legend and axis labels', () => {
    const doc = new PdfDocument();
    doc.lineChart({
      labels: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'],
      series: [
        { name: 'Created', values: [1, 3, 2, 4] },
        { name: 'Completed', values: [0, 2, 2, 5] },
      ],
    });
    const { pages, contents } = inspectPdf(doc.build());
    // Max 5 → an axis of 0, 2, 4, 6, 8.
    expect(pages[0]).toEqual(expect.arrayContaining(['Created', 'Completed', '2026-09-01', '2026-09-04', '0', '4', '8']));
    expect(contents[0]).toMatch(/ l\n/); // polylines
  });

  it('keeps a block whole: a chart that does not fit starts a new page', () => {
    const doc = new PdfDocument();
    // tpdf: 1.23.11 — a taller page body and smaller type: more filler to reach the bottom (was 44 lines).
    while (doc.remaining > 100) doc.text(`Filler ${doc.cursor}`);
    doc.lineChart({ labels: ['a', 'b'], series: [{ name: 'Series', values: [1, 2] }] });
    const { pages } = inspectPdf(doc.build());
    expect(pages.length).toBe(2);
    expect(pages[1]).toContain('Series');
  });
});

describe('PdfDocument — no clipping, no orphans', () => {
  it('never cuts a tile note short: one that does not fit beside the value gets its own line', () => {
    const doc = new PdfDocument();
    doc.statTiles([1, 2, 3, 4].map((i) => ({ label: `Tile ${i}`, value: '100%', note: '129 on time · 46 late' })));
    expect(inspectPdf(doc.build()).pages[0]!.filter((t) => t === '129 on time · 46 late')).toHaveLength(4);
  });

  it('never cuts a tile value short: long values shrink to fit, and wrap if they still do not', () => {
    const doc = new PdfDocument();
    doc.statTiles([
      { label: 'Status', value: 'In progress' },
      { label: 'Due', value: '30 Sep 2026' },
      { label: 'Project', value: 'Rig Inspection Portal maintenance programme' },
      { label: 'Progress', value: '40%' },
    ]);
    const text = inspectPdf(doc.build()).pages[0]!;
    expect(text).toEqual(expect.arrayContaining(['In progress', '30 Sep 2026', '40%']));
    expect(text.join(' ')).toContain('Rig Inspection Portal maintenance programme');
  });

  it('keeps a heading with the block after it (keepWith), instead of leaving it alone at a page end', () => {
    const doc = new PdfDocument();
    for (let i = 0; i < 40; i++) doc.text(`Filler ${i}`);
    doc.heading('Completion trend', { keepWith: 200 });
    doc.lineChart({ labels: ['a', 'b'], series: [{ name: 'Series', values: [1, 2] }] });
    const { pages } = inspectPdf(doc.build());
    expect(pages[0]).not.toContain('Completion trend');
    expect(pages[1]).toEqual(expect.arrayContaining(['Completion trend', 'Series']));
  });

  it('measures a table before drawing it, so a small one can be kept whole', () => {
    const doc = new PdfDocument();
    const cols = [{ header: 'Project' }, { header: 'Tasks' }];
    const rows = [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']];
    const h = doc.tableHeight(cols, rows);
    expect(h).toBeGreaterThan(60);
    expect(h).toBeLessThan(140);
  });

  it('colours chosen cells (e.g. overdue dates)', () => {
    const doc = new PdfDocument();
    doc.table([{ header: 'Key' }, { header: 'Due' }], [['MICO-1', '1 Oct 2026 · Overdue']], { cellColor: (r, c) => (c === 1 ? [0.72, 0.16, 0.16] : null) });
    expect(inspectPdf(doc.build()).contents[0]).toMatch(/0\.72\d* 0\.16\d* 0\.16\d* scn/);
  });

  it('sets chosen cells in bold (e.g. a failed result), and only those', () => {
    const doc = new PdfDocument();
    doc.table([{ header: 'Item' }, { header: 'Result' }], [['Pressure', 'FAIL'], ['Valves', 'Pass']], { cellBold: (r, c) => c === 1 && r === 0, fit: {} });
    const lines = inspectPdf(doc.build()).lines[0]!;
    const fontsOf = (text: string) => lines.find((l) => l.text === text)!.fonts;
    expect(fontsOf('FAIL').some((f) => /SemiBold/.test(f))).toBe(true);
    expect(fontsOf('Pass').some((f) => /SemiBold/.test(f))).toBe(false);
    expect(fontsOf('Pressure').some((f) => /SemiBold/.test(f))).toBe(false);
  });

  it('can give the spare width to one column, so the others hug their content (an Arabic name sits by its own words)', () => {
    const cols = [{ header: 'Who' }, { header: 'What' }];
    const rows = [['سارة البلوشي', 'Moved the task'], ['Omar Ahmed', 'Commented']];
    const whatX = (wide?: number) => {
      const doc = new PdfDocument();
      doc.table(cols, rows, wide === undefined ? {} : { wide });
      return inspectPdf(doc.build()).lines[0]!.find((l) => l.text === 'What')!.x;
    };
    expect(whatX()).toBeGreaterThan(200); // shared out: "Who" is stretched wide
    expect(whatX(1)).toBeLessThan(140); // "Who" is only as wide as its longest name
  });

  it('never cuts a long name in an identity header: it shrinks, then wraps, and the header grows to hold it', () => {
    const name = 'Rig Inspection Portal maintenance programme for the northern concession, phase two of the 2026 to 2027 works';
    const doc = new PdfDocument();
    doc.identityHeader({ initials: 'RI', eyebrow: 'Task', title: name, subtitle: 'RIG  ·  Project no. NWT-2026-014' });
    doc.text('After the header');
    const lines = inspectPdf(doc.build()).lines[0]!;
    expect(lines.map((l) => l.text).join(' ')).toContain(name);
    expect(lines.map((l) => l.text)).toContain('RIG  ·  Project no. NWT-2026-014');
    const after = lines.find((l) => l.text === 'After the header')!;
    const subtitle = lines.find((l) => l.text === 'RIG  ·  Project no. NWT-2026-014')!;
    expect(after.y).toBeGreaterThan(subtitle.y + 12);
  });

  it('keeps a short name in an identity header on one line at full size', () => {
    const doc = new PdfDocument();
    doc.identityHeader({ initials: 'FC', eyebrow: 'Task', title: 'Falcon CRM', subtitle: 'FAL' });
    const title = inspectPdf(doc.build()).lines[0]!.find((l) => l.text === 'Falcon CRM')!;
    // tpdf: 1.23.11 — the slim header band sets the project's name at 11 pt (was 17).
    expect(title.size).toBe(11);
  });
});

describe('PdfDocument — nested and formatted text, checklists, pictures', () => {
  it('insets a nested block (a reply) from the left whatever its direction, with a thin rule beside it', () => {
    const doc = new PdfDocument();
    doc.text('Top level comment');
    doc.text('A reply in English', { inset: 24, bar: [0.2, 0.4, 0.6] });
    doc.text('رد باللغة العربية على التعليق', { inset: 24, bar: [0.2, 0.4, 0.6] });
    const { lines, contents } = inspectPdf(doc.build());
    const at = (t: string) => lines[0]!.find((l) => l.text === t)!;
    // tpdf: 1.23.11 — 14 mm side margins (was 54 pt).
    expect(at('Top level comment').x).toBeCloseTo(doc.margin, 1);
    expect(at('A reply in English').x).toBeCloseTo(doc.margin + 24, 1);
    // An Arabic reply is set from the right edge, inside the nested column.
    expect(at('رد باللغة العربية على التعليق').x).toBeGreaterThan(300);
    expect(contents[0]).toMatch(/0\.2 0\.4 0\.6 scn/);
  });

  it('draws formatted runs in their own faces on one line (a bold @mention in a sentence)', () => {
    const doc = new PdfDocument();
    doc.styledText([{ text: 'Thanks ' }, { text: '@omar', bold: true }, { text: ' for the figures' }], { size: 10 });
    const line = inspectPdf(doc.build()).lines[0]!.find((l) => l.text === 'Thanks @omar for the figures')!;
    expect(line.fonts).toEqual(['IBMPlexSans-Regular', 'IBMPlexSans-SemiBold', 'IBMPlexSans-Regular']);
  });

  it('draws checklist boxes (a tick in the done ones), wraps a long item in full and sets an Arabic item from the right', () => {
    const long = 'Confirm with the vendor that the signed contract, the insurance certificate and the HSE plan are all uploaded to the shared folder before the kickoff meeting on Sunday, and chase anyone who has not sent theirs';
    const doc = new PdfDocument();
    doc.checkItem('Collect figures', true).checkItem(long, false).checkItem('مراجعة العقد مع المورد قبل الاجتماع', false);
    const { lines, contents } = inspectPdf(doc.build());
    const text = lines[0]!.map((l) => l.text);
    expect(text).toContain('Collect figures');
    expect(text.filter((t) => long.includes(t)).join(' ')).toBe(long);
    expect(lines[0]!.find((l) => l.text === 'مراجعة العقد مع المورد قبل الاجتماع')!.x).toBeGreaterThan(300);
    // Boxes are drawn shapes, not font glyphs; one is filled green with a white tick.
    expect(text.join('')).not.toMatch(/[☐☑✓]/);
    expect(contents[0]!.match(/1 1 1 SCN/g)).toHaveLength(1);
    expect(contents[0]).toMatch(/0\.18\d* 0\.49\d* 0\.3[23]\d* scn/);
  });

  it('lays pictures out three to a row with each file name under its picture', async () => {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const doc = new PdfDocument();
    const image = doc.prepareImage(jpeg)!;
    doc.imageGrid(Array.from({ length: 7 }, (_, i) => ({ image, caption: `photo-${i + 1}.jpg` })));
    const { lines, contents } = inspectPdf(doc.build());
    expect(contents[0]!.match(/\/I\d+ Do/g)).toHaveLength(7);
    const at = (t: string) => lines[0]!.find((l) => l.text === t)!;
    expect(at('photo-1.jpg').y).toBe(at('photo-3.jpg').y);
    expect(at('photo-1.jpg').x).toBeLessThan(at('photo-2.jpg').x);
    expect(at('photo-2.jpg').x).toBeLessThan(at('photo-3.jpg').x);
    expect(at('photo-4.jpg').y).toBeGreaterThan(at('photo-1.jpg').y + 60);
    expect(at('photo-4.jpg').x).toBe(at('photo-1.jpg').x);
    expect(at('photo-7.jpg').y).toBeGreaterThan(at('photo-4.jpg').y);
  });

  it('says which pictures it can print: JPEG and PNG yes, WebP or a damaged file no', async () => {
    const sharp = (await import('sharp')).default;
    const base = sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 30, g: 90, b: 139, alpha: 0.5 } } });
    const doc = new PdfDocument();
    expect(doc.prepareImage(await base.clone().jpeg().toBuffer())).not.toBeNull();
    expect(doc.prepareImage(await base.clone().png().toBuffer())).not.toBeNull(); // see-through: flattened onto white
    expect(doc.prepareImage(await base.clone().webp().toBuffer())).toBeNull();
    expect(doc.prepareImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull(); // a JPEG cut short
    expect(doc.prepareImage(Buffer.from('not a picture'))).toBeNull();
    doc.text('Still fine');
    expect(inspectPdf(doc.build()).pages[0]).toContain('Still fine');
  });
});

describe('PdfDocument — measuring what follows a heading', () => {
  // How far down the page a block moved the cursor.
  const drop = (doc: PdfDocument, draw: () => void) => {
    const before = doc.remaining;
    draw();
    return before - doc.remaining;
  };

  it('measures a paragraph as text() draws it, wrapped lines and Arabic lines included', () => {
    const doc = new PdfDocument();
    const long = 'A long paragraph that wraps over more than one line of the page, so its height is that of several lines. '.repeat(3);
    for (const [content, options] of [['One line', { size: 9, gap: 3 }], [long, { size: 10 }], ['سطر باللغة العربية', { size: 10 }]] as const) {
      const expected = doc.textHeight(content, options);
      expect(drop(doc, () => doc.text(content, options)), content).toBeCloseTo(expected, 5);
    }
    expect(doc.textHeight(long, { size: 10 })).toBeGreaterThan(doc.textHeight('One line', { size: 10 }) * 2);
  });

  it('measures the first row of a picture grid, and a table’s header with its first rows', async () => {
    const sharp = (await import('sharp')).default;
    const doc = new PdfDocument();
    const image = doc.prepareImage(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).jpeg().toBuffer())!;
    const items = [{ image, caption: 'a-caption-long-enough-to-wrap-onto-a-second-line-under-its-picture.jpg' }, { image, caption: 'b.jpg' }];
    // tpdf: 1.23.11 — the grid's gap under a row is 8 pt (was 12).
    expect(drop(doc, () => doc.imageGrid(items))).toBeCloseTo(doc.imageGridFirstRowHeight(items) + 8, 5); // + the gap under the row
    expect(doc.imageGridFirstRowHeight([])).toBe(0);
    const cols = [{ header: 'When' }, { header: 'What' }];
    const rows = [['1 Oct', 'Short'], ['2 Oct', 'A much longer cell that sets how wide the column is drawn']];
    expect(doc.tableHeight(cols, rows, { firstRows: 1 })).toBeLessThan(doc.tableHeight(cols, rows));
    expect(drop(doc, () => doc.table(cols, rows))).toBeCloseTo(doc.tableHeight(cols, rows), 5);
  });

  it('says how much room a subheading keeps together, so a heading above it can keep it too', () => {
    // tpdf: 1.23.11 — sub-headings are 10 pt (was 11).
    expect(new PdfDocument().subheadingRoom({ topGap: 4, keepWith: 60 })).toBeCloseTo(4 + 10 * 1.6 + 60, 5);
    expect(new PdfDocument().subheadingRoom({ topGap: 4 })).toBeCloseTo(4 + 10 * 1.6 + 28, 5);
  });
});

describe('PdfDocument — tables never lose or overlap text', () => {
  const PAGE_H = 841.89;

  it('a cell taller than a page continues on the next page (under the repeated header) instead of being cut', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `w${i}`);
    const doc = new PdfDocument();
    doc.table([{ header: 'Id' }, { header: 'Notes' }], [['1', words.join(' ')], ['2', 'after']]);
    const { pages } = inspectPdf(doc.build());
    expect(pages.length).toBeGreaterThan(2);
    for (const p of pages) expect(p.slice(0, 2)).toEqual(['Id', 'Notes']);
    const drawn = pages.flat().filter((t) => /^w\d/.test(t));
    expect(drawn.join(' ')).toBe(words.join(' '));
    expect(pages[pages.length - 1]).toEqual(expect.arrayContaining(['2', 'after']));
  });

  describe('balanced columns (fit)', () => {
    const cols = [
      { header: 'Task', nowrap: true },
      { header: 'Title' },
      { header: 'Assigned to' },
      // tpdf: 1.23.11 — dates centre by default; held left here so the headers mark where columns start.
      { header: 'Due', nowrap: true, align: 'left' as const },
      { header: 'Overdue', align: 'right' as const, nowrap: true },
    ];
    const title = 'Pressure test report for the north manifold, including the calibration certificates from the vendor';
    const rows = [
      ['RIG-14', title, 'Hassan Ahmed, Layla Nasser, Mariam Al-Harthy', '19 Oct 2026', '5 days'],
      ['RIG-9', 'تحديث مخزون الصمامات في الموقع الشمالي', '', '2 Oct 2026', '12 days'],
      ['RIG-21', 'Safety checklist v2', 'Omar Said', '30 Sep 2026', '115 days'],
    ];
    const draw = () => {
      const doc = new PdfDocument();
      doc.table(cols, rows, { size: 9, fit: { minSize: 7 } });
      return inspectPdf(doc.build()).lines[0]!.filter((l) => l.y < PAGE_H - 62);
    };

    it('never breaks a word or a date, and keeps every cell’s words in order', () => {
      const lines = draw();
      const words = new Set(rows.flat().join(' ').split(/\s+/).concat(cols.map((c) => c.header).join(' ').split(' ')));
      for (const l of lines) for (const w of l.text.split(' ')) expect(words, `"${w}" in "${l.text}"`).toContain(w);
      const titleLines = lines.filter((l) => title.includes(l.text) && l.text.length > 3);
      expect(titleLines.map((l) => l.text).join(' ')).toBe(title);
      for (const d of ['19 Oct 2026', '2 Oct 2026', '30 Sep 2026']) expect(lines.map((l) => l.text)).toContain(d);
    });

    it('right-aligns numbers on one edge, and no line runs past its column', () => {
      const lines = draw();
      const right = (t: string, bold = false) => {
        const l = lines.find((x) => x.text === t)!;
        return l.x + measureText(t, l.size, bold);
      };
      expect(right('5 days')).toBeCloseTo(right('115 days'), 1);
      expect(right('12 days')).toBeCloseTo(right('Overdue', true), 1);
      // Left-aligned headers mark where each column's text starts; nothing crosses into the next column.
      const starts = ['Task', 'Title', 'Assigned to', 'Due'].map((h) => lines.find((l) => l.text === h)!.x);
      for (const l of lines) {
        const col = starts.findIndex((s, i) => l.x >= s - 0.5 && (i === starts.length - 1 || l.x < starts[i + 1]! - 0.5));
        if (col < 0 || col === starts.length - 1) continue;
        expect(l.x + measureText(l.text, l.size), l.text).toBeLessThanOrEqual(starts[col + 1]! - 5 + 0.5);
      }
    });

    it('gives a long word the room it needs when every column has to wrap (instead of an equal share that breaks it)', () => {
      const six = Array.from({ length: 6 }, (_, i) => ({ header: `Notes ${i + 1}` }));
      const filler = 'and then the team will review the list again '.repeat(4).trim();
      const doc = new PdfDocument();
      doc.table(six, [six.map((_, i) => (i === 2 ? `Electromechanical ${filler}` : filler))], { size: 9, fit: { minSize: 7 } });
      const lines = inspectPdf(doc.build()).lines[0]!;
      const word = lines.filter((l) => l.text.split(' ').includes('Electromechanical'));
      expect(word).toHaveLength(1);
      expect(word[0]!.size).toBe(9);
    });

    it('a table too wide for the page shrinks its type (to no less than the minimum) before it breaks words', () => {
      const many = Array.from({ length: 13 }, (_, i) => ({ header: `Column ${i + 1}` }));
      const row = many.map((_, i) => `Inspection${i} certificates`);
      const doc = new PdfDocument({ orientation: 'landscape' });
      doc.table(many, [row], { size: 9, fit: { minSize: 7 } });
      const body = inspectPdf(doc.build()).lines[0]!.filter((l) => l.text.startsWith('Inspection') || l.text === 'certificates');
      expect(body.length).toBeGreaterThan(0);
      for (const l of body) {
        expect(l.size).toBeLessThan(9);
        expect(l.size).toBeGreaterThanOrEqual(7);
      }
    });
  });
});

describe('PdfDocument — running header and footer never cut text silently', () => {
  const PAGE_H = 841.89;
  const fill = (doc: PdfDocument) => {
    for (let i = 0; i < 120; i++) doc.text(`Line ${i}`);
    return inspectPdf(doc.build());
  };

  it('a running title too long for the header ends with “…”', () => {
    const title = 'Overdue tasks in Rig Inspection and the platform audit with owners and dates '.repeat(4).trim();
    const { lines } = fill(new PdfDocument({ runningTitle: title }));
    const top = lines[1]!.filter((l) => l.y < 54);
    expect(top).toHaveLength(1);
    expect(top[0]!.text.endsWith('…')).toBe(true);
    expect(title.startsWith(top[0]!.text.slice(0, -1).trimEnd())).toBe(true);
  });

  // tpdf: 1.23.11 — the footer is company · "Printed … by …" · page; a "Printed" line too long to sit
  // beside the company gets a row of its own and wraps there (never shrunk under 7.5 pt or cut, was "…").
  it('a footer line too long for its place moves to a row of its own and wraps — never cut; a short one is unchanged', () => {
    const long = `Printed 25 Oct 2026, 09:00 by ${'Khurram Shahzad Al-Balushi '.repeat(6).trim()}`;
    const { lines } = fill(new PdfDocument({ footer: { company: 'Prolens Projects LLC', printed: long, extra: ['Short line'] } }));
    const footer = lines[0]!.filter((l) => l.artifact);
    expect(footer.every((l) => l.y > PAGE_H - 90)).toBe(true); // four rows in the bottom band
    expect(footer.map((l) => l.text).join(' ').replace(/\s+/g, ' ')).toContain(long);
    expect(footer.some((l) => l.text.includes('…'))).toBe(false);
    for (const l of footer) expect(l.size).toBe(7.5);
    const page = footer.find((l) => l.text.startsWith('Page '))!;
    const company = footer.find((l) => l.text === 'Prolens Projects LLC')!;
    expect(company.y).toBeCloseTo(page.y, 1);
    expect(footer.filter((l) => l.text.startsWith('Printed')).every((l) => l.y > page.y)).toBe(true);
    expect(footer.find((l) => l.text === 'Short line')).toBeDefined();
  });
});

describe('PdfDocument — review fixes', () => {
  const cols = [{ header: 'Task', nowrap: true }, { header: 'Title' }];

  it('keeps a heading that wraps onto several lines with the table after it (never alone at a page end)', () => {
    const title = 'Open tasks in Rig Inspection Portal and the platform audit, with their owners, due dates and progress, for the weekly review';
    const rows = [['RIG-1', 'Pressure test report'], ['RIG-2', 'Valve inventory']];
    const doc = new PdfDocument();
    const keep = doc.tableHeight(cols, rows, { size: 9, fit: {}, firstRows: 1 });
    // Leave room for a one-line heading and the table's start, but not for this heading's three lines.
    doc.spacer(doc.remaining - (11 * 1.8 + 9 + keep + 2));
    doc.heading(title, { size: 11, topGap: 0, keepWith: keep });
    doc.table(cols, rows, { size: 9, fit: {} });
    const { pages } = inspectPdf(doc.build());
    const headingPage = pages.findIndex((p) => p.some((t) => title.startsWith(t) && t.length > 10));
    const tablePage = pages.findIndex((p) => p.includes('RIG-1'));
    expect(headingPage).toBe(tablePage);
    expect(pages[headingPage]!.filter((t) => title.includes(t)).join(' ')).toBe(title);
  });

  it('a one-line heading keeps exactly the room it kept before', () => {
    const a = new PdfDocument();
    const b = new PdfDocument();
    a.heading('Activity', { keepWith: 40 });
    b.heading('Activity', { keepWith: 40 });
    expect(a.remaining).toBeCloseTo(b.remaining, 6);
    const doc = new PdfDocument();
    doc.spacer(doc.remaining - (12.5 * 1.8 + 9 + 40 + 14 + 1));
    doc.heading('Activity', { keepWith: 40 });
    doc.text('After');
    expect(inspectPdf(doc.build()).pages).toHaveLength(1);
  });

  it('balanced (fit) tables set rows without Arabic at the normal line height; a row with Arabic keeps the taller one, its cells on one baseline', () => {
    const latin = [['RIG-1', 'Pressure test report'], ['RIG-2', 'Valve inventory']];
    // tpdf: 1.23.11 — every table is balanced now, with 2.5 pt above and below a cell's text (was 3).
    const doc = new PdfDocument();
    const h = doc.tableHeight(cols, latin, { size: 9, fit: {} });
    expect(h).toBeCloseTo(3 * (9 * 1.4 + 5), 5); // header + 2 rows, one line each
    const mixed = [...latin, ['RIG-3', 'تحديث مخزون الصمامات']];
    expect(doc.tableHeight(cols, mixed, { size: 9, fit: {} })).toBeCloseTo(3 * (9 * 1.4 + 5) + (9 * 1.72 + 5), 5);
    expect(doc.tableHeight(cols, latin, { size: 9 })).toBeCloseTo(3 * (9 * 1.4 + 5), 5);
    doc.table(cols, mixed, { size: 9, fit: {} });
    const lines = inspectPdf(doc.build()).lines[0]!;
    const y = (t: string) => lines.find((l) => l.text === t)!.y;
    expect(y('RIG-3')).toBeCloseTo(y('تحديث مخزون الصمامات'), 5);
    expect(y('RIG-2') - y('RIG-1')).toBeCloseTo(9 * 1.4 + 5, 5);
  });
});

describe('PdfDocument — compact density (the minutes, 1.22.1)', () => {
  const drop = (doc: PdfDocument, draw: () => void) => {
    const before = doc.remaining;
    draw();
    return before - doc.remaining;
  };
  const drawnLines = (doc: PdfDocument) => inspectPdf(doc.build()).lines.flat();

  // tpdf: 1.23.11 — the compact scale became the one standard for every PDF (owner, 10 Nov): `density`
  // is still accepted but changes nothing; the strip sets its label over its value (was beside it).
  it('sets every PDF on the one standard, whatever density it asks for: 14 mm margins, 9.5 pt text, 11 pt headings, 8.5 pt tables', () => {
    for (const density of [undefined, 'regular', 'compact'] as const) {
      const doc = new PdfDocument(density ? { density } : {});
      doc.heading('Section').text('Body').bullet('Point').table([{ header: 'Col' }], [['Cell']]);
      const lines = drawnLines(doc);
      const at = (t: string) => lines.find((l) => l.text === t)!;
      expect(at('Body').size).toBe(9.5);
      expect(at('Point').size).toBe(9.5);
      expect(at('Section').size).toBe(11);
      expect(at('Cell').size).toBe(8.5);
      expect(at('Body').x).toBeCloseTo(14 * (72 / 25.4), 1);
    }
  });

  it('draws the summary as one slim strip (at most about 11 mm tall), each label over its value', () => {
    const doc = new PdfDocument({ density: 'compact' });
    const h = drop(doc, () => doc.statTiles([{ label: 'Attendees present', value: '0/6' }, { label: 'Open action items', value: '3', note: '1 overdue', tone: 'danger' }]));
    expect(h).toBeLessThanOrEqual(32 + 6); // the strip and the gap under it
    const lines = drawnLines(doc);
    const at = (t: string) => lines.find((l) => l.text === t)!;
    expect(at('0/6').y).toBeGreaterThan(at('Attendees present').y);
    expect(at('1 overdue')).toBeDefined();
  });

  it('draws a compact part heading and status line without filled bands', () => {
    const doc = new PdfDocument({ density: 'compact' });
    const band = drop(doc, () => doc.partBand('Meeting record'));
    const strip = drop(doc, () => doc.statusStrip('DRAFT · Not yet approved', 'warning'));
    expect(band).toBeLessThan(40);
    expect(strip).toBeLessThanOrEqual(24); // a 6 mm line and the gap under it
    const lines = drawnLines(doc);
    expect(lines.find((l) => l.text === 'Meeting record')!.size).toBeLessThanOrEqual(12);
    expect(lines.find((l) => l.text === 'DRAFT · Not yet approved')!.size).toBeLessThanOrEqual(8.5);
  });

  it('puts a small aside at the end of the last line drawn when it fits there, else on a short line of its own', () => {
    const doc = new PdfDocument({ density: 'compact' });
    doc.bullet('A short note.').aside('Ada · 09:05');
    doc.text('ملاحظة قصيرة').aside('خالد · 09:07');
    const lines = drawnLines(doc);
    const at = (t: string) => lines.find((l) => l.text === t)!;
    const short = at('A short note.');
    expect(at('Ada · 09:05').y).toBeCloseTo(short.y, 1);
    expect(at('Ada · 09:05').size).toBeLessThan(9);
    expect(at('Ada · 09:05').x).toBeGreaterThan(400); // at the right end of the line
    // An Arabic line ends on the left: its aside sits there.
    expect(at('خالد · 09:07').x).toBeLessThan(at('ملاحظة قصيرة').x);
    // A last line with no room beside it: the aside takes a short line of its own, at the right.
    let own: { last: number; aside: number; x: number } | null = null;
    for (let n = 1; n < 120 && !own; n++) {
      const d = new PdfDocument({ density: 'compact' });
      d.bullet('word '.repeat(n).trim()).aside('Ada · 09:06');
      const ls = drawnLines(d);
      const a = ls.find((l) => l.text === 'Ada · 09:06')!;
      const last = ls.filter((l) => l.text.startsWith('word')).at(-1)!;
      if (a.y > last.y + 1) own = { last: last.y, aside: a.y, x: a.x };
    }
    expect(own, 'an aside on a line of its own').not.toBeNull();
    expect(own!.aside - own!.last).toBeLessThan(12);
    expect(own!.x).toBeGreaterThan(400);
  });

  it('never leaves an aside alone at the top of a page: it stays under its block, clear of the footer', () => {
    // One full line, so the aside always needs a line of its own.
    let words = 1;
    while (new PdfDocument({ density: 'compact' }).textHeight('word '.repeat(words + 1).trim()) < 20) words++;
    const full = 'word '.repeat(words).trim();
    for (let fillers = 40; fillers < 70; fillers++) {
      const doc = new PdfDocument({ density: 'compact', footer: { company: 'Footer' } }); // tpdf: 1.23.11 footer (was footerLeft)
      for (let i = 0; i < fillers; i++) doc.text(`Filler line ${i}`);
      doc.text(full).aside('Ada Lovelace · 4 Nov, 17:45');
      const { lines } = inspectPdf(doc.build());
      const page = (t: string) => lines.findIndex((p) => p.some((l) => l.text === t));
      const last = lines.flatMap((p, pi) => p.filter((l) => l.text === full).map((l) => ({ ...l, pi }))).at(-1)!;
      expect(page('Ada Lovelace · 4 Nov, 17:45'), `${fillers} fillers`).toBe(last.pi);
      const aside = lines[last.pi]!.find((l) => l.text === 'Ada Lovelace · 4 Nov, 17:45')!;
      const footer = lines[last.pi]!.find((l) => l.text === 'Footer')!;
      expect(aside.y, `${fillers} fillers`).toBeLessThan(footer.y - 12); // above the footer and its rule
    }
  });

  it('makes a key/value row a clickable link when given an address, showing only its label', () => {
    const doc = new PdfDocument({ density: 'compact' });
    doc.keyValueColumns([['Online', 'Microsoft Teams — join link', 'https://teams.microsoft.com/l/meetup-join/abc']], [['Status', 'Draft']]);
    const { pages, objects } = inspectPdf(doc.build());
    expect(pages[0]).toContain('Microsoft Teams — join link');
    expect([...objects.values()].join('\n')).toContain('/URI (https://teams.microsoft.com/l/meetup-join/abc)');
  });

  it('puts a heading’s aside (a count) on the heading’s own line', () => {
    const doc = new PdfDocument({ density: 'compact' });
    doc.heading('Attendees', { aside: '6 invited · 0 present' });
    const lines = drawnLines(doc);
    const at = (t: string) => lines.find((l) => l.text === t)!;
    expect(at('6 invited · 0 present').y).toBeCloseTo(at('Attendees').y, 1);
    expect(at('6 invited · 0 present').x).toBeGreaterThan(at('Attendees').x + 200);
  });
});
