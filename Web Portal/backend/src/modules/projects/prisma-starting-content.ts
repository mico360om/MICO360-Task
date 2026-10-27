import type { Prisma } from '@prisma/client';
import { newRowId } from '../../lib/row-id';
import { highestKeyNumber } from '../tasks/prisma-task-repository';
import type { StartingContent } from './project-repository';

/** Rows per bulk insert: well inside MySQL's limit on placeholders in one statement. */
const CHUNK = 500;

async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

/**
 * A new project's tasks from a template, written inside the transaction that creates the project
 * (and its board): the tasks — keyed CODE-1, CODE-2… in order, the same numbering every new task
 * gets (the highest number the project has used, skipping any old key) — their checklists, their
 * people and the "created" line of each task's history, in a handful of bulk statements. A task
 * nobody was picked for goes to the project's owner, as any new task does.
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
  await inChunks(
    tasks.flatMap((t) => [...new Set(t.plan.assigneeIds ?? (project.ownerId ? [project.ownerId] : []))].map((userId) => ({ taskId: t.id, userId }))),
    (data) => tx.taskAssignee.createMany({ data, skipDuplicates: true }),
  );
  await inChunks(
    tasks.map((t) => ({ taskId: t.id, projectId: project.id, userId: project.createdById, action: 'CREATED', meta: { title: t.row.title, template: start.templateName } })),
    (data) => tx.activity.createMany({ data }),
  );
  return tasks.length;
}
