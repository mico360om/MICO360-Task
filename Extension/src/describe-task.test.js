import { describe, it, expect } from 'vitest';
import { suggestionsFrom, chosenPatch, toggleSuggestion, describeFailure, scheduleText, DESCRIBE_FAILED } from './describe-task.js';
import { formatDayKey } from './due-date.js';

const blank = { title: '', description: '', dueDate: '', priority: 'NORMAL', rule: null, projectId: 'p1' };
const projects = [
  { id: 'p1', name: 'Ops', code: 'OPS', number: null },
  { id: 'p2', name: 'Rig 1', code: 'RIG1', number: '2026-014' },
];
const draft = {
  title: 'Send the site report',
  description: 'With the inspection photos.',
  dueDate: '2026-10-26',
  priority: 'HIGH',
  recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
  project: { id: 'p2', code: 'RIG1', number: '2026-014', name: 'Rig 1' },
};
const day = (key) => formatDayKey(key, { weekday: true, year: true });

describe('"Describe it": suggestions, reviewed before anything changes (as on the web)', () => {
  it('suggests every detail it found; the ones that fill something empty start ticked', () => {
    const found = suggestionsFrom(draft, blank, blank, { projects });
    expect(found.map((s) => s.key)).toEqual(['title', 'description', 'dueDate', 'rule', 'priority', 'projectId']);
    expect(found.every((s) => s.checked)).toBe(true);
    expect(found.find((s) => s.key === 'dueDate')).toMatchObject({ label: 'Due date', shown: day('2026-10-26'), value: '2026-10-26', replaces: null });
    expect(found.find((s) => s.key === 'rule')).toMatchObject({ label: 'Repeat', shown: 'Repeats every week on Mon', replaces: null });
    expect(found.find((s) => s.key === 'priority')).toMatchObject({ label: 'Priority', shown: 'High', replaces: 'Normal' });
    expect(found.find((s) => s.key === 'projectId')).toMatchObject({ label: 'Project', shown: 'Rig 1 · RIG1 · 2026-014', value: 'p2', replaces: 'Ops' });
  });

  it('what you set yourself is never replaced silently: those suggestions start unticked and say what they replace', () => {
    const mine = { title: 'My title', description: 'My notes', dueDate: '2026-11-01', priority: 'LOW', rule: { freq: 'DAILY', interval: 1 }, projectId: 'p1' };
    const found = suggestionsFrom(draft, mine, blank, { projects, projectChosen: true });
    expect(found.every((s) => !s.checked)).toBe(true);
    expect(found.find((s) => s.key === 'title').replaces).toBe('“My title”');
    expect(found.find((s) => s.key === 'description').replaces).toBe('“My notes”');
    expect(found.find((s) => s.key === 'dueDate').replaces).toBe(day('2026-11-01'));
    expect(found.find((s) => s.key === 'rule').replaces).toBe('Repeats every day');
    expect(found.find((s) => s.key === 'priority').replaces).toBe('Low');
  });

  it('a project you didn’t pick (the one the form started in) may be replaced; one you picked may not', () => {
    expect(suggestionsFrom(draft, blank, blank, { projects }).find((s) => s.key === 'projectId').checked).toBe(true);
    expect(suggestionsFrom(draft, blank, blank, { projects, projectChosen: true }).find((s) => s.key === 'projectId').checked).toBe(false);
    expect(suggestionsFrom(draft, { ...blank, projectId: 'p3' }, blank, { projects }).find((s) => s.key === 'projectId').checked).toBe(false);
  });

  it('offers only a project the person can choose, and nothing that is already there', () => {
    expect(suggestionsFrom({ ...draft, project: { id: 'p9', code: 'X', name: 'Elsewhere' } }, blank, blank, { projects }).some((s) => s.key === 'projectId')).toBe(false);
    expect(suggestionsFrom(draft, blank, blank, {}).some((s) => s.key === 'projectId')).toBe(false);
    const same = { title: draft.title, description: draft.description, dueDate: draft.dueDate, priority: 'HIGH', rule: draft.recurrence, projectId: 'p2' };
    expect(suggestionsFrom(draft, same, blank, { projects })).toEqual([]);
    expect(suggestionsFrom({ title: '  ', description: null, dueDate: null, priority: null, recurrence: null, project: null }, blank, blank, { projects })).toEqual([]);
  });

  it('a long title is cut to the server’s limit, and a long description shown shorter', () => {
    const found = suggestionsFrom({ ...draft, title: 'x'.repeat(300), description: 'd'.repeat(500) }, blank, blank, { projects });
    expect(found.find((s) => s.key === 'title').value).toHaveLength(191);
    const d = found.find((s) => s.key === 'description');
    expect(d.value).toHaveLength(500);
    expect(d.shown).toHaveLength(200);
  });

  it('applies only the ticked suggestions', () => {
    const mine = { ...blank, title: 'Keep mine' };
    let found = suggestionsFrom(draft, mine, blank, { projects });
    expect(chosenPatch(found)).toEqual({ description: draft.description, dueDate: '2026-10-26', rule: draft.recurrence, priority: 'HIGH', projectId: 'p2' });
    found = toggleSuggestion(toggleSuggestion(found, 'title'), 'projectId');
    expect(chosenPatch(found)).toEqual({ title: 'Send the site report', description: draft.description, dueDate: '2026-10-26', rule: draft.recurrence, priority: 'HIGH' });
  });
});

describe('when it can’t read the description', () => {
  it('shows the server’s own message — e.g. AI isn’t set up yet — exactly as the web does', () => {
    const message = 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.';
    expect(describeFailure({ status: 400, serverMessage: message })).toBe(message);
    expect(describeFailure({ status: 429, serverMessage: 'Too many requests — try again in a minute.' })).toBe('Too many requests — try again in a minute.');
  });

  it('otherwise the web’s words, or that it needs a connection', () => {
    expect(describeFailure({ status: 500, serverMessage: '' })).toBe(DESCRIBE_FAILED);
    expect(DESCRIBE_FAILED).toBe('Couldn’t read that description. Try rephrasing it, or fill in the details yourself.');
    expect(describeFailure(new TypeError('Failed to fetch'), { online: true })).toBe(DESCRIBE_FAILED);
    expect(describeFailure(new TypeError('Failed to fetch'), { online: false })).toBe('“Describe it” needs a connection — you appear to be offline.');
  });
});

describe('scheduleText', () => {
  it('a weekly repeat without chosen days repeats on the due date’s weekday', () => {
    expect(scheduleText({ freq: 'WEEKLY', interval: 1 }, '2026-10-22')).toBe('Repeats every week on Thu');
    expect(scheduleText({ freq: 'WEEKLY', interval: 1 }, '')).toBe('Repeats every week');
    expect(scheduleText({ freq: 'MONTHLY', interval: 1, dayOfMonth: 5 }, '2026-10-22')).toMatch(/^Repeats every month/);
  });
});
