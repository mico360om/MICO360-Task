import { describe, it, expect, beforeEach } from 'vitest';
import { createTemplateService, checkProjectTemplate, TEMPLATE_LIMITS, type TemplateActor } from './template-service';
import { createMemoryTemplateRepository } from './memory-template-repository';
import type { ProjectSnapshot, ProjectTemplateInput } from './template-repository';

const TZ = 'Asia/Muscat';
const SUN_THU = [0, 1, 2, 3, 4];
// 10:00 on Tuesday 27 Oct 2026 in Muscat.
const NOW = new Date('2026-10-27T06:00:00Z');

const admin: TemplateActor = { id: 'admin', roles: ['ADMIN'] };
const lead: TemplateActor = { id: 'lead', roles: ['EMPLOYEE'] };
const member: TemplateActor = { id: 'member', roles: ['EMPLOYEE'] };
const outsider: TemplateActor = { id: 'outsider', roles: ['EMPLOYEE'] };

const board = [
  { name: 'To Do', category: 'TODO' as const, color: '#3A6EA5' },
  { name: 'Done', category: 'DONE' as const, color: '#2E7D53' },
];
const simple = (over: Partial<ProjectTemplateInput> = {}): ProjectTemplateInput => ({
  name: 'Rig inspection',
  description: null,
  columns: board,
  roles: [{ key: 'insp', name: 'Inspector' }],
  tasks: [{ title: 'Inspect', description: null, priority: 'NORMAL', dueOffsetDays: 5, roleKey: 'insp', checklist: ['Valves'] }],
  ...over,
});

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const rig: ProjectSnapshot = {
  id: 'p-rig',
  name: 'Rig 7',
  startDate: day('2026-11-01'),
  createdAt: new Date('2026-10-20T08:00:00Z'),
  columns: [
    { name: 'Backlog', category: 'BACKLOG', color: '#948985' },
    { name: 'Doing', category: 'IN_PROGRESS', color: '#B87611' },
    { name: 'Done', category: 'DONE', color: '#2E7D53' },
  ],
  tasks: [
    { id: 't1', title: 'Kick-off', description: 'Meet on site', priority: 'HIGH', dueDate: day('2026-11-01'), assigneeIds: ['omar', 'sara'], checklist: ['Agenda'] },
    { id: 't2', title: 'Inspect valves', description: null, priority: 'NORMAL', dueDate: day('2026-11-06'), assigneeIds: ['sara', 'omar'], checklist: [] },
    { id: 't3', title: 'Write report', description: null, priority: 'LOW', dueDate: null, assigneeIds: ['layla'], checklist: [] },
    { id: 't4', title: 'Prep', description: null, priority: 'NORMAL', dueDate: day('2026-10-29'), assigneeIds: [], checklist: [] },
  ],
};

let repo: ReturnType<typeof createMemoryTemplateRepository>;
let active: Set<string>;
let service: ReturnType<typeof createTemplateService>;

beforeEach(() => {
  repo = createMemoryTemplateRepository({ projects: [structuredClone(rig)], tasks: [{ id: 't1', projectId: 'p-rig', title: 'Kick-off', description: 'Meet on site', priority: 'HIGH', checklist: ['Agenda', 'Attendees'] }] });
  active = new Set(['admin', 'lead', 'member', 'omar', 'sara']);
  // lead runs Rig 7; member is on its team; outsider can't see it.
  service = createTemplateService({
    repo,
    canViewProject: async (userId, roles) => roles.includes('ADMIN') || userId === 'lead' || userId === 'member',
    canManageProject: async (userId, roles) => roles.includes('ADMIN') || userId === 'lead',
    people: { activeIds: async (ids) => ids.filter((id) => active.has(id)) },
    workingDays: async () => SUN_THU,
    timeZone: TZ,
    now: () => NOW,
    names: async (ids) => new Map(ids.map((id) => [id, id.toUpperCase()])),
  });
});

