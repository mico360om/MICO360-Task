/** Serialize a list of flat objects to RFC-4180 CSV (CRLF row separators). */
export function toCsv<T extends object>(rows: readonly T[], columns?: string[]): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0] as object) : []);
  if (cols.length === 0) return '';

  const lines = [cols.map(escapeCell).join(',')];
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    lines.push(cols.map((c) => escapeCell(rec[c])).join(','));
  }
  return lines.join('\r\n');
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
