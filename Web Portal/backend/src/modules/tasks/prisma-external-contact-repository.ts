import type { PrismaClient, TaskExternalContact } from '@prisma/client';
import type { ExternalContactRecord, ExternalContactRepository } from './external-contact-repository';
import type { ExternalContactFields } from './external-contacts';

export const toExternalContactRecord = (c: TaskExternalContact): ExternalContactRecord => ({
  id: c.id,
  taskId: c.taskId,
  name: c.name,
  company: c.company,
  designation: c.designation,
  email: c.email,
  phone: c.phone,
  remarks: c.remarks,
  position: c.position,
  createdById: c.createdById,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

/** Live tasks only: not deleted, and not in a deleted project (as the task repository's rule). */
const liveTaskWhere = { deletedAt: null, project: { is: { deletedAt: null } } };

/** The six fields as they are stored. */
const columns = (f: ExternalContactFields) => ({ name: f.name, company: f.company, designation: f.designation, email: f.email, phone: f.phone, remarks: f.remarks });

/** Does any word of the text start with the prefix (case aside)? */
export function hasWordStarting(text: string | null, prefix: string): boolean {
  if (!text) return false;
  const p = prefix.toLowerCase();
  return text
    .toLowerCase()
    .split(/[\s()\-,./]+/)
    .some((word) => word.startsWith(p));
}

export function createPrismaExternalContactRepository(prisma: PrismaClient): ExternalContactRepository {
  return {
    async list(taskId) {
      const rows = await prisma.taskExternalContact.findMany({ where: { taskId }, orderBy: { position: 'asc' } });
      return rows.map(toExternalContactRecord);
    },
    async get(contactId) {
      const row = await prisma.taskExternalContact.findFirst({ where: { id: contactId, task: liveTaskWhere } });
      return row ? toExternalContactRecord(row) : null;
    },
    async add(taskId, fields, createdById, max) {
      // The task's row is locked while its contacts are counted, so two adds at once take turns.
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
        const existing = await tx.taskExternalContact.findMany({ where: { taskId }, select: { position: true } });
        if (existing.length >= max) return null;
        const position = existing.reduce((top, c) => Math.max(top, c.position + 1), 0);
        const row = await tx.taskExternalContact.create({ data: { taskId, createdById, position, ...columns(fields) } });
        return toExternalContactRecord(row);
      });
    },
    async update(contactId, fields) {
      const { count } = await prisma.taskExternalContact.updateMany({ where: { id: contactId }, data: columns(fields) });
      if (count === 0) return null;
      const row = await prisma.taskExternalContact.findUnique({ where: { id: contactId } });
      return row ? toExternalContactRecord(row) : null;
    },
    async remove(contactId) {
      const { count } = await prisma.taskExternalContact.deleteMany({ where: { id: contactId } });
      return count > 0;
    },
    async searchProject(projectId, prefix, limit) {
      const p = prefix.trim();
      if (!p) return [];
      // The database narrows to names and companies that contain it; the word-start check runs here
      // (a word can start after a space, a hyphen or a bracket: "Al-Hassan", "Oman (PDO)").
      const rows = await prisma.taskExternalContact.findMany({
        where: {
          task: { ...liveTaskWhere, projectId },
          OR: [{ name: { contains: p } }, { company: { contains: p } }],
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
      return rows.filter((c) => hasWordStarting(c.name, p) || hasWordStarting(c.company, p)).map(toExternalContactRecord);
    },
  };
}
