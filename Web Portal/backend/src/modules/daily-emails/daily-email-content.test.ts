import { describe, it, expect, vi } from 'vitest';
import { dailyEmail, emailSafetyProblems, taskLink, type DailyEmailInput, type DailyMeeting, type DailyProject, type DailyProjectFigures, type DailyTask } from './daily-email-content';
import { DEFAULT_DAILY_EMAILS } from '../notifications/notification-preferences';
import { OVERDUE_TONES, PRIORITY_TONES, STATUS_TONES } from '../../lib/colour-scheme';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-04T02:00:00Z'); // 06:00 on Wed 4 Nov 2026 in Muscat
const APP = 'https://task.example';
const ASSETS = 'https://api.example';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`); // due dates are stored as pure days
const board = (key: string) => new Date(`${key}T12:00:00.000Z`); // board days: a noon-UTC anchor

const RIG: DailyProject = {
  id: 'p-rig',
  code: 'RIG',
  name: 'Rig Inspection',
  number: '2026-014',
  clientName: 'Acme Drilling',
  managerName: 'Sara Ali',
  status: 'ACTIVE',
  color: '#3A6EA5',
  imageUrl: null,
  targetDate: day('2026-11-30'),
};
const OPS: DailyProject = { id: 'p-ops', code: 'OPS', name: 'Operations', number: null, clientName: null, managerName: null, status: 'ON_HOLD', color: null, imageUrl: '/uploads/projects/ops.png', targetDate: null };

const task = (key: string, extra: Partial<DailyTask> = {}): DailyTask => ({
  id: key.toLowerCase(),
  key,
  title: `Task ${key}`,
  project: RIG,
  priority: 'NORMAL',
  dueDate: null,
  statusLabel: 'To Do',
  statusKind: 'TODO',
  completedAt: null,
  ...extra,
});
const meeting = (id: string, extra: Partial<DailyMeeting> = {}): DailyMeeting => ({
  id,
  title: `Meeting ${id}`,
  startAt: new Date('2026-11-04T05:00:00Z'), // 09:00 Muscat
  endAt: new Date('2026-11-04T06:00:00Z'),
  location: null,
  online: false,
  projectName: null,
  organizer: false,
  response: 'ACCEPTED',
  status: 'SCHEDULED',
  ...extra,
});
const figures = (project: DailyProject, extra: Partial<DailyProjectFigures> = {}): DailyProjectFigures => ({ project, pct: 50, done: 5, total: 10, open: 5, overdue: 0, waiting: 0, ...extra });

const input = (extra: Partial<DailyEmailInput> = {}): DailyEmailInput => ({
  name: 'Ada',
  timeZone: TZ,
  now: NOW,
  appUrl: APP,
  assetUrl: ASSETS,
  time: '06:00',
  weekStart: 0,
  parts: { ...DEFAULT_DAILY_EMAILS },
  tasks: [],
  meetings: [],
  completed: [],
  completedSince: new Date('2026-11-03T02:00:00Z'),
  awaitingApproval: 0,
  managed: [],
  week: { due: [], completions: [] },
  projects: [],
  ...extra,
});
const build = (extra: Partial<DailyEmailInput> = {}) => {
  const e = dailyEmail(input(extra));
  if (!e) throw new Error('expected an email');
  return e;
};
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
/** The plain text between one section heading and the next. */
const section = (text: string, heading: string) => {
  const start = text.indexOf(`== ${heading}`);
  if (start < 0) return '';
  const next = text.indexOf('\n== ', start + 3);
  const foot = text.indexOf('You get this email', start);
  const end = [next, foot].filter((i) => i > start).sort((a, b) => a - b)[0] ?? text.length;
  return text.slice(start, end);
};
const only = (part: string) => ({ ...(Object.fromEntries(Object.keys(DEFAULT_DAILY_EMAILS).map((k) => [k, k === part])) as unknown as DailyEmailInput['parts']), time: '06:00' });

describe('taskLink', () => {
  it('opens the task on My Tasks', () => {
    expect(taskLink('https://task.example/', 'abc 1')).toBe('https://task.example/my-tasks?task=abc%201');
  });
});

describe('the daily email: its sections in the design’s order', () => {
  const everything = () =>
    build({
      tasks: [
        task('RIG-1', { dueDate: day('2026-11-01'), priority: 'HIGH' }), // 3 days late
        task('RIG-2', { dueDate: day('2026-11-04') }), // due today
        task('OPS-3', { project: OPS, dueDate: day('2026-11-06') }), // coming up
        task('OPS-4', { project: OPS }), // no due date: other open tasks
      ],
      meetings: [meeting('m1')],
      managed: [task('RIG-9', { dueDate: day('2026-11-02'), assignees: ['Omar Ahmed'] })],
      completed: [task('RIG-5', { completedAt: new Date('2026-11-03T10:00:00Z'), dueDate: day('2026-11-05') })],
      week: { due: [{ dueDate: day('2026-11-04'), done: false }, { dueDate: day('2026-11-02'), done: true }], completions: [new Date('2026-11-03T10:00:00Z')] },
      projects: [figures(RIG, { overdue: 1 })],
    });

  it('At a glance → This week → By priority → Overdue → Due today → Coming up → Other open tasks → meetings → completed → Your projects → others’ tasks', () => {
    const { text } = everything();
    const order = [
      '== Today at a glance ==',
      '== This week ==',
      '== By priority ==',
      '== Overdue (1) ==',
      '== Due today (1) ==',
      '== Coming up (1) ==',
      '== Other open tasks (1) ==',
      '== Today’s meetings (1) ==',
      '== Completed yesterday (1) ==',
      '== Your projects (1) ==',
      '== Overdue and waiting in your projects (1) ==',
    ];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the subject: what is overdue and due, and the day', () => {
    expect(everything().subject).toBe('Today: 1 overdue, 1 due, 1 meeting — Wed 4 Nov');
    expect(build({ tasks: [task('RIG-1', { dueDate: day('2026-11-01') }), task('RIG-2', { dueDate: day('2026-10-30') }), task('RIG-3', { dueDate: day('2026-11-04') })] }).subject).toBe('Today: 2 overdue, 1 due — Wed 4 Nov');
    expect(build({ meetings: [meeting('a'), meeting('b')] }).subject).toBe('Today: 2 meetings — Wed 4 Nov');
    expect(build({ tasks: [task('RIG-1')] }).subject).toBe('Today: 1 open task — Wed 4 Nov');
    expect(build({ awaitingApproval: 2 }).subject).toBe('Today: 2 tasks to approve — Wed 4 Nov');
    expect(build({ completed: [task('RIG-1', { completedAt: NOW })] }).subject).toBe('Today: 1 task completed recently — Wed 4 Nov');
  });

  it('greets the person for the time of day and dates the header in their time zone, "Wed 4 Nov 2026"', () => {
    const e = everything();
    expect(e.html).toContain('Good morning, Ada');
    expect(e.html).toMatch(/class="email-head-note"[^>]*>Wed 4 Nov 2026</);
    // 21:30 on Tuesday in UTC is already 01:30 on Wednesday in Muscat.
    expect(build({ tasks: [task('RIG-1')], now: new Date('2026-11-03T21:30:00Z') }).html).toMatch(/class="email-head-note"[^>]*>Wed 4 Nov 2026</);
    expect(build({ tasks: [task('RIG-1')], now: new Date('2026-11-04T10:00:00Z') }).html).toContain('Good afternoon, Ada'); // 14:00
    expect(build({ tasks: [task('RIG-1')], now: new Date('2026-11-04T15:00:00Z') }).html).toContain('Good evening, Ada'); // 19:00
  });

  it('names the time zone once, in the line about when the email comes', () => {
    const { text, html } = everything();
    expect(text.split('Asia/Muscat').length - 1).toBe(1);
    expect(html).toContain('You get this email at 06:00 every morning, Asia/Muscat time.');
  });

  it('nothing in any part that is on: no email', () => {
    expect(dailyEmail(input())).toBeNull();
    // Only the meetings on, and no meeting — though there are tasks.
    expect(dailyEmail(input({ parts: only('schedule'), tasks: [task('RIG-1')] }))).toBeNull();
  });

  it('figures alone never send an email: last week’s work with nothing open, nothing new and no meeting is no email (as before)', () => {
    expect(
      dailyEmail(input({ week: { due: [{ dueDate: day('2026-11-02'), done: true }], completions: [new Date('2026-10-30T08:00:00Z'), new Date('2026-11-02T08:00:00Z')] }, projects: [figures(RIG, { open: 0, done: 10, total: 10, pct: 100 })] })),
    ).toBeNull();
  });

  it('a summary-only email: only At a glance on still comes while the person has open tasks', () => {
    const e = build({ parts: only('glance'), tasks: [task('RIG-1', { dueDate: day('2026-11-01') })] });
    expect(e.text).toContain('== Today at a glance ==');
    expect(e.text).not.toContain('== Overdue');
  });
});

describe('Today at a glance', () => {
  const tiles = (text: string) => section(text, 'Today at a glance').split('\n')[1];

  it('Open = their tasks not done; In progress = In progress, Review and Blocked columns, and tasks waiting for approval; Not started = To do and Backlog', () => {
    const e = build({
      tasks: [
        task('A-1', { statusKind: 'IN_PROGRESS', statusLabel: 'In Progress' }),
        task('A-2', { statusKind: 'REVIEW', statusLabel: 'Review' }),
        task('A-3', { statusKind: 'BLOCKED', statusLabel: 'Blocked' }),
        task('A-4', { statusKind: 'TODO' }),
        task('A-5', { statusKind: 'BACKLOG', statusLabel: 'Backlog' }),
        task('A-6', { statusKind: 'TODO', waitingSince: new Date('2026-11-03T08:00:00Z') }), // handed in: in progress
      ],
    });
    expect(tiles(e.text)).toBe('6 open · 4 in progress · 2 not started · 0 overdue · 0 done this week');
  });

  it('Overdue = open with a due day before today in their time zone; a task waiting for approval is never overdue', () => {
    const e = build({
      tasks: [
        task('A-1', { dueDate: day('2026-11-03') }),
        task('A-2', { dueDate: day('2026-10-20') }),
        task('A-3', { dueDate: day('2026-11-04') }), // today
        task('A-4', { dueDate: day('2026-11-02'), waitingSince: new Date('2026-11-03T08:00:00Z') }),
      ],
    });
    expect(tiles(e.text)).toContain('2 overdue');
    // 21:30 on Tuesday in UTC is Wednesday in Muscat: a task due Tuesday is already late.
    const late = build({ now: new Date('2026-11-03T21:30:00Z'), tasks: [task('A-1', { dueDate: day('2026-11-03') })] });
    expect(tiles(late.text)).toContain('1 overdue');
    // ...and at 23:30 on Tuesday Muscat time (19:30 UTC) it isn't yet.
    const notYet = build({ now: new Date('2026-11-03T19:30:00Z'), tasks: [task('A-1', { dueDate: day('2026-11-03') })] });
    expect(tiles(notYet.text)).toContain('0 overdue');
  });

  it('the Overdue tile is red (word and colour) only when there is something overdue', () => {
    const red = OVERDUE_TONES.light.text;
    const late = build({ tasks: [task('A-1', { dueDate: day('2026-11-01') })] }).html;
    const fine = build({ tasks: [task('A-1')] }).html;
    expect(late).toMatch(new RegExp(`class="em-tile-n em-ink-overdue"[^>]*color:${red}[^>]*>1<`));
    expect(fine).not.toMatch(/class="em-tile-n em-ink-overdue"/);
  });

  it('Done this week = completed since the start of their week (their own week start), in their time zone', () => {
    const completions = [
      new Date('2026-10-30T19:59:00Z'), // Fri 30 Oct 23:59 Muscat
      new Date('2026-10-30T20:00:00Z'), // Sat 31 Oct 00:00 Muscat
      new Date('2026-10-31T20:00:00Z'), // Sun 1 Nov 00:00 Muscat
      new Date('2026-11-01T20:00:00Z'), // Mon 2 Nov 00:00 Muscat
      new Date('2026-11-04T01:00:00Z'), // today 05:00
    ];
    const at = (weekStart: 0 | 1 | 6) => tiles(build({ weekStart, tasks: [task('A-1')], week: { due: [], completions } }).text);
    expect(at(0)).toContain('3 done this week'); // Sunday weeks: since Sun 1 Nov
    expect(at(1)).toContain('2 done this week'); // Monday weeks: since Mon 2 Nov
    expect(at(6)).toContain('4 done this week'); // Saturday weeks: since Sat 31 Oct
  });

  it('tasks waiting for a later start day are out of today’s figures (they are in Coming up)', () => {
    const e = build({ tasks: [task('A-1'), task('A-2', { boardDate: board('2026-11-05'), dueDate: day('2026-11-03') })] });
    expect(tiles(e.text)).toBe('1 open · 0 in progress · 1 not started · 0 overdue · 0 done this week');
    expect(section(e.text, 'Coming up')).toContain('A-2');
  });

  it('turned off: no tiles', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, glance: false }, tasks: [task('A-1')] }).text).not.toContain('Today at a glance');
  });
});

describe('This week', () => {
  const week = (text: string) => section(text, 'This week');

  it('tasks due this week (their week) done of all due this week, with a bar; 100% only when all are done', () => {
    const due = [
      { dueDate: day('2026-11-01'), done: true }, // Sun: in a Sunday week
      { dueDate: day('2026-11-04'), done: true },
      { dueDate: day('2026-11-07'), done: false }, // Sat: the last day
      { dueDate: day('2026-11-08'), done: true }, // next week
      { dueDate: day('2026-10-31'), done: true }, // last week
      { dueDate: new Date('2026-11-07T21:00:00Z'), done: false }, // an instant: Sun 8 Nov 01:00 Muscat — next week
    ];
    const e = build({ tasks: [task('A-1')], week: { due, completions: [] } });
    expect(week(e.text)).toContain('Due this week: 2 of 3 done · 67%');
    expect(e.html).toContain('2 of 3 done · 67%');
    expect(e.html).toMatch(/class="em-f-status-done" width="67%"/);
    // Monday weeks: Mon 2 Nov – Sun 8 Nov.
    expect(week(build({ weekStart: 1, tasks: [task('A-1')], week: { due, completions: [] } }).text)).toContain('Due this week: 2 of 4 done · 50%');
    const nearly = Array.from({ length: 200 }, (_, i) => ({ dueDate: day('2026-11-04'), done: i > 0 }));
    expect(week(build({ tasks: [task('A-1')], week: { due: nearly, completions: [] } }).text)).toContain('199 of 200 done · 99%');
    expect(week(build({ tasks: [task('A-1')], week: { due: [{ dueDate: day('2026-11-04'), done: true }], completions: [] } }).text)).toContain('1 of 1 done · 100%');
  });

  it('the trend: tasks completed on each of the last 7 days (to yesterday), against the 7 days before', () => {
    const at = (key: string, n: number) => Array.from({ length: n }, () => new Date(`${key}T06:00:00Z`));
    const completions = [
      ...at('2026-10-20', 9), // 15 days back: not counted
      ...at('2026-10-21', 3), // the week before: Wed 21 Oct … Tue 27 Oct
      ...at('2026-10-27', 2),
      ...at('2026-10-28', 2), // the last 7 days: Wed 28 Oct … Tue 3 Nov
      ...at('2026-11-01', 1),
      ...at('2026-11-03', 4),
      ...at('2026-11-04', 5), // today: not in the 7 days
    ];
    const e = build({ tasks: [task('A-1')], week: { due: [], completions } });
    const w = week(e.text);
    expect(w).toContain('Done each day, last 7 days: Wed 2 · Thu 0 · Fri 0 · Sat 0 · Sun 1 · Mon 0 · Tue 4');
    expect(w).toContain('7 done vs 5 the week before (more)');
    expect(e.html).toContain('7 done vs 5 the week before ↑');
    // Fewer, and the same.
    expect(week(build({ tasks: [task('A-1')], week: { due: [], completions: [...at('2026-10-27', 3), ...at('2026-11-02', 1)] } }).text)).toContain('1 done vs 3 the week before (fewer)');
    expect(week(build({ tasks: [task('A-1')], week: { due: [], completions: [...at('2026-10-27', 2), ...at('2026-11-02', 2)] } }).text)).toContain('2 done vs 2 the week before (the same)');
  });

  it('nothing completed in the last two weeks: a plain line instead of seven empty bars', () => {
    const e = build({ tasks: [task('A-1')], week: { due: [{ dueDate: day('2026-11-04'), done: false }], completions: [] } });
    expect(section(e.text, 'This week')).toContain('Nothing completed in the last two weeks');
    expect(section(e.text, 'This week')).not.toContain('Done each day');
    expect(e.html).not.toContain('Done each day, last 7 days');
  });

  it('nothing due this week and nothing done in two weeks: no section', () => {
    expect(build({ tasks: [task('A-1')] }).text).not.toContain('== This week');
    // Something done, nothing due: the trend alone.
    const e = build({ tasks: [task('A-1')], week: { due: [], completions: [new Date('2026-11-02T06:00:00Z')] } });
    expect(week(e.text)).toContain('Nothing due this week');
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, week: false }, tasks: [task('A-1')], week: { due: [{ dueDate: day('2026-11-04'), done: false }], completions: [] } }).text).not.toContain('== This week');
  });
});

describe('By priority', () => {
  it('their open tasks by priority — urgent, high, normal, low — each with its count and a bar in the scheme’s colour', () => {
    const e = build({
      tasks: [task('A-1', { priority: 'URGENT' }), task('A-2', { priority: 'URGENT' }), task('A-3', { priority: 'HIGH' }), task('A-4'), task('A-5', { waitingSince: NOW, priority: 'LOW' })],
    });
    expect(section(e.text, 'By priority')).toContain('Urgent 2 · High 1 · Normal 1 · Low 1');
    expect(e.html).toContain(`bgcolor="${PRIORITY_TONES.URGENT.light.fill}"`);
    expect(e.html).toMatch(/class="em-f-prio-urgent" width="40%"/);
    // A priority with none: a count of 0 and an empty track.
    expect(build({ tasks: [task('A-1', { priority: 'HIGH' })] }).text).toContain('Urgent 0 · High 1 · Normal 0 · Low 0');
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, priority: false }, tasks: [task('A-1')] }).text).not.toContain('By priority');
  });
});

describe('Overdue and Due today', () => {
  it('overdue: most days late first, each saying how late, with a red edge; waiting-for-approval tasks are not overdue', () => {
    const e = build({
      tasks: [
        task('RIG-1', { dueDate: day('2026-11-03') }),
        task('RIG-2', { dueDate: day('2026-10-30'), priority: 'URGENT' }),
        task('RIG-3', { dueDate: day('2026-11-01'), waitingSince: NOW }),
      ],
    });
    const late = section(e.text, 'Overdue');
    expect(late.indexOf('RIG-2')).toBeLessThan(late.indexOf('RIG-1'));
    expect(late).toContain('5 days late');
    expect(late).toContain('1 day late');
    expect(late).not.toContain('RIG-3');
    expect(e.html).toContain(`border-left:4px solid ${OVERDUE_TONES.light.fill}`);
  });

  it('due today: by time (a time first, in their zone), saying "today" or "today 14:00"', () => {
    const e = build({ tasks: [task('RIG-1', { dueDate: day('2026-11-04') }), task('RIG-2', { dueDate: new Date('2026-11-04T10:00:00Z') })] });
    const today = section(e.text, 'Due today');
    expect(today.indexOf('RIG-2')).toBeLessThan(today.indexOf('RIG-1'));
    expect(today).toContain('today 14:00');
    expect(today).toMatch(/RIG-1 Task RIG-1 — today\n/);
  });

  it('turned off: neither list (the tiles still count them)', () => {
    const e = build({ parts: { ...DEFAULT_DAILY_EMAILS, urgent: false }, tasks: [task('RIG-1', { dueDate: day('2026-11-01') }), task('RIG-2', { dueDate: day('2026-11-04') })] });
    expect(e.text).not.toContain('== Overdue');
    expect(e.text).not.toContain('== Due today');
    expect(e.text).toContain('1 overdue');
  });
});

describe('Coming up', () => {
  it('tasks due in the next 7 days, by day ("tomorrow", "in 3 days"), and tasks waiting for a later start day', () => {
    const e = build({
      tasks: [
        task('A-1', { dueDate: day('2026-11-07') }),
        task('A-2', { dueDate: day('2026-11-05') }),
        task('A-3', { dueDate: day('2026-11-11') }), // 7 days: still coming up
        task('A-4', { dueDate: day('2026-11-12') }), // 8 days: other open tasks
        task('A-5', { boardDate: board('2026-11-06'), startDate: day('2026-11-06') }), // starts in 2 days
        task('A-6', { boardDate: board('2026-11-20') }), // starts later than a week: other open tasks
      ],
    });
    const up = section(e.text, 'Coming up');
    expect(up).toMatch(/A-2 Task A-2 — tomorrow/);
    expect(up).toMatch(/A-1 Task A-1 — in 3 days/);
    expect(up).toMatch(/A-5 Task A-5 — starts in 2 days/);
    expect(up.indexOf('A-2')).toBeLessThan(up.indexOf('A-5'));
    expect(up.indexOf('A-5')).toBeLessThan(up.indexOf('A-1'));
    expect(up).toContain('A-3');
    expect(up).not.toContain('A-4');
    expect(up).not.toContain('A-6');
    const other = section(e.text, 'Other open tasks');
    expect(other).toContain('A-4');
    expect(other).toMatch(/A-6 Task A-6 — starts 20 Nov/);
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, comingUp: false }, tasks: [task('A-1', { dueDate: day('2026-11-05') })] }).text).not.toContain('== Coming up');
  });
});

describe('Other open tasks (nothing disappears)', () => {
  it('no due date, due later than a week, urgent but not due soon, and waiting for approval — grouped by project', () => {
    const e = build({
      tasks: [
        task('RIG-1'),
        task('RIG-2', { dueDate: day('2026-12-01'), priority: 'URGENT' }),
        task('OPS-1', { project: OPS, waitingSince: new Date('2026-11-03T08:00:00Z'), dueDate: day('2026-11-01') }),
      ],
    });
    const other = section(e.text, 'Other open tasks');
    expect(other).toContain('RIG INSPECTION');
    expect(other).toContain('OPERATIONS');
    expect(other).toMatch(/RIG-2 Task RIG-2 — 1 Dec/);
    expect(other).toContain('Waiting for approval');
    // Urgent first in its project.
    expect(other.indexOf('RIG-2')).toBeLessThan(other.indexOf('RIG-1'));
  });

  it('a project cut short says how many more, with a link to the project', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(`RIG-${i + 1}`));
    const { text } = build({ tasks });
    expect(text).toContain(`and 3 more in this project: ${APP}/projects/p-rig`);
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, pending: false }, tasks: [task('A-1')] }).text).not.toContain('== Other open tasks');
  });
});

describe('a task’s row', () => {
  const t = task('RIG-7', {
    title: 'Replace the pump seal',
    dueDate: day('2026-11-01'),
    priority: 'URGENT',
    statusLabel: 'In Progress',
    statusKind: 'IN_PROGRESS',
    checklist: { done: 4, total: 7 },
    blocked: true,
    categories: [{ name: 'Electrical', color: '#7C3AED' }],
    guests: [{ name: 'Ahmed', company: 'Acme' }],
  });

  it('number, title (a link), project, status and priority badges in the scheme’s colours, how late, the checklist with a bar, categories and guests', () => {
    const { html, text } = build({ tasks: [t] });
    expect(html).toContain('>RIG-7<');
    expect(html).toContain(`href="${APP}/my-tasks?task=rig-7"`);
    expect(html).toContain('>Replace the pump seal</a>');
    const progress = STATUS_TONES.IN_PROGRESS.light;
    expect(html).toContain(`class="em-t-status-progress" style="display:inline-block;margin:4px 4px 0 0;padding:0 8px;border-radius:9px;background:${progress.soft};color:${progress.text}`);
    expect(html).toContain('>In Progress</span>');
    expect(html).toContain(`background:${PRIORITY_TONES.URGENT.light.soft};color:${PRIORITY_TONES.URGENT.light.text}`);
    expect(html).toContain('>Urgent</span>');
    expect(html).toContain('>Blocked</span>');
    expect(html).toContain('>4/7 · 57%<');
    expect(html).toMatch(/class="em-f-status-done" width="57%"/);
    expect(html).toContain('<span style="color:#7C3AED">●</span>&nbsp;Electrical</span>');
    expect(html).toContain('>Guest: Ahmed (Acme)</span>');
    expect(text).toContain('- RIG-7 Replace the pump seal — 3 days late\n  Rig Inspection (Acme Drilling) · Due Sun 1 Nov · In Progress · Urgent · Blocked · Electrical · Guest: Ahmed (Acme) · Checklist 4/7 (57%)');
  });

  it('a normal priority, an empty checklist and no categories or guests are left out', () => {
    const { text, html } = build({ tasks: [task('RIG-8', { dueDate: day('2026-11-01'), checklist: { done: 0, total: 0 } })] });
    expect(text).toContain('- RIG-8 Task RIG-8 — 3 days late\n  Rig Inspection (Acme Drilling) · Due Sun 1 Nov · To Do\n');
    expect(html).not.toContain('>Normal</span>');
    expect(html).not.toContain('Checklist');
  });

  it('text from tasks can’t break the email', () => {
    const { html } = build({ tasks: [task('RIG-9', { title: '<script>alert(1)</script>', statusLabel: '"><b>x', categories: [{ name: '<i>c</i>', color: 'red;background:url(x)' }] })] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('"><b>x');
    expect(html).not.toContain('url(x)');
  });
});

