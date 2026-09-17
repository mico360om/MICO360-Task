import { describe, it, expect } from 'vitest';
import { toSpreadsheetXml } from './xlsx';

describe('toSpreadsheetXml', () => {
  it('emits a SpreadsheetML workbook with the sheet name and a header row', () => {
    const xml = toSpreadsheetXml('Projects', ['name', 'total'], [{ name: 'MICO', total: 5 }]);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('ss:Name="Projects"');
    expect(xml).toContain('<Data ss:Type="String">name</Data>');
    expect(xml).toContain('<Data ss:Type="String">total</Data>');
  });

  it('types numeric cells as Number and text cells as String', () => {
    const xml = toSpreadsheetXml('S', ['label', 'count'], [{ label: 'done', count: 3 }]);
    expect(xml).toContain('<Data ss:Type="String">done</Data>');
    expect(xml).toContain('<Data ss:Type="Number">3</Data>');
  });

  it('escapes XML-special characters in values', () => {
    const xml = toSpreadsheetXml('S', ['title'], [{ title: 'A & B <c> "d"' }]);
    expect(xml).toContain('<Data ss:Type="String">A &amp; B &lt;c&gt; &quot;d&quot;</Data>');
  });

  it('renders empty cells for null/undefined', () => {
    const xml = toSpreadsheetXml('S', ['a', 'b'], [{ a: null, b: undefined }]);
    expect(xml).toContain('<Data ss:Type="String"></Data>');
  });

  it('produces one Row per record plus the header', () => {
    const xml = toSpreadsheetXml('S', ['x'], [{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect((xml.match(/<Row>/g) ?? []).length).toBe(4); // header + 3 data rows
  });
});
