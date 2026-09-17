import type { PrismaClient } from '@prisma/client';
import type { ChecklistItemRecord, ChecklistRepository } from './checklist-repository';

type Row = { id: string; taskId: string; text: string; done: boolean; position: number };
const toRecord = (i: Row): ChecklistItemRecord => ({ id: i.id, taskId: i.taskId, text: i.text, done: i.done, position: i.position });

export function createPrismaChecklistRepository(prisma: PrismaClient): ChecklistRepository {
  return {
    async add(taskId, text, position) {
      return toRecord(await prisma.checklistItem.create({ data: { taskId, text, position } }));
    },
    async toggle(itemId, done) {
      return toRecord(await prisma.checklistItem.update({ where: { id: itemId }, data: { done } }));
    },
    async editText(itemId, text) {
      return toRecord(await prisma.checklistItem.update({ where: { id: itemId }, data: { text } }));
    },
    async list(taskId) {
      const items = await prisma.checklistItem.findMany({ where: { taskId }, orderBy: { position: 'asc' } });
      return items.map(toRecord);
    },
    async reorder(taskId, orderedIds) {
      // Set each item's position to its index; scoped to the task so stray ids can't move other tasks' items.
      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.checklistItem.updateMany({ where: { id, taskId }, data: { position: index } }),
        ),
      );
      const items = await prisma.checklistItem.findMany({ where: { taskId }, orderBy: { position: 'asc' } });
      return items.map(toRecord);
    },
    async remove(itemId) {
      const item = await prisma.checklistItem.delete({ where: { id: itemId } });
      return { taskId: item.taskId };
    },
  };
}
