import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTemplateRepository } from '../../src/modules/templates/prisma-template-repository';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createTemplateService } from '../../src/modules/templates/template-service';
import type { ProjectTemplateInput } from '../../src/modules/templates/template-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaTemplateRepository(prisma);
const projects = createPrismaProjectRepository(prisma);
const people = createPrismaPeopleLookup(prisma);
const projectService = createProjectService({ projects, people });
const NOW = new Date('2026-10-27T06:00:00Z');
const service = createTemplateService({
  repo,
  canViewProject: async () => true,
  canManageProject: async () => true,
  people,
  workingDays: async () => [0, 1, 2, 3, 4],
  timeZone: 'Asia/Muscat',
  now: () => NOW,
});

const CODES = ['TPLA', 'TPLB', 'TPLC', 'TPLBIG', 'TPLRB', 'TPLD', 'TPLMAX', 'TPLX'];
const NAMES = ['creator', 'owner', 'omar', 'sara', 'inactive'] as const;
const EMAIL = (n: string) => `templates-${n}@mico360.test`;
const id: Record<(typeof NAMES)[number], string> = {} as never;
const mineTemplates = new Set<string>();

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const ids = ps.map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.taskKeyAlias.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.projectTemplate.deleteMany({ where: { id: { in: [...mineTemplates] } } });
  await prisma.taskTemplate.deleteMany({ where: { createdById: { in: Object.values(id).filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { email: { in: NAMES.map(EMAIL) } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  mineTemplates.clear();
  for (const n of NAMES) {
    id[n] = (await prisma.user.create({ data: { email: EMAIL(n), username: `templates-${n}`, passwordHash: 'x', firstName: n, lastName: 'Test', ...(n === 'inactive' ? { status: 'INACTIVE' as const } : {}) } })).id;
  }
});

const input = (over: Partial<ProjectTemplateInput> = {}): ProjectTemplateInput => ({
  name: 'Rig inspection',
  description: 'The usual',
  columns: [
    { name: 'Backlog', category: 'BACKLOG', color: '#948985' },
    { name: 'To Do', category: 'TODO', color: '#3A6EA5' },
    { name: 'Done', category: 'DONE', color: '#2E7D53' },
  ],
  roles: [{ key: 'insp', name: 'Inspector' }, { key: 'lead', name: 'Site lead' }],
  tasks: [
    { title: 'Kick-off', description: null, priority: 'HIGH', dueOffsetDays: 0, roleKey: 'lead', checklist: ['Agenda', 'Attendees'] },
    { title: 'Inspect', description: 'Walk the site', priority: 'NORMAL', dueOffsetDays: 5, roleKey: 'insp', checklist: [] },
    { title: 'Report', description: null, priority: 'LOW', dueOffsetDays: null, roleKey: null, checklist: ['Draft'] },
  ],
  ...over,
});

async function saved(over: Partial<ProjectTemplateInput> = {}) {
  const t = await repo.createProjectTemplate(input(over), id.creator);
  mineTemplates.add(t.id);
  return t;
}

describe('Templates (integration)', () => {
  it('stores a template whole and reads it back in order', async () => {
    const t = await saved();
    const back = await repo.findProjectTemplate(t.id);
    expect(back).toMatchObject({ name: 'Rig inspection', description: 'The usual', createdById: id.creator, columnCount: 3, roleCount: 2, taskCount: 3 });
    expect(back!.columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'Done']);
    expect(back!.roles.map((r) => r.name)).toEqual(['Inspector', 'Site lead']);
    const insp = back!.roles[0]!.id;
    expect(back!.tasks.map((x) => [x.title, x.dueOffsetDays, x.roleId === null ? null : x.roleId === insp ? 'insp' : 'lead', x.checklist])).toEqual([
      ['Kick-off', 0, 'lead', ['Agenda', 'Attendees']],
      ['Inspect', 5, 'insp', []],
      ['Report', null, null, ['Draft']],
    ]);
    const list = await repo.listProjectTemplates();
    expect(list.find((s) => s.id === t.id)).toMatchObject({ taskCount: 3, roleCount: 2, columnCount: 3 });
  });

  it('a replace keeps a role’s id when it is named by it, and swaps the tasks in one go', async () => {
    const t = await saved();
    const insp = t.roles.find((r) => r.name === 'Inspector')!.id;
    const after = await repo.updateProjectTemplate(
      t.id,
      input({ name: 'Renamed', roles: [{ key: insp, name: 'Senior inspector' }, { key: 'new', name: 'Driver' }], tasks: [{ title: 'Only', description: null, priority: 'URGENT', dueOffsetDays: 2, roleKey: insp, checklist: [] }, { title: 'Drive', description: null, priority: 'LOW', dueOffsetDays: 1, roleKey: 'new', checklist: [] }] }),
      id.owner,
    );
    expect(after!.roles.map((r) => [r.name, r.id === insp])).toEqual([['Senior inspector', true], ['Driver', false]]);
    expect(after!.tasks.map((x) => [x.title, x.roleId === insp])).toEqual([['Only', true], ['Drive', false]]);
    expect(await prisma.projectTemplateRole.count({ where: { templateId: t.id } })).toBe(2);
    expect(await prisma.projectTemplateTask.count({ where: { templateId: t.id } })).toBe(2);
    expect(after!.createdById).toBe(id.creator);
    expect(await repo.updateProjectTemplate('no-such-template', input(), id.owner)).toBeNull();
  });

  it('makes a project from a template in one transaction: board, tasks CODE-1…, checklists, assignees, team', async () => {
    const t = await saved();
    const roles = Object.fromEntries(t.roles.map((r) => [r.name, r.id]));
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: id.omar, [roles['Site lead']!]: id.omar }, defaultDueToday: false });
    const { team, ...p } = await projectService.createProject(
      { code: 'TPLA', name: 'From a template', ownerId: id.owner, createdById: id.creator, memberIds: prep.fillerIds, startDate: new Date('2026-11-01T00:00:00Z'), startWith: prep.startWith },
      { id: id.creator, roles: ['EMPLOYEE'] },
    );
    expect(team.map((m) => m.userId).sort()).toEqual([id.creator, id.owner, id.omar].sort());
    const columns = await prisma.kanbanColumn.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' } });
    expect(columns.map((c) => [c.name, c.category, c.position])).toEqual([['Backlog', 'BACKLOG', 0], ['To Do', 'TODO', 1], ['Done', 'DONE', 2]]);
    const tasks = await prisma.task.findMany({
      where: { projectId: p.id },
      orderBy: { position: 'asc' },
      include: { checklist: { orderBy: { position: 'asc' } }, assignees: true },
    });
    expect(tasks.map((x) => [x.key, x.title, x.columnId === columns[1]!.id, x.dueDate?.toISOString().slice(0, 10) ?? null, x.assignees.map((a) => a.userId), x.checklist.map((c) => [c.text, c.done])])).toEqual([
      ['TPLA-1', 'Kick-off', true, '2026-11-01', [id.omar], [['Agenda', false], ['Attendees', false]]],
      ['TPLA-2', 'Inspect', true, '2026-11-08', [id.omar], []],
      // No role: the project's owner, as for any new task.
      ['TPLA-3', 'Report', true, null, [id.owner], [['Draft', false]]],
    ]);
    expect(tasks[0]).toMatchObject({ priority: 'HIGH', createdById: id.creator, progress: 0, completedAt: null });
    expect(tasks[1]!.description).toBe('Walk the site');
    // On today's board, with a "created" line in each task's history.
    expect(tasks.every((x) => x.boardDate?.toISOString() === '2026-10-27T12:00:00.000Z')).toBe(true);
    const created = await prisma.activity.findMany({ where: { projectId: p.id, action: 'CREATED' } });
    expect(created).toHaveLength(3);
    expect(created[0]!.meta).toMatchObject({ template: 'Rig inspection' });
    // The next task created by hand continues the numbers.
    expect(await prisma.project.findUnique({ where: { id: p.id }, select: { startDate: true } })).toEqual({ startDate: new Date('2026-11-01T00:00:00Z') });
    const { highestKeyNumber } = await import('../../src/modules/tasks/prisma-task-repository');
    expect(await highestKeyNumber(prisma, p.id)).toBe(3);
  });

  it('a project without an owner leaves the unfilled tasks unassigned', async () => {
    const t = await saved();
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false });
    const p = await projectService.createProject({ code: 'TPLC', name: 'No owner', ownerId: null, createdById: id.creator, startWith: prep.startWith }, { id: id.creator, roles: ['ADMIN'] });
    expect(await prisma.taskAssignee.count({ where: { task: { projectId: p.id } } })).toBe(0);
  });

  it('writes nothing when the project can’t be created (its code is taken)', async () => {
    await prisma.project.create({ data: { code: 'TPLB', name: 'Taken', createdById: id.creator } });
    const t = await saved();
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false });
    const before = await prisma.task.count();
    await expect(projects.create({ code: 'TPLB', name: 'Clash', createdById: id.creator, members: [{ userId: id.sara, role: 'MEMBER' }], startWith: prep.startWith })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.task.count()).toBe(before);
    expect(await prisma.projectMember.count({ where: { userId: id.sara } })).toBe(0);
  });

  it('gives each person a task is assigned to an "assigned" line in its history, as creating it by hand does', async () => {
    const t = await saved();
    const roles = Object.fromEntries(t.roles.map((r) => [r.name, r.id]));
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: id.sara }, defaultDueToday: false });
    const p = await projectService.createProject({ code: 'TPLA', name: 'History', ownerId: id.owner, createdById: id.creator, memberIds: prep.fillerIds, startWith: prep.startWith }, { id: id.creator, roles: ['EMPLOYEE'] });
    const lines = await prisma.activity.findMany({ where: { projectId: p.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { task: { select: { title: true } } } });
    const of = (title: string) => lines.filter((l) => l.task?.title === title).map((l) => [l.action, (l.meta as { assignee?: string } | null)?.assignee ?? null, (l.meta as { assigneeId?: string } | null)?.assigneeId ?? null]);
    // Kick-off: its role nobody fills → the owner; Inspect: Sara; Report: no role → the owner.
    expect(of('Kick-off')).toEqual([['CREATED', null, null], ['ASSIGNED', 'owner Test', id.owner]]);
    expect(of('Inspect')).toEqual([['CREATED', null, null], ['ASSIGNED', 'sara Test', id.sara]]);
    expect(lines.every((l) => l.userId === id.creator)).toBe(true);
  });

  it('rolls everything back when a write fails after the tasks are in: no project, columns, tasks, checklists, people or team', async () => {
    const t = await saved();
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false });
    // The tasks and their checklists are written, then assigning someone who doesn't exist fails.
    prep.startWith.tasks[2]!.assigneeIds = ['no-such-user'];
    const before = { tasks: await prisma.task.count(), items: await prisma.checklistItem.count(), assignees: await prisma.taskAssignee.count(), activity: await prisma.activity.count() };
    await expect(
      projects.create({ code: 'TPLRB', name: 'Rolled back', createdById: id.creator, ownerId: id.owner, members: [{ userId: id.creator, role: 'MANAGER' }, { userId: id.owner, role: 'MEMBER' }], startWith: prep.startWith }),
    ).rejects.toBeTruthy();
    expect(await prisma.project.count({ where: { code: 'TPLRB' } })).toBe(0);
    expect(await prisma.kanbanColumn.count({ where: { project: { code: 'TPLRB' } } })).toBe(0);
    expect(await prisma.projectMember.count({ where: { project: { code: 'TPLRB' } } })).toBe(0);
    expect({ tasks: await prisma.task.count(), items: await prisma.checklistItem.count(), assignees: await prisma.taskAssignee.count(), activity: await prisma.activity.count() }).toEqual(before);
  });

  it('a clash on another unique index is not reported as “that code is taken”', async () => {
    // A task in another project already holds the key TPLD-1 (data from before keys were checked).
    const other = await prisma.project.create({ data: { code: 'TPLX', name: 'Other', createdById: id.creator } });
    const col = await prisma.kanbanColumn.create({ data: { projectId: other.id, name: 'To Do', category: 'TODO', position: 0 } });
    await prisma.task.create({ data: { key: 'TPLD-1', title: 'Squatter', projectId: other.id, columnId: col.id, createdById: id.creator } });
    const t = await saved();
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false });
    const err = await projects.create({ code: 'TPLD', name: 'Clash', createdById: id.creator, startWith: prep.startWith }).catch((e) => e);
    expect(err).toBeTruthy();
    expect(err.code).not.toBe('DUPLICATE_PROJECT_CODE');
    expect(await prisma.project.count({ where: { code: 'TPLD' } })).toBe(0);
  });

  it('at the limits: 500 tasks and 5,000 checklist items, with long descriptions, in one transaction', async () => {
    const tasks = Array.from({ length: 500 }, (_, i) => ({
      title: `Step ${i + 1}`,
      description: 'ع'.repeat(32000) + ` ${i}`,
      priority: 'NORMAL' as const,
      dueOffsetDays: i % 120,
      roleKey: i % 2 ? 'insp' : null,
      checklist: Array.from({ length: 10 }, (_, j) => `Check ${j + 1} of step ${i + 1}`),
    }));
    const t = await saved({ tasks });
    expect(t.taskCount).toBe(500);
    const roles = Object.fromEntries(t.roles.map((r) => [r.name, r.id]));
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: id.sara }, defaultDueToday: false });
    const t0 = Date.now();
    const p = await projectService.createProject({ code: 'TPLMAX', name: 'At the limits', ownerId: id.owner, createdById: id.creator, memberIds: prep.fillerIds, startWith: prep.startWith }, { id: id.creator, roles: ['EMPLOYEE'] });
    const took = Date.now() - t0;
    expect(await prisma.task.count({ where: { projectId: p.id } })).toBe(500);
    expect(await prisma.checklistItem.count({ where: { task: { projectId: p.id } } })).toBe(5000);
    expect(await prisma.taskAssignee.count({ where: { task: { projectId: p.id } } })).toBe(500);
    expect(await prisma.activity.count({ where: { projectId: p.id } })).toBe(1000);
    expect((await prisma.task.findFirst({ where: { projectId: p.id, key: 'TPLMAX-500' }, select: { description: true } }))!.description!.length).toBe(32004);
    expect(took).toBeLessThan(15_000);
  });

  it('a 200-task template becomes a project fast', async () => {
    const tasks = Array.from({ length: 200 }, (_, i) => ({ title: `Task ${i + 1}`, description: `Step ${i + 1}`, priority: 'NORMAL' as const, dueOffsetDays: i % 60, roleKey: i % 2 ? 'insp' : null, checklist: ['One', 'Two', 'Three', 'Four', 'Five'] }));
    const t = await saved({ tasks });
    const roles = Object.fromEntries(t.roles.map((r) => [r.name, r.id]));
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: id.sara }, defaultDueToday: false });
    const t0 = Date.now();
    const p = await projectService.createProject({ code: 'TPLBIG', name: 'Big', ownerId: id.owner, createdById: id.creator, memberIds: prep.fillerIds, startWith: prep.startWith }, { id: id.creator, roles: ['EMPLOYEE'] });
    const took = Date.now() - t0;
    expect(await prisma.task.count({ where: { projectId: p.id } })).toBe(200);
    expect(await prisma.checklistItem.count({ where: { task: { projectId: p.id } } })).toBe(1000);
    expect(await prisma.taskAssignee.count({ where: { task: { projectId: p.id }, userId: id.sara } })).toBe(100);
    const keys = (await prisma.task.findMany({ where: { projectId: p.id }, select: { key: true } })).map((k) => Number(k.key.split('-')[1])).sort((a, b) => a - b);
    expect(keys).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(took).toBeLessThan(5000);
  });

  it('deleting a template never touches the projects made from it', async () => {
    const t = await saved();
    const prep = await service.prepareProject(t.id, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false });
    const p = await projectService.createProject({ code: 'TPLA', name: 'Stays', createdById: id.creator, startWith: prep.startWith }, { id: id.creator, roles: ['ADMIN'] });
    expect(await repo.deleteProjectTemplate(t.id)).toBe(true);
    expect(await repo.deleteProjectTemplate(t.id)).toBe(false);
    expect(await prisma.projectTemplateTask.count({ where: { templateId: t.id } })).toBe(0);
    expect(await prisma.projectTemplateRole.count({ where: { templateId: t.id } })).toBe(0);
    expect(await prisma.task.count({ where: { projectId: p.id } })).toBe(3);
    expect(await prisma.kanbanColumn.count({ where: { projectId: p.id } })).toBe(3);
  });

  it('reads a project for "save as template": switched-on columns, live tasks once per repeating series, assignees in order', async () => {
    const p = await prisma.project.create({ data: { code: 'TPLA', name: 'Source', createdById: id.creator, startDate: new Date('2026-11-01T00:00:00Z') } });
    const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To Do', category: 'TODO', position: 0 } });
    await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Hidden', category: 'BLOCKED', position: 1, enabled: false } });
    await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 2, color: '#2E7D53' } });
    const mk = (key: string, title: string, extra = {}) => prisma.task.create({ data: { key, title, projectId: p.id, columnId: todo.id, createdById: id.creator, ...extra } });
    const first = await mk('TPLA-1', 'Weekly check', { recurrenceRule: { freq: 'WEEKLY', interval: 1 }, dueDate: new Date('2026-11-03T00:00:00Z') });
    await mk('TPLA-2', 'Weekly check', { recurrenceParentId: first.id, dueDate: new Date('2026-11-10T00:00:00Z') });
    const other = await mk('TPLA-3', 'Report', { priority: 'HIGH', description: 'Write it' });
    await mk('TPLA-4', 'Deleted', { deletedAt: new Date() });
    await prisma.taskAssignee.create({ data: { taskId: other.id, userId: id.sara, assignedAt: new Date('2026-10-01T00:00:00Z') } });
    await prisma.taskAssignee.create({ data: { taskId: other.id, userId: id.omar, assignedAt: new Date('2026-10-02T00:00:00Z') } });
    await prisma.checklistItem.create({ data: { taskId: other.id, text: 'Second', position: 1, done: true } });
    await prisma.checklistItem.create({ data: { taskId: other.id, text: 'First', position: 0 } });
    const snap = await repo.projectSnapshot(p.id);
    expect(snap!.columns.map((c) => c.name)).toEqual(['To Do', 'Done']);
    expect(snap!.tasks.map((x) => [x.title, x.dueDate?.toISOString().slice(0, 10) ?? null, x.assigneeIds, x.checklist])).toEqual([
      ['Weekly check', '2026-11-03', [], []],
      ['Report', null, [id.sara, id.omar], ['First', 'Second']],
    ]);
    expect(await repo.taskSnapshot(other.id)).toMatchObject({ projectId: p.id, title: 'Report', description: 'Write it', priority: 'HIGH', checklist: ['First', 'Second'] });
    expect(await repo.projectSnapshot('no-such-project')).toBeNull();
  });

  it('a new task written with its checklist (the New task form, filled in from a task template)', async () => {
    const { createPrismaTaskRepository } = await import('../../src/modules/tasks/prisma-task-repository');
    const p = await prisma.project.create({ data: { code: 'TPLA', name: 'Tasks', createdById: id.creator } });
    const col = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To Do', category: 'TODO', position: 0 } });
    const t = await createPrismaTaskRepository(prisma).create({ key: 'TPLA-1', title: 'Site check', projectId: p.id, columnId: col.id, createdById: id.creator, checklist: ['Gate', 'Fence'] });
    const items = await prisma.checklistItem.findMany({ where: { taskId: t.id }, orderBy: { position: 'asc' } });
    expect(items.map((i) => [i.text, i.position, i.done])).toEqual([['Gate', 0, false], ['Fence', 1, false]]);
  });

  it('task templates: create, change, list and delete', async () => {
    const t = await repo.createTaskTemplate({ name: 'Site check', title: 'Check the site', description: null, priority: 'HIGH', checklist: ['Gate'] }, id.creator);
    const changed = await repo.updateTaskTemplate(t.id, { name: 'Site check', title: 'Check the whole site', description: 'All of it', priority: 'LOW', checklist: ['Gate', 'Fence'] }, id.owner);
    expect(changed).toMatchObject({ title: 'Check the whole site', description: 'All of it', priority: 'LOW', checklist: ['Gate', 'Fence'], createdById: id.creator });
    expect((await repo.listTaskTemplates()).some((x) => x.id === t.id)).toBe(true);
    expect(await repo.deleteTaskTemplate(t.id)).toBe(true);
    expect(await repo.findTaskTemplate(t.id)).toBeNull();
  });
});
