// @vitest-environment jsdom
/**
 * Stage 6: light meetings. The Meetings list (Up next, then Today, Next 7 days and Later, with your
 * answer), a meeting's page (when, where, Join, who's coming, the agenda), your answer — Accept,
 * Maybe or Decline, sent now or kept on this device — and "Open on the web" for the rest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeetingsScreen } from '../app/screens/meetings.js';
import { MeetingScreen } from '../app/screens/meeting.js';
import { DashboardScreen } from '../app/screens/dashboard.js';
import { ApiError } from './errors.js';

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

const meeting = (id, startAt, over = {}) => ({
  id, title: `Meeting ${id}`, description: null, status: 'SCHEDULED', startAt, endAt: null, timeZone: 'Asia/Muscat', projectId: 'p1', organizerId: 'u2',
  location: null, onlineLink: null, recurrenceRule: null, recurrenceParentId: null, updatedAt: '2026-10-01T00:00:00Z', attendeeCount: 2, attendees: ['Omar Ahmed', 'Mariam'], ...over,
});
const LIST = [
  meeting('next', '2026-10-21T06:55:00.000Z', { title: 'Rig review', location: 'Room 2', onlineLink: 'https://meet.example.com/rig' }),
  meeting('today', '2026-10-21T12:00:00.000Z', { title: 'Safety walk' }),
  meeting('week', '2026-10-24T06:00:00.000Z', { title: 'Supplier call', onlineLink: 'http://insecure.example.com/x' }),
  meeting('later', '2026-11-20T06:00:00.000Z', { title: 'Quarterly plan', projectId: null }),
  meeting('past', '2026-10-01T06:00:00.000Z', { title: 'Old one' }),
];
const PEOPLE = {
  next: [{ id: 'a1', userId: 'me', role: 'REQUIRED', response: 'PENDING' }, { id: 'a2', userId: 'u2', role: 'REQUIRED', response: 'ACCEPTED' }],
  today: [{ id: 'a3', userId: 'me', role: 'OPTIONAL', response: 'ACCEPTED' }],
  week: [{ id: 'a4', userId: 'u2', role: 'REQUIRED', response: 'PENDING' }],
};

function ctxFor(over = {}) {
  const people = { ...PEOPLE, ...(over.people || {}) };
  return {
    me: { id: 'me', roles: [] },
    timeZone: 'Asia/Muscat',
    appBase: 'https://task.mico360.com',
    apiBase: 'https://task.mico360.com/api/v1',
    params: over.params ?? {},
    query: {},
    navigate: vi.fn(),
    openTask: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { id: p.attendeeId, response: p.response } })),
    api: {
      meetings: {
        list: over.list ?? vi.fn(async () => ({ data: LIST, stale: !!over.stale })),
        get: over.get ?? vi.fn(async (id) => ({ data: LIST.find((m) => m.id === id) })),
        attendees: over.attendees ?? vi.fn(async (id) => ({ data: people[id] || [] })),
        agenda: over.agenda ?? vi.fn(async () => ({ data: [{ id: 'g1', title: 'Pump status', ownerId: 'u2', expectedMinutes: 15, position: 0, completed: false }] })),
      },
      projects: { list: vi.fn(async () => ({ data: [{ id: 'p1', name: 'Rig Inspection', color: '#0F766E', status: 'ACTIVE' }] })) },
      directory: vi.fn(async () => ({ data: [{ id: 'me', firstName: 'Mariam', lastName: '', username: 'mariam' }, { id: 'u2', firstName: 'Omar', lastName: 'Ahmed', username: 'omar' }] })),
      tasks: { mine: vi.fn(async () => ({ data: [] })) },
    },
  };
}

async function open(screen, ctx) {
  const root = screen(ctx);
  document.body.append(root);
  await settle();
  return root;
}

describe('Meetings: Up next', () => {
  it('the next meeting on top: when, where, who, Join (a secure link) and Open', async () => {
    const ctx = ctxFor();
    const root = await open(MeetingsScreen, ctx);
    const up = root.querySelector('[aria-label="Up next"]');
    expect(up.textContent).toContain('Up next');
    expect(up.textContent).toContain('in 25 min');
    expect(up.textContent).toContain('Rig review');
    expect(up.textContent).toContain('Room 2');
    expect(up.textContent).toContain('Rig Inspection');
    const join = byText(up, 'a', 'Join');
    expect(join.getAttribute('href')).toBe('https://meet.example.com/rig');
    expect(join.getAttribute('target')).toBe('_blank');
    expect(join.getAttribute('rel')).toBe('noopener noreferrer');
    byLabel(up, 'Open Rig review').click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/meeting/next');
  });

  it('your answer, as on the web: Going? Accept, Maybe or Decline — sent at once', async () => {
    const ctx = ctxFor();
    const root = await open(MeetingsScreen, ctx);
    const up = root.querySelector('[aria-label="Up next"]');
    const group = up.querySelector('[role="group"][aria-label="Your answer"]');
    expect([...group.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Accept', 'false'], ['Maybe', 'false'], ['Decline', 'false']]);
    const accept = byText(group, 'button', 'Accept');
    accept.focus(); // a click focuses the button in a browser
    accept.click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('meeting.respond', { meetingId: 'next', attendeeId: 'a1', response: 'ACCEPTED', title: 'Rig review' });
    const again = root.querySelector('[aria-label="Up next"] [role="group"][aria-label="Your answer"]');
    expect(byText(again, 'button', 'Accept').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[aria-label="Up next"]').textContent).toContain('You’re going.');
    expect(document.activeElement.textContent).toBe('Accept'); // focus stays on the answer
  });

  it('pressing your answer again takes it back', async () => {
    const ctx = ctxFor({ people: { next: [{ id: 'a1', userId: 'me', response: 'TENTATIVE' }] } });
    const root = await open(MeetingsScreen, ctx);
    byText(root.querySelector('[aria-label="Up next"]'), 'button', 'Maybe').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('meeting.respond', expect.objectContaining({ response: 'PENDING' }));
  });

  it('offline: kept on this device and said so; refused: the server’s words, and the answer goes back', async () => {
    const queued = ctxFor({ write: vi.fn(async () => ({ queued: true, item: { id: 'q1' } })) });
    const root = await open(MeetingsScreen, queued);
    byText(root.querySelector('[aria-label="Up next"]'), 'button', 'Decline').click();
    await settle();
    expect(root.querySelector('[aria-label="Up next"]').textContent).toContain('Saved on this device — it will sync when the connection is back.');

    document.body.innerHTML = '';
    const refused = ctxFor({ write: vi.fn(async () => { throw new ApiError(403, 'Only the organizer, the project manager or an admin can change the attendees.', 'FORBIDDEN'); }) });
    const r2 = await open(MeetingsScreen, refused);
    byText(r2.querySelector('[aria-label="Up next"]'), 'button', 'Accept').click();
    await settle();
    const up = r2.querySelector('[aria-label="Up next"]');
    expect(up.querySelector('[role="alert"]').textContent).toBe('Only the organizer, the project manager or an admin can change the attendees.');
    expect(byText(up, 'button', 'Accept').getAttribute('aria-pressed')).toBe('false');
  });

  it('not invited: no answer to give', async () => {
    const root = await open(MeetingsScreen, ctxFor({ people: { next: [{ id: 'a2', userId: 'u2' }] } }));
    expect(root.querySelector('[aria-label="Up next"] [role="group"]')).toBeNull();
  });
});

describe('Meetings: the list', () => {
  it('upcoming meetings in Today, Next 7 days and Later; past ones and drafts on the website', async () => {
    const root = await open(MeetingsScreen, ctxFor());
    const groups = [...root.querySelectorAll('.mt-group')].map((g) => [g.querySelector('h2').textContent, [...g.querySelectorAll('.mt-card .mt-title')].map((t) => t.textContent)]);
    expect(groups).toEqual([['Today2', ['Rig review', 'Safety walk']], ['Next 7 days1', ['Supplier call']], ['Later1', ['Quarterly plan']]]);
    expect(root.textContent).not.toContain('Old one');
    const web = byText(root, 'a', 'Past meetings, drafts and everything else on the website ↗');
    expect(web.getAttribute('href')).toBe('https://task.mico360.com/meetings');
  });

  it('each card says your answer when you are invited', async () => {
    const root = await open(MeetingsScreen, ctxFor());
    const card = (title) => [...root.querySelectorAll('.mt-card')].find((c) => c.querySelector('.mt-title').textContent === title);
    expect(card('Rig review').textContent).toContain('You haven’t answered yet.');
    expect(card('Safety walk').textContent).toContain('You’re going.');
    expect(card('Supplier call').textContent).not.toContain('answer'); // not invited
  });

  it('a card opens the meeting here', async () => {
    const ctx = ctxFor();
    const root = await open(MeetingsScreen, ctx);
    byLabel(root, 'Open Safety walk').click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/meeting/today');
  });

  it('nothing coming up: says so; offline: the saved copy, marked', async () => {
    const empty = await open(MeetingsScreen, ctxFor({ list: vi.fn(async () => ({ data: [LIST[4]] })) }));
    expect(empty.textContent).toContain('No upcoming meetings');
    document.body.innerHTML = '';
    const stale = await open(MeetingsScreen, ctxFor({ stale: true }));
    expect(stale.textContent).toContain('offline · saved');
  });

  it('can’t be read with nothing saved: the web’s words, with Retry', async () => {
    const root = await open(MeetingsScreen, ctxFor({ list: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) }));
    expect(root.querySelector('[role="alert"]').textContent).toContain('Couldn’t load meetings. Check your connection and try again.');
    expect(byText(root, 'button', 'Retry')).toBeTruthy();
  });
});

describe('a meeting’s page', () => {
  it('when, where, Join, the organizer and project, what it is about, the agenda and who is coming', async () => {
    const ctx = ctxFor({ params: { meetingId: 'next' }, get: vi.fn(async () => ({ data: { ...LIST[0], description: 'Check the pumps.\nBring the logs.' } })) });
    const root = await open(MeetingScreen, ctx);
    expect(root.querySelector('h2').textContent).toBe('Rig review');
    expect(root.textContent).toContain('Scheduled');
    expect(root.textContent).toContain('Rig Inspection');
    expect(root.textContent).toContain('Room 2');
    expect(root.textContent).toContain('Organizer: Omar Ahmed');
    expect(root.textContent).toContain('Asia/Muscat');
    expect(byText(root, 'a', 'Join online').getAttribute('href')).toBe('https://meet.example.com/rig');
    expect(root.querySelector('.mt-about').textContent).toBe('Check the pumps.\nBring the logs.');
    expect(root.querySelector('.mt-agenda').textContent).toContain('Pump status');
    expect(root.querySelector('.mt-agenda').textContent).toContain('Omar Ahmed · 15 min');
    expect(root.textContent).toContain('1 accepted · 0 maybe · 0 declined · 1 no response');
    expect(root.querySelector('.mt-people').textContent).toContain('Omar Ahmed');
    const web = byText(root, 'a', 'Open on the web ↗');
    expect(web.getAttribute('href')).toBe('https://task.mico360.com/meetings/next');
    expect(web.getAttribute('target')).toBe('_blank');
    expect(root.textContent).toContain('Notes, minutes and action items are on the website.');
  });

  it('your answer shows at once in the people list too (your row and the count)', async () => {
    const ctx = ctxFor({ params: { meetingId: 'next' } });
    const root = await open(MeetingScreen, ctx);
    const accept = byText(root.querySelector('[aria-label="Your answer"]'), 'button', 'Accept');
    accept.focus();
    accept.click();
    await settle();
    expect(root.querySelector('.mt-people').textContent).toContain('2 accepted · 0 maybe · 0 declined · 0 no response');
    const mineRow = [...root.querySelectorAll('.mt-people li')].find((li) => li.textContent.includes('(you)'));
    expect(mineRow.textContent).toContain('Accepted');
    expect(document.activeElement).toBe(accept); // the answer buttons weren't drawn again
  });

  it('read again (coming back to the tab): focus stays on the same control', async () => {
    const ctx = ctxFor({ params: { meetingId: 'next' } });
    const root = await open(MeetingScreen, ctx);
    byText(root.querySelector('[aria-label="Your answer"]'), 'button', 'Maybe').focus();
    root.refresh();
    await settle();
    expect(document.activeElement.textContent).toBe('Maybe');
    expect(root.contains(document.activeElement)).toBe(true);
    document.body.innerHTML = '';
    const list = await open(MeetingsScreen, ctxFor());
    byLabel(list, 'Open Safety walk').focus();
    list.refresh();
    await settle();
    expect(document.activeElement.getAttribute('aria-label')).toBe('Open Safety walk');
  });

  it('Join only for a secure (https) link', async () => {
    const root = await open(MeetingScreen, ctxFor({ params: { meetingId: 'week' } }));
    expect(byText(root, 'a', 'Join online')).toBeUndefined();
  });

  it('your answer from its page; a cancelled meeting can’t be answered', async () => {
    const ctx = ctxFor({ params: { meetingId: 'next' } });
    const root = await open(MeetingScreen, ctx);
    byText(root.querySelector('[aria-label="Your answer"]'), 'button', 'Maybe').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('meeting.respond', { meetingId: 'next', attendeeId: 'a1', response: 'TENTATIVE', title: 'Rig review' });
    expect(root.textContent).toContain('You might go.');
    document.body.innerHTML = '';
    const cancelled = await open(MeetingScreen, ctxFor({ params: { meetingId: 'next' }, get: vi.fn(async () => ({ data: { ...LIST[0], status: 'CANCELLED' } })) }));
    expect(cancelled.querySelector('[aria-label="Your answer"]')).toBeNull();
    expect(cancelled.querySelector('h2').classList.contains('cancelled')).toBe(true);
  });

  it('a meeting that is gone, or not yours to see: the web’s words, back to meetings', async () => {
    const ctx = ctxFor({ params: { meetingId: 'x' }, get: vi.fn(async () => { throw new ApiError(404, 'Meeting not found.', 'NOT_FOUND'); }) });
    const root = await open(MeetingScreen, ctx);
    expect(root.textContent).toContain('Meeting not found');
    expect(root.textContent).toContain('It may have been deleted, or you don’t have access to it.');
    expect(byText(root, 'button', 'Retry')).toBeUndefined();
    byText(root, 'button', '← Back to meetings').click();
    expect(ctx.navigate).toHaveBeenCalledWith('#/meetings');
  });

  it('can’t be read with nothing saved: says so, with Retry', async () => {
    const root = await open(MeetingScreen, ctxFor({ params: { meetingId: 'next' }, get: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) }));
    expect(root.textContent).toContain('Couldn’t load this meeting');
    expect(root.textContent).toContain('Check your connection and try again.');
    expect(byText(root, 'button', 'Retry')).toBeTruthy();
  });
});

describe('Dashboard: Up next', () => {
  it('the next meeting on top of the dashboard, with Join, your answer and Open', async () => {
    const ctx = ctxFor();
    const root = await open(DashboardScreen, ctx);
    const up = root.querySelector('[aria-label="Up next"]');
    expect(up.textContent).toContain('Rig review');
    expect(byText(up, 'a', 'Join')).toBeTruthy();
    expect(up.querySelector('[aria-label="Your answer"]')).toBeTruthy();
  });

  it('no meeting coming, or meetings that can’t be read: nothing extra', async () => {
    const root = await open(DashboardScreen, ctxFor({ list: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) }));
    expect(root.querySelector('[aria-label="Up next"]')).toBeNull();
    expect(root.textContent).toContain('Due today');
  });
});
