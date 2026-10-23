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
    expect(email().html).toContain('<img src="https://api.example/uploads/projects/ops.png" alt="Operations"');
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

describe('completedEmail (their tasks finished yesterday)', () => {
  const tasks = [
    task('RIG-7', { completedAt: new Date('2026-10-20T12:42:00Z'), dueDate: day('2026-10-22'), priority: 'HIGH' }),
    task('RIG-6', { completedAt: new Date('2026-10-20T05:10:00Z'), dueDate: day('2026-10-18') }),
    task('OPS-8', { project: OPS, completedAt: new Date('2026-10-20T08:00:00Z') }),
  ];
  const email = () => completedEmail({ name: 'Ada', tasks, day: '2026-10-20', timeZone: TZ, now: NOW, appUrl: APP, assetUrl: ASSETS });

  it('names the day and the count', () => {
    expect(email().subject).toBe('Completed yesterday (Tue 20 Oct): 3 tasks');
    expect(completedEmail({ name: 'Ada', tasks: [tasks[0]!], day: '2026-10-20', timeZone: TZ, now: NOW, appUrl: APP }).subject).toBe('Completed yesterday (Tue 20 Oct): 1 task');
  });

  it('shows today’s date in the header, and how many were on time or late', () => {
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
    expect(text).toContain('Active · 2 completed');
  });

  it('shows each task’s finishing time, whether it was on time, its priority and due day, with its link', () => {
    const { text, html } = email();
    expect(text).toContain('- Task RIG-6 (RIG-6) — Completed Tue 20 Oct, 09:10 · 2 days late · Normal priority · Due Sun 18 Oct');
    expect(text).toContain('- Task RIG-7 (RIG-7) — Completed Tue 20 Oct, 16:42 · On time · High priority · Due Thu 22 Oct');
    expect(text).toContain('- Task OPS-8 (OPS-8) — Completed Tue 20 Oct, 12:00 · Normal priority · No due date');
    expect(html).toContain('href="https://task.example/my-tasks?task=rig-7"');
  });
});
