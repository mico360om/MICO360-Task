import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError } from '../../lib/http-errors';
import { copyOf, createTaskDuplicateService, NEVER_COPIED, startColumn, withCopySuffix, type OriginalTask, type TaskDuplicatePorts } from './task-duplicate';
import type { NewTask, TaskService } from './task-service';
import type { TaskRecord } from './task-repository';
import type { AssigneeService } from './assignee-service';
import type { TaskActivityEvent } from '../activity/task-activity';

const TZ = 'Asia/Muscat';

const original = (over: Partial<OriginalTask> = {}): OriginalTask => ({
  id: 'orig',
  key: 'MSSP-34',
  title: 'Inspect the rig',
  description: 'Check every valve.',
  projectId: 'p1',
  priority: 'HIGH',
  // 3 Nov 09:00 in Muscat; due 6 Nov
  startDate: new Date('2026-11-03T05:00:00Z'),
  dueDate: new Date('2026-11-06T00:00:00Z'),
  estimatedHours: 4,
  isMilestone: true,
  weight: 3,
  inspectionFormId: 'form1',
  inspectionFormLive: true,
  inspectionPlace: 'Rig 3',
  tagNames: ['safety', 'rig'],
  assigneeIds: ['omar', 'sara', 'left'],
  watcherIds: ['nadia', 'outsider'],
  checklists: [
    { title: 'Before', items: [{ text: 'Valves', children: [{ text: 'Main valve' }, { text: 'Spare valve', children: [{ text: 'Seal' }] }] }, { text: 'Gauges' }] },
    { title: 'After', items: [{ text: 'Report' }] },
  ],
  externalContacts: [{ name: 'Ahmed Al Said', company: 'OXY', designation: null, email: null, phone: null, remarks: null }],
  files: [
    { id: 'f1', filename: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 300, storageKey: 'k1' },
    { id: 'f2', filename: 'site.dwg', mimeType: 'application/acad', sizeBytes: 900, storageKey: 'k2' },
    { id: 'f3', filename: 'photo.png', mimeType: 'image/png', sizeBytes: 50, storageKey: 'k3' },
  ],
  ...over,
});

describe('copyOf: what a copy carries', () => {
  it('copies the title, description, people, priority, dates, tags, checklists, contacts, form and place, watchers and files', () => {
    const c = copyOf(original());
    expect(c).toMatchObject({
      title: 'Inspect the rig',
      description: 'Check every valve.',
      priority: 'HIGH',
      startDate: new Date('2026-11-03T05:00:00Z'),
      dueDate: new Date('2026-11-06T00:00:00Z'),
      estimatedHours: 4,
      isMilestone: true,
      weight: 3,
      inspectionFormId: 'form1',
      inspectionPlace: 'Rig 3',
      tags: ['safety', 'rig'],
      assigneeIds: ['omar', 'sara', 'left'],
      watcherIds: ['nadia', 'outsider'],
    });
    expect(c.externalContacts).toEqual([{ name: 'Ahmed Al Said', company: 'OXY', designation: null, email: null, phone: null, remarks: null }]);
    expect(c.files.map((f) => f.filename)).toEqual(['plan.pdf', 'site.dwg', 'photo.png']);
  });

  it('keeps the checklists’ titles and nesting, with nothing ticked, no people and no dates', () => {
    const c = copyOf(original());
    expect(c.checklists).toEqual(original().checklists);
    expect(JSON.stringify(c.checklists)).not.toMatch(/done|assignee|dueDate/);
  });

  it('leaves a deleted inspection form out, and its place with it', () => {
    expect(copyOf(original({ inspectionFormLive: false }))).toMatchObject({ inspectionFormId: null, inspectionPlace: null });
  });

  it('never carries comments, history, status, completion, approvals, the repeat, merge or bin state, the meeting or client visibility', () => {
    const keys = Object.keys(copyOf(original()));
    for (const k of ['columnId', 'completedAt', 'progress', 'recurrenceRule', 'recurrenceParentId', 'needsApproval', 'approvedAt', 'meetingId', 'clientVisible', 'mergedIntoId', 'deletedAt', 'comments', 'activity']) {
      expect(keys).not.toContain(k);
    }
    expect(NEVER_COPIED).toEqual(expect.arrayContaining(['comments', 'history', 'status', 'approvals', 'repeat', 'meeting']));
  });

  it('marks a copy made without a review “(copy)”, still fitting a title', () => {
    expect(copyOf(original(), { markCopy: true }).title).toBe('Inspect the rig (copy)');
    const long = 'x'.repeat(191);
    expect(withCopySuffix(long)).toHaveLength(191);
    expect(withCopySuffix(long).endsWith(' (copy)')).toBe(true);
  });
});

