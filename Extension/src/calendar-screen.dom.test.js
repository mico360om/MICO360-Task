// @vitest-environment jsdom
/**
 * Stage 6: the Calendar as on the web — GET /calendar for the visible days (tasks due in the
 * projects you can see, and the copies repeating tasks will make), the meetings in those days, your
 * own week start and time zone; Month, Week and Agenda; only mine, done, repeats and meetings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalendarScreen } from '../app/screens/calendar.js';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T06:30:00.000Z')); // Wed 21 Oct, 10:30 in Muscat
});
afterEach(() => {
  vi.useRealTimers();
});

const task = (id, over = {}) => ({
  id, key: `RIG-${id}`, title: `Task ${id}`, projectId: 'p1', priority: 'NORMAL', columnCategory: 'TODO', completedAt: null,
  dueDate: '2026-10-21T00:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, assignees: [], ...over,
});

function calCtx(over = {}) {
  const range = over.range ?? {
    from: '', to: '', timeZone: 'Asia/Muscat',
    tasks: [
      task('1', { assignees: [{ id: 'me', name: 'Mariam' }] }),
      task('2', { title: 'Omar’s task', assignees: [{ id: 'u2', name: 'Omar Ahmed' }], dueDate: '2026-10-21T00:00:00.000Z' }),
      task('3', { dueDate: '2026-10-19T00:00:00.000Z' }),
      task('4', { columnCategory: 'DONE', completedAt: '2026-10-22T08:00:00Z', dueDate: '2026-10-22T00:00:00.000Z' }),
    ],
    occurrences: [{ taskId: 'r1', seriesId: 'r1', date: '2026-10-28' }],
    series: [task('r1', { title: 'Weekly check', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, dueDate: '2026-10-21T00:00:00.000Z' })],
  };
  return {
    me: { id: 'me' },
    timeZone: 'Asia/Muscat',
    query: over.query ?? {},
    params: {},
    navigate: vi.fn(),
    openTask: vi.fn(),
    replaceHash: vi.fn(),
    api: {
      preferences: over.prefs ?? vi.fn(async () => ({ data: { timeZone: null, weekStart: null } })),
      calendar: over.calendar ?? vi.fn(async (from, to) => ({ data: { ...range, from, to }, stale: !!over.stale })),
      meetings: {
        list: over.meetings ?? vi.fn(async () => ({ data: [
          { id: 'm1', title: 'Rig review', startAt: '2026-10-21T06:00:00.000Z', endAt: '2026-10-21T07:00:00.000Z', status: 'SCHEDULED', projectId: 'p1', organizerId: 'u2', location: 'Room 2', recurrenceRule: null, recurrenceParentId: null },
        ] })),
      },
      projects: { list: vi.fn(async () => ({ data: [{ id: 'p1', name: 'Rig Inspection', color: '#0F766E', status: 'ACTIVE' }] })) },
    },
  };
}

async function open(ctx) {
  const root = CalendarScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const chip = (root, key) => root.querySelector(`[data-item="${key}"]`);

describe('Calendar: what it asks for', () => {
  it('the visible month in whole weeks from your week start, and the meetings in those days (your time zone)', async () => {
    const ctx = calCtx({ prefs: vi.fn(async () => ({ data: { timeZone: 'Europe/London', weekStart: 1 } })) });
    await open(ctx);
    expect(ctx.api.calendar).toHaveBeenCalledWith('2026-09-28', '2026-11-01');
    expect(ctx.api.meetings.list).toHaveBeenCalledWith({ from: '2026-09-27T23:00:00.000Z', to: '2026-11-02T00:00:00.000Z' });
  });

  it('says which zone the dates are in', async () => {
    const root = await open(calCtx());
    expect(root.textContent).toContain('Dates in Asia/Muscat (company time)');
  });
});

describe('Calendar: the month', () => {
  it('weekday names from your week start, each day with its tasks, copies to come and meetings', async () => {
    const root = await open(calCtx());
    expect([...root.querySelectorAll('.cal-month thead th')].map((th) => th.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(root.querySelector('.cal-period').textContent).toBe('October 2026');
    const today = root.querySelector('[data-day="2026-10-21"]');
    expect(today.classList.contains('today')).toBe(true);
    expect(chip(today, '1')).toBeTruthy();
    expect(chip(today, 'mtg:m1').textContent).toContain('10:00');
    expect(chip(today, 'mtg:m1').getAttribute('aria-label')).toBe('Rig review, meeting, 10:00 – 11:00');
    expect(chip(root, '3').getAttribute('aria-label')).toBe('Task 3, overdue');
    expect(chip(root, 'proj:r1:2026-10-28').getAttribute('aria-label')).toBe('Weekly check, repeat, not created yet, Wed 28 Oct');
    expect(chip(root, '4').classList.contains('s-done')).toBe(true);
  });

  it('a task opens its panel; a copy not made yet opens the current copy; a meeting opens its page', async () => {
    const ctx = calCtx();
    const root = await open(ctx);
    chip(root, '1').click();
    expect(ctx.openTask).toHaveBeenCalledWith('1');
    chip(root, 'proj:r1:2026-10-28').click();
    expect(ctx.openTask).toHaveBeenLastCalledWith('r1');
    chip(root, 'mtg:m1').click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/meeting/m1');
  });

  it('a busy day shows a few and “+N more”; choosing a day lists all of it underneath', async () => {
    const many = Array.from({ length: 5 }, (_, i) => task(`b${i}`, { dueDate: '2026-10-23T00:00:00.000Z' }));
    const ctx = calCtx({ range: { tasks: many, occurrences: [], series: [] } });
    const root = await open(ctx);
    const day = root.querySelector('[data-day="2026-10-23"]');
    expect(day.querySelectorAll('.cal-chip')).toHaveLength(3);
    const more = byText(day, 'button', '+2 more');
    expect(more.getAttribute('aria-label')).toBe('2 more on Fri 23 Oct');
    more.click();
    await settle();
    const list = root.querySelector('.cal-daylist');
    expect(list.querySelector('h3').textContent).toBe('Friday 23 October');
    expect(list.querySelectorAll('.cal-chip')).toHaveLength(5);
    expect(ctx.replaceHash).toHaveBeenLastCalledWith('#/calendar?date=2026-10-23');
  });

  it('Previous, Today and Next move the month; the address keeps the place; focus stays on the button', async () => {
    const ctx = calCtx();
    const root = await open(ctx);
    const next = byLabel(root, 'Next month');
    next.focus();
    next.click();
    await settle();
    expect(ctx.api.calendar).toHaveBeenLastCalledWith('2026-11-01', '2026-12-05');
    expect(root.querySelector('.cal-period').textContent).toBe('November 2026');
    expect(ctx.replaceHash).toHaveBeenLastCalledWith('#/calendar?date=2026-11-01');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Next month');
    byLabel(root, 'Previous month').click();
    await settle();
    expect(root.querySelector('.cal-period').textContent).toBe('October 2026');
    byText(root, 'button', 'Today').click();
    await settle();
    expect(ctx.replaceHash).toHaveBeenLastCalledWith('#/calendar');
  });

  it('opens where the address says (a view and a day)', async () => {
    const ctx = calCtx({ query: { view: 'week', date: '2026-11-04' } });
    const root = await open(ctx);
    expect(ctx.api.calendar).toHaveBeenCalledWith('2026-11-01', '2026-11-07');
    expect(root.querySelector('.cal-period').textContent).toBe('1 – 7 Nov 2026');
  });
});

describe('Calendar: Week and Agenda', () => {
  it('Week: the seven days, each with its items and who they are for', async () => {
    const ctx = calCtx();
    const root = await open(ctx);
    byText(root, 'button', 'Week').click();
    await settle();
    expect(byText(root, 'button', 'Week').getAttribute('aria-pressed')).toBe('true');
    expect(ctx.api.calendar).toHaveBeenLastCalledWith('2026-10-18', '2026-10-24');
    expect(ctx.replaceHash).toHaveBeenLastCalledWith('#/calendar?view=week');
    const days = [...root.querySelectorAll('.cal-day-section')];
    expect(days).toHaveLength(7);
    expect(days[3].querySelector('h3').textContent).toBe('Wednesday 21 October');
    expect(chip(days[3], '2').textContent).toContain('RIG-2 · Rig Inspection · Omar Ahmed');
    expect(days[0].textContent).toContain('Nothing due.');
  });

  it('Agenda: only the days with something on them, in the month', async () => {
    const root = await open(calCtx({ query: { view: 'agenda' } }));
    const heads = [...root.querySelectorAll('.cal-day-section h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Monday 19 October', 'Wednesday 21 October', 'Thursday 22 October', 'Wednesday 28 October']);
  });
});

describe('Calendar: filters', () => {
  it('Only mine, Done, Repeats and Meetings — kept in the address with the web’s names', async () => {
    const ctx = calCtx();
    const root = await open(ctx);
    byText(root, 'button', 'Only mine').click();
    await settle();
    expect(byText(root, 'button', 'Only mine').getAttribute('aria-pressed')).toBe('true');
    expect(chip(root, '2')).toBeNull();
    expect(chip(root, '1')).toBeTruthy();
    expect(ctx.replaceHash).toHaveBeenLastCalledWith('#/calendar?mine=1');
    byText(root, 'button', 'Only mine').click();
    byText(root, 'button', 'Meetings').click();
    await settle();
    expect(chip(root, 'mtg:m1')).toBeNull();
    byText(root, 'button', 'Repeats').click();
    byText(root, 'button', 'Done').click();
    await settle();
    expect(chip(root, 'proj:r1:2026-10-28')).toBeNull();
    expect(chip(root, '4')).toBeNull();
    expect(ctx.replaceHash).toHaveBeenLastCalledWith('#/calendar?done=0&repeats=0&meetings=0');
  });

  it('nothing in the month: says so, and with filters on offers to clear them', async () => {
    const ctx = calCtx({ range: { tasks: [], occurrences: [], series: [] }, meetings: vi.fn(async () => ({ data: [] })) });
    const root = await open(ctx);
    expect(root.textContent).toContain('Nothing is due in October 2026.');
    byText(root, 'button', 'Only mine').click();
    await settle();
    expect(root.textContent).toContain('No tasks match these filters in October 2026.');
    byText(root, 'button', 'Clear filters').click();
    await settle();
    expect(byText(root, 'button', 'Only mine').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Calendar: titles in their own direction', () => {
  it('an Arabic meeting title is isolated after its time (the time stays first)', async () => {
    const ctx = calCtx({ meetings: vi.fn(async () => ({ data: [{ id: 'ma', title: 'اجتماع مراجعة', startAt: '2026-10-21T05:59:00.000Z', endAt: null, status: 'SCHEDULED', projectId: null, organizerId: 'u2', location: null, recurrenceRule: null, recurrenceParentId: null }] })) });
    const root = await open(ctx);
    const title = chip(root, 'mtg:ma').querySelector('.cal-chip-title');
    expect(title.firstChild.textContent).toBe('09:59');
    expect(title.querySelector('bdi').textContent).toBe('اجتماع مراجعة');
  });
});

describe('Calendar: offline', () => {
  it('the saved copy, marked as such', async () => {
    const root = await open(calCtx({ stale: true }));
    expect(root.textContent).toContain('offline · saved');
    expect(chip(root, '1')).toBeTruthy();
  });

  it('nothing saved: the web’s words, with Retry', async () => {
    let fail = true;
    const calendar = vi.fn(async (from, to) => {
      if (fail) throw new TypeError('Failed to fetch');
      return { data: { from, to, tasks: [task('1')], occurrences: [], series: [] } };
    });
    const root = await open(calCtx({ calendar }));
    expect(root.querySelector('[role="alert"]').textContent).toContain('Couldn’t load the calendar.');
    fail = false;
    byText(root, 'button', 'Retry').click();
    await settle();
    expect(chip(root, '1')).toBeTruthy();
  });

  it('meetings that can’t be read leave the tasks, and say so', async () => {
    const root = await open(calCtx({ meetings: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) }));
    expect(chip(root, '1')).toBeTruthy();
    expect(root.textContent).toContain('Meetings couldn’t be loaded.');
  });
});
