import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { PdfDocument } from './pdf-document';
import { buildXlsx } from './xlsx-writer';
import { FILE_TEXT_MAX_CHARS, letterCount, readFileText } from './file-text';

/** A minimal zip (stored or deflated parts), enough for an Office package. */
function zip(parts: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('readFileText', () => {
  it('reads a text PDF', () => {
    const pdf = new PdfDocument().text('Method statement for the crane lift').build();
    const out = readFileText(pdf, { filename: 'method.pdf', mimeType: 'application/pdf' });
    expect(out.status).toBe('READ');
    expect(out.method).toBe('pdf');
    expect(out.text).toContain('Method statement for the crane lift');
  });

  it('says a PDF with (almost) no text needs OCR, with its page pictures', () => {
    const out = readFileText(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'), { filename: 'scan.pdf', mimeType: 'application/pdf' });
    expect(out.status).toBe('NEEDS_OCR');
    expect(out.images).toEqual([]);
  });

  it('reads Word paragraphs, every sheet’s cells and every slide', () => {
    const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Permit to work</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Isolation &amp; lock-out</w:t></w:r></w:p></w:body></w:document>' });
    expect(readFileText(docx, { filename: 'ptw.docx', mimeType: DOCX })).toMatchObject({ status: 'READ', method: 'office', text: 'Permit to work\nIsolation & lock-out' });

    const xlsx = buildXlsx([{ name: 'Valves', columns: [{ header: 'Tag' }, { header: 'Size' }], rows: [['V-101', '6 inch'], ['V-102', '8 inch']] }]);
    const sheet = readFileText(xlsx, { filename: 'valves.xlsx', mimeType: XLSX });
    expect(sheet.status).toBe('READ');
    expect(sheet.text).toContain('Valves');
    expect(sheet.text).toContain('V-102 8 inch');

    const pptx = zip({ 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Toolbox talk</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Working at height</a:t></a:r></a:p></p:sld>' });
    expect(readFileText(pptx, { filename: 'talk.pptx', mimeType: PPTX }).text).toBe('Toolbox talk\nWorking at height');
  });

  it('reads plain text, CSV and Markdown (UTF-8, with or without a byte-order mark; UTF-16 too)', () => {
    expect(readFileText(Buffer.from('﻿Generator log — 3 Nov', 'utf8'), { filename: 'log.txt', mimeType: 'text/plain' }).text).toBe('Generator log — 3 Nov');
    expect(readFileText(Buffer.from('tag,size\nV-101,6"', 'utf8'), { filename: 'v.csv', mimeType: 'text/csv' })).toMatchObject({ status: 'READ', method: 'text' });
    expect(readFileText(Buffer.from('# Notes\nسلامة', 'utf8'), { filename: 'n.md', mimeType: 'text/plain' }).text).toContain('سلامة');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Pump curve', 'utf16le')]);
    expect(readFileText(utf16, { filename: 'p.txt', mimeType: 'text/plain' }).text).toBe('Pump curve');
  });

  it('sends pictures to OCR and skips files with no text (zip, unknown)', () => {
    expect(readFileText(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { filename: 'site.jpg', mimeType: 'image/jpeg' })).toMatchObject({ status: 'NEEDS_OCR', method: null });
    expect(readFileText(Buffer.from('PK'), { filename: 'all.zip', mimeType: 'application/zip' }).status).toBe('SKIPPED');
  });

  it('a damaged Office file is a failure, never a throw', () => {
    expect(readFileText(Buffer.from('not a zip'), { filename: 'bad.docx', mimeType: DOCX }).status).toBe('FAILED');
  });

  it('keeps at most FILE_TEXT_MAX_CHARS characters', () => {
    const big = readFileText(Buffer.from('word '.repeat(80_000)), { filename: 'big.txt', mimeType: 'text/plain' });
    expect(big.text.length).toBeLessThanOrEqual(FILE_TEXT_MAX_CHARS);
    expect(big.truncated).toBe(true);
  });

  it('counts letters (any script), not digits or marks', () => {
    expect(letterCount('Page 1 of 2 — سلامة')).toBe(11);
  });
});
