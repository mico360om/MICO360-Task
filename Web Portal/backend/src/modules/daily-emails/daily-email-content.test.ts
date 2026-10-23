import { describe, it, expect } from 'vitest';
import { completedEmail, pendingEmail, taskLink, type DailyProject, type DailyTask } from './daily-email-content';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T02:00:00Z'); // 06:00 on Wed 21 Oct in Muscat
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

describe('taskLink', () => {
  it('opens the task on My Tasks', () => {
    expect(taskLink('https://task.example/', 'abc 1')).toBe('https://task.example/my-tasks?task=abc%201');
  });
});

describe('pendingEmail (tasks assigned and not done)', () => {
  const tasks = [
    task('RIG-1', { dueDate: day('2026-10-25'), priority: 'LOW' }),
    task('RIG-2', { dueDate: day('2026-10-19'), priority: 'HIGH', statusLabel: 'In Progress' }),
    task('RIG-3'),
    task('RIG-4', { dueDate: day('2026-10-21'), priority: 'URGENT' }),
    task('OPS-5', { project: OPS, dueDate: day('2026-10-20') }),
  ];
  const email = () => pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: NOW, appUrl: APP, assetUrl: ASSETS });

  it('says how many are pending and how many overdue, in the subject', () => {
    expect(email().subject).toBe('Your pending tasks: 5 (2 overdue)');
    expect(pendingEmail({ name: 'Ada', tasks: [task('RIG-3')], timeZone: TZ, now: NOW, appUrl: APP }).subject).toBe('Your pending tasks: 1');
  });

  it('greets the person, says how many tasks in how many projects, and shows the day at a glance', () => {
    const { text, html } = email();
    expect(html).toContain('Good morning, Ada');
    expect(text).toContain('You have 5 tasks that aren’t done yet, in 2 projects.');
    expect(text).toContain('2 overdue · 1 due today · 1 upcoming · 1 with no due date');
    expect(pendingEmail({ name: 'Ada', tasks: [task('RIG-3')], timeZone: TZ, now: NOW, appUrl: APP }).text).toContain('You have 1 task that isn’t done yet.');
  });

  it('shows today’s date in the header, in the person’s time zone', () => {
    expect(email().html).toMatch(/class="email-head-note"[^>]*>Wednesday 21 October</);
    // 21:30 on Tuesday in UTC is already 01:30 on Wednesday in Muscat.
    const late = pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: new Date('2026-10-20T21:30:00Z'), appUrl: APP });
    expect(late.html).toMatch(/class="email-head-note"[^>]*>Wednesday 21 October</);
  });

  it('puts each project in its own section: the most urgent project first, and in each the most urgent task first', () => {
    const { text } = email();
    const at = (s: string) => text.indexOf(s);
    // RIG has the most overdue task (2 days), so it comes before OPS (1 day).
    expect(at('RIG INSPECTION')).toBeGreaterThan(-1);
    expect(at('RIG INSPECTION')).toBeLessThan(at('OPERATIONS'));
    // In RIG: overdue, due today, upcoming, no due date.
    expect(at('Task RIG-2')).toBeLessThan(at('Task RIG-4'));
    expect(at('Task RIG-4')).toBeLessThan(at('Task RIG-1'));
    expect(at('Task RIG-1')).toBeLessThan(at('Task RIG-3'));
    expect(at('Task RIG-3')).toBeLessThan(at('OPERATIONS'));
    expect(at('OPERATIONS')).toBeLessThan(at('Task OPS-5'));
  });

  it('heads each project with its details (only those it has), status, counts for the person, and a link', () => {
    const { text, html } = email();
    expect(text).toContain('RIG INSPECTION — RIG · No. 2026-014 · Client: Acme Drilling · Manager: Sara Ali · Target Mon 30 Nov');
    expect(text).toContain('Active · 4 tasks for you · 1 overdue · 1 due today');
    expect(text).toContain('https://task.example/projects/p-rig');
    expect(text).toContain('OPERATIONS — OPS\n');
    expect(text).toContain('On hold · 1 task for you · 1 overdue');
    expect(html).toContain('border-top:4px solid #3A6EA5');
  });

  it('shows a project’s picture at an address email clients can load', () => {
    expect(email().html).toContain('<img src="https://api.example/uploads/projects/ops.png" alt=""');
  });

  it('shows each task’s due day, priority and status as labels, with its link', () => {
    const { text, html } = email();
    expect(text).toContain('- Task RIG-2 (RIG-2) — 2 days overdue · High priority · In Progress');
    expect(text).toContain('- Task OPS-5 (OPS-5) — 1 day overdue · Normal priority · To Do');
    expect(text).toContain('- Task RIG-4 (RIG-4) — Due today · Urgent · To Do');
    expect(text).toContain('- Task RIG-1 (RIG-1) — Due Sun 25 Oct · Low priority · To Do');
    expect(text).toContain('- Task RIG-3 (RIG-3) — No due date · Normal priority · To Do');
    expect(html).toContain('href="https://task.example/my-tasks?task=rig-2"');
  });

  it('says where to change these emails', () => {
    expect(email().text).toContain('https://task.example/settings');
  });
});

