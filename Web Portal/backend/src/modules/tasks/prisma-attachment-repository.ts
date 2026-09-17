import type { PrismaClient, Attachment } from '@prisma/client';
import type { AttachmentRecord, AttachmentRepository } from './attachment-repository';

function toRecord(a: Attachment): AttachmentRecord {
  return {
    id: a.id,
    taskId: a.taskId,
    uploadedById: a.uploadedById,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    storageKey: a.storageKey,
    url: a.url,
    createdAt: a.createdAt,
  };
}

export function createPrismaAttachmentRepository(prisma: PrismaClient): AttachmentRepository {
  return {
    async create(data) {
      return toRecord(await prisma.attachment.create({ data }));
    },
    async list(taskId) {
      const rows = await prisma.attachment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
      return rows.map(toRecord);
    },
    async findById(id) {
      const a = await prisma.attachment.findUnique({ where: { id } });
      return a ? toRecord(a) : null;
    },
    async delete(id) {
      await prisma.attachment.delete({ where: { id } });
    },
  };
}
