import { it, expect } from 'vitest';
import { chooseTemplate, fillerOptions, planFor, templateOptions, withFiller, type TemplateChoice } from './template-choice';
import type { TemplatePlan } from './templates-api';

/** The New project form's template choice (Stage 4 Task 14), as the website's TemplateStart keeps it. */
const SUMMARY = (id: string, name: string, taskCount: number) => ({ id, name, taskCount, description: null, columnCount: 4, roleCount: 1, createdById: null, createdByName: null, canManage: false, createdAt: '', updatedAt: '' });
const PLAN = { template: { id: 't1', name: 'Rig survey', description: null, columns: [], roles: [{ id: 'r1', name: 'Inspector' }], updatedAt: 'u1' }, startDate: '2026-11-01', today: '2026-10-30', workingDays: [0, 1, 2, 3, 4], startColumn: 0, tasks: [], overdue: 0, moved: 0 } as TemplatePlan;

it('choosing a template keeps the start day, starts the roles afresh; Blank project is no template', () => {
  const first = chooseTemplate(null, 't1', '2026-10-30');
  expect(first).toEqual({ id: 't1', startDate: '2026-10-30', roles: {} });
  const later: TemplateChoice = { id: 't1', startDate: '2026-11-04', roles: { r1: 'u1' } };
  expect(chooseTemplate(later, 't2', '2026-10-30')).toEqual({ id: 't2', startDate: '2026-11-04', roles: {} });
  expect(chooseTemplate(later, '', '2026-10-30')).toBeNull();
});

it('a role is filled by a person, or left to the owner', () => {
  const c: TemplateChoice = { id: 't1', startDate: '2026-11-01', roles: { r1: 'u1' } };
  expect(withFiller(c, 'r2', 'u2').roles).toEqual({ r1: 'u1', r2: 'u2' });
  expect(withFiller(c, 'r1', '').roles).toEqual({});
});

it('the preview is the chosen template’s only', () => {
  expect(planFor(PLAN, { id: 't1', startDate: '2026-11-01', roles: {} })).toBe(PLAN);
  expect(planFor(PLAN, { id: 't2', startDate: '2026-11-01', roles: {} })).toBeUndefined();
  expect(planFor(PLAN, null)).toBeUndefined();
  // S5: an answer for another start day (shown while the new one loads) isn't this choice's preview.
  expect(planFor(PLAN, { id: 't1', startDate: '2026-11-08', roles: {} })).toBeUndefined();
  expect(planFor(undefined, { id: 't1', startDate: '2026-11-01', roles: {} })).toBeUndefined();
});

it('the picker: Blank project, then each template with its task count; a broken row is left out', () => {
  expect(templateOptions([SUMMARY('t1', 'Rig survey', 12), SUMMARY('t2', 'Audit', 1), { id: 'x' }], null, undefined)).toEqual([
    { value: '', label: 'Blank project', hint: 'the usual board, no tasks' },
    { value: 't1', label: 'Rig survey', hint: '12 tasks' },
    { value: 't2', label: 'Audit', hint: '1 task' },
  ]);
  // The one chosen while the list loads (its preview names it).
  expect(templateOptions(undefined, { id: 't1', startDate: '2026-11-01', roles: {} }, PLAN)).toEqual([{ value: '', label: 'Blank project', hint: 'the usual board, no tasks' }, { value: 't1', label: 'Rig survey' }]);
});

it('only active people fill a role, after “Nobody”', () => {
  const people = [
    { id: 'u1', username: 'omar', firstName: 'Omar', lastName: 'Ali', active: true },
    { id: 'u2', username: 'gone', firstName: 'Left', lastName: 'Already', active: false },
    { id: 'u3', username: 'sara', firstName: 'Sara', lastName: 'Khan' },
  ];
  expect(fillerOptions(people)).toEqual([
    { value: '', label: 'Nobody — the owner gets these tasks' },
    { value: 'u1', label: 'Omar Ali', hint: '@omar' },
    { value: 'u3', label: 'Sara Khan', hint: '@sara' },
  ]);
});