describe('long lists stay readable (Gmail cuts off emails over about 100 KB)', () => {
  const project = (i: number): DailyProject => ({ ...RIG, id: `p${i}`, code: `P${i}`, name: `Project ${i}` });
  const many = (p: DailyProject, n: number, extra: Partial<DailyTask> = {}) =>
    Array.from({ length: n }, (_, i) => task(`${p.code}-${i + 1}`, { project: p, dueDate: day('2026-10-25'), ...extra }));

  it('shows up to 10 tasks of a project, then how many more with a link to the project', () => {
    const { text } = pendingEmail({ name: 'Ada', tasks: many(RIG, 12), timeZone: TZ, now: NOW, appUrl: APP });
    expect(text).toContain('- Task RIG-10 (RIG-10)');
    expect(text).not.toContain('(RIG-11)');
    expect(text).toContain('Active · 12 tasks for you');
    expect(text).toContain('+2 more tasks in this project: https://task.example/projects/p-rig');
  });

  it('shows up to 30 tasks in all, then how many more in how many more projects', () => {
    const tasks = [1, 2, 3, 4].flatMap((i) => many(project(i), 10));
    const { text } = pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: NOW, appUrl: APP });
    expect(text).toContain('You have 40 tasks that aren’t done yet, in 4 projects.');
    expect(text).toContain('- Task P3-10 (P3-10)');
    expect(text).not.toContain('PROJECT 4');
    expect(text).toContain('+10 more tasks in 1 more project. Open My Tasks to see them all.');
  });

  it('shows up to 8 projects, then how many more tasks in how many more projects', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => many(project(i), 1)).flat();
    const { text } = pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: NOW, appUrl: APP });
    expect(text).toContain('PROJECT 7');
    expect(text).not.toContain('PROJECT 8');
    expect(text).toContain('+4 more tasks in 4 more projects. Open My Tasks to see them all.');
  });

  it('even 60 projects with one long task each stay well under Gmail’s limit, in both emails', () => {
    const long = (i: number): DailyProject => ({ ...project(i), id: `cmurzexwn0010mf376wf4e${i}`, name: 'Offshore Inspection Data Platform Modernisation (Phase 2)', clientName: 'Gulf Energy Services LLC', managerName: 'Sara Ahmed Al Balushi', imageUrl: '/uploads/959ede6f-1f00-4036-8d81-65ca613418f5.jpg' });
    const title = 'Investigate the intermittent sensor calibration failure on the north platform and report back';
    const tasks = Array.from({ length: 60 }, (_, i) => task(`P${i}-1`, { id: `cmurzf22r018ogxky0re9${i}`, project: long(i), title, priority: 'HIGH', dueDate: day('2026-10-01'), statusLabel: 'In Progress', completedAt: new Date('2026-10-20T08:00:00Z') }));
    expect(Buffer.byteLength(pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: NOW, appUrl: APP, assetUrl: ASSETS }).html)).toBeLessThan(80 * 1024);
    expect(Buffer.byteLength(completedEmail({ name: 'Ada', tasks, day: '2026-10-20', timeZone: TZ, appUrl: APP, assetUrl: ASSETS }).html)).toBeLessThan(80 * 1024);
  });

  it('even 500 tasks in 50 projects stay well under Gmail’s limit, in both emails', () => {
    const tasks = Array.from({ length: 50 }, (_, i) => many(project(i), 10)).flat();
    expect(Buffer.byteLength(pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: NOW, appUrl: APP }).html)).toBeLessThan(90 * 1024);
    const done = tasks.map((t) => ({ ...t, completedAt: new Date('2026-10-20T08:00:00Z') }));
    expect(Buffer.byteLength(completedEmail({ name: 'Ada', tasks: done, day: '2026-10-20', timeZone: TZ, appUrl: APP }).html)).toBeLessThan(90 * 1024);
  });
});

