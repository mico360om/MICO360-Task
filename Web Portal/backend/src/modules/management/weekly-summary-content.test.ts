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
});