describe('startColumn: where a copy starts', () => {
  const col = (id: string, category: string, position: number, enabled = true) => ({ id, category, position, enabled });
  it('is the first To-do column, then Backlog, then the first open one', () => {
    expect(startColumn([col('d', 'DONE', 0), col('t2', 'TODO', 3), col('t1', 'TODO', 1), col('ip', 'IN_PROGRESS', 2)])?.id).toBe('t1');
    expect(startColumn([col('ip', 'IN_PROGRESS', 2), col('b', 'BACKLOG', 1)])?.id).toBe('b');
    expect(startColumn([col('d', 'DONE', 0), col('r', 'REVIEW', 1)])?.id).toBe('r');
    expect(startColumn([col('d', 'DONE', 0)])).toBeNull();
  });
  it('skips a column switched off in Manage columns', () => {
    expect(startColumn([col('t1', 'TODO', 0, false), col('t2', 'TODO', 1)])?.id).toBe('t2');
  });
});

/** A small world: p1 (omar, sara, nadia; MSSP), p2 (omar, nadia; RIG). "left" is no longer on any team, "outsider" never was. */
function world(opts: { visible?: boolean; scope?: string[] | null; refuse?: Set<string>; missing?: Set<string> } = {}) {
  const created: NewTask[] = [];
  const notified: string[][] = [];
  const watchersAdded: Record<string, string[]> = {};
  const uploads: { taskId: string; filename: string; bytes: number }[] = [];
  const activity: TaskActivityEvent[] = [];
  const team: Record<string, string[]> = { p1: ['omar', 'sara', 'nadia', 'me'], p2: ['omar', 'nadia', 'me'] };
  const codes: Record<string, string> = { p1: 'MSSP', p2: 'RIG' };
  let n = 40;
  const taskService = {
    async createTask(input: NewTask): Promise<TaskRecord> {
      created.push(input);
      const now = new Date();
      return {
        id: `copy${n}`, key: `${codes[input.projectId]}-${n++}`, title: input.title, description: input.description ?? null, projectId: input.projectId, columnId: input.columnId,
        position: 0, priority: input.priority ?? 'NORMAL', startDate: input.startDate ?? null, dueDate: input.dueDate ?? null, estimatedHours: input.estimatedHours ?? null, actualHours: null,
        progress: 0, createdById: input.createdById, completedAt: null, recurrenceRule: null, recurrenceParentId: null, boardDate: null, version: 0, createdAt: now, updatedAt: now,
      };
    },
  } as unknown as TaskService;
  const assigneeService = {
    async eligibleAssignees(projectId: string, ids: string[]) { return ids.filter((id) => team[projectId]?.includes(id)); },
    async assertAssignable(projectId: string, ids: string[]) {
      const bad = ids.filter((id) => !team[projectId]?.includes(id));
      if (bad.length) throw new ValidationError('Only active members of this project can be assigned.');
      return [...new Set(ids)];
    },
    async notifyAssigned(_taskId: string, ids: string[]) { notified.push(ids); },
    async listAssignees(taskId: string) { return (created.at(-1)?.assigneeIds ?? []).map((id) => ({ id, taskId })); },
  } as unknown as AssigneeService;
  const files: Record<string, Buffer> = { k1: Buffer.from('%PDF-1.4 plan'), k2: Buffer.from('AC1027 drawing'), k3: Buffer.from('png bytes') };
  const ports: TaskDuplicatePorts = {
    async original(id) { return id === 'orig' ? original() : null; },
    async canViewTask(_actor, id) { return id === 'orig' && opts.visible !== false; },
    async peopleWhoSee(projectId, ids) { return ids.filter((id) => team[projectId]?.includes(id)); },
    async namesOf(ids) { return new Map(ids.map((id) => [id, id.charAt(0).toUpperCase() + id.slice(1)])); },
    async columnsOf(projectId) { return [{ id: `${projectId}-done`, category: 'DONE', position: 0, enabled: true }, { id: `${projectId}-todo`, category: 'TODO', position: 1, enabled: true }]; },
    async addWatchers(taskId, ids) { watchersAdded[taskId] = ids; },
    async readFile(key) { return opts.missing?.has(key) ? null : (files[key] ?? null); },
    async uploadFile(taskId, _by, file) {
      if (opts.refuse?.has(file.filename)) throw new ValidationError(`“${file.filename}” is a type of file that can’t be uploaded.`);
      uploads.push({ taskId, filename: file.filename, bytes: file.content.length });
    },
    async recordActivity(e) { activity.push(e); },
    pipeline: { taskService, assigneeService, scopeOf: async () => (opts.scope === undefined ? ['p1', 'p2'] : opts.scope) },
    timeZone: TZ,
  };
  return { service: createTaskDuplicateService(ports), created, notified, watchersAdded, uploads, activity };
}

