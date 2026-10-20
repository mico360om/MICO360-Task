import { officePreview, type OfficePreview } from '../../lib/office-preview';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { sniffMime, SNIFFABLE } from '../../lib/magic-mime';
import { fileContentMismatchMessage, fileTooLargeMessage, fileTypeNotAllowedMessage } from '../../lib/upload-safety';
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
  /** Makes a picture smaller before it is stored (the same bytes back when it can't). */
  shrinkImage?: (content: Buffer, mimeType: string) => Promise<Buffer>;
}

export function createAttachmentService({
  repo,
  storage,
  taskLookup,
  maxSizeBytes,
  allowedMimeTypes,
  maxTotalBytesPerTask,
  shrinkImage,
}: AttachmentServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function upload(taskId: string, uploadedById: string, file: UploadedFile): Promise<AttachmentRecord> {
    await ensureTask(taskId);
    if (file.content.length === 0) throw new ValidationError('File is empty.');
    if (file.content.length > maxSizeBytes) {
      throw new ValidationError(fileTooLargeMessage(maxSizeBytes));
    }
    if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.mimeType)) {
      throw new ValidationError(fileTypeNotAllowedMessage(file.filename));
    }
    // Reject a spoofed Content-Type: if we can sniff the declared type, the bytes must match.
    if (SNIFFABLE.has(file.mimeType)) {
      const actual = sniffMime(file.content);
      if (actual !== file.mimeType) {
        throw new ValidationError(fileContentMismatchMessage(file.filename));
      }
    }
    // Pictures are stored smaller (checked above first, so only real pictures get this far).
    const content = shrinkImage ? await shrinkImage(file.content, file.mimeType) : file.content;
    // Per-task storage quota, on what is actually stored.
    if (maxTotalBytesPerTask !== undefined) {
      const existing = await repo.list(taskId);
      const used = existing.reduce((sum, a) => sum + a.sizeBytes, 0);
      if (used + content.length > maxTotalBytesPerTask) {
        throw new ValidationError('This task has reached its attachment storage limit.');
      }
    }
    const { storageKey, url, sizeBytes } = await storage.save({ ...file, content });
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

  /** Delete an attachment (its uploader or an admin); returns what was removed. */
  async function remove(id: string, userId: string, isAdmin: boolean): Promise<AttachmentRecord> {
    const rec = await repo.findById(id);
    if (!rec) throw new NotFoundError('Attachment not found.');
    if (rec.uploadedById !== userId && !isAdmin) {
      throw new ForbiddenError('You can only delete your own attachment.');
    }
    await storage.remove(rec.storageKey);
    await repo.delete(id);
    return rec;
  }

  /** One attachment (NotFound when it doesn't exist). */
  async function get(id: string): Promise<AttachmentRecord> {
    const rec = await repo.findById(id);
    if (!rec) throw new NotFoundError('Attachment not found.');
    return rec;
  }

  /**
   * A plain-text preview of a Word, Excel or PowerPoint attachment; null when the file has none.
   * Throws PreviewError when it is damaged or too big to unpack safely.
   */
  async function preview(rec: AttachmentRecord): Promise<OfficePreview | null> {
    if (!storage.read || !/\.(docx|xlsx|pptx)$/i.test(rec.filename)) return null;
    return officePreview(await storage.read(rec.storageKey), rec.filename);
  }

  return { upload, list, remove, get, preview };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
