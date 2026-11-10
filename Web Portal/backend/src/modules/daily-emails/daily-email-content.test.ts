import { describe, it, expect, vi } from 'vitest';
import { dailyEmail, taskLink, type DailyEmailInput, type DailyMeeting, type DailyProject, type DailyTask } from './daily-email-content';
import { DEFAULT_DAILY_EMAILS } from '../notifications/notification-preferences';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-04T02:00:00Z'); // 06:00 on Wed 4 Nov 2026 in Muscat
const APP = 'https://task.example';
const ASSETS = 'https://api.example';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`); // due dates are stored as pure days

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

const input = (extra: Partial<DailyEmailInput> = {}): DailyEmailInput => ({
  name: 'Ada',
  timeZone: TZ,
  now: NOW,
  appUrl: APP,
  assetUrl: ASSETS,
  time: '06:00',
  parts: { ...DEFAULT_DAILY_EMAILS },
  tasks: [],
  meetings: [],
  completed: [],
  completedSince: new Date('2026-11-03T02:00:00Z'),
  awaitingApproval: 0,
  managed: [],
  ...extra,
});
const build = (extra: Partial<DailyEmailInput> = {}) => {
  const e = dailyEmail(input(extra));
  if (!e) throw new Error('expected an email');
  return e;
};
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('taskLink', () => {
  it('opens the task on My Tasks', () => {
    expect(taskLink('https://task.example/', 'abc 1')).toBe('https://task.example/my-tasks?task=abc%201');
  });
});

describe('the daily email: one email, its parts in order', () => {
  const everything = () =>
    build({
      tasks: [
        task('RIG-1', { dueDate: day('2026-11-01'), priority: 'HIGH' }), // 3 days overdue
        task('RIG-2', { dueDate: day('2026-11-04') }), // due today
        task('OPS-3', { project: OPS, dueDate: day('2026-11-06') }), // upcoming
        task('OPS-4', { project: OPS }), // no due date
      ],
      meetings: [meeting('m1')],
      managed: [task('RIG-9', { dueDate: day('2026-11-02'), assignees: ['Omar Ahmed'] })],
      completed: [task('RIG-5', { completedAt: new Date('2026-11-03T10:00:00Z'), dueDate: day('2026-11-05') })],
    });

  it('summary numbers → Today’s schedule → Overdue & urgent → your tasks by project → In your projects → Recently completed', () => {
    const { text } = everything();
    const order = ['4 pending · 1 overdue · 1 due today · 1 upcoming · 1 completed recently', '== Today’s schedule ==', '== Overdue & urgent (1) ==', '== Your other tasks ==', '== In your projects ==', '== Recently completed =='];
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

  it('names the time zone once', () => {
    const { text, html } = everything();
    expect(text.split('Asia/Muscat').length - 1).toBe(1);
    expect(html).toContain('Times are in your time zone, Asia/Muscat.');
  });

  it('nothing in any part that is on: no email', () => {
    expect(dailyEmail(input())).toBeNull();
    // Only the schedule on, and nothing on it — though there are tasks.
    expect(dailyEmail(input({ parts: { ...DEFAULT_DAILY_EMAILS, urgent: false, pending: false, managed: false, completed: false }, tasks: [task('RIG-1')] }))).toBeNull();
  });
});

describe('summary numbers', () => {
  it('pending (not waiting for approval), overdue, due today, upcoming and completed recently', () => {
    const e = build({
      tasks: [
        task('RIG-1', { dueDate: day('2026-11-02') }),
        task('RIG-2', { dueDate: day('2026-11-03') }),
        task('RIG-3', { dueDate: day('2026-11-04') }),
        task('RIG-4', { dueDate: day('2026-11-20') }),
        task('RIG-5'),
        task('RIG-6', { dueDate: day('2026-11-01'), waitingSince: new Date('2026-11-02T08:00:00Z') }), // handed in: never overdue
      ],
      completed: [task('RIG-7', { completedAt: NOW }), task('RIG-8', { completedAt: NOW })],
    });
    expect(e.text).toContain('5 pending · 2 overdue · 1 due today · 1 upcoming · 2 completed recently');
    expect(e.text).toContain('1 of your tasks is waiting for approval.');
    for (const [label, n] of [['Pending', 5], ['Overdue', 2], ['Due today', 1], ['Upcoming', 1], ['Completed', 2]] as const) {
      expect(e.html).toMatch(new RegExp(`>${n}</div><div[^>]*>${label}<`));
    }
  });

  it('no "Completed" number when that part is off', () => {
    const e = build({ parts: { ...DEFAULT_DAILY_EMAILS, completed: false }, tasks: [task('RIG-1')], completed: [task('RIG-7', { completedAt: NOW })] });
    expect(e.text).toContain('1 pending · 0 overdue · 0 due today · 0 upcoming');
    expect(e.text).not.toContain('completed recently');
    expect(e.text).not.toContain('Recently completed');
  });

  it('tasks waiting for the person’s approval: a line near the top with a link to the To approve list', () => {
    const e = build({ tasks: [task('RIG-3')], awaitingApproval: 3 });
    expect(e.text).toContain('3 tasks are waiting for your approval. Review them: https://task.example/my-tasks#to-approve');
    expect(e.text.indexOf('waiting for your approval')).toBeLessThan(e.text.indexOf('RIG-3'));
    expect(build({ tasks: [task('RIG-3')], awaitingApproval: 1 }).text).toContain('1 task is waiting for your approval.');
    expect(build({ tasks: [task('RIG-3')] }).text).not.toContain('your approval');
  });
});

describe('Today’s schedule', () => {
  it('meetings the person organizes or is invited to, and tasks due at a time today, by time, in their zone', () => {
    const e = build({
      meetings: [
        meeting('late', { title: 'Close-out', startAt: new Date('2026-11-04T12:30:00Z'), endAt: null, organizer: true }), // 16:30
        meeting('early', { title: 'Site walk', projectName: 'Rig Inspection', location: 'Room 2', online: true, response: 'TENTATIVE' }), // 09:00–10:00
        meeting('ask', { title: 'Budget', startAt: new Date('2026-11-04T07:05:00Z'), endAt: new Date('2026-11-04T07:35:00Z'), response: 'PENDING', status: 'IN_PROGRESS' }), // 11:05
      ],
      tasks: [task('RIG-4', { title: 'Send the report', dueDate: new Date('2026-11-04T10:00:00Z') })], // due at 14:00 today
    });
    const at = (s: string) => e.text.indexOf(s);
    expect(at('09:00–10:00  Site walk (meeting)')).toBeGreaterThan(-1);
    expect(at('09:00–10:00  Site walk')).toBeLessThan(at('11:05–11:35  Budget'));
    expect(at('11:05–11:35  Budget')).toBeLessThan(at('14:00  Send the report (RIG-4, due)'));
    expect(at('14:00  Send the report')).toBeLessThan(at('16:30  Close-out'));
    expect(e.text).toContain('Rig Inspection · Room 2 · Online · Maybe');
    expect(e.text).toContain('Under way · Not answered yet');
    expect(e.text).toContain('You organize');
    expect(e.html).toContain('https://task.example/meetings/early');
    expect(e.html).toContain('https://task.example/my-tasks?task=rig-4');
  });

  it('a task due on a day (no time) isn’t on the schedule; nothing scheduled: no section', () => {
    const e = build({ tasks: [task('RIG-1', { dueDate: day('2026-11-04') })] });
    expect(e.text).not.toContain('Today’s schedule');
  });

  it('turned off: not shown', () => {
    const e = build({ parts: { ...DEFAULT_DAILY_EMAILS, schedule: false }, meetings: [meeting('m1')], tasks: [task('RIG-1')] });
    expect(e.text).not.toContain('Today’s schedule');
    expect(e.html).not.toContain('/meetings/m1');
  });
});

describe('Overdue & urgent', () => {
  const tasks = [
    task('RIG-1', { dueDate: day('2026-11-03') }), // 1 day overdue
    task('OPS-2', { project: OPS, dueDate: day('2026-10-30'), priority: 'LOW' }), // 5 days overdue
    task('RIG-3', { priority: 'URGENT', dueDate: day('2026-11-10') }), // urgent, not overdue
    task('RIG-4', { dueDate: day('2026-11-04'), priority: 'HIGH' }), // due today: in its project
  ];

  it('days overdue, highest first, then urgent ones; each with its project (client)', () => {
    const { text } = build({ tasks });
    const section = text.slice(text.indexOf('== Overdue & urgent (3) =='), text.indexOf('== Your other tasks =='));
    expect(section.indexOf('OPS-2')).toBeLessThan(section.indexOf('RIG-1'));
    expect(section.indexOf('RIG-1')).toBeLessThan(section.indexOf('RIG-3'));
    expect(section).toContain('- Task OPS-2 (OPS-2) — 5 days overdue · Low priority · To Do');
    expect(section).toContain('- Task RIG-1 (RIG-1) — 1 day overdue · To Do');
    expect(section).toContain('Rig Inspection (Acme Drilling)');
    expect(section).toContain('- Task RIG-3 (RIG-3) — Due Tue 10 Nov 2026 · Urgent · To Do');
    expect(section).not.toContain('RIG-4');
  });

  it('they aren’t listed again under their project', () => {
    const { text } = build({ tasks });
    const rest = text.slice(text.indexOf('== Your other tasks =='));
    expect(rest).toContain('RIG-4');
    expect(rest).not.toContain('RIG-1');
    expect(rest).not.toContain('OPS-2');
  });

  it('turned off: overdue tasks come first in their project instead', () => {
    const { text } = build({ tasks, parts: { ...DEFAULT_DAILY_EMAILS, urgent: false } });
    expect(text).not.toContain('Overdue & urgent');
    expect(text).toContain('== Your tasks ==');
    expect(text.indexOf('Task RIG-1')).toBeLessThan(text.indexOf('Task RIG-4'));
  });
});

describe('your tasks, grouped by project, sorted by urgency', () => {
  it('in each project: due today, high priority, due soon, then the rest, then those waiting for approval', () => {
    const { text } = build({
      parts: { ...DEFAULT_DAILY_EMAILS, urgent: false },
      tasks: [
        task('RIG-1'),
        task('RIG-2', { dueDate: day('2026-11-08') }), // due soon
        task('RIG-3', { priority: 'HIGH', dueDate: day('2026-12-01') }),
        task('RIG-4', { dueDate: day('2026-11-04') }), // due today
        task('RIG-5', { dueDate: day('2026-11-02') }), // overdue
        task('RIG-6', { waitingSince: NOW }),
        task('RIG-7', { dueDate: day('2026-12-20') }),
      ],
    });
    const keys = ['RIG-5', 'RIG-4', 'RIG-3', 'RIG-2', 'RIG-7', 'RIG-1', 'RIG-6'].map((k) => text.indexOf(`(${k})`));
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    expect(text).toContain('- Task RIG-6 (RIG-6) — To Do · Waiting for approval');
  });

  it('projects in the order of their most urgent task, each with its details (only those it has) and a link', () => {
    const { text, html } = build({ tasks: [task('OPS-1', { project: OPS }), task('RIG-1', { dueDate: day('2026-11-04') })] });
    expect(text.indexOf('RIG INSPECTION')).toBeLessThan(text.indexOf('OPERATIONS'));
    expect(text).toContain('RIG INSPECTION — RIG · No. 2026-014 · Client: Acme Drilling · Manager: Sara Ali · Target Mon 30 Nov 2026');
    expect(text).toContain('OPERATIONS — OPS\nOn hold · 1 task');
    expect(html).toContain('https://task.example/projects/p-rig');
    // A stored picture is loaded from the server's address; a project without one shows its initials.
    expect(html).toContain('src="https://api.example/uploads/projects/ops.png"');
    expect(html).toContain('>RI</td>');
  });

  it('turned off: no project sections', () => {
    const e = build({ parts: { ...DEFAULT_DAILY_EMAILS, pending: false }, tasks: [task('RIG-1', { dueDate: day('2026-11-02') }), task('RIG-2')] });
    expect(e.text).toContain('Overdue & urgent (1)');
    expect(e.text).not.toContain('Your other tasks');
    expect(e.text).not.toContain('Task RIG-2');
  });
});

describe('a task’s card', () => {
  const full = task('RIG-1', {
    title: 'Replace the pump seal',
    dueDate: new Date('2026-11-06T10:30:00Z'), // a due time: 14:30 Muscat
    startDate: day('2026-11-02'),
    priority: 'HIGH',
    statusLabel: 'In Progress',
    description: `The seal on pump 3 leaks under load.   ${'It must be replaced before the client visit, and the old one sent back to the supplier for a refund. '.repeat(3)}`,
    checklist: { done: 3, total: 5 },
    latest: { text: 'Sara Ali: “The new seal arrives on Friday”', at: new Date('2026-11-03T09:00:00Z') },
    blocked: true,
  });

  it('title, ID, status, priority, start, due date and time, checklist, a short description, the latest update, blocked', () => {
    const { text, html } = build({ tasks: [full] });
    expect(text).toContain('- Replace the pump seal (RIG-1) — Due Fri 6 Nov 2026, 14:30 · High priority · In Progress · Blocked');
    expect(text).toContain('Start Mon 2 Nov 2026 · Checklist 3 of 5');
    expect(text).toContain('Latest: Sara Ali: “The new seal arrives on Friday” · Tue 3 Nov 2026');
    const desc = /The seal on pump 3 leaks under load\. It must[^\n]*/.exec(text)![0];
    expect(desc.length).toBeLessThanOrEqual(161);
    expect(desc.endsWith('…')).toBe(true);
    expect(html).toContain('https://task.example/my-tasks?task=rig-1');
  });

  it('empty fields are hidden: no due date, no start, no checklist, no description, no update; normal priority unsaid', () => {
    const { text } = build({ tasks: [task('RIG-2')] });
    expect(text).toContain('- Task RIG-2 (RIG-2) — To Do\n');
    expect(text).not.toContain('No due date');
    expect(text).not.toContain('Normal priority');
    expect(text).not.toContain('Start ');
    expect(text).not.toContain('Checklist');
    expect(text).not.toContain('Latest:');
  });

  it('the assignee is not shown on the person’s own tasks', () => {
    expect(build({ tasks: [task('RIG-2', { assignees: ['Ada Lovelace'] })] }).text).not.toContain('Assigned to');
  });

  it('text from tasks can’t break the email', () => {
    const { html } = build({ tasks: [task('RIG-3', { title: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' })] });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('In your projects (people who run a project)', () => {
  const managed = [
    task('RIG-8', { title: 'Order steel', waitingSince: new Date('2026-11-03T08:00:00Z'), assignees: ['Bilal Khan'] }),
    task('RIG-9', { title: 'Fix the gate', dueDate: day('2026-11-01'), assignees: ['Omar Ahmed', 'Zara Noor'] }),
    task('RIG-10', { title: 'Not late', dueDate: day('2026-11-20'), assignees: ['Omar Ahmed'] }), // neither: left out
  ];

  it('overdue first, then waiting for approval — with who it is assigned to and a link in its project', () => {
    const { text, html } = build({ managed, tasks: [task('RIG-1')] });
    const section = text.slice(text.indexOf('== In your projects =='));
    expect(section).toContain('Overdue and waiting-for-approval tasks of the projects you run.');
    expect(section.indexOf('RIG-9')).toBeLessThan(section.indexOf('RIG-8'));
    expect(section).toContain('- Fix the gate (RIG-9) — 3 days overdue · To Do');
    expect(section).toContain('Rig Inspection (Acme Drilling) · Assigned to Omar Ahmed, Zara Noor');
    expect(section).toContain('- Order steel (RIG-8) — To Do · Waiting for approval');
    expect(section).not.toContain('RIG-10');
    expect(html).toContain('https://task.example/projects/p-rig?task=rig-9');
  });

  it('1.22 review: those waiting for approval, the longest-waiting first (whatever their due dates)', () => {
    const { text } = build({
      tasks: [task('RIG-1')],
      managed: [
        task('RIG-21', { waitingSince: new Date('2026-11-03T08:00:00Z'), dueDate: day('2026-11-06') }),
        task('RIG-22', { waitingSince: new Date('2026-10-25T08:00:00Z') }),
      ],
    });
    expect(text.indexOf('(RIG-22)')).toBeLessThan(text.indexOf('(RIG-21)'));
  });

  it('nothing overdue or waiting, or turned off: no section', () => {
    expect(build({ managed: [managed[2]!], tasks: [task('RIG-1')] }).text).not.toContain('In your projects');
    expect(build({ managed, tasks: [task('RIG-1')], parts: { ...DEFAULT_DAILY_EMAILS, managed: false } }).text).not.toContain('In your projects');
  });
});

describe('Recently completed', () => {
  const completed = [
    task('RIG-1', { completedAt: new Date('2026-11-03T05:10:00Z'), dueDate: day('2026-11-05') }),
    task('OPS-2', { project: OPS, completedAt: new Date('2026-11-03T14:00:00Z'), dueDate: day('2026-11-01') }),
  ];

  it('since the last email, newest first, each with when and whether it was on time', () => {
    const { text } = build({ completed });
    const section = text.slice(text.indexOf('== Recently completed =='));
    expect(section).toContain('Since Tue 3 Nov 2026, 06:00.');
    expect(section.indexOf('OPS-2')).toBeLessThan(section.indexOf('RIG-1'));
    expect(section).toContain('- Task OPS-2 (OPS-2) — Completed Tue 3 Nov 2026, 18:00 · 2 days late');
    expect(section).toContain('- Task RIG-1 (RIG-1) — Completed Tue 3 Nov 2026, 09:10 · On time');
  });

  it('turned off: not shown', () => {
    expect(build({ completed, tasks: [task('RIG-5')], parts: { ...DEFAULT_DAILY_EMAILS, completed: false } }).text).not.toContain('Recently completed');
  });
});

describe('links: the dashboard and where to change the email', () => {
  it('a button to the dashboard, and links to the delivery time, the time zone and the notification settings', () => {
    const { text, html } = build({ tasks: [task('RIG-1')], time: '07:30' });
    expect(text).toContain('Open the dashboard: https://task.example/dashboard');
    expect(text).toContain('You get this email at 07:30 every morning.');
    expect(html).toContain('href="https://task.example/settings#daily-email"');
    expect(html).toContain('href="https://task.example/settings#time-zone"');
    expect(html).toContain('href="https://task.example/settings#notifications"');
  });

  it('every link goes to the site', () => {
    const { html } = build({ tasks: [task('RIG-1')], meetings: [meeting('m1')], completed: [task('RIG-2', { completedAt: NOW })], managed: [task('RIG-3', { dueDate: day('2026-11-01') })] });
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => !h.startsWith('mailto:'));
    const site = hrefs.filter((h) => h.startsWith('https://task.example/'));
    // The footer's own links (the product and the website) are the brand's.
    expect(hrefs.length - site.length).toBeLessThanOrEqual(2);
  });
});

describe('email-safe HTML (Outlook and Gmail)', () => {
  const big = () =>
    build({
      tasks: Array.from({ length: 30 }, (_, i) => task(`RIG-${i + 1}`, { dueDate: day(i % 3 ? '2026-11-02' : '2026-11-09'), description: 'x'.repeat(200) })),
      meetings: [meeting('m1')],
      managed: [task('RIG-90', { dueDate: day('2026-11-01') })],
      completed: [task('RIG-91', { completedAt: NOW })],
    });

  it('tables for layout, inline styles: no flex, grid or position', () => {
    const { html } = big();
    expect(html).not.toMatch(/display:\s*(flex|grid|inline-flex)/i);
    expect(html).not.toMatch(/position:\s*(absolute|relative|fixed)/i);
    expect(html).toMatch(/<table role="presentation"/);
  });

  it('every picture has alt text', () => {
    const { html } = build({ tasks: [task('OPS-1', { project: OPS })] });
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img).toMatch(/alt="[^"]+"/);
  });

  it('the button works in Outlook too (a VML button for Word-based Outlook)', () => {
    const { html } = big();
    expect(html).toContain('<!--[if mso]><v:roundrect');
    expect(html).toContain('href="https://task.example/dashboard"');
  });

  it('readable in dark mode: the email says it supports it and has dark styles for its own parts', () => {
    const { html } = big();
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toMatch(/@media \(prefers-color-scheme:dark\)\{[^}]*\.email-stat-danger\{color:#EE8C79!important\}/); // 1.23.8: the scheme's overdue words in dark
  });
});

describe('long lists stay under Gmail’s limit (about 102 KB)', () => {
  const many = (n: number, projects: number) =>
    Array.from({ length: n }, (_, i) => {
      const p = i % projects;
      return task(`P${p}-${i}`, {
        title: `A rather long task title number ${i} that goes on and on to fill the line`,
        project: { ...RIG, id: `p${p}`, code: `P${p}`, name: `Project number ${p} with a long name` },
        dueDate: day(i % 4 === 0 ? '2026-11-01' : i % 4 === 1 ? '2026-11-04' : '2026-11-12'),
        description: 'Something to do '.repeat(30),
        latest: { text: `Someone: “${'a long comment '.repeat(20)}”`, at: NOW },
        checklist: { done: 1, total: 4 },
        priority: i % 5 === 0 ? 'URGENT' : 'NORMAL',
      });
    });

  it('500 tasks in 50 projects, with a full day: well under the limit, saying how many more and where', () => {
    const e = build({
      tasks: many(500, 50),
      meetings: Array.from({ length: 30 }, (_, i) => meeting(`m${i}`, { title: `Meeting ${i} with a long title`, location: 'Main office, room 4', projectName: 'Project number 1' })),
      managed: many(120, 12).map((t) => ({ ...t, id: `x${t.id}`, assignees: ['Omar Ahmed', 'Sara Ali'] })),
      completed: many(80, 8).map((t) => ({ ...t, id: `c${t.id}`, completedAt: NOW })),
    });
    expect(bytes(e.html)).toBeLessThan(95_000);
    expect(e.text).toMatch(/and \d+ more · open the dashboard: https:\/\/task\.example\/dashboard/);
    expect(e.html).toMatch(/and \d+ more · open the dashboard/);
  });

  it('a short day keeps every task', () => {
    const e = build({ tasks: many(12, 3) });
    for (let i = 0; i < 12; i++) expect(e.text).toContain(`(P${i % 3}-${i})`);
    expect(e.text).not.toContain('more · open the dashboard');
  });

  it('a project cut short says how many more, with a link to the project', () => {
    const e = build({ parts: { ...DEFAULT_DAILY_EMAILS, urgent: false }, tasks: Array.from({ length: 12 }, (_, i) => task(`RIG-${i + 1}`)) });
    expect(e.text).toContain('and 4 more in this project: https://task.example/projects/p-rig');
  });
});

describe('grouped by company (companies)', () => {
  const ALPHA = { id: 'c-a', name: 'Alpha LLC' };
  const BETA = { id: 'c-b', name: 'Beta LLC' };
  const tasks = [
    task('RIG-1', { project: { ...RIG, company: BETA }, dueDate: day('2026-11-04') }),
    task('OPS-1', { project: { ...OPS, company: ALPHA } }),
    task('OPS-2', { project: { ...OPS, company: ALPHA }, dueDate: day('2026-11-02') }),
  ];

  it('two companies: a heading per company in name order, each with its own projects; flat lists name the company', () => {
    const { text, html } = build({ tasks, groupByCompany: true });
    const rest = text.slice(text.indexOf('== Your other tasks =='));
    expect(rest.indexOf('Alpha LLC')).toBeLessThan(rest.indexOf('OPERATIONS'));
    expect(rest.indexOf('OPERATIONS')).toBeLessThan(rest.indexOf('Beta LLC'));
    expect(rest.indexOf('Beta LLC')).toBeLessThan(rest.indexOf('RIG INSPECTION'));
    expect(html.split('>Alpha LLC<').length - 1).toBe(1);
    expect(text).toContain('Operations · Alpha LLC');
  });

  it('one company: no headings', () => {
    const { html } = build({ tasks });
    expect(html).not.toContain('Alpha LLC');
  });
});

describe('one company: the email pinned byte for byte (checked by eye when it changes)', () => {
  const fixture = input({
    tasks: [
      task('RIG-1', { title: 'Replace the pump seal', dueDate: day('2026-11-01'), priority: 'URGENT', statusLabel: 'In Progress', startDate: day('2026-10-28'), checklist: { done: 3, total: 5 }, description: 'The seal on pump 3 leaks under load.', latest: { text: 'Sara Ali: “The new seal arrives on Friday”', at: new Date('2026-11-03T09:00:00Z') }, blocked: true }),
      task('RIG-2', { title: 'Send the weekly report', dueDate: new Date('2026-11-04T10:00:00Z'), priority: 'HIGH' }),
      task('OPS-1', { project: OPS, dueDate: day('2026-11-06') }),
      task('OPS-2', { project: OPS }),
      task('RIG-3', { waitingSince: new Date('2026-11-03T08:00:00Z') }),
    ],
    meetings: [meeting('m-1', { title: 'Site walk', projectName: 'Rig Inspection', location: 'Gate 2', organizer: true })],
    managed: [task('RIG-9', { title: 'Fix the gate', dueDate: day('2026-11-02'), assignees: ['Omar Ahmed'] })],
    completed: [task('OPS-5', { project: OPS, title: 'Order the steel', completedAt: new Date('2026-11-03T11:00:00Z'), dueDate: day('2026-11-05') })],
    awaitingApproval: 2,
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

describe('1.24 guests and categories on a task’s card', () => {
  it('“with guest Ahmed (OXY)” and its categories, in the email and its plain text — never the guests’ addresses', () => {
    const e = build({ tasks: [task('RIG-1', { guests: [{ name: 'Ahmed', company: 'OXY' }, { name: 'Sara', company: null }], categories: ['Civil', 'HSE'] })] });
    expect(e.text).toContain('with guests Ahmed (OXY) and Sara');
    expect(e.text).toContain('Categories: Civil, HSE');
    expect(e.html).toContain('with guests Ahmed (OXY) and Sara');
  });
});
