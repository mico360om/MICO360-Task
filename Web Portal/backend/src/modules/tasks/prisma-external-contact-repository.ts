import type { PrismaClient, TaskExternalContact } from '@prisma/client';
import type { ExternalContactRecord, ExternalContactRepository } from './external-contact-repository';
import type { ExternalContactFields } from './external-contacts';
import { companyOfProject, companyOfTask, findOrCreateGuest, guestColumns, guestIdsOnProject, seesWholeList, type Db } from '../guests/guest-store';
import { DEFAULT_COMPANY } from '../companies/default-company';
import { GUEST_LIMITS } from './guest-contacts';

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

/** A contact's own details (the guest's), without the task's remarks. */
const guestFieldsOf = (f: ExternalContactFields) => ({ name: f.name, company: f.company, designation: f.designation, email: f.email, phone: f.phone });

/**
 * 1.24: the part of the task's company list this person may be matched against — all of it, or (another
 * company's person on a shared project) the guests already on that project's tasks.
 */
async function matchScope(db: Db, taskId: string, userId: string | null): Promise<{ companyId: string; onlyAmong: Set<string> | null; key?: string }> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { key: true, projectId: true } });
  const companyId = (await companyOfTask(db, taskId)) ?? DEFAULT_COMPANY.id;
  const whole = !userId || !task || (await seesWholeList(db, { id: userId }, companyId));
  return { companyId, onlyAmong: whole ? null : await guestIdsOnProject(db, task.projectId), key: task?.key };
}

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
    // 1.24: the old way in (the Android app and the extension) works on guests. Adding a contact links the
    // task to the company's guest with those details (the duplicate rule finds one, else a new guest is made);
    // changing one re-links the task to the guest the new details match — the shared guest is never edited.
    async add(taskId, fields, createdById, max) {
      // The task's row is locked while its contacts are counted, so two adds at once take turns.
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
        const existing = await tx.taskExternalContact.findMany({ where: { taskId }, select: { id: true, guestId: true, position: true } });
        const scope = await matchScope(tx, taskId, createdById);
        const guest = await findOrCreateGuest(tx, scope.companyId, guestFieldsOf(fields), createdById, { taskKey: scope.key, onlyAmong: scope.onlyAmong });
        const already = existing.find((c) => c.guestId === guest.id);
        if (already) {
          // The task has this guest already: one row each — the remarks typed now are kept with it.
          const row = fields.remarks ? await tx.taskExternalContact.update({ where: { id: already.id }, data: { remarks: fields.remarks } }) : await tx.taskExternalContact.findUniqueOrThrow({ where: { id: already.id } });
          return { ...toExternalContactRecord(row), alreadyOnTask: true };
        }
        if (existing.length >= max) return null;
        const position = existing.reduce((top, c) => Math.max(top, c.position + 1), 0);
        const row = await tx.taskExternalContact.create({ data: { taskId, createdById, position, guestId: guest.id, remarks: fields.remarks, ...guestColumns(guest) } });
        return toExternalContactRecord(row);
      });
    },
    async update(contactId, fields, actorId) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.taskExternalContact.findUnique({ where: { id: contactId } });
        if (!row) return null;
        const scope = await matchScope(tx, row.taskId, actorId ?? null);
        const guest = await findOrCreateGuest(tx, scope.companyId, guestFieldsOf(fields), actorId ?? row.createdById, { taskKey: scope.key, onlyAmong: scope.onlyAmong });
        const other = guest.id !== row.guestId ? await tx.taskExternalContact.findFirst({ where: { taskId: row.taskId, guestId: guest.id, id: { not: row.id } } }) : null;
        if (other) {
          // The task has that guest already: this row goes, the other keeps both remarks.
          const remarks = [other.remarks, fields.remarks].filter(Boolean).join('\n').slice(0, GUEST_LIMITS.note) || null;
          await tx.taskExternalContact.delete({ where: { id: row.id } });
          return toExternalContactRecord(await tx.taskExternalContact.update({ where: { id: other.id }, data: { remarks } }));
        }
        return toExternalContactRecord(await tx.taskExternalContact.update({ where: { id: contactId }, data: { guestId: guest.id, remarks: fields.remarks, ...guestColumns(guest) } }));
      });
    },
    async remove(contactId) {
      const { count } = await prisma.taskExternalContact.deleteMany({ where: { id: contactId } });
      return count > 0;
    },
    async searchProject(projectId, prefix, limit, viewer) {
      const p = prefix.trim();
      if (!p) return [];
      // 1.24: the suggestions are the project's company guest list (active guests; another company's person on
      // a shared project, only the guests on its tasks), by the start of a word of the name or company (a word
      // can start after a space, a hyphen or a bracket: "Al-Hassan", "Oman (PDO)").
      const companyId = await companyOfProject(prisma, projectId);
      const only = (await seesWholeList(prisma, viewer, companyId)) ? null : [...(await guestIdsOnProject(prisma, projectId))];
      const rows = await prisma.guestContact.findMany({
        where: { companyId, retiredAt: null, mergedIntoId: null, ...(only ? { id: { in: only } } : {}), OR: [{ name: { contains: p } }, { company: { contains: p } }] },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
      return rows
        .filter((g) => hasWordStarting(g.name, p) || hasWordStarting(g.company, p))
        .map((g) => ({ id: g.id, taskId: '', ...guestColumns(g), remarks: null, position: 0, createdById: g.createdById, createdAt: g.createdAt, updatedAt: g.updatedAt }));
    },
  };
}
