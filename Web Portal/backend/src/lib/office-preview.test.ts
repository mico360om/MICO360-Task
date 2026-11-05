import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { officePreview, PreviewError } from './office-preview';
import { buildXlsx, zip } from './xlsx-writer';

const when = new Date('2026-10-10T08:00:00Z');
const pkg = (files: Record<string, string>) => zip(Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })), when);
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

describe('officePreview — Word', () => {
  it('gives the document’s paragraphs as plain text (entities decoded, tabs and breaks kept, Arabic intact)', () => {
    const docx = pkg({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': `<w:document ${W}><w:body>
        <w:p><w:r><w:t>Quarterly </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">report &amp; plan</w:t></w:r></w:p>
        <w:p/>
        <w:p><w:r><w:t>Item</w:t><w:tab/><w:t>Cost &lt;OMR&gt;</w:t><w:br/><w:t>next line</w:t></w:r></w:p>
        <w:p><w:r><w:t>مراجعة الميزانية</w:t></w:r></w:p>
      </w:body></w:document>`,
    });
    expect(officePreview(docx, 'plan.docx')).toEqual({
      kind: 'document',
      paragraphs: ['Quarterly report & plan', 'Item\tCost <OMR>\nnext line', 'مراجعة الميزانية'],
      truncated: false,
    });
  });
});

describe('officePreview — Excel', () => {
  it('reads a workbook made by our own export (inline strings, numbers), sheet by sheet', () => {
    const xlsx = buildXlsx([
      { name: 'Budget', columns: [{ header: 'Item', kind: 'text' }, { header: 'Cost', kind: 'number' }], rows: [['Venue', 1200], ['Catering', 450.5]] },
      { name: 'Notes', columns: [{ header: 'Note', kind: 'text' }], rows: [['Approved']] },
    ] as never, {}, when);
    const p = officePreview(xlsx, 'budget.xlsx');
    expect(p?.kind).toBe('sheet');
    if (p?.kind !== 'sheet') return;
    expect(p.sheets.map((s) => s.name)).toEqual(['Budget', 'Notes']);
    const flat = p.sheets[0]!.rows.map((r) => r.join('|')).join('\n');
    expect(flat).toContain('Venue|1200');
    expect(flat).toContain('Catering|450.5');
    expect(p.sheets[1]!.rows.flat()).toContain('Approved');
  });

  it('reads shared strings and keeps cells in their columns (gaps stay empty)', () => {
    const xlsx = pkg({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Q3 &amp; Q4" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><r><t>Om</t></r><r><t>ar</t></r></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>7</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="b"><v>1</v></c></row></sheetData></worksheet>',
    });
    expect(officePreview(xlsx, 'team.xlsx')).toEqual({
      kind: 'sheet',
      sheets: [{ name: 'Q3 & Q4', rows: [['Name', '', '7'], ['Omar', 'TRUE', '']], truncated: false }],
    });
  });
});

describe('officePreview — PowerPoint', () => {
  it('gives each slide’s text, slides in their real order (2 before 10)', () => {
    const slide = (lines: string[]) => `<p:sld ${A}><p:cSld><p:spTree>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;
    const pptx = pkg({
      'ppt/slides/slide10.xml': slide(['Thanks']),
      'ppt/slides/slide1.xml': slide(['Launch plan', 'October 2026']),
      'ppt/slides/slide2.xml': slide(['Budget']),
    });
    expect(officePreview(pptx, 'deck.pptx')).toEqual({
      kind: 'slides',
      slides: [{ number: 1, lines: ['Launch plan', 'October 2026'] }, { number: 2, lines: ['Budget'] }, { number: 10, lines: ['Thanks'] }],
      truncated: false,
    });
  });
});

describe('officePreview — what it won’t do', () => {
  it('has nothing to show for older or other formats', () => {
    expect(officePreview(Buffer.from('anything'), 'old.doc')).toBeNull();
    expect(officePreview(Buffer.from('anything'), 'photo.png')).toBeNull();
  });

  it('refuses a damaged file instead of crashing', () => {
    expect(() => officePreview(Buffer.from('PK not really a zip'), 'broken.docx')).toThrow(PreviewError);
  });

  it('refuses a "zip bomb" (a part that unpacks to far more than its size)', () => {
    const huge = Buffer.alloc(40 * 1024 * 1024, 0x20); // 40 MB of spaces deflates to almost nothing
    const bomb = zip([{ name: 'word/document.xml', data: huge }], when);
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => officePreview(bomb, 'bomb.docx')).toThrow(/too large/i);
    expect(deflateRawSync).toBeTypeOf('function');
  });

  it('1.23: refuses a file whose parts together unpack to too much (many parts, each under the part limit)', () => {
    const part = Buffer.alloc(15 * 1024 * 1024, 0x20);
    const sheets = Array.from({ length: 6 }, (_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: part }));
    const bomb = zip([{ name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') }, ...sheets], when);
    expect(() => officePreview(bomb, 'many.xlsx')).toThrow(/too large/i);
  });

  it('shows only the start of a very long document', () => {
    const paras = Array.from({ length: 5000 }, (_, i) => `<w:p><w:r><w:t>Line ${i}</w:t></w:r></w:p>`).join('');
    const p = officePreview(pkg({ 'word/document.xml': `<w:document ${W}><w:body>${paras}</w:body></w:document>` }), 'long.docx');
    expect(p).toMatchObject({ kind: 'document', truncated: true });
    if (p?.kind === 'document') expect(p.paragraphs.length).toBeLessThan(5000);
  });
});

// Security review (1.23): the preview's patterns took time growing with the square of the text when a
// tag was never closed — a 30 KB .docx (16 MB of "<w:p>" unpacked) held the server for about an hour and
// a half. Each kind of tag is now read in one pass: these files preview at once.
describe('officePreview — tags that are never closed', () => {
  const KB = 1024;
  const fast = (name: string, files: Record<string, string>) => {
    const file = pkg(files);
    const t = Date.now();
    expect(() => officePreview(file, name)).not.toThrow();
    expect(Date.now() - t, `${name} took too long`).toBeLessThan(1000);
  };
  const xlsx = (parts: Partial<Record<'workbook' | 'rels' | 'shared' | 'sheet', string>>) => ({
    'xl/workbook.xml': parts.workbook ?? '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': parts.rels ?? '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': parts.shared ?? '<sst><si><t>x</t></si></sst>',
    'xl/worksheets/sheet1.xml': parts.sheet ?? '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
  });

  it('Word: paragraphs and text runs that never end', () => {
    fast('p.docx', { 'word/document.xml': '<w:p>'.repeat((600 * KB) / 5) });
    fast('t.docx', { 'word/document.xml': `<w:p>${'<w:t>'.repeat((600 * KB) / 5)}</w:p>` });
  }, 120_000);

  it('PowerPoint: paragraphs that never end', () => {
    fast('s.pptx', { 'ppt/slides/slide1.xml': '<a:p>'.repeat((600 * KB) / 5) });
  }, 120_000);

  it('Excel: shared strings, rows, cells, values, sheets and links that never end, and a tag with one endless name', () => {
    fast('si.xlsx', xlsx({ shared: `<sst>${'<si>'.repeat((600 * KB) / 4)}</sst>` }));
    fast('row.xlsx', xlsx({ sheet: `<sheetData>${'<row>'.repeat((600 * KB) / 5)}</sheetData>` }));
    fast('c.xlsx', xlsx({ sheet: `<sheetData><row>${'<c>'.repeat((600 * KB) / 3)}</row></sheetData>` }));
    fast('v.xlsx', xlsx({ sheet: `<sheetData><row><c>${'<v>'.repeat((600 * KB) / 3)}</c></row></sheetData>` }));
    fast('sheet.xlsx', xlsx({ workbook: `<workbook><sheets>${'<sheet '.repeat((600 * KB) / 7)}` }));
    fast('rel.xlsx', xlsx({ rels: `<Relationships>${'<Relationship '.repeat((600 * KB) / 14)}` }));
    fast('attr.xlsx', xlsx({ sheet: `<sheetData><row><c ${'a'.repeat(100 * KB)}><v>1</v></c></row></sheetData>` }));
  }, 300_000);

  it('reads rows as they are: a self-closed row is empty, and the row after it keeps its own cells', () => {
    const p = officePreview(
      pkg(xlsx({ sheet: '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2" spans="1:2"/><row r="3"><c r="B3"><v>7</v></c></row></sheetData>' })),
      'gaps.xlsx',
    );
    expect(p).toMatchObject({ kind: 'sheet', sheets: [{ name: 'S', rows: [['x', ''], ['', ''], ['', '7']] }] });
  });
});