describe('Today’s meetings (kept)', () => {
  it('meetings they organize or are invited to, by time, in their zone', () => {
    const e = build({
      meetings: [
        meeting('late', { title: 'Wrap-up', startAt: new Date('2026-11-04T12:00:00Z'), endAt: null }),
        meeting('early', { title: 'Site walk', organizer: true, response: null, location: 'Gate 2', projectName: 'Rig Inspection', online: true }),
        meeting('maybe', { title: 'Supplier call', startAt: new Date('2026-11-04T07:30:00Z'), endAt: new Date('2026-11-04T08:00:00Z'), response: 'TENTATIVE' }),
      ],
    });
    const m = section(e.text, 'Today’s meetings');
    expect(m.indexOf('Site walk')).toBeLessThan(m.indexOf('Supplier call'));
    expect(m.indexOf('Supplier call')).toBeLessThan(m.indexOf('Wrap-up'));
    expect(m).toContain('09:00–10:00  Site walk');
    expect(m).toContain('Rig Inspection · Gate 2 · Online · You organize');
    expect(m).toContain('Maybe');
    expect(e.html).toContain(`href="${APP}/meetings/early"`);
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, schedule: false }, meetings: [meeting('m')], tasks: [task('A-1')] }).text).not.toContain('meetings');
  });
});

