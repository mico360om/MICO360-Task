export interface PdfTable {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Escape a string for a PDF text literal, dropping non-ASCII (keeps byte offsets == char offsets). */
function escapePdfText(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Build a minimal, valid single-page PDF (uncompressed Helvetica text) listing a
 * report's rows. No dependency — the cross-reference offsets are computed from the
 * actual serialized bytes. Suitable for small tabular reports.
 */
export function toSimplePdf({ title, columns, rows }: PdfTable): Buffer {
  const sep = '   |   ';
  const lines: string[] = [title, '', columns.join(sep), ...rows.map((r) => columns.map((c) => cellText(r[c])).join(sep))];

  const leading = 16;
  const stream = [
    'BT',
    '/F1 11 Tf',
    `${leading} TL`,
    '50 740 Td',
    ...lines.flatMap((ln, i) => (i < lines.length - 1 ? [`(${escapePdfText(ln)}) Tj`, 'T*'] : [`(${escapePdfText(ln)}) Tj`])),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  const size = objects.length + 1;
  pdf += `xref\n0 ${size}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
