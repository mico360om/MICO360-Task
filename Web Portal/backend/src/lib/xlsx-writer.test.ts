import { describe, it, expect } from 'vitest';
import { unzipText as unzip } from './xlsx-inspect';
import { buildXlsx, excelSerial, type XlsxSheet } from './xlsx-writer';

const sheet = (over: Partial<XlsxSheet> = {}): XlsxSheet => ({
  name: 'Projects',
  columns: [
    { header: 'Project', kind: 'text' },
    { header: 'Tasks', kind: 'integer' },
    { header: 'Completion', kind: 'percent' },
    { header: 'Due', kind: 'date' },
  ],
  rows: [
    ['Website relaunch', 12, 75, { date: '2026-10-30' }],
    ['مشروع الإطلاق', 3, 0, null],
  ],
  ...over,
});

describe('buildXlsx', () => {
  it('writes a real Office Open XML package: content types, workbook, styles and one part per sheet', () => {
    const files = unzip(buildXlsx([sheet(), sheet({ name: 'Second' })], { title: 'Tasks report' }));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml', 'docProps/app.xml']) {
      expect(files.has(part), part).toBe(true);
    }
    expect(files.get('[Content_Types].xml')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Projects" sheetId="1" r:id="rId1"/>');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Second" sheetId="2" r:id="rId2"/>');
    expect(files.get('docProps/core.xml')).toContain('<dc:title>Tasks report</dc:title>');
  });

  it('styles the header row (bold, white on the brand colour), freezes it and adds filter buttons', () => {
    const files = unzip(buildXlsx([sheet()], { brand: '#8B1E1E' }));
    const styles = files.get('xl/styles.xml')!;
    expect(styles).toContain('<fgColor rgb="FF8B1E1E"/>');
    expect(styles).toMatch(/<font><b\/><sz val="11"\/><color rgb="FFFFFFFF"\/>/);
    const xml = files.get('xl/worksheets/sheet1.xml')!;
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A1:D3"/>');
    expect(xml).toMatch(/<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Project<\/t><\/is><\/c>/);
  });

  it('puts a title and notes above the table and freezes below the header', () => {
    const xml = unzip(buildXlsx([sheet({ title: 'Project performance', notes: ['Project: All', 'Generated 1 Oct 2026'] })])).get('xl/worksheets/sheet1.xml')!;
    expect(xml).toContain('Project performance');
    expect(xml).toContain('Generated 1 Oct 2026');
    // Title (1), two notes (2-3), a blank row (4), the header on row 5.
    expect(xml).toContain('<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A5:D7"/>');
    expect(xml).toContain('<mergeCell ref="A1:D1"/>');
  });

  it('stores numbers as numbers, dates as Excel serials and percentages as fractions, each with a format', () => {
    const files = unzip(buildXlsx([sheet()]));
    const xml = files.get('xl/worksheets/sheet1.xml')!;
    expect(xml).toMatch(/<c r="B2" s="\d+"><v>12<\/v><\/c>/);
    expect(xml).toMatch(/<c r="C2" s="\d+"><v>0.75<\/v><\/c>/);
    expect(xml).toMatch(new RegExp(`<c r="D2" s="\\d+"><v>${excelSerial('2026-10-30')}</v></c>`));
    expect(excelSerial('2026-10-30')).toBe(46325);
    expect(excelSerial('2026-10-30 18:00')).toBe(46325.75);
    // Minutes survive exactly (17:45 must not read back as 17:44:59).
    expect(Math.round(((excelSerial('2026-10-29 17:45') % 1) * 1440) * 1e6) / 1e6).toBe(17 * 60 + 45);
    const styles = files.get('xl/styles.xml')!;
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
    expect(styles).toContain('formatCode="yyyy-mm-dd hh:mm"');
    expect(styles).toMatch(/numFmtId="9"/); // 0%
  });

  it('sizes columns to their content, caps very long text and wraps it', () => {
    const long = 'A long description that keeps going well past what fits in a reasonable column width of a spreadsheet';
    const xml = unzip(buildXlsx([sheet({ columns: [{ header: 'Key' }, { header: 'Description', wrap: true }], rows: [['MICO-1', long]] })])).get('xl/worksheets/sheet1.xml')!;
    const widths = [...xml.matchAll(/<col min="(\d+)" max="\d+" width="([\d.]+)" customWidth="1"\/>/g)].map((m) => Number(m[2]));
    expect(widths[0]).toBeGreaterThanOrEqual(8);
    expect(widths[0]).toBeLessThan(15);
    expect(widths[1]).toBe(60);
  });

  it('keeps Arabic text, escapes XML and drops characters XML can’t hold', () => {
    const xml = unzip(buildXlsx([sheet({ rows: [['<b>"Tom & Jerry"</b>\u0001', 1, 10, null], ['مشروع الإطلاق', 2, 20, null]] })])).get('xl/worksheets/sheet1.xml')!;
    expect(xml).toContain('&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;');
    expect(xml).not.toContain('\u0001');
    expect(xml).toContain('مشروع الإطلاق');
  });

  it('makes sheet names valid and unique', () => {
    const wb = unzip(buildXlsx([sheet({ name: 'Q3/Q4: [draft]*?' }), sheet({ name: 'Q3/Q4: [draft]*?' }), sheet({ name: 'A very long sheet name that Excel would refuse' })])).get('xl/workbook.xml')!;
    const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!);
    expect(names[0]).toBe('Q3-Q4- -draft---');
    expect(names[1]).not.toBe(names[0]);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });

  it('says so when a table has no rows', () => {
    const xml = unzip(buildXlsx([sheet({ rows: [] })])).get('xl/worksheets/sheet1.xml')!;
    expect(xml).toContain('No data for the selected filters.');
  });

  it('prints landscape, fitted to the page width, repeating the header row', () => {
    const files = unzip(buildXlsx([sheet()]));
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    expect(files.get('xl/workbook.xml')).toContain(`<definedName name="_xlnm.Print_Titles" localSheetId="0">'Projects'!$1:$1</definedName>`);
  });
});