const me = { id: 'me', roles: ['EMPLOYEE'] };
const reviewed = (over: Record<string, unknown> = {}) => ({ title: 'Inspect the rig', projectId: 'p1', priority: 'HIGH' as const, assigneeIds: ['omar', 'sara'], ...over });

describe('prefill: the review form, filled in from the original', () => {
  it('is “not found” for someone who can’t open the original', async () => {
    await expect(world({ visible: false }).service.prefill(me, 'orig')).rejects.toMatchObject({ status: 404 });
    await expect(world().service.prefill(me, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('has the New task form’s fields, only people still on the project, the first To-do column, days in company time and the files', async () => {
    const p = await world().service.prefill(me, 'orig');
    expect(p.original).toEqual({ id: 'orig', key: 'MSSP-34', title: 'Inspect the rig', projectId: 'p1' });
    expect(p.task).toMatchObject({
      title: 'Inspect the rig',
      projectId: 'p1',
      columnId: 'p1-todo',
      startDate: '2026-11-03',
      dueDate: '2026-11-06',
      assigneeIds: ['omar', 'sara'],
      tags: ['safety', 'rig'],
      inspectionFormId: 'form1',
      inspectionPlace: 'Rig 3',
      isMilestone: true,
      weight: 3,
      estimatedHours: 4,
    });
    expect(p.task.checklists[0]!.items[0]!.children).toHaveLength(2);
    expect(p.watchers).toEqual([{ id: 'nadia', name: 'Nadia' }]);
    expect(p.files).toEqual([
      { id: 'f1', filename: 'plan.pdf', sizeBytes: 300, mimeType: 'application/pdf' },
      { id: 'f2', filename: 'site.dwg', sizeBytes: 900, mimeType: 'application/acad' },
      { id: 'f3', filename: 'photo.png', sizeBytes: 50, mimeType: 'image/png' },
    ]);
    expect(JSON.stringify(p)).not.toContain('storageKey');
  });
});

describe('duplicate: a new task from the reviewed form', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it('is “not found” when the original can’t be opened — nothing is made', async () => {
    const hidden = world({ visible: false });
    await expect(hidden.service.duplicate(me, 'orig', { body: reviewed() })).rejects.toMatchObject({ status: 404 });
    expect(hidden.created).toHaveLength(0);
  });

  it('is refused (403) when the person can’t add tasks to the chosen project — nothing is made', async () => {
    const narrow = world({ scope: ['p1'] });
    await expect(narrow.service.duplicate(me, 'orig', { body: reviewed({ projectId: 'p2' }) })).rejects.toMatchObject({ status: 403 });
    expect(narrow.created).toHaveLength(0);
    expect(narrow.uploads).toHaveLength(0);
  });

  it('makes the task as any new task — the reviewed fields, in the first To-do column, remembering the original', async () => {
    const r = await w.service.duplicate(me, 'orig', { body: reviewed({ title: 'Inspect the rig again', checklists: original().checklists }) });
    expect(r.task.key).toBe('MSSP-40');
    const made = w.created[0]!;
    expect(made).toMatchObject({ title: 'Inspect the rig again', projectId: 'p1', columnId: 'p1-todo', createdById: 'me', duplicatedFromId: 'orig', assigneeIds: ['omar', 'sara'] });
    expect(made.checklists).toEqual(original().checklists);
    // The assignees are told, as for any new task.
    expect(w.notified).toEqual([['omar', 'sara']]);
  });

  it('takes what the form has no field for from the original: tags, the start date, the estimate and the weight', async () => {
    await w.service.duplicate(me, 'orig', { body: reviewed({ dueDate: new Date('2026-11-10T00:00:00Z') }) });
    expect(w.created[0]).toMatchObject({ tagNames: ['safety', 'rig'], startDate: new Date('2026-11-03T05:00:00Z'), estimatedHours: 4, weight: 3 });
  });

  it('keeps what the form sent for them, and drops the original’s start date when it falls after the new due date', async () => {
    await w.service.duplicate(me, 'orig', { body: reviewed({ tags: ['other'], startDate: null, estimatedHours: 1, weight: null }) });
    expect(w.created[0]).toMatchObject({ tagNames: ['other'], estimatedHours: 1, weight: null });
    expect(w.created[0]!.startDate).toBeUndefined();
    await w.service.duplicate(me, 'orig', { body: reviewed({ dueDate: new Date('2026-11-02T00:00:00Z') }) });
    expect(w.created[1]!.startDate).toBeUndefined();
  });

  it('applies the chosen project’s rules: someone not on its team is refused, as for any new task', async () => {
    await expect(w.service.duplicate(me, 'orig', { body: reviewed({ projectId: 'p2', assigneeIds: ['sara'] }) })).rejects.toMatchObject({ status: 400 });
    expect(w.created).toHaveLength(0);
  });

  it('copies the watchers who can see the chosen project', async () => {
    const r = await w.service.duplicate(me, 'orig', { body: reviewed({ projectId: 'p2', assigneeIds: ['omar'] }) });
    expect(r.task.key).toBe('RIG-40');
    expect(w.created[0]).toMatchObject({ columnId: 'p2-todo' });
    expect(w.watchersAdded[r.task.id]).toEqual(['nadia']);
  });

  it('copies every file when ticked (as new files of the new task)', async () => {
    const r = await w.service.duplicate(me, 'orig', { body: reviewed() });
    expect(r.files).toEqual({ total: 3, copied: 3, failed: [] });
    expect(w.uploads.map((u) => [u.taskId, u.filename])).toEqual([[r.task.id, 'plan.pdf'], [r.task.id, 'site.dwg'], [r.task.id, 'photo.png']]);
  });

  it('copies no file when not ticked', async () => {
    const r = await w.service.duplicate(me, 'orig', { body: reviewed(), copyFiles: false });
    expect(r.files).toEqual({ total: 0, copied: 0, failed: [] });
    expect(w.uploads).toHaveLength(0);
  });

  it('lists a file the upload checks refuse (or that is missing) and still saves the task with the others', async () => {
    const partly = world({ refuse: new Set(['site.dwg']), missing: new Set(['k3']) });
    const r = await partly.service.duplicate(me, 'orig', { body: reviewed() });
    expect(partly.created).toHaveLength(1);
    expect(r.files.total).toBe(3);
    expect(r.files.copied).toBe(1);
    expect(r.files.failed).toEqual([
      { filename: 'site.dwg', reason: '“site.dwg” is a type of file that can’t be uploaded.' },
      { filename: 'photo.png', reason: 'The stored file couldn’t be found.' },
    ]);
  });

  it('writes a history line on both tasks, each naming the other', async () => {
    const r = await w.service.duplicate(me, 'orig', { body: reviewed() });
    expect(w.activity).toEqual([
      { taskId: r.task.id, userId: 'me', action: 'DUPLICATED_FROM', meta: { fromTaskId: 'orig', fromKey: 'MSSP-34' } },
      { taskId: 'orig', userId: 'me', action: 'DUPLICATED', meta: { copyTaskId: r.task.id, copyKey: 'MSSP-40' } },
    ]);
  });

  it('without a review (Bulk Duplicate): the original as it is in its own project, “(copy)” on the title, only people still on the team', async () => {
    await w.service.duplicate(me, 'orig', { markCopy: true });
    expect(w.created[0]).toMatchObject({
      title: 'Inspect the rig (copy)',
      projectId: 'p1',
      columnId: 'p1-todo',
      assigneeIds: ['omar', 'sara'],
      tagNames: ['safety', 'rig'],
      priority: 'HIGH',
      isMilestone: true,
      inspectionFormId: 'form1',
      inspectionPlace: 'Rig 3',
      duplicatedFromId: 'orig',
    });
    expect(w.created[0]!.checklists).toEqual(original().checklists);
    expect(w.created[0]!.externalContacts).toHaveLength(1);
  });
});
