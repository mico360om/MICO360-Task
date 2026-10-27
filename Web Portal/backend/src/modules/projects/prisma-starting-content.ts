import type { Prisma } from '@prisma/client';
import { newRowId } from '../../lib/row-id';
import { inChunks } from '../../lib/chunks';
import { highestKeyNumber } from '../tasks/prisma-task-repository';
import type { StartingContent } from './project-repository';

const displayName = (u: { firstName: string; lastName: string; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

/**
 * A new project's tasks from a template, written inside the transaction that creates the project
 * (and its board): the tasks — keyed CODE-1, CODE-2… in order, the same numbering every new task
 * gets (the highest number the project has used, skipping any old key) — their checklists, their
 * people and each task's history (its "created" line, then an "assigned" line per person, as creating
 * a task by hand writes), in a handful of bulk statements cut to stay well under MySQL's packet size.
 * A task nobody was picked for goes to the project's owner, as any new task does. Every insert is a
 * plain INSERT — never INSERT IGNORE, which would let a broken reference pass instead of undoing it all.
 */
export async function writeStartingTasks(
  tx: Prisma.TransactionClient,
  project: { id: string; code: string; ownerId: string | null; createdById: string },
  column: { id: string; category: string },
  start: StartingContent,
): Promise<number> {
  const taken = new Set((await tx.taskKeyAlias.findMany({ where: { key: { startsWith: `${project.code}-` } }, select: { key: true } })).map((k) => k.key));
  let n = await highestKeyNumber(tx, project.id);
  const nextKey = () => {
    do n++;
    while (taken.has(`${project.code}-${n}`));
    return `${project.code}-${n}`;
  };
  const at = new Date();
  // A board whose first open column is a Done column completes its tasks on arrival, as creating one there does.
  const done = column.category === 'DONE' ? { completedAt: at, progress: 100 } : {};
  const tasks = start.tasks.map((t, position) => ({ id: newRowId(), plan: t, row: {
    key: nextKey(),
    title: t.title,
    description: t.description,
    projectId: project.id,
    columnId: column.id,
    position,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    boardDate: start.boardDate,
    createdById: project.createdById,
    ...done,
  } }));
  await inChunks(tasks, (chunk) => tx.task.createMany({ data: chunk.map((t) => ({ id: t.id, ...t.row })) }));
  await inChunks(
    tasks.flatMap((t) => t.plan.checklist.map((text, position) => ({ id: newRowId(), taskId: t.id, text, position }))),
    (data) => tx.checklistItem.createMany({ data }),
  );
  const assignments = tasks.flatMap((t) => [...new Set(t.plan.assigneeIds ?? (project.ownerId ? [project.ownerId] : []))].map((userId) => ({ taskId: t.id, userId })));
  await inChunks(assignments, (data) => tx.taskAssignee.createMany({ data }));
  const people = new Map(
    (await tx.user.findMany({ where: { id: { in: [...new Set(assignments.map((a) => a.userId))] } }, select: { id: true, username: true, firstName: true, lastName: true } })).map((u) => [u.id, displayName(u)]),
  );
  // "Created", then "assigned" a moment later, so each task's history reads in that order.
  const assignedAt = new Date(at.getTime() + 1);
  await inChunks(
    [
      ...tasks.map((t) => ({ taskId: t.id, projectId: project.id, userId: project.createdById, action: 'CREATED', meta: { title: t.row.title, template: start.templateName }, createdAt: at })),
      ...assignments.map((a) => ({ taskId: a.taskId, projectId: project.id, userId: project.createdById, action: 'ASSIGNED', meta: { assigneeId: a.userId, assignee: people.get(a.userId) ?? a.userId }, createdAt: assignedAt })),
    ],
    (data) => tx.activity.createMany({ data }),
  );
  return tasks.length;
}