describe('who may manage templates', () => {
  it('only an administrator creates one from scratch', async () => {
    await expect(service.createProjectTemplate(simple(), lead)).rejects.toMatchObject({ status: 403 });
    await expect(service.createTaskTemplate({ name: 'x', title: 'x', description: null, priority: 'NORMAL', checklist: [] }, member)).rejects.toMatchObject({ status: 403 });
    const t = await service.createProjectTemplate(simple(), admin);
    expect(t).toMatchObject({ name: 'Rig inspection', createdById: 'admin', taskCount: 1 });
  });

  it('the person who made a template changes and deletes it; others can’t; an administrator can change any', async () => {
    const mine = await service.saveProjectAsTemplate('p-rig', { name: 'From Rig 7', description: null, roles: [] }, lead);
    await expect(service.updateProjectTemplate(mine.id, simple({ name: 'Renamed' }), member)).rejects.toMatchObject({ status: 403 });
    await expect(service.deleteProjectTemplate(mine.id, member)).rejects.toMatchObject({ status: 403 });
    expect((await service.updateProjectTemplate(mine.id, simple({ name: 'Renamed by lead' }), lead)).after.name).toBe('Renamed by lead');
    expect((await service.updateProjectTemplate(mine.id, simple({ name: 'Renamed by admin' }), admin)).after.name).toBe('Renamed by admin');
    await service.deleteProjectTemplate(mine.id, admin);
    await expect(service.getProjectTemplate(mine.id, member)).rejects.toMatchObject({ status: 404 });
  });

  it('everyone can use them: the list says who made each and whether you may change it', async () => {
    await service.createProjectTemplate(simple(), admin);
    await service.saveProjectAsTemplate('p-rig', { name: 'From Rig 7', description: null, roles: [] }, lead);
    const forMember = await service.listProjectTemplates(member);
    expect(forMember.map((t) => [t.name, t.createdByName, t.canManage])).toEqual([
      ['From Rig 7', 'LEAD', false],
      ['Rig inspection', 'ADMIN', false],
    ]);
    expect((await service.listProjectTemplates(lead)).map((t) => t.canManage)).toEqual([true, false]);
    expect((await service.listProjectTemplates(admin)).map((t) => t.canManage)).toEqual([true, true]);
  });

  it('task templates follow the same rule', async () => {
    const t = await service.saveTaskAsTemplate('t1', {}, lead);
    await expect(service.updateTaskTemplate(t.id, { ...t, name: 'Nope' }, member)).rejects.toMatchObject({ status: 403 });
    expect((await service.updateTaskTemplate(t.id, { ...t, name: 'Kick-off meeting' }, lead)).after.name).toBe('Kick-off meeting');
    await expect(service.deleteTaskTemplate(t.id, outsider)).rejects.toMatchObject({ status: 403 });
    await service.deleteTaskTemplate(t.id, admin);
    expect(await service.listTaskTemplates(member)).toEqual([]);
  });
});

describe('saving a project as a template', () => {
  it('is for whoever runs it: a plain member is refused, someone who can’t see it gets “not found”', async () => {
    await expect(service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, member)).rejects.toMatchObject({ status: 403 });
    await expect(service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, outsider)).rejects.toMatchObject({ status: 404 });
    await expect(service.projectDraft('p-rig', member)).rejects.toMatchObject({ status: 403 });
    await expect(service.projectDraft('p-rig', outsider)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps its board, and its tasks’ due dates as days from its start', async () => {
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'Rig standard', description: 'Our usual', roles: [] }, lead);
    expect(t.columns.map((c) => c.name)).toEqual(['Backlog', 'Doing', 'Done']);
    expect(t.tasks.map((x) => [x.title, x.dueOffsetDays, x.priority, x.checklist])).toEqual([
      ['Kick-off', 0, 'HIGH', ['Agenda']],
      ['Inspect valves', 5, 'NORMAL', []],
      ['Write report', null, 'LOW', []],
      ['Prep', -3, 'NORMAL', []],
    ]);
    expect(t.tasks[0]!.description).toBe('Meet on site');
  });

  it('without a start date, counts from the day it was created', async () => {
    repo.projects.get('p-rig')!.startDate = null;
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, lead);
    // Created 20 Oct: the kick-off on 1 Nov is 12 days later.
    expect(t.tasks.map((x) => x.dueOffsetDays)).toEqual([12, 17, null, 9]);
  });

  it('turns the people the saver names into roles; everyone else’s tasks are left unassigned', async () => {
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [{ userId: 'sara', name: 'Inspector' }, { userId: 'layla', name: '  ' }] }, lead);
    expect(t.roles.map((r) => r.name)).toEqual(['Inspector']);
    const insp = t.roles[0]!.id;
    // Kick-off: Omar first (no role), then Sara (Inspector) → Inspector.
    expect(t.tasks.map((x) => x.roleId)).toEqual([insp, insp, null, null]);
  });

  it('two people given the same role name share one role; the first assignee with a role names it', async () => {
    const t = await service.saveProjectAsTemplate(
      'p-rig',
      { name: 'x', description: null, roles: [{ userId: 'omar', name: 'Site lead' }, { userId: 'sara', name: 'Inspector' }, { userId: 'layla', name: 'site LEAD' }] },
      lead,
    );
    expect(t.roles.map((r) => r.name)).toEqual(['Site lead', 'Inspector']);
    const [siteLead, inspector] = t.roles.map((r) => r.id);
    expect(t.tasks.map((x) => x.roleId)).toEqual([siteLead, inspector, siteLead, null]);
  });

  it('drops roles no task names, and refuses a project with more tasks than a template holds', async () => {
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [{ userId: 'nobody', name: 'Ghost' }] }, lead);
    expect(t.roles).toEqual([]);
    const big = repo.projects.get('p-rig')!;
    big.tasks = Array.from({ length: TEMPLATE_LIMITS.tasks + 1 }, (_, i) => ({ id: `b${i}`, title: `T${i}`, description: null, priority: 'NORMAL' as const, dueDate: null, assigneeIds: [], checklist: [] }));
    await expect(service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, lead)).rejects.toMatchObject({ status: 400 });
  });

  it('a board whose open columns are all switched off falls back to the default board', async () => {
    repo.projects.get('p-rig')!.columns = [{ name: 'Done', category: 'DONE', color: '#2E7D53' }];
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, lead);
    expect(t.columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'Review', 'Done']);
  });

  it('the dialog’s draft: counts, the day offsets count from, and the people on its tasks', async () => {
    expect(await service.projectDraft('p-rig', lead)).toEqual({
      project: { id: 'p-rig', name: 'Rig 7' },
      base: { day: '2026-11-01', from: 'start' },
      taskCount: 4,
      columnCount: 3,
      columnsTotal: 3,
      maxTasks: TEMPLATE_LIMITS.tasks,
      checklistItems: 1,
      maxChecklistItems: TEMPLATE_LIMITS.checklistTotal,
      checklistTrimmed: 0,
      // Each task's people in the order they were assigned: the dialog works out what each role gets from them.
      assignments: [['omar', 'sara'], ['sara', 'omar'], ['layla'], []],
      people: [
        { id: 'omar', name: 'OMAR', taskCount: 2 },
        { id: 'sara', name: 'SARA', taskCount: 2 },
        { id: 'layla', name: 'LAYLA', taskCount: 1 },
      ],
    });
  });
});

