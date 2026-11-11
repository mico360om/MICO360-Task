import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkTrainingUpload, createTrainingFileStore, trainingFileHeaders, trainingFilesDirFor, TRAINING_FILE_TYPES } from './training-files';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.7\n%…', 'utf8');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const MB = 1024 * 1024;

describe('training files folder', () => {
  it('is beside the uploads folder, never inside it (TRAINING_FILES_DIR wins when set)', () => {
    const cwd = resolve('/srv/app');
    expect(trainingFilesDirFor({ UPLOAD_DIR: 'uploads', TRAINING_FILES_DIR: '' }, cwd)).toBe(resolve('/srv/app/training-files'));
    expect(trainingFilesDirFor({ UPLOAD_DIR: '../data/uploads', TRAINING_FILES_DIR: '' }, cwd)).toBe(resolve('/srv/data/training-files'));
    expect(trainingFilesDirFor({ UPLOAD_DIR: 'uploads', TRAINING_FILES_DIR: ' /private/tf ' }, cwd)).toBe(resolve('/private/tf'));
    expect(trainingFilesDirFor({ UPLOAD_DIR: 'uploads' }, cwd)).toBe(resolve('/srv/app/training-files'));
  });

  it('M13: compares whole folder names — a folder that merely starts with “..” is still inside', () => {
    const cwd = resolve('/srv/app');
    expect(() => trainingFilesDirFor({ UPLOAD_DIR: 'uploads', TRAINING_FILES_DIR: 'uploads/..training' }, cwd)).toThrow(/uploads/);
    expect(trainingFilesDirFor({ UPLOAD_DIR: 'uploads', TRAINING_FILES_DIR: 'uploads-private' }, cwd)).toBe(resolve('/srv/app/uploads-private'));
  });

  it('M13: never inside the web app folder either (WEB_ROOT, served to anyone)', () => {
    const cwd = resolve('/srv/app');
    expect(() => trainingFilesDirFor({ UPLOAD_DIR: '../data/uploads', TRAINING_FILES_DIR: 'web/files', WEB_ROOT: 'web' }, cwd)).toThrow(/web app/);
    expect(() => trainingFilesDirFor({ UPLOAD_DIR: 'web/uploads', TRAINING_FILES_DIR: '', WEB_ROOT: 'web' }, cwd)).toThrow(/web app/);
    expect(trainingFilesDirFor({ UPLOAD_DIR: '../data/uploads', TRAINING_FILES_DIR: '', WEB_ROOT: 'web' }, cwd)).toBe(resolve('/srv/data/training-files'));
  });

  it('refuses a TRAINING_FILES_DIR inside the public uploads folder (it would be public)', () => {
    const cwd = resolve('/srv/app');
    expect(() => trainingFilesDirFor({ UPLOAD_DIR: 'uploads', TRAINING_FILES_DIR: 'uploads/training' }, cwd)).toThrow(/uploads/);
  });
});

