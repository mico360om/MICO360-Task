import { describe, it, expect, beforeEach } from 'vitest';
import { createAttachmentService } from './attachment-service';
import type {
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStorage,
  UploadedFile,
} from './attachment-repository';
import type { TaskLookup } from './assignee-repository';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';

function inMemory(tasks: string[]) {
  const rows = new Map<string, AttachmentRecord>();
  const saved: { storageKey: string; content: Buffer }[] = [];
  const removed: string[] = [];
  let seq = 0;

  const repo: AttachmentRepository = {
    async create(data) {
      const rec: AttachmentRecord = { id: `a${seq++}`, createdAt: new Date(), ...data };
      rows.set(rec.id, rec);
      return rec;
    },
    async list(taskId) {
      return [...rows.values()].filter((a) => a.taskId === taskId);
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async delete(id) {
      rows.delete(id);
    },
  };

  const storage: AttachmentStorage = {
    async save(file: UploadedFile) {
      const storageKey = `key-${saved.length}`;
      saved.push({ storageKey, content: file.content });
      return { storageKey, url: `/uploads/${storageKey}`, sizeBytes: file.content.length };
    },
    async remove(storageKey) {
      removed.push(storageKey);
    },
  };

  const taskLookup: TaskLookup = { async exists(id) { return tasks.includes(id); } };
  return { repo, storage, taskLookup, saved, removed };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png: UploadedFile = { filename: 'shot.png', mimeType: 'image/png', content: Buffer.concat([PNG_MAGIC, Buffer.from('body')]) };

let mem: ReturnType<typeof inMemory>;
let svc: ReturnType<typeof createAttachmentService>;
beforeEach(() => {
  mem = inMemory(['t1']);
  svc = createAttachmentService({
    repo: mem.repo,
    storage: mem.storage,
    taskLookup: mem.taskLookup,
    maxSizeBytes: 1024,
    allowedMimeTypes: ['image/png', 'application/pdf'],
  });
});

describe('AttachmentService.upload', () => {
  it('stores the file bytes and records metadata pointing at the task', async () => {
    const rec = await svc.upload('t1', 'u1', png);
    expect(rec.taskId).toBe('t1');
    expect(rec.uploadedById).toBe('u1');
    expect(rec.filename).toBe('shot.png');
    expect(rec.mimeType).toBe('image/png');
    expect(rec.sizeBytes).toBe(png.content.length);
    expect(rec.url).toBe('/uploads/key-0');
    expect(mem.saved).toHaveLength(1); // bytes actually went to storage
    expect((await svc.list('t1')).map((a) => a.id)).toEqual([rec.id]);
  });

  it('rejects a file over the size limit before touching storage', async () => {
    const big: UploadedFile = { filename: 'big.png', mimeType: 'image/png', content: Buffer.alloc(2048) };
    await expect(svc.upload('t1', 'u1', big)).rejects.toBeInstanceOf(ValidationError);
    expect(mem.saved).toHaveLength(0);
  });

  it('rejects a disallowed mime type', async () => {
    const exe: UploadedFile = { filename: 'x.exe', mimeType: 'application/x-msdownload', content: Buffer.from('MZ') };
    await expect(svc.upload('t1', 'u1', exe)).rejects.toBeInstanceOf(ValidationError);
    expect(mem.saved).toHaveLength(0);
  });

  it('rejects an empty file', async () => {
    const empty: UploadedFile = { filename: 'empty.png', mimeType: 'image/png', content: Buffer.alloc(0) };
    await expect(svc.upload('t1', 'u1', empty)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFound when the task does not exist', async () => {
    await expect(svc.upload('ghost', 'u1', png)).rejects.toBeInstanceOf(NotFoundError);
    expect(mem.saved).toHaveLength(0);
  });

  it('rejects a spoofed content type (declared image/png but not actually PNG)', async () => {
    const spoof: UploadedFile = { filename: 'evil.png', mimeType: 'image/png', content: Buffer.from('not a real png at all') };
    await expect(svc.upload('t1', 'u1', spoof)).rejects.toBeInstanceOf(ValidationError);
    expect(mem.saved).toHaveLength(0);
  });

  it('enforces a per-task storage quota', async () => {
    const m = inMemory(['t1']);
    const quotaSvc = createAttachmentService({
      repo: m.repo, storage: m.storage, taskLookup: m.taskLookup,
      maxSizeBytes: 1024, allowedMimeTypes: [], maxTotalBytesPerTask: 20,
    });
    const file = (n: number): UploadedFile => ({ filename: `f${n}.txt`, mimeType: 'text/plain', content: Buffer.alloc(12) });
    await quotaSvc.upload('t1', 'u1', file(1)); // 12 bytes, ok
    await expect(quotaSvc.upload('t1', 'u1', file(2))).rejects.toBeInstanceOf(ValidationError); // 24 > 20
  });
});

describe('AttachmentService.remove', () => {
  it('lets the uploader delete their attachment and clears storage', async () => {
    const rec = await svc.upload('t1', 'u1', png);
    await svc.remove(rec.id, 'u1', false);
    expect(await svc.list('t1')).toHaveLength(0);
    expect(mem.removed).toEqual([rec.storageKey]);
  });

  it('lets an admin delete anyone’s attachment', async () => {
    const rec = await svc.upload('t1', 'u1', png);
    await svc.remove(rec.id, 'someone-else', true);
    expect(await svc.list('t1')).toHaveLength(0);
  });

  it('forbids a non-owner non-admin from deleting', async () => {
    const rec = await svc.upload('t1', 'u1', png);
    await expect(svc.remove(rec.id, 'u2', false)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await svc.list('t1')).toHaveLength(1);
  });

  it('throws NotFound deleting an unknown attachment', async () => {
    await expect(svc.remove('ghost', 'u1', true)).rejects.toBeInstanceOf(NotFoundError);
  });
});