describe('Completed yesterday (kept)', () => {
  const done = [
    task('RIG-5', { completedAt: new Date('2026-11-03T10:00:00Z'), dueDate: day('2026-11-05') }),
    task('RIG-6', { completedAt: new Date('2026-11-03T12:00:00Z'), dueDate: day('2026-11-01') }),
  ];
  it('since the last email, newest first, each with when and whether it was on time', () => {
    const c = section(build({ completed: done }).text, 'Completed yesterday');
    expect(c.indexOf('RIG-6')).toBeLessThan(c.indexOf('RIG-5'));
    expect(c).toContain('Done Tue 3 Nov, 16:00');
    expect(c).toContain('2 days late');
    expect(c).toContain('On time');
  });

  it('after a gap (the last email was days ago) the heading says since when', () => {
    const e = build({ completed: done, completedSince: new Date('2026-11-01T02:00:00Z') });
    expect(e.text).toContain('== Completed since Sun 1 Nov (2) ==');
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, completed: false }, completed: done, tasks: [task('A-1')] }).text).not.toContain('Completed');
  });
});

describe('Your projects (people who run a project)', () => {
  it('each project: its completion bar, done of total, overdue and waiting-for-approval counts — the ones needing attention first', () => {
    const e = build({
      tasks: [task('A-1')],
      projects: [figures(OPS, { pct: 80, done: 8, total: 10, open: 2, overdue: 0, waiting: 0 }), figures(RIG, { pct: 62, done: 24, total: 39, open: 15, overdue: 3, waiting: 2 })],
    });
    const p = section(e.text, 'Your projects');
    expect(p.indexOf('Rig Inspection')).toBeLessThan(p.indexOf('Operations'));
    expect(p).toContain('Rig Inspection — 62% complete (24 of 39 done) · 3 overdue · 2 to approve');
    expect(p).toContain('Operations — 80% complete (8 of 10 done) · nothing overdue');
    expect(e.html).toMatch(/class="em-f-status-done" width="62%"/);
    expect(e.html).toContain(`href="${APP}/my-tasks#to-approve"`);
    expect(e.html).toContain(`href="${APP}/projects/p-rig"`);
  });

  it('a project with no tasks yet is left out; none at all: no section', () => {
    expect(build({ tasks: [task('A-1')], projects: [figures(RIG, { total: 0, done: 0, open: 0, pct: 0 })] }).text).not.toContain('Your projects');
  });

  it('turned off: not shown', () => {
    expect(build({ parts: { ...DEFAULT_DAILY_EMAILS, projects: false }, tasks: [task('A-1')], projects: [figures(RIG)] }).text).not.toContain('Your projects');
  });

  it('others’ overdue and waiting tasks stay under it: overdue first, then waiting (longest first), with who it is assigned to and a link in its project', () => {
    const e = build({
      managed: [
        task('RIG-9', { waitingSince: new Date('2026-11-03T08:00:00Z'), assignees: ['Omar Ahmed'] }),
        task('RIG-8', { dueDate: day('2026-11-02'), assignees: ['Omar Ahmed', 'Lina Saeed'] }),
        task('RIG-7', { dueDate: day('2026-11-20'), assignees: ['Omar Ahmed'] }), // not overdue, not waiting
      ],
    });
    const m = section(e.text, 'Overdue and waiting in your projects');
    expect(m.indexOf('RIG-8')).toBeLessThan(m.indexOf('RIG-9'));
    expect(m).toContain('Assigned to Omar Ahmed, Lina Saeed');
    expect(m).not.toContain('RIG-7');
    expect(e.html).toContain(`href="${APP}/projects/p-rig?task=rig-8"`);
  });
});

