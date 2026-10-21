// @vitest-environment jsdom
/**
 * Fixes from the review of Stage 6 (search, the calendar and light meetings): a later period that
 * can't be read, the agenda's Overdue group, Arabic in a line of values, the period said to screen
 * readers, ranged meeting reads, your answer kept everywhere it shows, focus after a re-read, and
 * Ctrl+K over a dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalendarScreen } from '../app/screens/calendar.js';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const textNodes = (node) => [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent);

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T06:30:00.000Z')); // Wed 21 Oct, 10:30 in Muscat
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ---- the calendar ------------------------------------------------------------------------------

const task = (id, over = {}) => ({
  id, key: `RIG-${id}`, title: `Task ${id}`, projectId: 'p1', priority: 'NORMAL', columnCategory: 'TODO', completedAt: null,
  dueDate: '2026-10-21T00:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, assignees: [], ...over,
});

function calCtx(over = {}) {
  return {
    me: { id: 'me' },
    timeZone: 'Asia/Muscat',
    query: over.query ?? {},
    params: {},
    navigate: vi.fn(),
    openTask: vi.fn(),
    replaceHash: vi.fn(),
    announce: vi.fn(),
    api: {
      preferences: vi.fn(async () => ({ data: { timeZone: null, weekStart: null } })),
      calendar: over.calendar ?? vi.fn(async (from, to) => ({ data: { from, to, tasks: over.tasks ?? [task('1')], occurrences: [], series: [] } })),
      meetings: { list: over.meetings ?? vi.fn(async () => ({ data: [] })) },
      projects: { list: vi.fn(async () => ({ data: over.projects ?? [{ id: 'p1', name: 'Rig Inspection', color: '#0F766E', status: 'ACTIVE' }] })) },
      tasks: { list: over.overdue ?? vi.fn(async () => ({ data: [] })) },
    },
  };
}

async function openCal(ctx) {
  const root = CalendarScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const chip = (root, key) => root.querySelector(`[data-item="${key}"]`);

describe('Calendar review fix #1: a later period that can’t be read', () => {
  it('says it couldn’t be loaded, with Retry — never “Nothing is due” in a month it couldn’t read, nor the month before’s tasks', async () => {
    let fail = false;
    const calendar = vi.fn(async (from, to) => {
      if (fail) throw new TypeError('Failed to fetch');
      return { data: { from, to, tasks: [task('1')], occurrences: [], series: [] } };
    });
    const ctx = calCtx({ calendar });
    const root = await openCal(ctx);
    expect(chip(root, '1')).toBeTruthy();
    fail = true;
    byLabel(root, 'Next month').click();
    await settle();
    expect(root.querySelector('.cal-period').textContent).toBe('November 2026');
    expect(root.querySelector('[role="alert"]').textContent).toContain('Couldn’t load the calendar.');
    expect(root.textContent).not.toContain('Nothing is due');
    expect(chip(root, '1')).toBeNull();
    fail = false;
    byText(root, 'button', 'Retry').click();
    await settle();
    expect(calendar).toHaveBeenLastCalledWith('2026-11-01', '2026-12-05');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).toContain('November 2026');
  });

  it('the same month read again and failing stays on screen, marked “offline · saved”', async () => {
    let fail = false;
    const calendar = vi.fn(async (from, to) => {
      if (fail) throw new Error('500');
      return { data: { from, to, tasks: [task('1')], occurrences: [], series: [] } };
    });
    const root = await openCal(calCtx({ calendar }));
    expect(root.textContent).not.toContain('offline · saved');
    fail = true;
    root.refresh();
    await settle();
    expect(chip(root, '1')).toBeTruthy();
    expect(root.textContent).toContain('offline · saved');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('Calendar review fix #7: the agenda’s Overdue group, as on the web', () => {
  const late = (n) => Array.from({ length: n }, (_, i) => task(`o${i}`, { title: `Late ${i}`, dueDate: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`, assignees: i === 0 ? [{ id: 'me', name: 'Mariam' }] : [] }));

  it('lists open tasks past their day from any month first (GET /tasks?overdue=true): eight, then “Show all”', async () => {
    const overdue = vi.fn(async () => ({ data: [...late(10), task('done', { dueDate: '2026-09-01T00:00:00.000Z', columnCategory: 'DONE', completedAt: '2026-09-02T00:00:00Z' })] }));
    const root = await openCal(calCtx({ query: { view: 'agenda' }, overdue }));
    expect(overdue).toHaveBeenCalledWith({ overdue: true });
    const group = byLabel(root, 'Overdue (10)');
    expect(group.querySelector('h3').textContent).toBe('Overdue · 10');
    expect(group.querySelectorAll('.cal-chip')).toHaveLength(8);
    const more = byText(group, 'button', 'Show all 10 overdue tasks');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    const again = byLabel(root, 'Overdue (10)');
    expect(again.querySelectorAll('.cal-chip')).toHaveLength(10);
    expect(byText(again, 'button', 'Show fewer').getAttribute('aria-expanded')).toBe('true');
    // The group comes before the days.
    expect(root.querySelector('.cal-overdue').compareDocumentPosition(root.querySelector('.cal-day-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('follows the filters (Only mine), opens a task’s panel, and with nothing else in the month says no “Nothing is due”', async () => {
    const ctx = calCtx({ query: { view: 'agenda', mine: '1' }, tasks: [], overdue: vi.fn(async () => ({ data: late(3) })) });
    const root = await openCal(ctx);
    const group = byLabel(root, 'Overdue (1)');
    expect(group.textContent).toContain('Late 0');
    expect(root.textContent).not.toContain('No tasks match these filters');
    group.querySelector('.cal-chip').click();
    expect(ctx.openTask).toHaveBeenCalledWith('o0');
  });

  it('only in the agenda; when it can’t be read the agenda still shows', async () => {
    const overdue = vi.fn(async () => ({ data: late(2) }));
    const root = await openCal(calCtx({ overdue }));
    expect(overdue).not.toHaveBeenCalled();
    expect(root.querySelector('.cal-overdue')).toBeNull();
    const failing = await openCal(calCtx({ query: { view: 'agenda' }, overdue: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) }));
    expect(failing.querySelector('.cal-day-section')).toBeTruthy();
    expect(failing.querySelector('.cal-overdue')).toBeNull();
  });
});

describe('Calendar review fix #8: Arabic in a line of values', () => {
  it('a task’s line: each value isolated, the “ · ” between them outside (they can’t move or swap)', async () => {
    const ctx = calCtx({
      query: { view: 'week' },
      projects: [{ id: 'p1', name: 'مشروع الحفر', color: null, status: 'ACTIVE' }],
      tasks: [task('2', { assignees: [{ id: 'u2', name: 'عمر' }, { id: 'u3', name: 'Mariam' }] })],
    });
    const root = await openCal(ctx);
    const meta = chip(root, '2').querySelector('.cal-chip-meta');
    expect(meta.hasAttribute('dir')).toBe(false);
    expect([...meta.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['RIG-2', 'مشروع الحفر', 'عمر, Mariam']);
    expect(textNodes(meta)).toEqual([' · ', ' · ']);
    expect(meta.textContent).toBe('RIG-2 · مشروع الحفر · عمر, Mariam');
  });

  it('a meeting’s line too (its time, then its place)', async () => {
    const meetings = vi.fn(async () => ({ data: [{ id: 'ma', title: 'Review', startAt: '2026-10-21T06:00:00.000Z', endAt: '2026-10-21T07:00:00.000Z', status: 'SCHEDULED', projectId: null, organizerId: 'u2', location: 'غرفة ٢', recurrenceRule: null, recurrenceParentId: null }] }));
    const root = await openCal(calCtx({ query: { view: 'week' }, meetings }));
    const meta = chip(root, 'mtg:ma').querySelector('.cal-chip-meta');
    expect(meta.hasAttribute('dir')).toBe(false);
    expect([...meta.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['10:00 – 11:00', 'غرفة ٢']);
    expect(textNodes(meta)).toEqual([' · ']);
  });
});

describe('Calendar review fix #9: the period is said to screen readers', () => {
  it('changing month (or view) says the new one through the app’s own live region — not on first showing', async () => {
    const ctx = calCtx();
    const root = await openCal(ctx);
    expect(ctx.announce).not.toHaveBeenCalled();
    expect(root.querySelector('.cal-period').hasAttribute('aria-live')).toBe(false); // a new region each time is never read
    byLabel(root, 'Next month').click();
    await settle();
    expect(ctx.announce).toHaveBeenLastCalledWith('November 2026');
    byText(root, 'button', 'Today').click();
    await settle();
    expect(ctx.announce).toHaveBeenLastCalledWith('October 2026');
    const calls = ctx.announce.mock.calls.length;
    byText(root, 'button', 'Only mine').click(); // the same period: nothing to say
    await settle();
    expect(ctx.announce).toHaveBeenCalledTimes(calls);
  });
});
