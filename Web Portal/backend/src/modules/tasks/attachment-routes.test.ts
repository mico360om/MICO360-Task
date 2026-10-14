import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createAttachmentService } from './attachment-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { AttachmentRecord, AttachmentRepository, AttachmentStorage } from './attachment-repository';
import type { TaskLookup } from './assignee-repository';
import { zip } from '../../lib/xlsx-writer';

function inMemory() {
  const rows = new Map<string, AttachmentRecord>();
  let seq = 0;
  const repo: AttachmentRepository = {
    async create(data) {
      const rec: AttachmentRecord = { id: `a${seq++}`, createdAt: new Date(), ...data };
      rows.set(rec.id, rec);
      return rec;
    },
    async list(taskId) { return [...rows.values()].filter((a) => a.taskId === taskId); },
    async findById(id) { return rows.get(id) ?? null; },
    async delete(id) { rows.delete(id); },
  };
  const storage: AttachmentStorage = {
    async save(file) { return { storageKey: `k${seq}`, url: `/uploads/k${seq}`, sizeBytes: file.content.length }; },
    async remove() {},
  };
  const taskLookup: TaskLookup = { async exists(id) { return id === 't1'; } };
  return { repo, storage, taskLookup };
}

const tokenService = createTokenService({
  accessSecret: 'att-access',
  refreshSecret: 'att-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const attachmentService = createAttachmentService({
    ...inMemory(),
    maxSizeBytes: 1024,
    allowedMimeTypes: ['image/png', 'text/plain'],
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, attachmentService, attachmentMaxSizeBytes: 1024, ...extra });
}
async function token(id: string, roles: string[] = ['EMPLOYEE']) {
  return (await tokenService.issueTokens({ id, roles })).accessToken;
}

const BOUNDARY = '----mico360testboundary';
function filePayload(filename: string, mime: string, content: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n` +
      `${content}\r\n` +
      `--${BOUNDARY}--\r\n`,
  );
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Attachment routes', () => {
  it('records attached and removed files by name (task timeline)', async () => {
    const recorded: unknown[] = [];
    const a = await makeApp({ recordTaskActivity: async (e) => { recorded.push(e); } });
    const headers = { authorization: `Bearer ${await token('u1')}` };
    const up = await a.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/attachments',
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: filePayload('notes.txt', 'text/plain', 'hello'),
    });
    await a.inject({ method: 'DELETE', url: `/api/v1/attachments/${up.json().data.id}`, headers });
    expect(recorded).toEqual([
      { taskId: 't1', userId: 'u1', action: 'ATTACHED', meta: { filename: 'notes.txt' } },
      { taskId: 't1', userId: 'u1', action: 'ATTACHMENT_REMOVED', meta: { filename: 'notes.txt' } },
    ]);
  });

  it('uploads a file via multipart (201) and lists it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/attachments',
      headers: {
        authorization: `Bearer ${await token('u1')}`,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: filePayload('hello.txt', 'text/plain', 'hello world'),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.filename).toBe('hello.txt');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/t1/attachments',
      headers: { authorization: `Bearer ${await token('u1')}` },
    });
    expect(list.json().data).toHaveLength(1);
  });

  it('rejects a disallowed mime type (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/attachments',
      headers: {
        authorization: `Bearer ${await token('u1')}`,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: filePayload('bad.exe', 'application/x-msdownload', 'MZxx'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated upload (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/attachments',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: filePayload('x.txt', 'text/plain', 'x'),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Attachment preview (Word / Excel / PowerPoint as text)', () => {
  async function previewApp(canView = true) {
    const mem = inMemory();
    const bytes = new Map<string, Buffer>();
    const storage = { ...mem.storage, async read(key: string) { const b = bytes.get(key); if (!b) throw new Error('missing'); return b; } };
    const attachmentService = createAttachmentService({ ...mem, storage, maxSizeBytes: 1024, allowedMimeTypes: ['text/plain'] });
    const put = async (filename: string, mimeType: string, content: Buffer) => {
      const key = `key-${filename}`;
      bytes.set(key, content);
      return mem.repo.create({ taskId: 't1', uploadedById: 'u1', filename, mimeType, sizeBytes: content.length, storageKey: key, url: `/uploads/${key}` });
    };
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const a = await buildApp({ authService, tokenService, attachmentService, attachmentMaxSizeBytes: 1024, projectAccess: { canViewTask: async () => canView, canViewProject: async () => canView, accessibleProjectIds: async () => null } as never });
    return { app: a, put };
  }
  const docx = () =>
    zip([{ name: 'word/document.xml', data: Buffer.from('<w:document><w:body><w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p></w:body></w:document>') }], new Date());

  it('previews a Word file as text for someone who can see the task', async () => {
    const { app: a, put } = await previewApp();
    const rec = await put('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx());
    const res = await a.inject({ method: 'GET', url: `/api/v1/attachments/${rec.id}/preview`, headers: { authorization: `Bearer ${await token('u1')}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ kind: 'document', paragraphs: ['Hello from Word'], truncated: false });
  });

  it('refuses someone who can’t see the task (403)', async () => {
    const { app: a, put } = await previewApp(false);
    const rec = await put('brief.docx', 'application/octet-stream', docx());
    const res = await a.inject({ method: 'GET', url: `/api/v1/attachments/${rec.id}/preview`, headers: { authorization: `Bearer ${await token('u9')}` } });
    expect(res.statusCode).toBe(403);
  });

  it('says when a file has no preview (415), is damaged (422) or doesn’t exist (404)', async () => {
    const { app: a, put } = await previewApp();
    const auth = { authorization: `Bearer ${await token('u1')}` };
    const png = await put('photo.png', 'image/png', Buffer.from('png'));
    expect((await a.inject({ method: 'GET', url: `/api/v1/attachments/${png.id}/preview`, headers: auth })).json().error.code).toBe('NOT_PREVIEWABLE');
    const bad = await put('broken.docx', 'application/octet-stream', Buffer.from('PK broken'));
    const res = await a.inject({ method: 'GET', url: `/api/v1/attachments/${bad.id}/preview`, headers: auth });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/damaged/i);
    expect((await a.inject({ method: 'GET', url: '/api/v1/attachments/nope/preview', headers: auth })).statusCode).toBe(404);
  });
});
