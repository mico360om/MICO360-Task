import type { Prisma, PrismaClient } from '@prisma/client';
import { managedVisibleWhere } from '../projects/project-managers';
import { pickedCompanyWhere } from '../companies/company-access';
import { highestKeyNumberIn } from '../tasks/task-keys';
import { BIN_DAYS } from './bin-rules';
import type { BinComment, BinDetail, BinnedTask, BinPerson, BinRow, BinStore, ErasedTask } from './bin-store';

/** A task in the Recycle Bin: deleted, not merged (a merged task is the merge's, never the bin's). */
const IN_BIN = { deletedAt: { not: null }, mergedIntoId: null } satisfies Prisma.TaskWhereInput;
/** …in a project that is still there (the bin lists and restores only those; the sweep erases any). */
const IN_LIVE_PROJECT = { ...IN_BIN, project: { is: { deletedAt: null } } } satisfies Prisma.TaskWhereInput;

const personSelect = { id: true, username: true, firstName: true, lastName: true } as const;
const nameOf = (u: { username: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const person = (u: { id: string; username: string; firstName: string | null; lastName: string | null } | null | undefined): BinPerson | null =>
  u ? { id: u.id, name: nameOf(u) } : null;
const projectSelect = { id: true, name: true, code: true, color: true, icon: true, imageUrl: true } as const;
/** Erasing a big task (long history, many files, a merge's main task) may take a while on a busy host. */
const ERASE_TX = { timeout: 30_000, maxWait: 10_000 };
const binnedSelect = { id: true, key: true, title: true, projectId: true, deletedAt: true, deletedById: true, binExpiresAt: true, deleteBatchId: true } as const;

const toBinned = (t: { id: string; key: string; title: string; projectId: string; deletedAt: Date | null; deletedById: string | null; binExpiresAt: Date | null; deleteBatchId: string | null }): BinnedTask => ({
  id: t.id,
  key: t.key,
  title: t.title,
  projectId: t.projectId,
  deletedAt: t.deletedAt!,
  deletedById: t.deletedById,
  binExpiresAt: t.binExpiresAt,
  deleteBatchId: t.deleteBatchId,
});

/** How an erased task is named on the inspections carried out for it: "KEY-12 'Title'". */
export function erasedTaskLabel(t: { key: string; title: string }): string {
  const label = `${t.key} '${t.title}'`;
  return label.length > 300 ? `${label.slice(0, 298)}…'` : label;
}

/** The nesting of a task's live checklist items, in order: each item with how deep it sits. */
function flattenItems(items: { id: string; parentId: string | null; text: string; done: boolean; position: number }[]): { text: string; done: boolean; depth: number }[] {
  const byParent = new Map<string | null, typeof items>();
  const ids = new Set(items.map((i) => i.id));
  for (const i of items) {
    // An item whose parent is gone sits at the top (the server's tree rule).
    const parent = i.parentId && ids.has(i.parentId) ? i.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), i]);
  }
  const out: { text: string; done: boolean; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    if (depth > 50) return;
    for (const i of [...(byParent.get(parent) ?? [])].sort((a, b) => a.position - b.position)) {
      out.push({ text: i.text, done: i.done, depth });
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function createPrismaBinStore(prisma: PrismaClient): BinStore {
  return {
    async list(projectIds) {
      if (projectIds && projectIds.length === 0) return [];
      const rows = await prisma.task.findMany({
        where: { ...IN_LIVE_PROJECT, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
        select: {
          id: true, key: true, title: true, description: true, projectId: true, deletedAt: true, deletedById: true, binExpiresAt: true, deleteBatchId: true,
          project: { select: { ...projectSelect, companies: { select: { companyId: true } } } },
          column: { select: { name: true, category: true } },
          assignees: { select: { user: { select: personSelect } } },
          keyAliases: { select: { key: true } },
        },
        orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map((t): BinRow => {
        const { companies, ...project } = t.project;
        return {
          id: t.id,
          key: t.key,
          title: t.title,
          description: t.description,
          formerKeys: t.keyAliases.map((a) => a.key),
          project,
          companyIds: companies.map((c) => c.companyId),
          status: { name: t.column.name, category: t.column.category },
          deletedAt: t.deletedAt!,
          deletedById: t.deletedById,
          binExpiresAt: t.binExpiresAt,
          deleteBatchId: t.deleteBatchId,
          assignees: t.assignees.map((a) => person(a.user)!),
        };
      });
    },

    async people(ids) {
      if (ids.length === 0) return [];
      return (await prisma.user.findMany({ where: { id: { in: ids } }, select: personSelect })).map((u) => person(u)!);
    },

    async batchSizes(batchIds) {
      if (batchIds.length === 0) return new Map();
      const rows = await prisma.task.groupBy({ by: ['deleteBatchId'], where: { ...IN_BIN, deleteBatchId: { in: batchIds } }, _count: { _all: true } });
      return new Map(rows.filter((r) => r.deleteBatchId).map((r) => [r.deleteBatchId!, r._count._all]));
    },

    async find(id) {
      const t = await prisma.task.findFirst({ where: { id, ...IN_LIVE_PROJECT }, select: binnedSelect });
      return t ? toBinned(t) : null;
    },

    async facts(ids) {
      if (ids.length === 0) return [];
      return prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, title: true, projectId: true } });
    },

    async inBatch(batchId) {
      const rows = await prisma.task.findMany({ where: { ...IN_LIVE_PROJECT, deleteBatchId: batchId }, select: binnedSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return rows.map(toBinned);
    },

    async detail(id) {
      const t = await prisma.task.findFirst({
        where: { id, ...IN_LIVE_PROJECT },
        select: {
          id: true, key: true, title: true, description: true, priority: true, startDate: true, dueDate: true, isMilestone: true,
          recurrenceRule: true, recurrenceParentId: true, createdAt: true,
          createdBy: { select: personSelect },
          project: { select: projectSelect },
          column: { select: { name: true, category: true } },
          keyAliases: { select: { key: true }, orderBy: { createdAt: 'asc' } },
          assignees: { select: { user: { select: personSelect } } },
          tags: { select: { tag: { select: { name: true, color: true } } } },
          externalContacts: { select: { name: true, company: true }, orderBy: { position: 'asc' } },
          categories: { select: { category: { select: { id: true, name: true, color: true, position: true, retiredAt: true } } } },
          checklistLists: { where: { deletedAt: null }, select: { id: true, title: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
          checklist: { where: { deletedAt: null }, select: { id: true, listId: true, parentId: true, text: true, done: true, position: true } },
          comments: { select: { id: true, parentId: true, body: true, fromClient: true, createdAt: true, editedAt: true, deletedAt: true, user: { select: personSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          attachments: { select: { filename: true, sizeBytes: true, createdAt: true, uploadedBy: { select: personSelect } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          // Blockers that are still there (not deleted, merged or in a deleted project); the service keeps
          // only those the person may open.
          dependencies: { where: { dependsOn: { deletedAt: null, project: { is: { deletedAt: null } } } }, select: { dependsOn: { select: { key: true, title: true, projectId: true } } } },
        },
      });
      if (!t) return null;
      const history = await prisma.activity.findMany({ where: { taskId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200, include: { user: { select: personSelect } } });
      const lists = t.checklistLists.map((l) => ({ title: l.title, items: flattenItems(t.checklist.filter((i) => i.listId === l.id)) }));
      const loose = t.checklist.filter((i) => !i.listId || !t.checklistLists.some((l) => l.id === i.listId));
      if (loose.length) lists.push({ title: 'Checklist', items: flattenItems(loose) });
      const asComment = (c: (typeof t.comments)[number]): Omit<BinComment, 'replies'> => ({
        id: c.id,
        author: person(c.user),
        body: c.deletedAt ? '' : c.body,
        deleted: c.deletedAt !== null,
        fromClient: c.fromClient,
        createdAt: c.createdAt,
        editedAt: c.editedAt,
      });
      const top = t.comments.filter((c) => !c.parentId);
      const comments: BinComment[] = top
        .map((c) => ({ ...asComment(c), replies: t.comments.filter((r) => r.parentId === c.id && !r.deletedAt).map(asComment) }))
        // A deleted comment is only kept for its replies.
        .filter((c) => !c.deleted || c.replies.length > 0)
        .reverse(); // newest first, as the task panel shows them
      const detail: BinDetail = {
        task: {
          id: t.id,
          key: t.key,
          title: t.title,
          description: t.description,
          priority: t.priority,
          startDate: t.startDate,
          dueDate: t.dueDate,
          isMilestone: t.isMilestone,
          repeats: t.recurrenceRule !== null || t.recurrenceParentId !== null,
          createdAt: t.createdAt,
          createdBy: person(t.createdBy),
          formerKeys: t.keyAliases.map((a) => a.key),
          project: t.project,
          status: { name: t.column.name, category: t.column.category },
        },
        assignees: t.assignees.map((a) => person(a.user)!),
        tags: t.tags.map((x) => x.tag),
        contacts: t.externalContacts,
        categories: t.categories
          .map((c) => c.category)
          .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
          .map((c) => ({ id: c.id, name: c.name, color: c.color, retired: c.retiredAt !== null })),
        checklists: lists,
        comments,
        files: t.attachments.map((a) => ({ filename: a.filename, sizeBytes: a.sizeBytes, createdAt: a.createdAt, uploadedBy: person(a.uploadedBy) })),
        blockers: t.dependencies.map((d) => d.dependsOn),
        history: history.map((h) => ({ id: h.id, taskId: h.taskId, projectId: h.projectId, userId: h.userId, action: h.action, meta: h.meta, createdAt: h.createdAt, actor: person(h.user) })),
      };
      return detail;
    },

    async restore(id) {
      // Everything under it was never removed: clearing the marks brings it all back. A new version, so
      // an edit someone made to it before it was deleted can't be saved over it now.
      const { count } = await prisma.task.updateMany({
        where: { id, ...IN_BIN },
        data: { deletedAt: null, deletedById: null, binExpiresAt: null, deleteBatchId: null, version: { increment: 1 } },
      });
      return count === 1;
    },

    async erase(id) {
      return prisma.$transaction(async (tx): Promise<ErasedTask | null> => {
        // The row is locked first: a restore at the same moment waits, then finds it gone (it is never
        // told "restored" for a task this erases). MariaDB- and MySQL-safe.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tasks WHERE id = ${id} AND deletedAt IS NOT NULL AND mergedIntoId IS NULL FOR UPDATE`;
        if (locked.length === 0) return null;
        const t = await tx.task.findFirst({ where: { id, ...IN_BIN }, select: { id: true, key: true, title: true, projectId: true } });
        if (!t) return null;
        // The tasks merged into it (and into those): merged records whose content is this task's now.
        // They go with it — Undo can't bring them back once it is gone.
        const all = [t.id];
        for (let frontier = [t.id], depth = 0; frontier.length && depth < 20; depth++) {
          const next = (await tx.task.findMany({ where: { mergedIntoId: { in: frontier } }, select: { id: true } })).map((r) => r.id).filter((x) => !all.includes(x));
          all.push(...next);
          frontier = next;
        }
        const rows = await tx.task.findMany({
          where: { id: { in: all } },
          select: {
            id: true, key: true, title: true, projectId: true, recurrenceRule: true, recurrenceParentId: true, recurrenceSourceId: true,
            keyAliases: { select: { key: true, projectId: true } }, attachments: { select: { storageKey: true } },
          },
        });
        // Its numbers stay used: each project's mark is raised to the highest number going.
        const marks = new Map<string, number>();
        const used = (projectId: string, key: string) => marks.set(projectId, Math.max(marks.get(projectId) ?? 0, highestKeyNumberIn([key])));
        for (const r of rows) {
          used(r.projectId, r.key);
          for (const a of r.keyAliases) used(a.projectId, a.key);
        }
        for (const [projectId, n] of marks) {
          if (n > 0) await tx.project.updateMany({ where: { id: projectId, taskNumberMark: { lt: n } }, data: { taskNumberMark: n } });
        }
        // A repeating series still counts its erased tasks (its "10 times" stays 10 made), and the copy this one
        // was made from keeps a next copy: the one made from this, if any (so no parallel series can start).
        for (const r of rows) {
          if (r.recurrenceRule === null && r.recurrenceParentId === null) continue;
          const seriesId = r.recurrenceParentId ?? r.id;
          await tx.taskSeriesErased.upsert({ where: { seriesId }, create: { seriesId, erased: 1 }, update: { erased: { increment: 1 } } });
          if (await tx.task.count({ where: { recurrenceSourceId: r.id } })) {
            if (r.recurrenceSourceId) await tx.task.update({ where: { id: r.id }, data: { recurrenceSourceId: null } });
            await tx.task.updateMany({ where: { recurrenceSourceId: r.id }, data: { recurrenceSourceId: r.recurrenceSourceId } });
          }
        }
        // Inspections are compliance records: kept, saying which task they were for. A failed item's
        // follow-up whose task is gone is free to get a new one.
        for (const r of rows) await tx.inspection.updateMany({ where: { taskId: r.id }, data: { erasedTask: erasedTaskLabel(r) } });
        await tx.inspectionFollowUp.deleteMany({ where: { taskId: { in: all } } });
        // Notices that pointed to it, and what search had made of it (its own entry goes with the row).
        await tx.notification.deleteMany({ where: { entityType: 'task', entityId: { in: all } } });
        await tx.clientNotice.deleteMany({ where: { taskId: { in: all } } });
        const parts = await tx.searchIndex.findMany({ where: { taskId: { in: all } }, select: { kind: true, recordId: true } });
        await tx.searchEmbedding.deleteMany({ where: { OR: [{ kind: 'task', recordId: { in: all } }, ...parts.map((p) => ({ kind: p.kind, recordId: p.recordId }))] } });
        await tx.searchIndex.deleteMany({ where: { taskId: { in: all } } });
        await tx.taskMerge.deleteMany({ where: { mainTaskId: { in: all } } });
        // The task and everything under it (comments and replies, files' rows, checklists, people, tags,
        // contacts, blockers, history, its search entry) go by the database's cascades.
        const merged = all.filter((x) => x !== t.id);
        if (merged.length) await tx.task.deleteMany({ where: { id: { in: merged } } });
        const { count } = await tx.task.deleteMany({ where: { id: t.id, ...IN_BIN } });
        if (count !== 1) throw new Error('Recycle Bin: the task changed while it was being erased (left as it was).');
        return { ...t, files: [...new Set(rows.flatMap((r) => r.attachments.map((a) => a.storageKey)))] };
      }, ERASE_TX);
    },

    async fileInUse(storageKey) {
      const [tasks, chat, notes, decisions] = await Promise.all([
        prisma.attachment.count({ where: { storageKey } }),
        prisma.chatAttachment.count({ where: { storageKey } }),
        prisma.meetingNoteAttachment.count({ where: { storageKey } }),
        prisma.decisionAttachment.count({ where: { storageKey } }),
      ]);
      return tasks + chat + notes + decisions > 0;
    },

    async due(now, limit, skip = []) {
      // A row deleted by something older than the bin (no expiry stored) is kept 60 days and a bit more.
      const oldest = new Date(now.getTime() - (BIN_DAYS + 1) * 86_400_000);
      const rows = await prisma.task.findMany({
        where: { ...IN_BIN, ...(skip.length ? { id: { notIn: skip } } : {}), OR: [{ binExpiresAt: { lte: now } }, { binExpiresAt: null, deletedAt: { lte: oldest } }] },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: limit,
      });
      return rows.map((r) => r.id);
    },

    async runsProject(userId, projectId) {
      return (await prisma.project.count({ where: { id: projectId, deletedAt: null, ...managedVisibleWhere(userId) } })) > 0;
    },

    async runProjectIds(userId, pick) {
      const rows = await prisma.project.findMany({
        where: { AND: [{ deletedAt: null }, managedVisibleWhere(userId), ...(pick ? [pickedCompanyWhere(userId, pick)] : [])] },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async runsAny(userId) {
      return (await prisma.project.count({ where: { deletedAt: null, ...managedVisibleWhere(userId) } })) > 0;
    },
  };
}
