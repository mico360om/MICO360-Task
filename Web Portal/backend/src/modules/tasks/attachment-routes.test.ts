import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createAttachmentService } from './attachment-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { AttachmentRecord, AttachmentRepository, AttachmentStorage } from './attachment-repository';
import type { TaskLookup } from './assignee-repository';

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

async function makeApp() {
  const attachmentService = createAttachmentService({
    ...inMemory(),
    maxSizeBytes: 1024,
    allowedMimeTypes: ['image/png', 'text/plain'],
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, attachmentService, attachmentMaxSizeBytes: 1024 });
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
