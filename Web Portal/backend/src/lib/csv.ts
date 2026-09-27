/**
 * UTF-8 byte-order mark. Excel on Windows only decodes a CSV as UTF-8 when the file
 * starts with it; without it Arabic (and any non-Latin) text opens as mojibake.
 */
export const UTF8_BOM = String.fromCharCode(0xfeff);

export interface CsvOptions {
  /** Prefix the output with a UTF-8 BOM (default true). */
  bom?: boolean;
}

/**
 * Serialize a list of flat objects to RFC-4180 CSV (CRLF row separators), prefixed with
 * a UTF-8 BOM so spreadsheet apps read Arabic correctly. Cells that a spreadsheet would
 * run as a formula are neutralised (see `escapeCsvCell`).
 */
export function toCsv<T extends object>(rows: readonly T[], columns?: string[], options: CsvOptions = {}): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0] as object) : []);
  if (cols.length === 0) return '';

  const lines = [cols.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    lines.push(cols.map((c) => escapeCsvCell(rec[c])).join(','));
  }
  return (options.bom === false ? '' : UTF8_BOM) + lines.join('\r\n');
}

/** Characters that make Excel/LibreOffice/Sheets treat a cell as a formula (OWASP "CSV injection"). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** A plain signed number ("-5", "+3.2", "-1e3") is data, not a formula — leave it numeric. */
const PLAIN_NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;

/**
 * One CSV cell: null/undefined → empty; text starting with = + - @ TAB or CR gets a
 * leading apostrophe so it is shown as text instead of being evaluated (a title like
 * `=HYPERLINK(...)` stays inert); values with commas, quotes or line breaks are quoted.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  const isNumber = typeof value === 'number' || typeof value === 'bigint';
  if (!isNumber && FORMULA_LEAD.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
