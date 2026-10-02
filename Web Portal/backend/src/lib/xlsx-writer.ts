/**
 * A dependency-free Excel (.xlsx, Office Open XML) writer for report and task exports.
 *
 * Each sheet is one table: an optional title and notes (merged across the table), then a header
 * row in the brand colour (white bold text), frozen in place with filter buttons, and the rows.
 * Columns are sized to their content (long text is capped and wrapped). Numbers stay numbers,
 * dates are real Excel dates and percentages real percentages, so sorting, filters and formulas
 * work. Sheets print landscape, fitted to the page width, with the header row repeated.
 */
import { deflateRawSync } from 'node:zlib';

/** A cell value. `{ date }` is a calendar day 'YYYY-MM-DD' or a wall-clock time 'YYYY-MM-DD HH:mm'. */
export type XlsxValue = string | number | null | undefined | { date: string };

export type XlsxKind = 'text' | 'integer' | 'number' | 'percent' | 'date' | 'datetime';

export interface XlsxColumn {
  header: string;
  /** How values are stored and shown. 'percent' takes 0–100. Default 'text'. */
  kind?: XlsxKind;
  /** Wrap long text in this column (it is also capped at the maximum width). */
  wrap?: boolean;
}

export interface XlsxSheet {
  name: string;
  /** A heading above the table (row 1). */
  title?: string;
  /** Lines under the title: filters, period, when it was generated. */
  notes?: string[];
  columns: XlsxColumn[];
  rows: XlsxValue[][];
}

export interface XlsxOptions {
  /** Workbook title (file properties). */
  title?: string;
  /** Header fill and title colour, '#RRGGBB'. */
  brand?: string;
}

const MIN_WIDTH = 8;
const MAX_WIDTH = 60;
const MAX_CELL_TEXT = 32_767;
const EMPTY_TEXT = 'No data for the selected filters.';

// Cell style indexes (cellXfs order in styles.xml).
const S = { header: 1, text: 2, wrap: 3, integer: 4, number: 5, percent: 6, date: 7, datetime: 8, title: 9, note: 10 } as const;

/** Drop what XML 1.0 can't hold: control characters (except tab/newline), U+FFFE/U+FFFF, lone surrogates. */
function xmlSafe(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s.slice(i, i + 2);
        i += 1;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += s[i]!;
  }
  return out;
}

const xmlText = (s: string): string =>
  xmlSafe(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Excel column letters: 0 → A, 25 → Z, 26 → AA. */
function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel serial date (days since 1899-12-30) for 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm', as written. */
export function excelSerial(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return ms / 86_400_000 + 25_569;
}

const isDateValue = (v: XlsxValue): v is { date: string } => typeof v === 'object' && v !== null && 'date' in v;

/** Arabic letters and presentation forms. */
const isWideScript = (cp: number): boolean =>
  (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);

/** Rough display width of a value in characters (Excel column width units). */
function displayLength(v: XlsxValue, kind: XlsxKind): number {
  if (v === null || v === undefined || v === '') return 0;
  if (isDateValue(v)) return kind === 'datetime' || v.date.length > 10 ? 16 : 10;
  if (typeof v === 'number') return kind === 'percent' ? 5 : String(Math.round(v * 100) / 100).length;
  let len = 0;
  for (const line of String(v).split('\n')) {
    let l = 0;
    // Arabic and other wide scripts take a little more room than Latin in Calibri.
    for (const ch of line) l += isWideScript(ch.codePointAt(0)!) ? 1.15 : 1;
    len = Math.max(len, l);
  }
  return len;
}

function sheetNames(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((name) => {
    let base = name.replace(/[\\/?*[\]:]/g, '-').replace(/^'+|'+$/g, '').trim() || 'Sheet';
    base = base.slice(0, 31);
    let candidate = base;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

const quoteSheet = (name: string): string => `'${name.replace(/'/g, "''")}'`;

interface SheetLayout {
  xml: string;
  headerRow: number;
  lastRow: number;
  lastCol: string;
}

function sheetXml(sheet: XlsxSheet, first: boolean): SheetLayout {
  const cols = sheet.columns.length ? sheet.columns : [{ header: '' }];
  const n = cols.length;
  const lastCol = colName(n - 1);
  const kinds = cols.map((c) => c.kind ?? 'text');
  const rowsXml: string[] = [];
  const merges: string[] = [];
  let r = 0;

  const textCell = (ref: string, style: number, text: string) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text.slice(0, MAX_CELL_TEXT))}</t></is></c>`;
  const mergedLine = (text: string, style: number, height?: number) => {
    r += 1;
    rowsXml.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ''}>${textCell(`A${r}`, style, text)}</row>`);
    if (n > 1) merges.push(`A${r}:${lastCol}${r}`);
  };

  if (sheet.title) mergedLine(sheet.title, S.title, 24);
  for (const note of sheet.notes ?? []) mergedLine(note, S.note);
  if (sheet.title || sheet.notes?.length) {
    r += 1;
    rowsXml.push(`<row r="${r}"/>`);
  }

  // Header row.
  r += 1;
  const headerRow = r;
  rowsXml.push(`<row r="${r}">${cols.map((c, i) => textCell(`${colName(i)}${r}`, S.header, c.header)).join('')}</row>`);

  // Column widths from the header (plus room for the filter button) and the content.
  const widths = cols.map((c) => c.header.length + 4);
  const wrapCol = cols.map((c) => Boolean(c.wrap));

  const styleFor = (kind: XlsxKind, ci: number): number =>
    kind === 'integer' ? S.integer : kind === 'number' ? S.number : kind === 'percent' ? S.percent : kind === 'date' ? S.date : kind === 'datetime' ? S.datetime : wrapCol[ci] ? S.wrap : S.text;

  const body = sheet.rows;
  for (const row of body) {
    for (let ci = 0; ci < n; ci++) {
      const len = displayLength(row[ci], kinds[ci]!);
      widths[ci] = Math.max(widths[ci]!, len + 2);
      if (kinds[ci] === 'text' && len > MAX_WIDTH) wrapCol[ci] = true;
    }
  }
  for (const row of body) {
    r += 1;
    const cells: string[] = [];
    for (let ci = 0; ci < n; ci++) {
      const ref = `${colName(ci)}${r}`;
      const v = row[ci];
      const kind = kinds[ci]!;
      const style = styleFor(kind, ci);
      if (v === null || v === undefined || v === '') {
        cells.push(`<c r="${ref}" s="${style}"/>`);
      } else if (isDateValue(v)) {
        const serial = excelSerial(v.date);
        if (Number.isNaN(serial)) cells.push(textCell(ref, S.text, v.date));
        else cells.push(`<c r="${ref}" s="${v.date.length > 10 ? S.datetime : style === S.datetime ? S.datetime : S.date}"><v>${serial}</v></c>`);
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        cells.push(`<c r="${ref}" s="${style}"><v>${kind === 'percent' ? Math.round(v * 100) / 10000 : v}</v></c>`);
      } else {
        cells.push(textCell(ref, wrapCol[ci] ? S.wrap : S.text, String(v)));
      }
    }
    rowsXml.push(`<row r="${r}">${cells.join('')}</row>`);
  }
  if (body.length === 0) {
    r += 1;
    rowsXml.push(`<row r="${r}">${textCell(`A${r}`, S.note, EMPTY_TEXT)}</row>`);
  }
  const lastRow = r;

  const colsXml = widths
    .map((w, i) => {
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, kinds[i] === 'date' ? Math.max(w, 12) : kinds[i] === 'datetime' ? Math.max(w, 17) : w));
      return `<col min="${i + 1}" max="${i + 1}" width="${Math.round(width * 100) / 100}" customWidth="1"/>`;
    })
    .join('');

  const topLeft = `A${headerRow + 1}`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}>` +
    `<pane ySplit="${headerRow}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colsXml}</cols>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`;
  return { xml, headerRow, lastRow, lastCol };
}

