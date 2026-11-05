import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { createPrismaTimelineSource } from '../../src/modules/planning/prisma-timeline-source';
import { createPrismaWorkloadStore } from '../../src/modules/planning/prisma-workload-store';
import { createPrismaManagementSource } from '../../src/modules/management/prisma-management-source';
import { createPrismaReportDataSource } from '../../src/modules/reports/prisma-report-data-source';
import { createReportService } from '../../src/modules/reports/report-service';
import { reportSheets } from '../../src/modules/reports/report-export';
import { createPrismaTaskExportSource } from '../../src/modules/tasks/task-export';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createPrismaClientViewSource } from '../../src/modules/client-view/client-view-source';
import { createPrismaProjectOverviewSource } from '../../src/modules/projects/prisma-project-overview-source';
import { runBackfill } from './company-helpers';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Merged tasks disappear from every
// place that lists or counts tasks (one family per test), and their numbers and content are found as
// the main task. Every place reads live tasks only (deletedAt is set with mergedIntoId): these guard it.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-05T06:00:00Z');
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const taskService = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ, now: () => NOW });
const merges = createTaskMergeService({ prisma, timeZone: TZ, now: () => NOW });
const CODE = 'MGPLC';
const EMAILS = ['mgp-manager@mico360.test', 'mgp-mate@mico360.test'];

