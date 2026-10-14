import { describe, it, expect } from 'vitest';
import { fileKind } from './file-kind';

describe('fileKind (icon and preview for an attachment)', () => {
  it('knows pictures, PDFs, sheets, documents, slides, archives and text', () => {
    expect(fileKind('image/png', 'a.png')).toBe('image');
    expect(fileKind('application/pdf', 'a.pdf')).toBe('pdf');
    expect(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toBe('sheet');
    expect(fileKind('text/csv', 'a.csv')).toBe('sheet');
    expect(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('doc');
    expect(fileKind('application/vnd.ms-powerpoint', 'a.ppt')).toBe('slides');
    expect(fileKind('application/zip', 'a.zip')).toBe('archive');
    expect(fileKind('text/plain', 'a.txt')).toBe('text');
  });
  it('falls back to the file name, then to "other"', () => {
    expect(fileKind('application/octet-stream', 'photo.JPG')).toBe('image');
    expect(fileKind('', 'notes.docx')).toBe('doc');
    expect(fileKind('application/octet-stream', 'blob.bin')).toBe('other');
  });
  it('never treats an SVG as a picture to show inline (it can carry script)', () => {
    expect(fileKind('image/svg+xml', 'logo.svg')).toBe('other');
  });
});
