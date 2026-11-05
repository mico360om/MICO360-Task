import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import PDFKit from 'pdfkit';
import { PdfDocument } from './pdf-document';
import { fontData } from './pdf-text';
import { readPdfText, visualToLogical } from './pdf-read-text';

/** A PDF from objects (bodies without "n 0 obj"), with a correct xref, as a small hand-made file. */
function handMade(objects: (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(at);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    at += b.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

const stream = (dict: string, data: Buffer | string, flate = false): Buffer => {
  const raw = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
  const body = flate ? deflateSync(raw) : raw;
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${body.length}${flate ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream', 'latin1')]);
};

/** One page whose content stream is `content`, with Helvetica as /F1. */
function onePage(content: string, opts: { flate?: boolean } = {}): Buffer {
  return handMade([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    stream('', content, opts.flate),
  ]);
}

const pdfkitBuffer = (draw: (doc: PDFKit.PDFDocument) => void, opts: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFKit({ compress: true, ...opts });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });

describe('readPdfText', () => {
  it('reads Tj, TJ, quote operators and line moves from a plain page', () => {
    const pdf = onePage('BT /F1 12 Tf 72 700 Td (Scaffold inspection) Tj 0 -14 Td [(Hot ) -40 (work) -300 (permit)] TJ T* (Rig 3) Tj (next line) \' ET');
    const { text, pages } = readPdfText(pdf);
    expect(pages).toBe(1);
    expect(text).toContain('Scaffold inspection');
    expect(text).toContain('Hot work permit');
    expect(text).toMatch(/Rig 3\s+next line/);
  });

  it('decodes escapes in literal strings and hex strings', () => {
    const pdf = onePage('BT /F1 12 Tf (Caf\\351 \\(main\\) gate) Tj <4F696C2077656C6C> Tj ET');
    const { text } = readPdfText(pdf);
    expect(text).toContain('Café (main) gate');
    expect(text).toContain('Oil well');
  });

  it('inflates compressed content streams', () => {
    expect(readPdfText(onePage('BT /F1 12 Tf (Compressed generator report) Tj ET', { flate: true })).text).toContain('Compressed generator report');
  });

  it('reads a pdfkit page in a standard font (WinAnsi hex strings)', async () => {
    const pdf = await pdfkitBuffer((doc) => {
      doc.font('Helvetica').fontSize(12).text('Pressure test of the riser');
      doc.addPage().text('Second page: valve replacement');
    });
    const { text, pages } = readPdfText(pdf);
    expect(pages).toBe(2);
    expect(text).toContain('Pressure test of the riser');
    expect(text).toContain('Second page: valve replacement');
  });

  it('maps an embedded font’s glyphs back to text through its ToUnicode map (Arabic too)', async () => {
    const pdf = await pdfkitBuffer((doc) => {
      doc.registerFont('plex', fontData('latin'));
      doc.registerFont('naskh', fontData('arabic'));
      doc.font('plex').fontSize(12).text('Electrical isolation certificate');
      doc.font('naskh').text('سلامة');
    });
    const { text } = readPdfText(pdf);
    expect(text).toContain('Electrical isolation certificate'); // the "fi" ligature is two letters again
    // Arabic drawn in visual order comes back in reading order, as its letters.
    expect(text.normalize('NFKC')).toContain('سلامة');
  });

  it('puts right-to-left lines drawn in visual order back in reading order', () => {
    expect(visualToLogical([...'ةمالس'])).toBe('سلامة');
    // A right-to-left line: read from its right end, a number inside kept as written.
    expect(visualToLogical([...'ريرقت 12 مقر'])).toBe('رقم 12 تقرير');
    // A left-to-right line keeps its order; an Arabic word inside is read from its right end.
    expect(visualToLogical([...'Pump ةخضم check'])).toBe('Pump مضخة check');
    expect(visualToLogical([...'Plain English'])).toBe('Plain English');
    // A ligature glyph's own letters stay in order.
    expect(visualToLogical(['ة', 'لا', 'ص'])).toBe('صلاة');
  });

  it('prefers each line’s ActualText (the site’s own PDFs: Arabic in reading order)', () => {
    const doc = new PdfDocument();
    doc.text('Minutes of the safety meeting').text('مرحبا بكم في الاجتماع');
    const { text } = readPdfText(doc.build());
    expect(text).toContain('Minutes of the safety meeting');
    expect(text).toContain('مرحبا بكم في الاجتماع');
  });

  it('reads objects packed in an object stream (the font there, its ToUnicode outside)', () => {
    expect(readPdfText(handMadeObjStm()).text).toContain('Pumno');
  });

  it('finds the JPEG pictures of a scanned page (for OCR) and reports no text', async () => {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 250, g: 250, b: 250 } } }).jpeg().toBuffer();
    const pdf = await pdfkitBuffer((doc) => {
      doc.image(jpeg, 0, 0, { width: 595 });
    });
    const out = readPdfText(pdf);
    expect(out.text.trim()).toBe('');
    expect(out.images).toHaveLength(1);
    expect(out.images[0]!.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('stops at the text cap and says it was cut', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `(Line number ${i} of the long report) Tj T*`).join(' ');
    const out = readPdfText(onePage(`BT /F1 10 Tf 12 TL ${lines} ET`), { maxChars: 500 });
    expect(out.text.length).toBeLessThanOrEqual(500);
    expect(out.truncated).toBe(true);
  });

  it('never throws on damaged or hostile input, and stops on time', () => {
    for (const bad of [Buffer.alloc(0), Buffer.from('not a pdf'), Buffer.from('%PDF-1.4\n1 0 obj << /Length 999999 >> stream\nxx'), Buffer.from('%PDF-1.7\n' + '[[[['.repeat(5000))]) {
      expect(() => readPdfText(bad)).not.toThrow();
    }
    let t = 0;
    const out = readPdfText(onePage('BT /F1 12 Tf (Slow) Tj ET'), { timeLimitMs: 5, now: () => (t += 10) });
    expect(out.truncated).toBe(true);
  });
});