describe('the approval line', () => {
  it('tasks waiting for the person’s approval: a line near the top with a link to the To approve list', () => {
    const e = build({ tasks: [task('A-1')], awaitingApproval: 3 });
    expect(e.text).toContain(`> 3 tasks are waiting for your approval. Review them: ${APP}/my-tasks#to-approve`);
    expect(e.text.indexOf('waiting for your approval')).toBeLessThan(e.text.indexOf('== Other open tasks'));
  });
});

describe('links: the dashboard and where to change the email', () => {
  it('a button to the dashboard, and links to the daily email settings, the time zone and the notification settings', () => {
    const { html, text } = build({ tasks: [task('A-1')] });
    expect(html).toContain(`href="${APP}/dashboard"`);
    expect(text).toContain(`Daily email settings: ${APP}/settings#daily-email`);
    expect(text).toContain(`Time zone: ${APP}/settings#time-zone`);
    expect(text).toContain(`Notification settings: ${APP}/settings#notifications`);
  });

  it('every link goes to the site', () => {
    const { html } = build({
      tasks: [task('A-1', { dueDate: day('2026-11-01') }), task('A-2', { project: OPS })],
      meetings: [meeting('m')],
      completed: [task('A-3', { completedAt: NOW })],
      managed: [task('A-4', { dueDate: day('2026-11-01'), assignees: ['X'] })],
      projects: [figures(RIG, { waiting: 1 })],
      awaitingApproval: 1,
    });
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => !h.startsWith('mailto:'));
    const site = hrefs.filter((h) => h.startsWith(`${APP}/`));
    expect(site.length).toBeGreaterThan(5);
    // The footer's own links (the product and the website) are the brand's.
    expect(hrefs.length - site.length).toBeLessThanOrEqual(2);
  });
});

