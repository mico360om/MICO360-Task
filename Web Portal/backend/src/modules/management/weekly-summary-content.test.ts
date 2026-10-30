import { describe, it, expect } from 'vitest';
import { weeklySummaryEmail } from './weekly-summary-content';
import type { WeeklyDigest } from './management-service';

const DIGEST: WeeklyDigest = {
  scope: 'RUN',
  projects: 3,
  red: 1,
  amber: 1,
  green: 1,
  worst: [
    { id: 'rig', code: 'RIG', name: 'Rig Inspection Portal', rag: 'RED', reasons: [{ code: 'MILESTONE_LATE', level: 'RED', text: 'Milestone “Handover” is 3 days late' }, { code: 'MANY_MISSING_CHECKS', level: 'RED', text: '3 missing checks' }] },
    { id: 'arab', code: 'ARB', name: 'مشروع الحفر', rag: 'AMBER', reasons: [{ code: 'LATE_TASKS', level: 'AMBER', text: '1 late task' }] },
  ],
  lateTasks: 5,
  missingChecks: 3,
  lastWeek: { start: '2026-10-18', end: '2026-10-24' },
  doneLateLastWeek: 1,
  passRateLastWeek: 80,
  mostLate: [
    { id: 'zara', name: 'Zara Ahmed', lateTasks: 3 },
    { id: 'bilal', name: 'Bilal Ahmed', lateTasks: 1 },
  ],
  approvals: { total: 3, projects: [{ id: 'rig', code: 'RIG', name: 'Rig Inspection Portal', count: 2 }, { id: 'arab', code: 'ARB', name: 'مشروع الحفر', count: 1 }] },
};

