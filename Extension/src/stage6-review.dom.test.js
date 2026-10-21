// @vitest-environment jsdom
/**
 * Fixes from the review of Stage 6 (search, the calendar and light meetings): a later period that
 * can't be read, the agenda's Overdue group, Arabic in a line of values, the period said to screen
 * readers, ranged meeting reads, your answer kept everywhere it shows, focus after a re-read, and
 * Ctrl+K over a dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalendarScreen } from '../app/screens/calendar.js';
import { MeetingsScreen } from '../app/screens/meetings.js';
import { DashboardScreen } from '../app/screens/dashboard.js';

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

// ---- meetings ------------------------------------------------------------------------------------

const meeting = (id, startAt, over = {}) => ({
  id, title: `Meeting ${id}`, description: null, status: 'SCHEDULED', startAt, endAt: null, timeZone: 'Asia/Muscat', projectId: 'p1', organizerId: 'u2',
  location: null, onlineLink: null, recurrenceRule: null, recurrenceParentId: null, attendeeCount: 2, ...over,
});
const LIST = [
  meeting('next', '2026-10-21T06:55:00.000Z', { title: 'Rig review', location: 'Room 2', onlineLink: 'https://meet.example.com/rig' }),
  meeting('today', '2026-10-21T12:00:00.000Z', { title: 'Safety walk' }),
  meeting('week', '2026-10-24T06:00:00.000Z', { title: 'Supplier call' }),
];
const PEOPLE = {
  next: [{ id: 'a1', userId: 'me', role: 'REQUIRED', response: 'PENDING' }, { id: 'a2', userId: 'u2', role: 'REQUIRED', response: 'ACCEPTED' }],
  today: [{ id: 'a3', userId: 'me', role: 'OPTIONAL', response: 'ACCEPTED' }],
  week: [],
};
/** The list as a newer server sends it: your own row and answer on each meeting. */
const withMine = (list, mine) => list.map((m) => ({ ...m, myAttendeeId: mine[m.id] ? mine[m.id][0] : null, myResponse: mine[m.id] ? mine[m.id][1] : null }));