describe('email-safe HTML (Outlook, Gmail, phones)', () => {
  const busy = () =>
    build({
      tasks: [
        task('A-1', { dueDate: day('2026-11-01'), checklist: { done: 1, total: 3 }, categories: [{ name: 'HSE', color: '#2F6DB5' }], guests: [{ name: 'G', company: null }] }),
        task('A-2', { dueDate: day('2026-11-04') }),
        task('A-3', { dueDate: day('2026-11-06'), project: OPS }),
        task('A-4', { project: OPS }),
      ],
      meetings: [meeting('m')],
      completed: [task('A-5', { completedAt: new Date('2026-11-03T10:00:00Z') })],
      managed: [task('A-6', { dueDate: day('2026-11-01'), assignees: ['X'] })],
      projects: [figures(RIG, { overdue: 1, waiting: 1 })],
      week: { due: [{ dueDate: day('2026-11-04'), done: true }], completions: [new Date('2026-11-02T06:00:00Z')] },
      awaitingApproval: 1,
    });

  it('passes the email-safety lint: tables only for layout, inline styles, no CSS Outlook drops (flex, grid, position, float, variables, calc, images for bars)', () => {
    expect(emailSafetyProblems(busy().html)).toEqual([]);
  });

  it('the lint catches what Outlook can’t show', () => {
    expect(emailSafetyProblems('<div style="display:flex">x</div>')).toEqual(expect.arrayContaining([expect.stringContaining('display:flex')]));
    expect(emailSafetyProblems('<table role="presentation"><tr><td style="width:var(--w)">x</td></tr></table>')).toEqual(expect.arrayContaining([expect.stringContaining('var(')]));
    expect(emailSafetyProblems('<span style="display:inline-block;width:40px;height:6px;background:#000"></span>')).toEqual(expect.arrayContaining([expect.stringContaining('bar')]));
    expect(emailSafetyProblems('<table><tr><td style="color:#000">x</td></tr></table>')).toEqual(expect.arrayContaining([expect.stringContaining('role="presentation"')]));
    expect(emailSafetyProblems('<p>no style</p>')).toEqual(expect.arrayContaining([expect.stringContaining('inline style')]));
  });

  it('phones: tiles two to a row, rows in one column, under 480 px; Outlook gets the fixed 720 px table', () => {
    const { html } = busy();
    expect(html).toContain('@media (max-width:480px){');
    expect(html).toMatch(/\.em-tile\{display:inline-block!important;width:50%!important/);
    expect(html).toMatch(/\.em-col\{display:block!important;width:auto!important/);
    expect(html).toContain('<!--[if mso]><table role="presentation" width="720"');
  });

  it('readable in dark mode: the email says it supports it, and every coloured badge and bar has its dark colours', () => {
    const { html } = busy();
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain(`.em-t-status-todo{background:${STATUS_TONES.TODO.dark.soft}!important;color:${STATUS_TONES.TODO.dark.text}!important}`);
    // Only the colours the email uses (nothing here is blocked).
    expect(html).not.toContain('.em-t-status-blocked{');
    expect(html).toContain(`.em-f-prio-normal{background:${PRIORITY_TONES.NORMAL.dark.fill}!important}`);
    expect(html).toContain('.em-track{background:#3A312E!important}');
  });

  it('a system font stack, 14–15 px body text, and a button at least 44 px tall', () => {
    const { html } = busy();
    expect(html).toContain("font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif");
    expect(html).toMatch(/class="email-btn"[^>]*padding:13px 28px;[^>]*line-height:20px/); // 13 + 20 + 13 = 46 px
  });

  it('the plain-text version has every section, every link and no markup', () => {
    const { text } = busy();
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    for (const h of ['Today at a glance', 'This week', 'By priority', 'Overdue (1)', 'Due today (1)', 'Coming up (1)', 'Other open tasks (1)', 'Today’s meetings (1)', 'Completed yesterday (1)', 'Your projects (1)', 'Overdue and waiting in your projects (1)']) {
      expect(text).toContain(`== ${h} ==`);
    }
    expect(text).toContain(`${APP}/my-tasks?task=a-1`);
  });
});

describe('long lists stay under Gmail’s limit (about 102 KB)', () => {
  const projects = Array.from({ length: 50 }, (_, i): DailyProject => ({ ...RIG, id: `p-${i}`, code: `P${i}`, name: `Project number ${i} with a fairly long name`, clientName: 'A client with a long name LLC' }));
  const many = (n: number, extra: (i: number) => Partial<DailyTask>) =>
    Array.from({ length: n }, (_, i) =>
      task(`P-${i}`, {
        title: `A long task title that goes on and on about the work to do, number ${i}`,
        project: projects[i % 50]!,
        statusKind: 'IN_PROGRESS',
        statusLabel: 'In Progress',
        priority: 'HIGH',
        checklist: { done: 2, total: 9 },
        categories: [{ name: 'Mechanical', color: '#2F6DB5' }],
        guests: [{ name: 'A guest with a long name', company: 'Some Company' }],
        ...extra(i),
      }),
    );
  const huge = () =>
    dailyEmail(
      input({
        tasks: [...many(150, (i) => ({ dueDate: day(i % 2 ? '2026-10-20' : '2026-11-04') })), ...many(150, () => ({ dueDate: day('2026-11-08') })), ...many(200, () => ({}))].map((t, i) => ({ ...t, id: `t-${i}`, key: `P-${i}` })),
        meetings: Array.from({ length: 60 }, (_, i) => meeting(`m-${i}`, { title: `A long meeting title number ${i}`, location: 'The big meeting room on the third floor', projectName: 'Project number 1' })),
        completed: many(100, () => ({ completedAt: new Date('2026-11-03T10:00:00Z'), dueDate: day('2026-11-02') })),
        managed: many(200, () => ({ dueDate: day('2026-10-01'), assignees: ['Someone With A Long Name', 'Another Person'] })),
        projects: projects.map((p) => figures(p, { overdue: 4, waiting: 2 })),
        week: {
          due: Array.from({ length: 300 }, () => ({ dueDate: day('2026-11-04'), done: false })),
          completions: Array.from({ length: 300 }, (_, i) => new Date(Date.parse('2026-10-22T06:00:00Z') + i * 3_600_000)),
        },
        awaitingApproval: 40,
      }),
    )!;

  it('500 tasks in 50 projects, with a full day: within 95 KB, saying how many more and where', () => {
    const e = huge();
    expect(bytes(e.html)).toBeLessThanOrEqual(95_000);
    expect(e.text).toMatch(/and \d+ more on the Dashboard/);
    expect(e.text).toMatch(/and \d+ more on the Projects page/);
    expect(emailSafetyProblems(e.html)).toEqual([]);
  });

  it('a short day keeps every task', () => {
    const e = build({ tasks: [task('A-1', { dueDate: day('2026-11-01') }), task('A-2'), task('A-3', { dueDate: day('2026-11-05') })] });
    expect(e.text).not.toContain('more on the Dashboard');
    for (const k of ['A-1', 'A-2', 'A-3']) expect(e.text).toContain(`${k} Task ${k}`);
  });
});

describe('grouped by company (companies)', () => {
  const ALPHA = { id: 'c-a', name: 'Alpha LLC' };
  const BETA = { id: 'c-b', name: 'Beta LLC' };
  const tasks = [task('RIG-1', { project: { ...RIG, company: BETA } }), task('OPS-1', { project: { ...OPS, company: ALPHA } }), task('OPS-2', { project: { ...OPS, company: ALPHA }, dueDate: day('2026-11-02') })];

  it('two companies: other open tasks under a heading per company in name order; flat lists name the company', () => {
    const { text, html } = build({ tasks, groupByCompany: true });
    const other = section(text, 'Other open tasks');
    expect(other.indexOf('Alpha LLC')).toBeLessThan(other.indexOf('OPERATIONS'));
    expect(other.indexOf('OPERATIONS')).toBeLessThan(other.indexOf('Beta LLC'));
    expect(other.indexOf('Beta LLC')).toBeLessThan(other.indexOf('RIG INSPECTION'));
    expect(html.split('>Alpha LLC<').length - 1).toBe(1);
    expect(section(text, 'Overdue')).toContain('Operations · Alpha LLC');
  });

  it('one company: no headings', () => {
    expect(build({ tasks }).html).not.toContain('Alpha LLC');
  });
});

describe('one company: the email pinned byte for byte (checked by eye when it changes)', () => {
  const fixture = input({
    tasks: [
      task('RIG-1', { title: 'Replace the pump seal', dueDate: day('2026-11-01'), priority: 'URGENT', statusLabel: 'In Progress', statusKind: 'IN_PROGRESS', startDate: day('2026-10-28'), checklist: { done: 3, total: 5 }, blocked: true }),
      task('RIG-2', { title: 'Send the weekly report', dueDate: new Date('2026-11-04T10:00:00Z'), priority: 'HIGH' }),
      task('OPS-1', { project: OPS, dueDate: day('2026-11-06'), statusKind: 'BACKLOG', statusLabel: 'Backlog' }),
      task('OPS-2', { project: OPS, priority: 'LOW' }),
      task('RIG-3', { waitingSince: new Date('2026-11-03T08:00:00Z'), statusKind: 'REVIEW', statusLabel: 'Review' }),
      task('RIG-4', { title: 'Order spare valves', boardDate: board('2026-11-05'), dueDate: day('2026-11-09') }),
    ],
    meetings: [meeting('m-1', { title: 'Site walk', projectName: 'Rig Inspection', location: 'Gate 2', organizer: true, response: null })],
    managed: [task('RIG-9', { title: 'Fix the gate', dueDate: day('2026-11-02'), assignees: ['Omar Ahmed'] })],
    completed: [task('OPS-5', { project: OPS, title: 'Order the steel', completedAt: new Date('2026-11-03T11:00:00Z'), dueDate: day('2026-11-05') })],
    awaitingApproval: 2,
    week: {
      due: [
        { dueDate: day('2026-11-02'), done: true },
        { dueDate: day('2026-11-03'), done: true },
        { dueDate: day('2026-11-04'), done: false },
        { dueDate: day('2026-11-06'), done: false },
      ],
      completions: ['2026-10-26', '2026-10-29', '2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-03'].map((d) => new Date(`${d}T07:00:00Z`)),
    },
    projects: [figures(RIG, { pct: 62, done: 24, total: 39, open: 15, overdue: 3, waiting: 2 }), figures(OPS, { pct: 80, done: 8, total: 10, open: 2 })],
  });
  const pinned = <T>(fn: () => T): T => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      return fn();
    } finally {
      vi.useRealTimers();
    }
  };

  it('the daily email', async () => {
    const e = pinned(() => dailyEmail(fixture))!;
    await expect(e.subject).toMatchFileSnapshot('__snapshots__/daily-email.subject.snap');
    await expect(e.html).toMatchFileSnapshot('__snapshots__/daily-email.html.snap');
    await expect(e.text).toMatchFileSnapshot('__snapshots__/daily-email.text.snap');
  });
});