describe('weeklySummaryEmail', () => {
  const mail = weeklySummaryEmail({ name: 'Sara Ahmed', digest: DIGEST, week: '2026-10-25', appUrl: 'https://task.mico360.com/' });

  it('says how many tasks wait for approval, in all and per project (as the Management page), with a link to the To approve list (owner, 30 Oct)', () => {
    for (const s of ['Waiting for approval', 'Waiting for approval, by project:', '  - Rig Inspection Portal (RIG): 2 tasks', '  - مشروع الحفر (ARB): 1 task', 'https://task.mico360.com/my-tasks#to-approve']) {
      expect(mail.text, s).toContain(s);
    }
    expect(mail.text).toMatch(/Waiting for approval\W+3/);
    expect(mail.text.indexOf('Waiting for approval, by project:')).toBeLessThan(mail.text.indexOf('Open the dashboard'));
    expect(mail.html).toContain('href="https://task.mico360.com/my-tasks#to-approve"');
    // None waiting: the number is 0, with no list and no link.
    const none = weeklySummaryEmail({ name: 'Sara Ahmed', digest: { ...DIGEST, approvals: { total: 0, projects: [] } }, week: '2026-10-25', appUrl: 'https://task.mico360.com/' });
    expect(none.text).toMatch(/Waiting for approval\W+0/);
    expect(none.text).not.toContain('by project');
    expect(none.text).not.toContain('#to-approve');
  });

  it('writes last week’s days with three-letter months, never "Sept"', () => {
    const sep = weeklySummaryEmail({ name: 'Sara Ahmed', digest: { ...DIGEST, lastWeek: { start: '2026-09-27', end: '2026-10-03' } }, week: '2026-10-04', appUrl: 'https://task.mico360.com/' });
    expect(sep.text).toContain('Checks done late last week (27 Sep – 3 Oct)');
    expect(sep.text).not.toContain('Sept');
  });

  it('says in its subject how many projects are red and amber, and the late work', () => {
    expect(mail.subject).toBe('Weekly summary: 1 red, 1 amber · 5 late tasks');
  });

  it('lists the worst projects with their mark in words and their reasons, the numbers, the people with the most late work, and a button to the dashboard', () => {
    for (const s of [
      'Hello, Sara Ahmed',
      'the projects you run (3 projects)',
      'Red: Rig Inspection Portal (RIG): Milestone “Handover” is 3 days late; 3 missing checks',
      'Amber: مشروع الحفر (ARB): 1 late task',
      'Late tasks',
      'Missing checks',
      'Checks done late last week (18 Oct – 24 Oct)',
      'Pass rate last week',
      '80%',
      'Zara Ahmed: 3 late tasks',
      'Bilal Ahmed: 1 late task',
      'Open the dashboard',
      'https://task.mico360.com/management',
      'https://task.mico360.com/settings',
    ]) {
      expect(mail.text, s).toContain(s);
    }
    expect(mail.html).toContain('href="https://task.mico360.com/management"');
    expect(mail.html).toContain('Week of Sunday 25 October');
    // It goes at the person's daily email time, which may be any hour: no "morning" in it.
    expect(mail.text).not.toMatch(/morning/i);
    expect(mail.html).toContain('class="email-container"'); // the daily emails' centred card
  });

  it('for an administrator, all projects; with nothing to worry about, says so', () => {
    const calm = weeklySummaryEmail({
      name: 'Aisha',
      digest: { ...DIGEST, scope: 'ALL', red: 0, amber: 0, green: 3, worst: [], lateTasks: 0, missingChecks: 0, doneLateLastWeek: 0, passRateLastWeek: null, mostLate: [] },
      week: '2026-10-25',
      appUrl: 'https://task.mico360.com',
    });
    expect(calm.subject).toBe('Weekly summary: all 3 projects on track');
    expect(calm.text).toContain('all projects (3 projects)');
    expect(calm.text).toContain('Every project is on track.');
    expect(calm.text).toContain('No inspections finished');
    expect(calm.text).not.toContain('Most late work');
  });

  it('after the three worst projects, says how many more need attention, with a link to the Management page', () => {
    const w = (id: string, rag: 'RED' | 'AMBER'): WeeklyDigest['worst'][number] => ({ id, code: id.toUpperCase(), name: `Project ${id}`, rag, reasons: [{ code: 'LATE_TASKS', level: rag, text: '2 late tasks' }] });
    const busy = weeklySummaryEmail({
      name: 'Aisha',
      // 1 red and 4 amber; the digest names the worst three (in its own order).
      digest: { ...DIGEST, scope: 'ALL', projects: 6, red: 1, amber: 4, green: 1, worst: [w('a', 'RED'), w('b', 'AMBER'), w('c', 'AMBER')] },
      week: '2026-10-25',
      appUrl: 'https://task.mico360.com/',
    });
    // The shown projects keep their order; then the rest are counted, never dropped silently.
    const text = busy.text;
    expect(text.indexOf('Red: Project a')).toBeLessThan(text.indexOf('Amber: Project b'));
    expect(text.indexOf('Amber: Project b')).toBeLessThan(text.indexOf('Amber: Project c'));
    expect(text).toContain('and 2 more on the Management page: https://task.mico360.com/management');
    expect(text.indexOf('Amber: Project c')).toBeLessThan(text.indexOf('and 2 more on the Management page'));
    expect(text.indexOf('and 2 more on the Management page')).toBeLessThan(text.indexOf('Late tasks'));
    expect(busy.html).toMatch(/<a href="https:\/\/task\.mico360\.com\/management"[^>]*>and 2 more on the Management page<\/a>/);

    const one = weeklySummaryEmail({ name: 'Aisha', digest: { ...DIGEST, red: 2, amber: 2, worst: [w('a', 'RED'), w('b', 'RED'), w('c', 'AMBER')] }, week: '2026-10-25', appUrl: 'https://task.mico360.com' });
    expect(one.text).toContain('and 1 more on the Management page: https://task.mico360.com/management');
  });

  it('says nothing about more projects when every red and amber one is named', () => {
    expect(mail.text).not.toMatch(/and \d+ more/);
    expect(mail.html).not.toMatch(/and \d+ more/);
  });
});