describe('saving: what is dropped, and what is published', () => {
  it('says beforehand when it keeps only the first 100 checklist items of a task, or the first 20 columns', async () => {
    const snap = repo.projects.get('p-rig')!;
    snap.tasks[0]!.checklist = Array.from({ length: 130 }, (_, i) => `Item ${i + 1}`);
    snap.columns = Array.from({ length: 24 }, (_, i) => ({ name: `Col ${i + 1}`, category: 'TODO' as const, color: '#3A6EA5' }));
    const draft = await service.projectDraft('p-rig', lead);
    expect(draft).toMatchObject({ columnsTotal: 24, columnCount: 20, checklistTrimmed: 1, checklistItems: 100 });
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, lead);
    expect(t.columns).toHaveLength(20);
    expect(t.tasks[0]!.checklist).toHaveLength(100);
  });

  it('leaves the task descriptions out when asked', async () => {
    const t = await service.saveProjectAsTemplate('p-rig', { name: 'x', description: 'Kept: the template’s own', roles: [], includeDescriptions: false }, lead);
    expect(t.description).toBe('Kept: the template’s own');
    expect(t.tasks.map((x) => x.description)).toEqual([null, null, null, null]);
    const task = await service.saveTaskAsTemplate('t1', { includeDescription: false }, lead);
    expect(task.description).toBeNull();
    expect((await service.saveTaskAsTemplate('t1', {}, lead)).description).toBe('Meet on site');
  });

  it('refuses a project whose checklists add up to more than a template holds in all', async () => {
    const snap = repo.projects.get('p-rig')!;
    snap.tasks = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, title: `T${i}`, description: null, priority: 'NORMAL' as const, dueDate: null, assigneeIds: [], checklist: Array.from({ length: 90 }, (_, j) => `i${j}`) }));
    expect((await service.projectDraft('p-rig', lead)).checklistItems).toBe(5400);
    await expect(service.saveProjectAsTemplate('p-rig', { name: 'x', description: null, roles: [] }, lead)).rejects.toThrow(`at most ${TEMPLATE_LIMITS.checklistTotal.toLocaleString('en-US')} checklist items`);
  });
});