describe('review fixes', () => {
  it('I1: an email goes only when a section that is on has something in it (never just a greeting and a button)', () => {
    // Only "Overdue and due today" on: a task with no due date is in Other open tasks, which is off.
    expect(dailyEmail(input({ parts: only('urgent'), tasks: [task('A-1')] }))).toBeNull();
    // Only Coming up on: nothing in the next 7 days.
    expect(dailyEmail(input({ parts: only('comingUp'), tasks: [task('A-1', { dueDate: day('2026-11-30') })] }))).toBeNull();
    // Overdue and due today on, a task 1 day late: an email.
    expect(dailyEmail(input({ parts: only('urgent'), tasks: [task('A-1', { dueDate: day('2026-11-03') })] }))).not.toBeNull();
    // Coming up on and a task due tomorrow: an email.
    expect(dailyEmail(input({ parts: only('comingUp'), tasks: [task('A-1', { dueDate: day('2026-11-05') })] }))).not.toBeNull();
  });

  it('I3: board days are the company\u2019s calendar days — a person far west of the company never sees today\u2019s tasks as "starts tomorrow"', () => {
    // 21:00 on Tue 3 Nov in New York = 06:00 on Wed 4 Nov in Muscat (the company): today\u2019s board is 4 Nov.
    const ny = { timeZone: 'America/New_York', companyTimeZone: TZ, now: new Date('2026-11-04T02:00:00Z') };
    const e = build({ ...ny, tasks: [task('A-1', { boardDate: board('2026-11-04'), dueDate: day('2026-10-30') }), task('A-2', { boardDate: board('2026-11-05') })] });
    expect(section(e.text, 'Overdue')).toContain('A-1');
    expect(section(e.text, 'Coming up')).toMatch(/A-2 Task A-2 — starts tomorrow/);
    expect(section(e.text, 'Today at a glance')).toContain('1 open');
  });

  it('M4: figures alone don\u2019t send it — an open task due this week with only This week on, or projects with nothing overdue or waiting', () => {
    expect(dailyEmail(input({ parts: only('week'), tasks: [task('A-1', { dueDate: day('2026-11-05') })], week: { due: [{ dueDate: day('2026-11-05'), done: false }], completions: [] } }))).toBeNull();
    expect(dailyEmail(input({ parts: only('projects'), projects: [figures(RIG, { open: 5, overdue: 0, waiting: 0 })] }))).toBeNull();
    expect(dailyEmail(input({ parts: only('projects'), projects: [figures(RIG, { open: 5, overdue: 1, waiting: 0 })] }))).not.toBeNull();
  });

  it('M5: others\u2019 tasks waiting for a later start day are not overdue in the managers\u2019 list', () => {
    const e = build({ managed: [task('RIG-8', { dueDate: day('2026-11-02'), assignees: ['Omar'] }), task('RIG-9', { dueDate: day('2026-11-02'), boardDate: board('2026-11-20'), assignees: ['Omar'] })] });
    const m = section(e.text, 'Overdue and waiting in your projects');
    expect(m).toContain('RIG-8');
    expect(m).not.toContain('RIG-9');
  });

  it('merge (dupmv lane’s case): only tasks starting on a later day — the email still goes, and its subject says they are coming up', () => {
    const e = build({ tasks: [task('RIG-30', { title: 'Pour the slab', boardDate: board('2026-11-10'), dueDate: day('2026-11-12') })] });
    expect(e.subject).toBe('Today: 1 task coming up — Wed 4 Nov');
    expect(section(e.text, 'Coming up')).toMatch(/RIG-30 Pour the slab — starts in 6 days/);
    // Its start day is today: today’s work again.
    expect(build({ tasks: [task('RIG-30', { boardDate: board('2026-11-04') })] }).subject).toBe('Today: 1 open task — Wed 4 Nov');
  });

  it('merge (guests lane’s case): a guest’s name and company only, as a "Guest: Ahmed (Acme)" chip; a guest without a company by name', () => {
    const { text, html } = build({ tasks: [task('RIG-1', { guests: [{ name: 'Ahmed', company: 'Acme' }, { name: 'Sara', company: null }], categories: [{ name: 'Civil', color: '#2E7D53' }, { name: 'HSE' }] })] });
    expect(text).toContain('Guest: Ahmed (Acme) · Guest: Sara');
    expect(text).toContain('Civil · HSE');
    expect(html).toContain('>Guest: Sara</span>');
    expect(html).toContain('<span style="color:#2E7D53">●</span>&nbsp;Civil</span>');
  });

  it('M6: the subject and the preview line say only what the parts that are on show', () => {
    const tasks = [task('A-1', { dueDate: day('2026-11-01') }), task('A-2', { dueDate: day('2026-11-04') })];
    // Overdue and due today off: the subject doesn't count them.
    const off = build({ parts: { ...DEFAULT_DAILY_EMAILS, urgent: false }, tasks });
    expect(off.subject).toBe('Today: 2 open tasks — Wed 4 Nov');
    // At a glance and This week off: no "done this week" in the preview line (it wasn't counted).
    const noWeek = build({ parts: { ...DEFAULT_DAILY_EMAILS, glance: false, week: false }, tasks });
    expect(noWeek.html).not.toContain('done this week');
  });
});