// Security review (1.23): a 16 KB PDF whose one stream unpacks to 16 MB — ASCII85 "z"s, one long literal
// string, one long array, an object stream's header of numbers — grew a JS array per byte and ran the
// reader out of memory (taking its whole process down). Each is now read within a small memory: the
// real reader, in a Node of its own with a 128 MB heap.
describe('readPdfText within a small memory', () => {
  const runner = join(mkdtempSync(join(tmpdir(), 'pdf-heap-')), 'run.ts');
  writeFileSync(
    runner,
    [
      `import { deflateSync } from 'node:zlib';`,
      `import { readPdfText } from ${JSON.stringify(pathToFileURL(join(__dirname, 'pdf-read-text.ts')).href)};`,
      `const MB = 1024 * 1024;`,
      `const kind = process.argv[2];`,
      `const page = (body: Buffer, filters: string) => Buffer.concat([`,
      "  Buffer.from(`%PDF-1.4\\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n2 0 obj << /Type /Pages /Kids [3 0 R] >> endobj\\n3 0 obj << /Type /Page /Contents 4 0 R >> endobj\\n4 0 obj << /Filter ${filters} /Length ${body.length} >>\\nstream\\n`, 'latin1'),",
      `  body, Buffer.from('\\nendstream\\nendobj\\n%%EOF', 'latin1')]);`,
      `let pdf: Buffer;`,
      `if (kind === 'a85') pdf = page(deflateSync(Buffer.alloc(16 * MB - 64, 0x7a)), '[/FlateDecode /ASCII85Decode]');`,
      `else if (kind === 'literal') pdf = page(deflateSync(Buffer.concat([Buffer.from('BT ('), Buffer.alloc(15 * MB, 0x41), Buffer.from(') Tj ET')])), '/FlateDecode');`,
      `else if (kind === 'array') pdf = page(deflateSync(Buffer.concat([Buffer.from('BT ['), Buffer.alloc(15 * MB, '0 '), Buffer.from('] TJ ET')])), '/FlateDecode');`,
      `else {`,
      `  const head = Buffer.alloc(15 * MB, '1 ');`,
      "  const objStm = deflateSync(Buffer.concat([head, Buffer.from('<< >>')]));",
      "  pdf = Buffer.concat([Buffer.from(`%PDF-1.5\\n1 0 obj << /Type /ObjStm /N 9999999 /First ${head.length} /Filter /FlateDecode /Length ${objStm.length} >>\\nstream\\n`, 'latin1'), objStm, Buffer.from('\\nendstream\\nendobj\\n%%EOF', 'latin1')]);",
      `}`,
      `const out = readPdfText(pdf, { timeLimitMs: 20_000 });`,
      `console.log(JSON.stringify({ bytes: pdf.length, chars: out.text.length }));`,
    ].join('\n'),
  );
  const backend = join(__dirname, '..', '..');

  it.each(['a85', 'literal', 'array', 'objstm'])('a hostile PDF (%s) is read without running out of memory', (kind) => {
    const r = spawnSync(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', runner, kind], { cwd: backend, encoding: 'utf8', timeout: 60_000 });
    expect(r.status, `${kind}: ${(r.stderr || '').split('\n').find((l) => /FATAL|Error/.test(l)) ?? r.stderr?.slice(0, 300)}`).toBe(0);
    const out = JSON.parse(r.stdout.trim().split('\n').pop()!) as { bytes: number; chars: number };
    expect(out.bytes).toBeLessThan(40_000);
  }, 70_000);
});

/** A page whose font (object 7) is packed in an object stream (4); its ToUnicode map (6) is a plain stream. */
function handMadeObjStm(): Buffer {
  const cmap = 'begincmap 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <0050> <02> <0075> endbfchar 1 beginbfrange <03> <05> <006D> endbfrange endcmap';
  const fontBody = '<< /Type /Font /Subtype /Type1 /BaseFont /Custom /ToUnicode 6 0 R >>';
  const header = '7 0 ';
  return handMade([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F9 7 0 R >> >> /Contents 5 0 R >>',
    stream(`/Type /ObjStm /N 1 /First ${header.length}`, header + fontBody, true),
    stream('', 'BT /F9 10 Tf <0102030405> Tj ET'),
    stream('', cmap),
  ]);
}
