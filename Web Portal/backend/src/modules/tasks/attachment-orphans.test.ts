import { describe, it, expect, vi } from 'vitest';
import { createAttachmentService } from './attachment-service';
import type { AttachmentRecord, AttachmentRepository, AttachmentStorage } from './attachment-repository';

// Review fix #23 (batch 4b), from verify35/repro/A/attachment-service-repro.ts: what happens on disk when an
// attachment's row can't be written or deleted. Task files, and the client portal's uploads (the same service).
function world() {
  const disk = new Map<string, Buffer>();
  const rows = new Map<string, AttachmentRecord>();
  const order: string[] = [];
  let n = 0;
  let failCreate = false;
  let failDelete = false;
  let diskRefusals = 0;
  const storage: AttachmentStorage = {
    async save(f) {
      const k = `k${++n}.pdf`;
      disk.set(k, f.content);
      return { storageKey: k, url: `/uploads/${k}`, sizeBytes: f.content.length };
    },
    async remove(k) {
      order.push(`file ${k}`);
      if (diskRefusals > 0) {
        diskRefusals -= 1;
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      }
      disk.delete(k);
    },
    async read(k) {
      return disk.get(k)!;
    },
  };
  const repo: AttachmentRepository = {
    async create(r) {
      if (failCreate) throw Object.assign(new Error('db down'), { code: 'P1001' });
      const row = { id: `a${rows.size + 1}`, createdAt: new Date(), ...r };
      rows.set(row.id, row);
      return row;
    },
    async list(taskId) {
      return [...rows.values()].filter((r) => r.taskId === taskId);
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async delete(id) {
      order.push(`row ${id}`);
      if (failDelete) throw new Error('db down');
      rows.delete(id);
    },
  };
  const warn = vi.fn();
  const svc = createAttachmentService({ repo, storage, taskLookup: { exists: async () => true }, maxSizeBytes: 1e6, allowedMimeTypes: [], logger: { warn }, fileRetryPauseMs: 0 });
  return {
    svc, disk, rows, order, warn,
    failCreate: (v: boolean) => { failCreate = v; },
    failDelete: (v: boolean) => { failDelete = v; },
    refuseDisk: (times: number) => { diskRefusals = times; },
  };
}
const PDF = { filename: 'x.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-1.4\n%%EOF\n') };

describe('#23 task files are never orphaned, and no record points at a missing file', () => {
  it('the row can’t be written: the saved bytes are removed', async () => {
    const w = world();
    w.failCreate(true);
    await expect(w.svc.upload('t1', 'u1', PDF)).rejects.toThrow('db down');
    expect(w.disk.size).toBe(0);
    expect(w.rows.size).toBe(0);
  });

  it('deleting: the row goes first, then the file — a row that can’t be deleted leaves the file in place (no row pointing at a missing file)', async () => {
    const w = world();
    const rec = await w.svc.upload('t1', 'u1', PDF);
    w.failDelete(true);
    await expect(w.svc.remove(rec.id, 'u1', false)).rejects.toThrow('db down');
    expect(w.rows.size).toBe(1);
    expect(w.disk.size).toBe(1); // the file its row points at is still there
    w.failDelete(false);
    await w.svc.remove(rec.id, 'u1', false);
    expect(w.order).toEqual([`row ${rec.id}`, `row ${rec.id}`, `file ${rec.storageKey}`]);
    expect(w.rows.size).toBe(0);
    expect(w.disk.size).toBe(0);
  });

  it('a file the disk refuses for a moment is tried again and goes', async () => {
    const w = world();
    const rec = await w.svc.upload('t1', 'u1', PDF);
    w.refuseDisk(2);
    await w.svc.remove(rec.id, 'u1', false);
    expect(w.disk.size).toBe(0);
    expect(w.warn).not.toHaveBeenCalled();
  });

  it('a file that can’t be deleted at all is logged with its key; the delete still succeeds (the row is gone)', async () => {
    const w = world();
    const rec = await w.svc.upload('t1', 'u1', PDF);
    w.refuseDisk(99);
    await expect(w.svc.remove(rec.id, 'u1', false)).resolves.toMatchObject({ id: rec.id });
    expect(w.rows.size).toBe(0);
    expect(w.warn).toHaveBeenCalledTimes(1);
    expect(w.warn.mock.calls[0]![1]).toMatchObject({ storageKey: rec.storageKey });
  });
});