describe('Release B: the Notification & Scheduling centre on the new daily email', () => {
  it('notices held overnight come first as “While you were away” (10 shown, then how many more and where), and are enough for an email', () => {
    const held = Array.from({ length: 12 }, (_, i) => ({ title: `Escalation: RIG-${i + 1} is Blocked`, body: i === 0 ? 'RIG-1 · Pour slab\nsecond line' : null }));
    const email = dailyEmail(input({ tasks: [], completed: [], held }))!;
    expect(email).not.toBeNull();
    expect(email.text).toContain('== While you were away (12) ==');
    expect(email.text).toContain('- Escalation: RIG-1 is Blocked — RIG-1 · Pour slab');
    expect(email.text).not.toContain('second line');
    expect(email.text).toContain('- Escalation: RIG-10 is Blocked');
    expect(email.text).not.toContain('RIG-11 is Blocked');
    expect(email.text).toContain('and 2 more in your notifications');
    expect(email.html).toContain('/notifications');
    expect(emailSafetyProblems(email.html)).toEqual([]);
    const withTasks = dailyEmail(input({ tasks: [task('RIG-50', { dueDate: new Date('2026-11-01T00:00:00Z') })], held: held.slice(0, 1) }))!;
    expect(withTasks.text.indexOf('While you were away')).toBeLessThan(withTasks.text.indexOf('Today at a glance'));
  });

  it('seam review M-2: each held notice is cut to size (it sits outside the size ladder); an email of held notices alone says so in its subject', () => {
    const long = 'x'.repeat(5000);
    const email = dailyEmail(input({ tasks: [], completed: [], held: [{ title: `Escalation ${long}`, body: `RIG-1 · ${long}` }] }))!;
    expect(email.html.length).toBeLessThan(60_000);
    expect(email.text).not.toContain('x'.repeat(400));
    expect(email.subject).toMatch(/^Today: 1 notice while you were away — /);
  });

  it('a late task says working days late with the centre (its own company’s calendar), and plain days without it', () => {
    const late = task('RIG-51', { dueDate: new Date('2026-10-29T00:00:00Z') });
    const calls: string[] = [];
    const withCentre = dailyEmail(input({ tasks: [late], lateDays: (t, due, to) => (calls.push(`${t.key} ${due} ${to}`), 4) }))!;
    expect(withCentre.text).toContain('4 working days late');
    expect(calls).toContain('RIG-51 2026-10-29 2026-11-04');
    expect(dailyEmail(input({ tasks: [late] }))!.text).toContain('6 days late');
    // Due on a day off and nothing working since: overdue, without a count.
    expect(dailyEmail(input({ tasks: [late], lateDays: () => 0 }))!.text).toMatch(/overdue/);
  });
});
