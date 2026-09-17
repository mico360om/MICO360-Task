import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { sniffMime, SNIFFABLE } from '../../lib/magic-mime';
import type {
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStorage,
  UploadedFile,
} from './attachment-repository';
import type { TaskLookup } from './assignee-repository';

export interface AttachmentServiceDeps {
  repo: AttachmentRepository;
  storage: AttachmentStorage;
  taskLookup: TaskLookup;
  maxSizeBytes: number;
  /** Allowed mime types; empty array means "allow any". */
  allowedMimeTypes: string[];
  /** Optional cap on the total bytes of all attachments on a single task. */
  maxTotalBytesPerTask?: number;
}

export function createAttachmentService({
  repo,
  storage,
  taskLookup,
  maxSizeBytes,
  allowedMimeTypes,
  maxTotalBytesPerTask,
}: AttachmentServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function upload(taskId: string, uploadedById: string, file: UploadedFile): Promise<AttachmentRecord> {
    await ensureTask(taskId);
    if (file.content.length === 0) throw new ValidationError('File is empty.');
    if (file.content.length > maxSizeBytes) {
      throw new ValidationError(`File exceeds the ${maxSizeBytes}-byte limit.`);
    }
    if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.mimeType)) {
      throw new ValidationError(`File type ${file.mimeType} is not allowed.`);
    }
    // Reject a spoofed Content-Type: if we can sniff the declared type, the bytes must match.
    if (SNIFFABLE.has(file.mimeType)) {
      const actual = sniffMime(file.content);
      if (actual !== file.mimeType) {
        throw new ValidationError(`File content does not match its declared type (${file.mimeType}).`);
      }
    }
    // Per-task storage quota.
    if (maxTotalBytesPerTask !== undefined) {
      const existing = await repo.list(taskId);
      const used = existing.reduce((sum, a) => sum + a.sizeBytes, 0);
      if (used + file.content.length > maxTotalBytesPerTask) {
        throw new ValidationError('This task has reached its attachment storage limit.');
      }
    }
    const { storageKey, url, sizeBytes } = await storage.save(file);
    return repo.create({
      taskId,
      uploadedById,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes,
      storageKey,
      url,
    });
  }

  async function list(taskId: string): Promise<AttachmentRecord[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  async function remove(id: string, userId: string, isAdmin: boolean): Promise<void> {
    const rec = await repo.findById(id);
    if (!rec) throw new NotFoundError('Attachment not found.');
    if (rec.uploadedById !== userId && !isAdmin) {
      throw new ForbiddenError('You can only delete your own attachment.');
    }
    await storage.remove(rec.storageKey);
    await repo.delete(id);
  }

  return { upload, list, remove };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
