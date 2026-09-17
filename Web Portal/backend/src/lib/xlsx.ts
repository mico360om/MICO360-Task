function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cell(value: unknown): string {
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const type = isNumber ? 'Number' : 'String';
  return `<Cell><Data ss:Type="${type}">${isNumber ? value : escapeXml(value)}</Data></Cell>`;
}

function row(cells: string[]): string {
  return `<Row>${cells.join('')}</Row>`;
}

/**
 * Serialize rows to a SpreadsheetML 2003 (.xls) XML workbook — a single XML file
 * (no zip, no dependency) that Excel and LibreOffice open natively.
 */
export function toSpreadsheetXml(sheetName: string, columns: string[], rows: Record<string, unknown>[]): string {
  const header = row(columns.map((c) => cell(c)));
  const body = rows.map((r) => row(columns.map((c) => cell(r[c])))).join('');
  return (
    '<?xml version="1.0"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${header}${body}</Table></Worksheet>\n` +
    '</Workbook>'
  );
}