function stylesXml(brand: string): string {
  const fill = `FF${brand}`;
  const border = '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>';
  const xf = (numFmt: number, font: number, fillId: number, borderId: number, align: string) =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment ${align}/></xf>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>` +
    `<fonts count="4">` +
    `<font><sz val="11"/><color rgb="FF1C1A17"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="15"/><color rgb="${fill}"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><i/><sz val="10"/><color rgb="FF6B6661"/><name val="Calibri"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${fill}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="11">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    xf(0, 1, 2, 1, 'vertical="center" wrapText="1"') + // header
    xf(0, 0, 0, 1, 'vertical="top"') + // text
    xf(0, 0, 0, 1, 'vertical="top" wrapText="1"') + // wrapped text
    xf(1, 0, 0, 1, 'vertical="top"') + // integer
    xf(0, 0, 0, 1, 'vertical="top"') + // number
    xf(9, 0, 0, 1, 'vertical="top"') + // percent
    xf(164, 0, 0, 1, 'vertical="top" horizontal="left"') + // date
    xf(165, 0, 0, 1, 'vertical="top" horizontal="left"') + // date + time
    xf(0, 2, 0, 0, 'vertical="center"') + // title
    xf(0, 3, 0, 0, 'vertical="top"') + // note
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

// ---------------------------------------------------------------------------
// ZIP container (deflate + CRC-32), enough for an Office package.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries: { name: string; data: Buffer }[], when: Date): Buffer {
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const dosDate = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const deflated = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, deflated);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Build an .xlsx workbook with one sheet per table. */
export function buildXlsx(sheets: XlsxSheet[], opts: XlsxOptions = {}, now: Date = new Date()): Buffer {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }];
  const names = sheetNames(list.map((s) => s.name));
  const brand = /^#?([0-9a-f]{6})$/i.exec(opts.brand ?? '#8B1E1E')?.[1]?.toUpperCase() ?? '8B1E1E';
  const layouts = list.map((s, i) => sheetXml(s, i === 0));

  const definedNames = layouts
    .flatMap((l, i) => [
      `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(quoteSheet(names[i]!))}!$A$${l.headerRow}:$${l.lastCol}$${l.lastRow}</definedName>`,
      `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xmlText(quoteSheet(names[i]!))}!$${l.headerRow}:$${l.headerRow}</definedName>`,
    ])
    .join('');

  const files: { name: string; data: string }[] = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        layouts.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        (opts.title ? `<dc:title>${xmlText(opts.title)}</dc:title>` : '') +
        `<dc:creator>MICO360 Tasks</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MICO360 Tasks</Application></Properties>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
        names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets><definedNames>${definedNames}</definedNames></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        layouts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${layouts.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: stylesXml(brand) },
    ...layouts.map((l, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: l.xml })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })), now);
}

/** The MIME type to send an .xlsx file with. */
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
