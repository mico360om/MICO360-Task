import { describe, it, expect } from 'vitest';
import { toCsv, escapeCsvCell, UTF8_BOM } from './csv';

/** Strip the leading BOM for readable content assertions. */
const body = (csv: string) => {
  expect(csv.startsWith(UTF8_BOM)).toBe(true);
  return csv.slice(UTF8_BOM.length);
};

describe('toCsv', () => {
  it('writes a header row from the keys and one row per object', () => {
    const csv = toCsv([
      { name: 'Ada', count: 3 },
      { name: 'Omar', count: 5 },
    ]);
    expect(body(csv)).toBe('name,count\r\nAda,3\r\nOmar,5');
  });

  it('starts with a UTF-8 byte-order mark so Excel decodes Arabic correctly', () => {
    const csv = toCsv([{ projectName: 'مشروع الميزانية', total: 4 }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const bytes = Buffer.from(csv, 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body(csv)).toBe('projectName,total\r\nمشروع الميزانية,4');
  });

  it('can omit the BOM on request', () => {
    expect(toCsv([{ a: 1 }], undefined, { bom: false })).toBe('a\r\n1');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ title: 'Hello, world', note: 'She said "hi"', extra: 'line1\nline2' }]);
    expect(body(csv)).toBe('title,note,extra\r\n"Hello, world","She said ""hi""","line1\nline2"');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = toCsv([{ a: null, b: undefined, c: 0 }]);
    expect(body(csv)).toBe('a,b,c\r\n,,0');
  });

  it('uses an explicit column order when given', () => {
    const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
    expect(body(csv)).toBe('a,b\r\n1,2');
  });

  it('returns an empty string when there are no columns, and just the header for no rows', () => {
    expect(toCsv([])).toBe('');
    expect(body(toCsv([], ['a', 'b']))).toBe('a,b');
  });

  it('neutralises cells that a spreadsheet would evaluate as a formula', () => {
    const csv = toCsv([
      { t: '=HYPERLINK("http://evil.example","click")' },
      { t: '+cmd|\' /C calc\'!A0' },
      { t: '-2+3' },
      { t: '@SUM(A1:A2)' },
      { t: '\t=1+1' },
      { t: '\r=1+1' },
    ]);
    expect(body(csv).split('\r\n').slice(1, 5)).toEqual([
      `"'=HYPERLINK(""http://evil.example"",""click"")"`,
      `'+cmd|' /C calc'!A0`,
      `'-2+3`,
      `'@SUM(A1:A2)`,
    ]);
    expect(escapeCsvCell('\t=1+1')).toBe("'\t=1+1");
    expect(escapeCsvCell('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('leaves real numbers (including negative ones) and ordinary text untouched', () => {
    expect(escapeCsvCell(-5)).toBe('-5');
    expect(escapeCsvCell('-12.5')).toBe('-12.5');
    expect(escapeCsvCell('+3')).toBe('+3');
    expect(escapeCsvCell('Budget = 5')).toBe('Budget = 5');
    expect(escapeCsvCell('خالد البلوشي')).toBe('خالد البلوشي');
    expect(escapeCsvCell(true)).toBe('true');
  });
});
