import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileKind, attachmentUrl, KIND_LABEL } from './file-kind.js';

describe('attachments: what sort of file, and where it is', () => {
  it('knows a picture, a PDF, a sheet… from the type, else the name; an SVG is never shown as a picture', () => {
    expect(fileKind('image/png', 'shot.png')).toBe('image');
    expect(fileKind('', 'Site photo.JPG')).toBe('image');
    expect(fileKind('application/pdf', 'x')).toBe('pdf');
    expect(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toBe('sheet');
    expect(fileKind('image/svg+xml', 'logo.svg')).toBe('other');
    expect(fileKind('', 'notes')).toBe('other');
    expect(KIND_LABEL.image).toBe('IMG');
  });

  it('a file is served beside the API: the server’s address without /api/v1', () => {
    expect(attachmentUrl('https://task.mico360.com/api/v1', '/uploads/a b.png')).toBe('https://task.mico360.com/uploads/a b.png');
    expect(attachmentUrl('http://localhost:4000/api/v1/', '/uploads/x.pdf')).toBe('http://localhost:4000/uploads/x.pdf');
    expect(attachmentUrl('https://office.example/tasks/api/v1', '/uploads/x.pdf')).toBe('https://office.example/tasks/uploads/x.pdf');
    // Only the server's own files: nothing else is ever linked from a task.
    expect(attachmentUrl('https://task.mico360.com/api/v1', 'https://elsewhere.example/x.png')).toBeNull();
    expect(attachmentUrl('https://task.mico360.com/api/v1', 'javascript:alert(1)')).toBeNull();
    expect(attachmentUrl('https://task.mico360.com/api/v1', '//elsewhere.example/x.png')).toBeNull();
    expect(attachmentUrl('https://task.mico360.com/api/v1', '')).toBeNull();
  });

  it('only the server’s stored files, under /uploads/ — never another page of the server (review fix #13)', () => {
    const api = 'https://task.mico360.com/api/v1';
    for (const path of [
      '/api/v1/auth/logout', '/admin/users', '/uploadsx/a.png', '/uploads', '/uploads/../api/v1/me',
      '/uploads/a/../../admin', '/uploads/%2e%2e/admin', '/uploads/%2E%2E/admin', '/uploads/a\\..\\b', '/uploads/a.png?x=/../',
    ]) {
      expect(attachmentUrl(api, path), path).toBeNull();
    }
    expect(attachmentUrl(api, '/uploads/2026/10/a.png')).toBe('https://task.mico360.com/uploads/2026/10/a.png');
  });
});

// The web app owns these rules (Web Portal/frontend/src/lib/file-kind.ts, shared with the Android
// app). Both run over the same files and this fails when they drift (skipped without the web app).
const repo = resolve(__dirname, '../..');
const WEB = resolve(repo, 'Web Portal/frontend/src/lib/file-kind.ts');
const web = existsSync(WEB) ? await import(pathToFileURL(WEB).href) : null;

describe.skipIf(!web)('file kinds: src/file-kind.js matches the web app (lib/file-kind.ts)', () => {
  it('gives every file the same kind', () => {
    const TYPES = ['', 'image/png', 'IMAGE/JPEG', 'image/svg+xml', 'image/heic', 'application/pdf', 'application/vnd.ms-excel', 'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip', 'text/plain', 'text/html', 'application/json', 'application/octet-stream'];
    const NAMES = ['', 'a', 'a.', '.png', 'photo.PNG', 'x.jpeg', 'x.avif', 'x.svg', 'x.SVG', 'r.pdf', 's.xls', 's.ods', 'c.csv', 'd.docx', 'd.rtf', 'p.ppt',
      'p.odp', 'z.zip', 'z.7z', 'z.tar.gz', 'n.md', 'n.log', 'n.json', 'b.bin', 'archive.rar', 'Site photo 2026.10.21.jpg'];
    for (const type of TYPES) {
      for (const name of NAMES) expect(fileKind(type, name), `${type} ${name}`).toBe(web.fileKind(type, name));
    }
  });
});
