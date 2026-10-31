import { describe, it, expect } from 'vitest';
import { apiRoutes, appSource as src, hasWeb, loadWebTs, normalise, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { PROJECT_TEMPLATES_KEY, TASK_TEMPLATES_KEY, templatesApi, type ProjectTemplateDraft, type TemplatePlan } from './templates-api';
import { roleCounts } from './role-counts';
import {
  TEMPLATE_SAVE_WORDS,
  TEMPLATE_START_WORDS,
  blockingProblem,
  count,
  daysOffNote,
  keepRoles,
  listWords,
  overdueWarning,
  personRoleNote,
  planSummary,
  planTaskDue,
  planTaskWho,
  publishWarning,
  roleWontCount,
  rolesSummary,
  saveProjectLines,
  saveTaskLine,
  templateCreateProblem,
  templateSaveReason,
} from './template-words';
import { ApiError, NetworkError } from './api-client';
import type { ApiClient } from './api-client';

/** The templates' calls, the website's role rule and every template word (Stage 4 Task 13). */

/** The website's types section: from TemplateColumn up to the keys, without TaskTemplate (lib/types.ts owns it, Stage 2). */
function templateTypes(text: string): string {
  const t = normalise(text);
  const from = t.indexOf('export interface TemplateColumn');
  const to = t.indexOf('export const PROJECT_TEMPLATES_KEY');
  return t
    .slice(from, to < 0 ? undefined : to)
    .replace(/export interface TaskTemplate \{[^]*?\n\}\n+/, '')
    .trim();
}

type PlanTask = TemplatePlan['tasks'][number];
const task = (o: Partial<PlanTask> = {}): PlanTask => ({
  position: 0, title: 'Check the rails', priority: 'NORMAL', dueDate: null, movedFrom: null, offset: null, roleId: null, checklistCount: 0, hasDescription: false, ...o,
});

const PLAN: TemplatePlan = {
  template: { id: 't1', name: 'Rig survey', description: null, columns: [{ name: 'To do', category: 'TODO', color: '#000' }, { name: 'Doing', category: 'IN_PROGRESS', color: '#000' }, { name: 'Review', category: 'REVIEW', color: '#000' }, { name: 'Done', category: 'DONE', color: '#000' }], roles: [], updatedAt: '2026-10-30T06:00:00Z' },
  startDate: '2026-11-01', today: '2026-10-30', workingDays: [0, 1, 2, 3, 4], startColumn: 0,
  tasks: Array.from({ length: 12 }, (_, i) => task({ position: i })), overdue: 0, moved: 0,
};

const DRAFT: ProjectTemplateDraft = {
  project: { id: 'pr1', name: 'Rig 3' }, base: { day: '2026-11-01', from: 'start' }, taskCount: 12, columnCount: 4, columnsTotal: 4, maxTasks: 500,
  checklistItems: 30, maxChecklistItems: 5000, checklistTrimmed: 0, assignments: [['u1', 'u2'], ['u2'], []], people: [{ id: 'u2', name: 'Sara Khan', taskCount: 2 }, { id: 'u1', name: 'Omar Ali', taskCount: 1 }],
};

describe.skipIf(!hasWeb('frontend/src/api/templates.ts', 'frontend/src/components/templates/role-counts.ts', 'frontend/src/components/templates/TemplateStart.tsx', 'frontend/src/components/templates/SaveAsTemplate.tsx', 'frontend/src/lib/day-label.ts'))('the website’s templates', () => {
  it('types, keys and paths are the website’s', () => {
    expect(templateTypes(src('lib/templates-api.ts'))).toBe(templateTypes(readWeb('frontend/src/api/templates.ts')));
    expect(templateTypes(src('lib/templates-api.ts'))).toContain('export interface TemplatePlan');
    const web = apiRoutes(readWeb('frontend/src/api/templates.ts'));
    const app = apiRoutes(src('lib/templates-api.ts'));
    expect(Object.keys(app).sort()).toEqual(['createProject', 'listProjects', 'listTasks', 'plan', 'projectDraft', 'saveProject', 'saveTask']);
    for (const [k, r] of Object.entries(app)) expect(r, k).toBe(web[k]);
    const keys = loadWebTs('frontend/src/api/templates.ts') as { PROJECT_TEMPLATES_KEY: readonly string[]; TASK_TEMPLATES_KEY: readonly string[] };
    expect(PROJECT_TEMPLATES_KEY).toEqual(keys.PROJECT_TEMPLATES_KEY);
    expect(TASK_TEMPLATES_KEY).toEqual(keys.TASK_TEMPLATES_KEY);
  });
  it('role-counts.ts is the website’s file', () => expect(normalise(src('lib/role-counts.ts'))).toBe(normalise(readWeb('frontend/src/components/templates/role-counts.ts'))));
  it('every word is the website’s', () => {
    const web = ['components/templates/TemplateStart.tsx', 'components/templates/SaveAsTemplate.tsx', 'components/project-form/ProjectFormDialog.tsx', 'components/task-drawer/menus.tsx', 'pages/ProjectDetailPage.tsx'].map((f) => readWeb(`frontend/src/${f}`));
    // websiteSays reads the text between tags; a word in an attribute (aria-label, title) is read as written.
    const said = (v: string) => websiteSays(web, v) || web.some((w) => normalise(w).includes(`"${v}"`));
    for (const [k, v] of Object.entries({ ...TEMPLATE_START_WORDS, ...TEMPLATE_SAVE_WORDS })) expect(said(v), k).toBe(true);
  });
  it('a moved due day names its weekday as the website does', () => {
    const web = loadWebTs('frontend/src/lib/day-label.ts', { './day-words': 'frontend/src/lib/day-words.ts' }) as { dayLabel: (k: string, o: object) => string };
    expect(planTaskDue(task({ dueDate: '2026-11-08', movedFrom: '2026-11-06' }), '2026-10-30')).toBe(`Due Sun 8 Nov (moved from ${web.dayLabel('2026-11-06', { only: 'weekday' })})`);
    expect(planTaskDue(task({ dueDate: '2027-01-03' }), '2026-10-30')).toBe(`Due ${web.dayLabel('2027-01-03', { year: true })}`);
  });
  it('the role a task gets is the website’s rule', () => {
    const web = loadWebTs('frontend/src/components/templates/role-counts.ts').roleCounts as typeof roleCounts;
    const cases: Array<[string[][], string[], Record<string, string>]> = [[[['u1', 'u2'], ['u2'], []], ['u1', 'u2'], { u2: 'Inspector' }], [[['a'], ['b'], ['a', 'b']], ['a', 'b'], { a: ' inspector ', b: 'Inspector' }]];
    for (const [a, p, r] of cases) expect(roleCounts(a, p, r)).toEqual(web(a, p, r));
  });
});

it('the calls send what the website sends, with an idempotency key on the creating ones', async () => {
  const calls: Array<{ verb: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  const client = {
    get: async (path: string) => { calls.push({ verb: 'GET', path }); return { data: [] }; },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => { calls.push({ verb: 'POST', path, body, headers: opts?.headers }); return { data: {} }; },
  } as unknown as Pick<ApiClient, 'get' | 'post'>;
  const api = templatesApi(client);
  await api.plan('t 1', '2026-11-01');
  await api.createProject('t1', { code: 'RIG', name: 'Rig', startDate: '2026-11-01', roles: { r1: 'u1' } }, 'k1');
  await api.saveProject('pr1', { name: 'Rig', roles: [] }, 'k2');
  await api.saveTask('tk1', undefined, 'k3');
  expect(calls.map((c) => `${c.verb} ${c.path}`)).toEqual(['GET /templates/projects/t%201/plan?start=2026-11-01', 'POST /templates/projects/t1/projects', 'POST /templates/projects/from-project/pr1', 'POST /templates/tasks/from-task/tk1']);
  expect(calls.slice(1).map((c) => c.headers?.['Idempotency-Key'])).toEqual(['k1', 'k2', 'k3']);
  expect(calls[3]!.body).toEqual({});
});

it('days off, the summary and the overdue warning', () => {
  expect(daysOffNote([0, 1, 2, 3, 4])).toBe('Due dates count from this day. A due day on a Friday or Saturday (days off) moves to the next working day.');
  expect(daysOffNote([0, 1, 2, 3, 4, 5])).toBe('Due dates count from this day. A due day on a Saturday (a day off) moves to the next working day.');
  expect(daysOffNote([0, 1, 2, 3, 4, 5, 6])).toBe('Due dates count from this day.');
  expect(overdueWarning(1)).toBe('1 task will be overdue as soon as the project is created, because the start date is in the past.');
  expect(overdueWarning(3)).toBe('3 tasks will be overdue as soon as the project is created, because the start date is in the past.');
  expect(overdueWarning(0)).toBeNull();
  expect(planSummary(PLAN)).toBe('Creates 12 tasks on a board of 4 columns: To do · Doing · Review · Done. The tasks start in To do.');
  expect(planSummary({ ...PLAN, tasks: [] })).toBe('Creates 0 tasks on a board of 4 columns: To do · Doing · Review · Done');
  expect(keepRoles({ r1: 'u1', gone: 'u2' }, [{ id: 'r1', name: 'Inspector' }])).toEqual({ r1: 'u1' });
  expect(count(1, 'task')).toBe('1 task');
  expect(count(2, 'checklist item')).toBe('2 checklist items');
  expect(listWords(['Thursday', 'Friday', 'Saturday'], 'or')).toBe('Thursday, Friday or Saturday');
});

it('each task says when it is due and who does it, as the website’s preview', () => {
  expect(planTaskDue(task(), '2026-10-30')).toBe('No due date');
  expect(planTaskDue(task({ dueDate: '2026-11-08' }), '2026-10-30')).toBe('Due Sun 8 Nov');
  const roles = [{ id: 'r1', name: 'Inspector' }];
  const names = new Map([['u1', 'Omar Ali'], ['u9', 'Sara Khan']]);
  expect(planTaskWho(task({ roleId: 'r1' }), roles, { r1: 'u1' }, names, { id: 'u9', name: 'Sara Khan' })).toBe('Omar Ali · Inspector');
  expect(planTaskWho(task({ roleId: 'r1' }), roles, {}, names, { id: 'u9', name: 'Sara Khan' })).toBe('Owner (Sara Khan) · Inspector');
  expect(planTaskWho(task(), roles, {}, names, { id: 'u9', name: null })).toBe('Owner');
  expect(planTaskWho(task(), roles, {}, names, null)).toBe('Unassigned');
});

it('a template that changed or was deleted meanwhile is told apart from other refusals', () => {
  expect(templateCreateProblem(new ApiError(404, 'NOT_FOUND', 'Template not found'))).toEqual({ kind: 'gone', message: TEMPLATE_START_WORDS.gone });
  expect(templateCreateProblem(new ApiError(409, 'TEMPLATE_CHANGED', 'This template was changed while you were looking at it — check the preview again.'))).toEqual({ kind: 'changed', message: 'This template was changed while you were looking at it — check the preview again.' });
  expect(templateCreateProblem(new ApiError(400, 'VALIDATION', 'x', { code: 'TEMPLATE_CHANGED' }))).toMatchObject({ kind: 'changed' });
  expect(templateCreateProblem(new ApiError(409, 'CONFLICT', 'RIG is already used by another project.'))).toBeNull();
  expect(templateCreateProblem(new Error('offline'))).toBeNull();
});

it('Save as template: what it saves, what it warns about, what stops it', () => {
  expect(saveProjectLines(DRAFT, true)).toEqual([
    { text: 'Saves its board (4 columns) and its 12 tasks, with their descriptions, priorities and checklists.', tone: 'plain' },
    { text: 'Due dates are kept as days from the project’s start, Sun 1 Nov 2026.', tone: 'plain' },
  ]);
  const odd = { ...DRAFT, base: { day: '2026-10-20', from: 'created' as const }, columnsTotal: 22, columnCount: 20, checklistTrimmed: 2, taskCount: 501 };
  expect(saveProjectLines(odd, false).map((l) => l.text)).toEqual([
    'Saves its board (20 columns) and its 501 tasks, with their priorities and checklists.',
    'Due dates are kept as days from the day the project was created, Tue 20 Oct 2026 (it has no start date).',
    'Only the first 20 of its 22 columns are kept.',
    '2 tasks have more than 100 checklist items: only their first 100 are kept.',
    'This project has 501 tasks; a template can hold at most 500.',
  ]);
  expect(saveProjectLines({ ...DRAFT, checklistTrimmed: 1 }, true)[2]).toEqual({ text: '1 task has more than 100 checklist items: only its first 100 are kept.', tone: 'warning' });
  expect(blockingProblem(odd)).toBe('This project has 501 tasks; a template can hold at most 500.');
  expect(blockingProblem({ ...DRAFT, checklistItems: 12000 })).toBe('Its checklists hold 12,000 items in all; a template can hold at most 5,000.');
  expect(blockingProblem(DRAFT)).toBeNull();
  expect(publishWarning('task titles and checklists')).toBe('Everyone in the company will be able to see this template’s task titles and checklists.');
  expect(saveTaskLine({ description: 'Steps', checklistCount: 3 }, true)).toBe('Saves its title, description, priority and checklist (3 items). Its dates, people and project aren’t saved.');
  expect(saveTaskLine({ description: ' ', checklistCount: 0 }, true)).toBe('Saves its title, priority and checklist. Its dates, people and project aren’t saved.');
});

it('a failed save says why in the website’s words', () => {
  expect(templateSaveReason(new ApiError(403, 'FORBIDDEN', 'Only the people who run the project can do that.'))).toBe('Only the people who run the project can do that.');
  expect(templateSaveReason(new ApiError(500, 'INTERNAL', 'Request failed (500)'))).toBe('Please try again.');
  expect(templateSaveReason(new NetworkError('offline'))).toBe('The server couldn’t be reached.');
  expect(templateSaveReason(new Error('x'))).toBe('Please try again.');
});

it('roles: each person’s note and the summary follow the server’s rule', () => {
  const people = ['u1', 'u2'];
  const c = roleCounts(DRAFT.assignments, people, { u2: 'Inspector' });
  expect(rolesSummary(c)).toBe('Inspector: 2 tasks. 1 task will be unassigned (they go to the new project’s owner).');
  expect(rolesSummary(roleCounts([['u1']], ['u1'], {}))).toBe('No roles yet. 1 task will be unassigned (they go to the new project’s owner).');
  expect(personRoleNote('u2', '', c, 2)).toBe('On 2 tasks.');
  expect(personRoleNote('u2', 'Inspector', c, 2)).toBe('Inspector gets all 2 of these tasks.');
  const both = roleCounts(DRAFT.assignments, people, { u1: 'Lead', u2: 'Inspector' });
  expect(personRoleNote('u2', 'Inspector', both, 2)).toBe('Inspector gets 1 of these 2 tasks; the others name another role first.');
  const lost = roleCounts([['u1', 'u2']], people, { u1: 'Lead', u2: 'Inspector' });
  expect(personRoleNote('u2', 'Inspector', lost, 1)).toBe('“Inspector” won’t become a role: each of these tasks names another role first.');
  expect(roleWontCount('Inspector', lost)).toBe(true);
  expect(roleWontCount('Lead', lost)).toBe(false);
  const same = roleCounts([['u1', 'u2'], ['u2']], people, { u1: 'Inspector', u2: 'inspector' });
  expect(personRoleNote('u2', 'inspector', same, 2)).toBe('inspector gets 1 of these 2 tasks; the others name another role first.');
  expect(personRoleNote('u1', 'Inspector', roleCounts([['u1']], ['u1'], { u1: 'Inspector' }), 1)).toBe('Inspector gets this task.');
});

// Task 15 (lead amendment 1): Stage 2 built "New task from a task template" (TemplatePicker,
// applyTemplate, templateFilledText — new-task-extras.test.ts, task-form.test.ts). What Stage 4 adds
// to it is only this check: a task from a template is made with the normal New task body.
it('a task started from a template is created as any new task: no template endpoint is called', () => {
  for (const f of ['screens/NewTaskScreen.tsx', 'core/new-task.ts', 'lib/task-form.ts']) expect(src(f), f).not.toMatch(/templates\.(?!listTasks\b)\w+\(/);
});