describe('saving a task as a template', () => {
  it('takes its title, description, checklist and priority; only whoever runs its project may', async () => {
    await expect(service.saveTaskAsTemplate('t1', {}, member)).rejects.toMatchObject({ status: 403 });
    await expect(service.saveTaskAsTemplate('t1', {}, outsider)).rejects.toMatchObject({ status: 404 });
    await expect(service.saveTaskAsTemplate('nope', {}, admin)).rejects.toMatchObject({ status: 404 });
    const t = await service.saveTaskAsTemplate('t1', { name: '  ' }, lead);
    expect(t).toMatchObject({ name: 'Kick-off', title: 'Kick-off', description: 'Meet on site', priority: 'HIGH', checklist: ['Agenda', 'Attendees'], createdById: 'lead' });
  });
});

describe('the rules a template keeps', () => {
  it('needs a column tasks can start in', () => {
    expect(() => checkProjectTemplate(simple({ columns: [{ name: 'Done', category: 'DONE', color: '#000' }] }))).toThrow(/isn’t Done/);
  });
  it('gives each role its own name', () => {
    expect(() => checkProjectTemplate(simple({ roles: [{ key: 'a', name: 'Inspector' }, { key: 'b', name: ' inspector ' }] }))).toThrow(/Two roles are called/);
  });
  it('holds at most 5,000 checklist items in all (100 per task)', () => {
    const tasks = Array.from({ length: 51 }, (_, i) => ({ title: `T${i}`, description: null, priority: 'NORMAL' as const, dueOffsetDays: null, roleKey: null, checklist: Array.from({ length: 99 }, (_, j) => `i${j}`) }));
    expect(() => checkProjectTemplate(simple({ roles: [], tasks }))).toThrow('A template can hold at most 5,000 checklist items in all; this one has 5,049.');
    expect(() => checkProjectTemplate(simple({ roles: [], tasks: tasks.slice(0, 50) }))).not.toThrow();
  });

  it('tasks only name its roles', () => {
    expect(() => checkProjectTemplate(simple({ roles: [] }))).toThrow(/names a role this template doesn’t have/);
  });
});

