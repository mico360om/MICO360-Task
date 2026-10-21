import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chosenTaskPatch, describeFailure, describeHint, isCalendarDay, readTaskDraft, taskSuggestions, DESCRIBE_TEXT, type DescribedFields } from './task-describe';
import { scheduleText } from './task-form';
import { ApiError, NetworkError } from './api-client';

const projects = [
  { id: 'p1', name: 'MICO360 Platform', code: 'MICO', number: null },
  { id: 'p2', name: 'Ops Board', code: 'OPS', number: null },
];
/** A new form as it opened: nothing typed; its project settled by the form (not yours). */
const fresh: DescribedFields = { title: '', description: '', dueDate: '', priority: 'NORMAL', rule: null, projectId: 'p1' };
const suggest = (draft: unknown, over: Partial<Parameters<typeof taskSuggestions>[1]> = {}) =>
  taskSuggestions(readTaskDraft(draft), { current: fresh, initial: fresh, projects, projectChosen: false, repeatText: scheduleText, ...over });
const view = (s: ReturnType<typeof taskSuggestions>) => s.map((x) => [`${x.label}: ${x.shown}`, x.checked, x.replaces]);

describe('Describe it in plain English (4a, the website’s DescribeTask)', () => {
  it('fills in what the sentence says — ticked where nothing of yours is replaced', () => {
    expect(view(suggest({ title: 'Review the report', dueDate: '2026-10-16', priority: 'HIGH' }))).toEqual([
      ['Title: Review the report', true, null],
      ['Due date: Fri 16 Oct 2026', true, null],
      ['Priority: High', true, 'Normal'],
    ]);
  });

  it('never silently replaces what you typed or chose yourself', () => {
    const current = { ...fresh, title: 'My own title', priority: 'URGENT' as const };
    expect(view(suggest({ title: 'Review the report', dueDate: '2026-10-16', priority: 'HIGH' }, { current }))).toEqual([
      ['Title: Review the report', false, '“My own title”'],
      ['Due date: Fri 16 Oct 2026', true, null],
      ['Priority: High', false, 'Urgent'],
    ]);
  });

  const fuller = {
    title: 'Send the site report',
    description: 'Include the inspection photos.',
    dueDate: '2026-10-19',
    priority: null,
    recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
    project: { id: 'p2', code: 'OPS', number: 'PDO-7', name: 'Ops Board' },
  };

  it('also suggests a description, a repeat and the project', () => {
    expect(view(suggest(fuller))).toEqual([
      ['Title: Send the site report', true, null],
      ['Description: Include the inspection photos.', true, null],
      ['Due date: Mon 19 Oct 2026', true, null],
      ['Repeat: Repeats every week on Mon', true, null],
      ['Project: Ops Board · OPS · PDO-7', true, 'MICO360 Platform'],
    ]);
  });

  it('a day the form opened with (the calendar’s) isn’t yours: a new one starts ticked over it', () => {
    const opened = { ...fresh, dueDate: '2026-10-23' };
    expect(view(suggest({ title: 'x', dueDate: '2026-10-19' }, { current: opened, initial: opened })).find((r) => String(r[0]).startsWith('Due'))).toEqual([
      'Due date: Mon 19 Oct 2026',
      true,
      'Fri 23 Oct 2026',
    ]);
  });

  it('offers no project when the project is fixed (a board), and ignores one that isn’t in your list', () => {
    expect(suggest(fuller, { projects: undefined }).some((s) => s.key === 'projectId')).toBe(false);
    expect(suggest({ title: 'X', project: { id: 'p9', code: 'SEC', number: null, name: 'Secret' } }).some((s) => s.key === 'projectId')).toBe(false);
  });

  it('a project, description or repeat you chose yourself starts unticked', () => {
    const current = { ...fresh, description: 'My own notes', rule: { freq: 'DAILY' as const, interval: 1 } };
    const found = suggest(fuller, { current, projectChosen: true });
    expect(found.filter((s) => ['projectId', 'description', 'rule'].includes(s.key)).map((s) => [s.key, s.checked])).toEqual([
      ['description', false],
      ['rule', false],
      ['projectId', false],
    ]);
    expect(found.find((s) => s.key === 'description')!.replaces).toBe('“My own notes”');
  });

  it('nothing new: no suggestions', () => {
    expect(suggest({ title: '', dueDate: null, priority: 'NORMAL' })).toEqual([]);
  });

  it('“Use selected details” takes only what is ticked', () => {
    const found = suggest(fuller).map((s) => (s.key === 'title' ? { ...s, checked: false } : s));
    expect(chosenTaskPatch(found)).toEqual({
      description: 'Include the inspection photos.',
      dueDate: '2026-10-19',
      rule: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
      projectId: 'p2',
    });
  });

  it('reads the server’s answer carefully: anything odd is left out, never a crash', () => {
    expect(readTaskDraft(null)).toEqual({ title: '', description: null, dueDate: null, priority: null, recurrence: null, project: null });
    expect(
      readTaskDraft({ title: `  ${'x'.repeat(300)}  `, description: 7, dueDate: '16/10/2026', priority: 'SOON', recurrence: 'weekly', project: { code: 'X' } }),
    ).toEqual({ title: 'x'.repeat(191), description: null, dueDate: null, priority: null, recurrence: null, project: null });
    expect(readTaskDraft({ recurrence: { freq: 'HOURLY', interval: 1 } }).recurrence).toBeNull();
    expect(readTaskDraft({ recurrence: { freq: 'MONTHLY', interval: 0 } }).recurrence).toEqual({ freq: 'MONTHLY', interval: 1 });
  });

  it('says why it couldn’t read the sentence: the AI being slow, offline, the server’s reason, or the website’s words', () => {
    expect(describeFailure(new NetworkError('slow', { timedOut: true }))).toBe('The AI is taking longer than usual. Please try again in a minute.');
    expect(describeFailure(new NetworkError('Network request failed.'))).toBe('You’re offline — this needs a connection. Please try again.');
    expect(describeFailure(new ApiError(503, 'AI_UNAVAILABLE', 'The AI assistant is turned off.'))).toBe('The AI assistant is turned off.');
    expect(describeFailure(new ApiError(502, 'HTTP_502', 'Request failed (502)'))).toBe(DESCRIBE_TEXT.failed);
  });

  it('says what it suggests (the project only when it can be chosen)', () => {
    expect(describeHint(true)).toBe('The assistant suggests a title, description, due date, repeat, priority and project — you choose what to use.');
    expect(describeHint(false)).toBe('The assistant suggests a title, description, due date, repeat, priority — you choose what to use.');
  });
});