describe('training uploads: types, sizes and contents', () => {
  it('takes PDFs, pictures, Office files, text, CSV and zip; nothing else', () => {
    expect(TRAINING_FILE_TYPES).toEqual(
      expect.arrayContaining([
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
        'application/zip',
      ]),
    );
    expect(checkTrainingUpload({ filename: 'a.pdf', mimeType: 'application/pdf', content: PDF }, 'DOCUMENT')).toEqual({ mimeType: 'application/pdf', name: 'a.pdf' });
    expect(() => checkTrainingUpload({ filename: 'a.html', mimeType: 'text/html', content: Buffer.from('<p>') }, 'RESOURCE')).toThrow(/can’t be attached/);
    expect(() => checkTrainingUpload({ filename: 'a.svg', mimeType: 'image/svg+xml', content: Buffer.from('<svg/>') }, 'IMAGE')).toThrow(/can’t be attached/);
  });

  it('checks the bytes: a renamed file is refused; Office files must be zip files', () => {
    expect(() => checkTrainingUpload({ filename: 'a.pdf', mimeType: 'application/pdf', content: PNG }, 'DOCUMENT')).toThrow(/isn’t really/);
    expect(() => checkTrainingUpload({ filename: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: PDF }, 'RESOURCE')).toThrow(/isn’t really/);
    expect(checkTrainingUpload({ filename: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: ZIP }, 'RESOURCE').mimeType).toContain('wordprocessingml');
    // Text with a NUL byte is not text.
    expect(() => checkTrainingUpload({ filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from([0x61, 0, 0x62]) }, 'RESOURCE')).toThrow(/isn’t really/);
    expect(() => checkTrainingUpload({ filename: 'a.txt', mimeType: 'text/plain', content: Buffer.alloc(0) }, 'RESOURCE')).toThrow(/empty/);
  });

  it('pictures only where a picture is asked for (a guide step, a signature)', () => {
    expect(checkTrainingUpload({ filename: 'p.png', mimeType: 'image/png', content: PNG }, 'IMAGE').mimeType).toBe('image/png');
    expect(checkTrainingUpload({ filename: 's.png', mimeType: 'image/png', content: PNG }, 'SIGNATURE').mimeType).toBe('image/png');
    expect(() => checkTrainingUpload({ filename: 'a.pdf', mimeType: 'application/pdf', content: PDF }, 'IMAGE')).toThrow(/picture/);
    expect(() => checkTrainingUpload({ filename: 'a.zip', mimeType: 'application/zip', content: ZIP }, 'SIGNATURE')).toThrow(/picture/);
  });

  it('documents and downloads up to 25 MB, pictures up to 10 MB', () => {
    const big = (n: number, head: Buffer) => Buffer.concat([head, Buffer.alloc(n - head.length)]);
    expect(checkTrainingUpload({ filename: 'a.pdf', mimeType: 'application/pdf', content: big(20 * MB, PDF) }, 'DOCUMENT').mimeType).toBe('application/pdf');
    expect(() => checkTrainingUpload({ filename: 'a.pdf', mimeType: 'application/pdf', content: big(25 * MB + 1, PDF) }, 'DOCUMENT')).toThrow(/25 MB/);
    expect(() => checkTrainingUpload({ filename: 'p.png', mimeType: 'image/png', content: big(10 * MB + 1, PNG) }, 'IMAGE')).toThrow(/10 MB/);
  });

  it('keeps a clean name (no hidden characters, no folders, fits the column)', () => {
    const out = checkTrainingUpload({ filename: 'C:\\x\\in\u202evoice.pdf', mimeType: 'application/pdf', content: PDF }, 'DOCUMENT');
    expect(out.name).toBe('C:_x_invoice.pdf');
    expect([...checkTrainingUpload({ filename: `${'a'.repeat(300)}.pdf`, mimeType: 'application/pdf', content: PDF }, 'DOCUMENT').name].length).toBeLessThanOrEqual(180);
  });
});

describe('the private file store', () => {
  it('saves under a random key with the checked type’s extension, reads it back, removes it', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'tf-')), 'training-files');
    const store = createTrainingFileStore(dir);
    const key = await store.save(PDF, 'application/pdf');
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect((await store.read(key)).equals(PDF)).toBe(true);
    // A key can never leave the folder.
    await expect(store.read('../secret.txt')).rejects.toThrow();
    await store.remove(key);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('the reply headers', () => {
  it('pictures and PDFs open in the browser; everything else downloads; never sniffed or cached', () => {
    const png = trainingFileHeaders({ name: 'step 1.png', mimeType: 'image/png' });
    expect(png['Content-Type']).toBe('image/png');
    expect(png['Content-Disposition']).toMatch(/^inline; filename="step 1.png"/);
    expect(png['X-Content-Type-Options']).toBe('nosniff');
    expect(png['Content-Security-Policy']).toBe("sandbox; default-src 'none'");
    expect(png['Cache-Control']).toBe('no-store');
    expect(trainingFileHeaders({ name: 'guide.pdf', mimeType: 'application/pdf' })['Content-Disposition']).toMatch(/^inline;/);
    const docx = trainingFileHeaders({ name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(docx['Content-Disposition']).toMatch(/^attachment;/);
    expect(trainingFileHeaders({ name: 'x', mimeType: 'text/html' })['Content-Type']).toBe('application/octet-stream');
  });
});