describe('completedEmail (their tasks finished yesterday)', () => {
  const tasks = [
    task('RIG-7', { completedAt: new Date('2026-10-20T12:42:00Z'), dueDate: day('2026-10-22'), priority: 'HIGH' }),
    task('RIG-6', { completedAt: new Date('2026-10-20T05:10:00Z'), dueDate: day('2026-10-18') }),
    task('OPS-8', { project: OPS, completedAt: new Date('2026-10-20T08:00:00Z') }),
  ];
  const email = () => completedEmail({ name: 'Ada', tasks, day: '2026-10-20', timeZone: TZ, appUrl: APP, assetUrl: ASSETS });

  it('names the day and the count', () => {
    expect(email().subject).toBe('Completed yesterday (Tue 20 Oct): 3 tasks');
    expect(completedEmail({ name: 'Ada', tasks: [tasks[0]!], day: '2026-10-20', timeZone: TZ, appUrl: APP }).subject).toBe('Completed yesterday (Tue 20 Oct): 1 task');
  });

  it('shows the day after the one it reports in the header (even when a retry goes after midnight), and how many were on time or late', () => {
    const { html, text } = email();
    expect(html).toMatch(/class="email-head-note"[^>]*>Wednesday 21 October</);
    expect(text).toContain('1 on time · 1 late');
  });

  it('puts each project in its own section, in the order the work was finished', () => {
    const { text } = email();
    const at = (s: string) => text.indexOf(s);
    // RIG's first task was finished first (09:10), so RIG comes first, with both its tasks in order.
    expect(at('RIG INSPECTION')).toBeLessThan(at('Task RIG-6'));
    expect(at('Task RIG-6')).toBeLessThan(at('Task RIG-7'));
    expect(at('Task RIG-7')).toBeLessThan(at('OPERATIONS'));
    expect(at('OPERATIONS')).toBeLessThan(at('Task OPS-8'));
    expect(text).toContain('Active · 2 tasks done');
    expect(text).toContain('On hold · 1 task done');
  });

  it('shows each task’s finishing time, whether it was on time, its priority and due day, with its link', () => {
    const { text, html } = email();
    expect(text).toContain('- Task RIG-6 (RIG-6) — Completed Tue 20 Oct, 09:10 · 2 days late · Normal priority · Due Sun 18 Oct');
    expect(text).toContain('- Task RIG-7 (RIG-7) — Completed Tue 20 Oct, 16:42 · On time · High priority · Due Thu 22 Oct');
    expect(text).toContain('- Task OPS-8 (OPS-8) — Completed Tue 20 Oct, 12:00 · Normal priority · No due date');
    expect(html).toContain('href="https://task.example/my-tasks?task=rig-7"');
  });
});