const webDescribe = resolve(__dirname, '../../../Web Portal/frontend/src/components/task-form/DescribeTask.tsx');
describe.skipIf(!existsSync(webDescribe))('the same rules and words as the website’s DescribeTask', () => {
  it('keeps the website’s rules for what is yours, and its words', () => {
    const web = readFileSync(webDescribe, 'utf8');
    for (const rule of [
      "const mine = current.title.trim() !== '';",
      "const mine = current.description.trim() !== '' && current.description !== initial.description;",
      "const mine = current.dueDate !== '' && current.dueDate !== initial.dueDate;",
      'const mine = current.rule !== null && !sameRule(current.rule, initial.rule);',
      'const mine = current.priority !== initial.priority;',
      "const mine = projectChosen || (current.projectId !== '' && current.projectId !== initial.projectId);",
      '.slice(0, 191)',
    ]) {
      expect(web, rule).toContain(rule);
    }
    for (const words of Object.values(DESCRIBE_TEXT)) expect(web, words).toContain(words);
    expect(web).toContain('The assistant suggests a title, description, due date, repeat, priority');
  });
});

describe('the AI’s dates are real calendar days (4a review #7)', () => {
  it('a day that doesn’t exist (31 September, 30 February) is left out, as the server would refuse it', () => {
    expect(readTaskDraft({ title: 'x', dueDate: '2026-09-31' }).dueDate).toBeNull();
    expect(readTaskDraft({ title: 'x', dueDate: '2026-02-30' }).dueDate).toBeNull();
    expect(readTaskDraft({ title: 'x', dueDate: '2026-13-01' }).dueDate).toBeNull();
    expect(readTaskDraft({ title: 'x', dueDate: '2028-02-29' }).dueDate).toBe('2028-02-29');
    expect(readTaskDraft({ title: 'x', recurrence: { freq: 'DAILY', interval: 1, until: '2026-04-31' } }).recurrence?.until).toBeUndefined();
    expect(isCalendarDay('2026-10-21')).toBe(true);
  });
});
