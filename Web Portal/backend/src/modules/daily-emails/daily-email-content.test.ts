import { describe, it, expect } from 'vitest';
import { completedEmail, pendingEmail, taskLink, type DailyTask } from './daily-email-content';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T02:00:00Z'); // 06:00 on Wed 21 Oct in Muscat
const APP = 'https://task.example';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`); // due dates are stored as pure days

const task = (key: string, extra: Partial<DailyTask> = {}): DailyTask => ({
  id: key.toLowerCase(),
  key,
  title: `Task ${key}`,
  projectName: 'Rig Inspection',
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
    task('RIG-5', { dueDate: day('2026-10-20') }),
  ];
  const email = () => pendingEmail({ name: 'Ada', tasks, timeZone: TZ, now: NOW, appUrl: APP });

  it('says how many are pending and how many overdue, in the subject', () => {
    expect(email().subject).toBe('Your pending tasks: 5 (2 overdue)');
    expect(pendingEmail({ name: 'Ada', tasks: [task('RIG-3')], timeZone: TZ, now: NOW, appUrl: APP }).subject).toBe('Your pending tasks: 1');
  });

  it('groups them: overdue (most overdue first), due today, upcoming, no due date', () => {
    const { text } = email();
    const at = (s: string) => text.indexOf(s);
    expect(at('OVERDUE (2)')).toBeGreaterThan(-1);
    expect(at('Task RIG-2')).toBeLessThan(at('Task RIG-5')); // 2 days overdue before 1
    expect(at('Task RIG-5')).toBeLessThan(at('DUE TODAY (1)'));
    expect(at('DUE TODAY (1)')).toBeLessThan(at('Task RIG-4'));
    expect(at('Task RIG-4')).toBeLessThan(at('UPCOMING (1)'));
    expect(at('UPCOMING (1)')).toBeLessThan(at('Task RIG-1'));
    expect(at('Task RIG-1')).toBeLessThan(at('NO DUE DATE (1)'));
  });

  it('shows each task’s priority, due day, status, overdue flag and link', () => {
    const { text, html } = email();
    expect(text).toContain('- Task RIG-2 (RIG-2, Rig Inspection) — High priority · Due Mon 19 Oct · In Progress — 2 days overdue');
    expect(text).toContain('- Task RIG-5 (RIG-5, Rig Inspection) — Normal priority · Due Tue 20 Oct · To Do — 1 day overdue');
    expect(text).toContain('Urgent priority · Due Wed 21 Oct · To Do — Due today');
    expect(text).toContain('Normal priority · No due date · To Do');
    expect(html).toContain('href="https://task.example/my-tasks?task=rig-2"');
    expect(html).toContain('Good morning, Ada');
  });

  it('says where to change these emails', () => {
    expect(email().text).toContain('https://task.example/settings');
  });
});

describe('completedEmail (their tasks finished yesterday)', () => {
  const tasks = [
    task('RIG-7', { completedAt: new Date('2026-10-20T12:42:00Z'), dueDate: day('2026-10-22'), priority: 'HIGH' }),
    task('RIG-6', { completedAt: new Date('2026-10-20T05:10:00Z'), dueDate: day('2026-10-18') }),
  ];
  const email = () => completedEmail({ name: 'Ada', tasks, day: '2026-10-20', timeZone: TZ, appUrl: APP });

  it('names the day and the count', () => {
    expect(email().subject).toBe('Completed yesterday (Tue 20 Oct): 2 tasks');
    expect(completedEmail({ name: 'Ada', tasks: [tasks[0]!], day: '2026-10-20', timeZone: TZ, appUrl: APP }).subject).toBe('Completed yesterday (Tue 20 Oct): 1 task');
  });

  it('lists them in the order they were finished, with the time, and whether on time', () => {
    const { text } = email();
    expect(text.indexOf('Task RIG-6')).toBeLessThan(text.indexOf('Task RIG-7'));
    expect(text).toContain('- Task RIG-6 (RIG-6, Rig Inspection) — Completed Tue 20 Oct, 09:10 · Normal priority · Due Sun 18 Oct — 2 days late');
    expect(text).toContain('Completed Tue 20 Oct, 16:42 · High priority · Due Thu 22 Oct — On time');
    expect(email().html).toContain('href="https://task.example/my-tasks?task=rig-7"');
  });
});
