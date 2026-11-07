import { describe, it, expect } from 'vitest';
import { createAttachmentService } from './attachment-service';
import { safeUploadName } from '../../lib/upload-safety';
import type { AttachmentRecord, AttachmentRepository, AttachmentStorage } from './attachment-repository';

// 1.23.7 (security review): an uploaded file's name can't hide what it is (bidi and control characters
// go), always fits the column, and a client's upload carries the extension of the type it was checked as —
// "invoice.exe" declared as text/plain is kept as "invoice.exe.txt", never saved to disk as an .exe.
describe('a file’s name, as kept', () => {
  it('drops control and direction characters, and path separators', () => {
    expect(safeUploadName('invoice\u202Efdp.exe', 'text/plain')).toBe('invoicefdp.exe');
    expect(safeUploadName('a\u0000b\u200Fc\u2066d\uFEFF.pdf', 'application/pdf')).toBe('abcd.pdf');
    expect(safeUploadName(String.raw`..\..\etc/passwd.txt`, 'text/plain')).toBe('.._.._etc_passwd.txt');
    expect(safeUploadName('   ', 'application/pdf')).toBe('file.pdf');
  });

  it('fits 180 characters, keeping its extension', () => {
    const long = `${'r'.repeat(400)}.pdf`;
    const kept = safeUploadName(long, 'application/pdf');
    expect(kept.length).toBeLessThanOrEqual(180);
    expect(kept.endsWith('.pdf')).toBe(true);
    expect(safeUploadName(`تقرير ${'م'.repeat(300)}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').length).toBeLessThanOrEqual(180);
  });

  it('for a client: the extension must be the checked type’s, else the type’s is added', () => {
    const client = { client: true };
    expect(safeUploadName('invoice.exe', 'text/plain', client)).toBe('invoice.exe.txt');
    expect(safeUploadName('run.hta', 'text/csv', client)).toBe('run.hta.csv');
    expect(safeUploadName('notes', 'text/plain', client)).toBe('notes.txt');
    expect(safeUploadName('photo.JPEG', 'image/jpeg', client)).toBe('photo.JPEG');
    expect(safeUploadName('report.pdf', 'application/pdf', client)).toBe('report.pdf');
    expect(safeUploadName('plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', client)).toBe('plan.docx');
    // Staff names are cleaned but keep their own extension (nothing changes for the team).
    expect(safeUploadName('notes.md', 'text/plain')).toBe('notes.md');
  });
});

describe('an upload whose row can’t be saved', () => {
  it('leaves no bytes behind on disk', async () => {
    const removed: string[] = [];
    const repo: AttachmentRepository = {
      async create() { throw new Error('Data too long for column'); },
      async list() { return []; },
      async findById() { return null; },
      async delete() {},
    };
    const storage: AttachmentStorage = {
      async save(f) { return { storageKey: 'k1.txt', url: '/uploads/k1.txt', sizeBytes: f.content.length }; },
      async remove(key) { removed.push(key); },
    };
    const svc = createAttachmentService({ repo, storage, taskLookup: { async exists() { return true; } }, maxSizeBytes: 100, allowedMimeTypes: [] });
    await expect(svc.upload('t1', 'u1', { filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('hi') })).rejects.toThrow(/too long/);
    expect(removed).toEqual(['k1.txt']);
  });

  it('stores the cleaned name; a client’s with the checked type’s extension', async () => {
    const rows: AttachmentRecord[] = [];
    const repo: AttachmentRepository = {
      async create(d) { const r = { id: 'a1', createdAt: new Date(), ...d }; rows.push(r); return r; },
      async list() { return []; },
      async findById() { return null; },
      async delete() {},
    };
    const storage: AttachmentStorage = { async save(f) { return { storageKey: 'k', url: '/uploads/k', sizeBytes: f.content.length }; }, async remove() {} };
    const svc = createAttachmentService({ repo, storage, taskLookup: { async exists() { return true; } }, maxSizeBytes: 100, allowedMimeTypes: [] });
    await svc.upload('t1', 'c1', { filename: 'invoice\u202Efdp.exe', mimeType: 'text/plain', content: Buffer.from('hi') }, { fromClient: true });
    await svc.upload('t1', 'u1', { filename: 'notes.md', mimeType: 'text/plain', content: Buffer.from('hi') });
    expect(rows.map((r) => r.filename)).toEqual(['invoicefdp.exe.txt', 'notes.md']);
  });
});