function meetCtx(over = {}) {
  return {
    me: { id: 'me', roles: [] },
    timeZone: 'Asia/Muscat',
    appBase: 'https://task.mico360.com',
    apiBase: 'https://task.mico360.com/api/v1',
    params: {},
    query: {},
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { id: p.attendeeId, response: p.response } })),
    api: {
      meetings: {
        list: over.list ?? vi.fn(async () => ({ data: LIST })),
        attendees: over.attendees ?? vi.fn(async (id) => ({ data: PEOPLE[id] || [] })),
        rememberAnswer: over.rememberAnswer ?? vi.fn(async () => {}),
      },
      projects: { list: vi.fn(async () => ({ data: [{ id: 'p1', name: over.projectName ?? 'Rig Inspection', color: '#0F766E', status: 'ACTIVE' }] })) },
      directory: vi.fn(async () => ({ data: [{ id: 'me', firstName: 'Mariam', lastName: '', username: 'mariam' }, { id: 'u2', firstName: over.organizer ?? 'Omar', lastName: '', username: 'omar' }] })),
      tasks: { mine: vi.fn(async () => ({ data: [] })) },
    },
  };
}
async function show(screen, ctx) {
  const root = screen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const cardOf = (root, id) => root.querySelector(`.mt-card[data-meeting-id="${id}"]`);
const upNext = (root) => root.querySelector('[aria-label="Up next"]');

describe('Meetings review fix #2: meetings are read from the start of today, soonest first', () => {
  it('Meetings asks for the meetings from the start of today in company time (not the latest 500, newest first)', async () => {
    const ctx = meetCtx();
    await show(MeetingsScreen, ctx);
    expect(ctx.api.meetings.list).toHaveBeenCalledWith({ from: '2026-10-20T20:00:00.000Z' }); // 00:00 on the 21st in Muscat
  });

  it('the Dashboard’s Up next asks for the two weeks from today only', async () => {
    const ctx = meetCtx();
    await show(DashboardScreen, ctx);
    expect(ctx.api.meetings.list).toHaveBeenCalledWith({ from: '2026-10-20T20:00:00.000Z', to: '2026-11-03T20:00:00.000Z' });
  });
});

describe('Meetings review fix #3: an answer in Up next shows on that meeting’s card too', () => {
  it('Accept in Up next: the card below says “You’re going.” at once', async () => {
    const root = await show(MeetingsScreen, meetCtx());
    expect(cardOf(root, 'next').textContent).toContain('You haven’t answered yet.');
    byText(upNext(root), 'button', 'Accept').click();
    await settle();
    expect(cardOf(root, 'next').textContent).toContain('You’re going.');
    expect(cardOf(root, 'next').textContent).not.toContain('You haven’t answered yet.');
  });
});

describe('Meetings review fix #4: focus after a re-read goes back to the very same control', () => {
  it('a series shares its title: focus on the second card’s title stays there, not on Up next’s Open or the first card', async () => {
    const list = [
      meeting('w1', '2026-10-21T06:55:00.000Z', { title: 'Weekly sync', recurrenceParentId: 'w1' }),
      meeting('w2', '2026-10-21T12:00:00.000Z', { title: 'Weekly sync', recurrenceParentId: 'w1' }),
    ];
    const root = await show(MeetingsScreen, meetCtx({ list: vi.fn(async () => ({ data: list })), attendees: vi.fn(async () => ({ data: [] })) }));
    cardOf(root, 'w2').querySelector('.mt-title').focus();
    root.refresh();
    await settle();
    expect(document.activeElement.closest('.mt-card')?.dataset.meetingId).toBe('w2');
    upNext(root).querySelector('[data-focus-key="upnext-open-w1"]').focus();
    root.refresh();
    await settle();
    expect(document.activeElement.dataset.focusKey).toBe('upnext-open-w1');
  });
});

describe('Meetings review fix #5: your answers come with the list from a newer server', () => {
  it('with myAttendeeId and myResponse on each meeting, no meeting’s people are read; the answers show, and Up next answers on your row', async () => {
    const ctx = meetCtx({ list: vi.fn(async () => ({ data: withMine(LIST, { next: ['a1', 'PENDING'], today: ['a3', 'ACCEPTED'] }) })) });
    const root = await show(MeetingsScreen, ctx);
    expect(ctx.api.meetings.attendees).not.toHaveBeenCalled();
    expect(cardOf(root, 'today').textContent).toContain('You’re going.');
    expect(cardOf(root, 'week').textContent).not.toContain('answer');
    byText(upNext(root), 'button', 'Maybe').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('meeting.respond', { meetingId: 'next', attendeeId: 'a1', response: 'TENTATIVE', title: 'Rig review' });
  });

  it('your answer waiting to sync (marked on the row) says so in Up next', async () => {
    const rows = withMine(LIST, { next: ['a1', 'DECLINED'] }).map((m) => (m.id === 'next' ? { ...m, myPending: true } : m));
    const root = await show(MeetingsScreen, meetCtx({ list: vi.fn(async () => ({ data: rows })) }));
    expect(upNext(root).textContent).toContain('You’re not going. Saved on this device');
  });

  it('an older server (no such fields): the people of the soonest meetings are read, as before', async () => {
    const ctx = meetCtx();
    const root = await show(MeetingsScreen, ctx);
    expect(ctx.api.meetings.attendees).toHaveBeenCalledWith('next');
    expect(cardOf(root, 'today').textContent).toContain('You’re going.');
  });

  it('the Dashboard too: its Up next answers on your row without reading the meeting’s people', async () => {
    const ctx = meetCtx({ list: vi.fn(async () => ({ data: withMine(LIST, { next: ['a1', 'ACCEPTED'] }) })) });
    const root = await show(DashboardScreen, ctx);
    expect(ctx.api.meetings.attendees).not.toHaveBeenCalled();
    expect(byText(upNext(root), 'button', 'Accept').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Meetings review fix #6: an answer the server took is kept in the saved copies', () => {
  it('a direct answer updates the saved copies (offline they’d show the old one); one kept on this device leaves them', async () => {
    const ctx = meetCtx();
    const root = await show(MeetingsScreen, ctx);
    byText(upNext(root), 'button', 'Accept').click();
    await settle();
    expect(ctx.api.meetings.rememberAnswer).toHaveBeenCalledWith({ meetingId: 'next', attendeeId: 'a1', response: 'ACCEPTED', timeZone: 'Asia/Muscat' });
    const queued = meetCtx({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1' } })) });
    document.body.innerHTML = '';
    const r2 = await show(MeetingsScreen, queued);
    byText(upNext(r2), 'button', 'Accept').click();
    await settle();
    expect(queued.api.meetings.rememberAnswer).not.toHaveBeenCalled();
  });
});

describe('Meetings review fix #8: Arabic in a line of values', () => {
  it('Up next’s line and a card’s lines: each value isolated, the “ · ” outside', async () => {
    const list = [meeting('next', '2026-10-21T06:55:00.000Z', { title: 'مراجعة', location: 'غرفة ٢' })];
    const root = await show(MeetingsScreen, meetCtx({ list: vi.fn(async () => ({ data: list })), projectName: 'مشروع الحفر', organizer: 'عمر' }));
    const meta = upNext(root).querySelector('.mt-upnext-meta');
    expect([...meta.querySelectorAll('[dir="auto"]')].filter((n) => n.tagName !== 'BDI')).toEqual([]);
    expect(textNodes(meta).every((t) => t === ' · ')).toBe(true);
    expect([...meta.querySelectorAll('bdi')].map((b) => b.textContent)).toContain('غرفة ٢');
    expect([...meta.querySelectorAll('bdi')].map((b) => b.textContent)).toContain('مشروع الحفر');
    const lines = [...cardOf(root, 'next').querySelectorAll('.mt-line')];
    for (const line of lines) {
      expect([...line.querySelectorAll('[dir="auto"]')].filter((n) => n.tagName !== 'BDI')).toEqual([]);
      expect(textNodes(line).filter((t) => t.includes('·')).every((t) => t === ' · ')).toBe(true);
    }
    expect([...lines[1].querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['مشروع الحفر', 'عمر']);
    expect(lines[1].textContent).toBe('مشروع الحفر · Organizer: عمر');
  });

  it('a meeting’s agenda line too (who presents · how long)', async () => {
    const { MeetingScreen } = await import('../app/screens/meeting.js');
    const ctx = meetCtx({ organizer: 'عمر' });
    ctx.params = { meetingId: 'next' };
    ctx.api.meetings.get = vi.fn(async () => ({ data: LIST[0] }));
    ctx.api.meetings.agenda = vi.fn(async () => ({ data: [{ id: 'g1', title: 'Pumps', ownerId: 'u2', expectedMinutes: 15, position: 0, completed: false }] }));
    const root = await show(MeetingScreen, ctx);
    const line = root.querySelector('.mt-agenda-line');
    expect(line.hasAttribute('dir')).toBe(false);
    expect([...line.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['عمر', '15 min']);
    expect(textNodes(line)).toEqual([' · ']);
  });
});