describe('making a project from a template', () => {
  let templateId = '';
  let roles: Record<string, string> = {};
  beforeEach(async () => {
    const t = await service.createProjectTemplate(
      simple({
        columns: [{ name: 'Backlog', category: 'BACKLOG', color: '#948985' }, ...board],
        roles: [{ key: 'insp', name: 'Inspector' }, { key: 'lead', name: 'Site lead' }],
        tasks: [
          { title: 'Kick-off', description: null, priority: 'HIGH', dueOffsetDays: 0, roleKey: 'lead', checklist: ['Agenda'] },
          { title: 'Inspect', description: 'Walk it', priority: 'NORMAL', dueOffsetDays: 5, roleKey: 'insp', checklist: [] },
          { title: 'Report', description: null, priority: 'LOW', dueOffsetDays: null, roleKey: null, checklist: [] },
          { title: 'Prep', description: null, priority: 'LOW', dueOffsetDays: -2, roleKey: null, checklist: [] },
        ],
      }),
      admin,
    );
    templateId = t.id;
    roles = Object.fromEntries(t.roles.map((r) => [r.name, r.id]));
  });

  it('plans the tasks with their dates, moving days off to the next working day, and starts them in To Do', async () => {
    const prep = await service.prepareProject(templateId, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: 'omar' }, defaultDueToday: false });
    expect(prep.startWith.startColumn).toBe(1);
    expect(prep.startWith.columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'Done']);
    expect(prep.startWith.tasks.map((t) => [t.title, t.dueDate?.toISOString().slice(0, 10) ?? null, t.startDate?.toISOString().slice(0, 10), t.assigneeIds])).toEqual([
      ['Kick-off', '2026-11-01', '2026-11-01', null],
      // Start + 5 is Friday 6 Nov: due Sunday 8 Nov.
      ['Inspect', '2026-11-08', '2026-11-01', ['omar']],
      ['Report', null, '2026-11-01', null],
      // Start − 2 is Friday 30 Oct, a day off: due Sunday 1 Nov, the start day.
      ['Prep', '2026-11-01', '2026-11-01', null],
    ]);
    expect(prep.fillerIds).toEqual(['omar']);
    expect(prep.filledRoles).toEqual([{ roleId: roles.Inspector, role: 'Inspector', userId: 'omar' }]);
    // The tasks appear on today's board.
    expect(prep.startWith.boardDate.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(prep.startWith.templateName).toBe('Rig inspection');
  });

  it('a task due before the start is under way from its due day', async () => {
    // Tuesday 3 Nov − 2 = Sunday 1 Nov (a working day).
    const prep = await service.prepareProject(templateId, { startKey: '2026-11-03', fillers: {}, defaultDueToday: false });
    const prepTask = prep.startWith.tasks[3]!;
    expect([prepTask.dueDate?.toISOString().slice(0, 10), prepTask.startDate?.toISOString().slice(0, 10)]).toEqual(['2026-11-01', '2026-11-01']);
  });

  it('one person can fill several roles, and a role nobody fills leaves its tasks to the usual default', async () => {
    const prep = await service.prepareProject(templateId, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: 'sara', [roles['Site lead']!]: 'sara' }, defaultDueToday: false });
    expect(prep.startWith.tasks.map((t) => t.assigneeIds)).toEqual([['sara'], ['sara'], null, null]);
    expect(prep.fillerIds).toEqual(['sara']);
    const none = await service.prepareProject(templateId, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: null }, defaultDueToday: false });
    expect(none.startWith.tasks.map((t) => t.assigneeIds)).toEqual([null, null, null, null]);
    expect(none.fillerIds).toEqual([]);
  });

  it('refuses an inactive person for a role, naming the role', async () => {
    await expect(service.prepareProject(templateId, { startKey: '2026-11-01', fillers: { [roles.Inspector!]: 'layla' }, defaultDueToday: false })).rejects.toThrow(
      'The person picked for Inspector isn’t an active user. Pick someone else.',
    );
  });

  it('refuses a role the template no longer has (it was changed meanwhile)', async () => {
    await expect(service.prepareProject(templateId, { startKey: '2026-11-01', fillers: { 'gone-role': 'omar' }, defaultDueToday: false })).rejects.toMatchObject({ status: 400, details: { code: 'TEMPLATE_CHANGED' } });
  });

  it('a past start date keeps the dates the template gives (they are overdue at once); the preview counts them', async () => {
    const prep = await service.prepareProject(templateId, { startKey: '2026-10-04', fillers: {}, defaultDueToday: false });
    expect(prep.startWith.tasks.map((t) => t.dueDate?.toISOString().slice(0, 10) ?? null)).toEqual(['2026-10-04', '2026-10-11', null, '2026-10-04']);
    const plan = await service.planProject(templateId, '2026-10-04');
    expect(plan).toMatchObject({ startDate: '2026-10-04', today: '2026-10-27', overdue: 3, startColumn: 1, workingDays: SUN_THU });
    expect(plan.tasks.map((t) => [t.title, t.dueDate, t.movedFrom, t.roleId, t.checklistCount])).toEqual([
      ['Kick-off', '2026-10-04', null, roles['Site lead'], 1],
      // Start + 5 = Friday 9 Oct → Sunday 11 Oct.
      ['Inspect', '2026-10-11', '2026-10-09', roles.Inspector, 0],
      ['Report', null, null, null, 0],
      // Start − 2 = Friday 2 Oct → Sunday 4 Oct.
      ['Prep', '2026-10-04', '2026-10-02', null, 0],
    ]);
    expect(plan.moved).toBe(2);
  });

  it('an undated task follows “New tasks are due today”, as any new task does — not when the project starts later', async () => {
    const soon = await service.prepareProject(templateId, { startKey: '2026-10-25', fillers: {}, defaultDueToday: true });
    expect(soon.startWith.tasks[2]!.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-27');
    const later = await service.prepareProject(templateId, { startKey: '2026-11-15', fillers: {}, defaultDueToday: true });
    expect(later.startWith.tasks[2]!.dueDate).toBeNull();
  });

  it('refuses when the template changed after its preview was shown (409, in plain words)', async () => {
    const plan = await service.planProject(templateId, '2026-11-01');
    const shownAt = new Date(plan.template.updatedAt).toISOString();
    // As shown: fine.
    await expect(service.prepareProject(templateId, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false, expectedUpdatedAt: shownAt })).resolves.toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    await service.updateProjectTemplate(templateId, simple({ name: 'Changed meanwhile' }), admin);
    await expect(service.prepareProject(templateId, { startKey: '2026-11-01', fillers: {}, defaultDueToday: false, expectedUpdatedAt: shownAt })).rejects.toMatchObject({
      status: 409,
      code: 'TEMPLATE_CHANGED',
      message: 'This template was changed while you were looking at it — check the preview again.',
    });
  });

  it('a template that is gone answers “not found”', async () => {
    await expect(service.prepareProject('nope', { startKey: '2026-11-01', fillers: {}, defaultDueToday: false })).rejects.toMatchObject({ status: 404 });
    await expect(service.planProject('nope', '2026-11-01')).rejects.toMatchObject({ status: 404 });
  });
});