let managerId = '';
let mateId = '';
let projectId = '';
let todo = '';
let main = { id: '', key: '' };
let other = { id: '', key: '' };
let third = { id: '', key: '' };

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: CODE }, select: { id: true } })).map((p) => p.id);
  const taskIds = (await prisma.task.findMany({ where: { projectId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: taskIds } } });
  await prisma.searchIndex.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { projectId: { in: ids } }] } });
  await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { taskId: { in: taskIds } }] } });
  await prisma.taskKeyAlias.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { taskId: { in: taskIds } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  const user = (email: string, first: string) => prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: first, lastName: 'Merge' } });
  managerId = (await user(EMAILS[0]!, 'Aisha')).id;
  mateId = (await user(EMAILS[1]!, 'Omar')).id;
  const p = await prisma.project.create({ data: { code: CODE, name: 'Merge places', createdById: managerId } });
  projectId = p.id;
  todo = (await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } })).id;
  await prisma.kanbanColumn.create({ data: { projectId, name: 'Done', category: 'DONE', position: 1 } });
  await prisma.projectMember.createMany({ data: [{ projectId, userId: managerId, role: 'MANAGER' }, { projectId, userId: mateId }] });
  await runBackfill(prisma);
  const make = async (title: string, extra: Record<string, unknown> = {}) => {
    const t = await taskService.createTask({ title, projectId, columnId: todo, createdById: managerId, assigneeIds: [mateId], dueDate: day('2026-11-06'), ...extra });
    return { id: t.id, key: t.key };
  };
  main = await make('Service the generator');
  other = await make('Generator oil quokkas', { description: 'Change the oil filter', isMilestone: true });
  third = await make('Generator belts');
  await prisma.task.update({ where: { id: other.id }, data: { clientVisible: true } });
  await prisma.attachment.create({ data: { taskId: other.id, uploadedById: managerId, filename: 'quokka-manual.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'x.pdf', url: '/uploads/x.pdf' } });
  await merges.merge({ id: managerId, roles: [] }, { taskIds: [main.id, other.id, third.id], mainTaskId: main.id });
  await createTaskSearchIndex({ prisma }).refresh([main.id, other.id, third.id]);
  const general = createSearchIndex({ prisma });
  for (const id of [main.id, other.id, third.id]) await general.taskFilesChanged(id);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const gone = (ids: string[]) => ids.filter((id) => id === other.id || id === third.id);

describe('Merged tasks leave every place that lists or counts tasks (integration)', () => {
  it('task lists, boards (one project and All projects), the Table view, My Tasks and the calendar', async () => {
    expect((await taskService.listTasks({ projectId })).map((t) => t.id)).toEqual([main.id]);
    expect(gone((await taskService.listTasks({ projectIds: [projectId] })).map((t) => t.id))).toEqual([]);
    expect((await taskService.listTasks({ assigneeId: mateId, projectIds: [projectId] })).map((t) => t.id)).toEqual([main.id]);
    expect((await taskService.listTasks({ projectIds: [projectId], dueAfter: day('2026-11-01'), dueBefore: day('2026-11-30') })).map((t) => t.id)).toEqual([main.id]);
  });

  it('the timeline and the workload', async () => {
    const rows = await createPrismaTimelineSource(prisma).load([projectId], [], { shownFrom: day('2026-10-01'), shownTo: day('2027-01-01'), soonFrom: day('2026-11-01'), soonTo: day('2026-11-30'), weekFrom: day('2026-11-01'), weekTo: day('2026-11-08') });
    expect(rows.totals.find((t) => t.projectId === projectId)).toMatchObject({ total: 1 });
    expect(rows.milestones.map((m) => m.id)).toEqual([]);
    const tasks = await createPrismaWorkloadStore(prisma).openTasks({ projectIds: [projectId], assigneeIds: [mateId], from: day('2026-11-01'), to: day('2026-11-30') });
    expect(tasks.map((t) => t.id)).toEqual([main.id]);
  });

  it('Management and the project dashboard', async () => {
    const figures = await createPrismaManagementSource(prisma, TZ).taskFigures([projectId], '2026-11-05');
    expect(figures).toEqual([expect.objectContaining({ projectId, total: 1, open: 1 })]);
    const overview = await createPrismaProjectOverviewSource(prisma).load([projectId], []);
    expect(overview.totals.find((t) => t.projectId === projectId)).toMatchObject({ total: 1 });
  });

  it('reports and their exports: merged tasks aren’t counted; the main task’s row says what was merged into it', async () => {
    const reports = createReportService({ data: createPrismaReportDataSource(prisma), timeZone: TZ, now: () => NOW });
    const rows = await reports.taskListReport({ projectId });
    expect(rows.map((r) => r.key)).toEqual([main.key]);
    expect(rows[0]!.mergedFrom).toEqual([other.key, third.key]);
    const sheets = reportSheets({ tasks: rows, completion: { total: 1 } } as never, { title: 'Tasks', timeZone: TZ, generatedAt: NOW } as never, ['tasks']);
    const sheet = sheets.find((s) => s.name === 'Tasks')!;
    const col = sheet.columns.findIndex((c) => c.header === 'Merged from');
    expect(col).toBeGreaterThan(-1);
    expect(sheet.rows[0]![col]).toBe(`${other.key}, ${third.key}`);
    const one = await createPrismaTaskExportSource(prisma, TZ, () => NOW).load(main.id);
    expect(one!.mergedFrom).toEqual([other.key, third.key]);
    expect(await createPrismaTaskExportSource(prisma, TZ, () => NOW).load(other.id)).toBeNull();
  });

  it('the daily task emails', async () => {
    const pending = await createPrismaDailyEmailSources(prisma).tasks.pending(mateId);
    expect(pending.map((t) => t.key).filter((k) => k.startsWith(CODE))).toEqual([main.key]);
  });

  it('search: a merged task’s number and words find the main task; it is never a result of its own', async () => {
    const engine = createTaskSearchEngine({ prisma, timeZone: TZ });
    const byKey = await engine.search({ q: other.key, scope: { projectIds: null }, limit: 20 });
    expect(byKey.hits.map((h) => h.id)).toEqual([main.id]);
    const byWords = await engine.search({ q: 'quokkas', scope: { projectIds: null }, limit: 20 });
    expect(byWords.hits.map((h) => h.id)).toEqual([main.id]);
    // 1.23.0's search of everything: the merged task's file is the main task's now.
    const all = await createSearchEngine({ prisma, timeZone: TZ }).search({ q: 'quokka manual', scope: { projectIds: null, meetings: { full: null, invitee: [], editable: null } }, viewerId: managerId, limit: 20 });
    const files = all.hits.filter((h) => h.kind === 'file');
    expect(files).toHaveLength(1);
    expect(files[0]!).toMatchObject({ key: main.key });
    expect(all.hits.filter((h) => h.kind === 'task').map((h) => h.id)).toEqual([main.id]);
  });

  it('MICO AI: an old number finds the main task; lists never show a merged one', async () => {
    const data = createPrismaMicoAiData({ prisma, projectAccess: {} as never, meetingAccess: {} as never, conversationIdsFor: async () => [], finalMinutes: {} as never });
    expect((await data.findTask(null, other.key))?.id).toBe(main.id);
    expect((await data.tasks({ projectIds: [projectId] })).map((t) => t.id)).toEqual([main.id]);
  });

  it('the client page (and the Client portal, which reads it the same way)', async () => {
    const source = createPrismaClientViewSource(prisma);
    expect(await source.items(projectId)).toEqual([]);
    expect(await source.counts(projectId)).toEqual({ total: 1, done: 0 });
  });
});
