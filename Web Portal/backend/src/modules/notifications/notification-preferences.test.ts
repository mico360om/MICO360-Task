import { describe, it, expect } from 'vitest';
import { dailyEmailOn, dailyEmailPrefs, emptyPreferences, isMuted, normalizePreferences, weeklySummaryOn, DAILY_EMAIL_PARTS, DEFAULT_DAILY_EMAILS } from './notification-preferences';

describe('notification-preferences', () => {
  it('defaults to nothing muted', () => {
    expect(emptyPreferences()).toEqual({ muted: [] });
  });

  it('normalizes arbitrary input: keeps string types, drops blanks, de-duplicates', () => {
    expect(normalizePreferences({ muted: ['TASK_COMMENT', 'TASK_COMMENT', '', 42, 'TASK_DUE_SOON'] })).toEqual({
      muted: ['TASK_COMMENT', 'TASK_DUE_SOON'],
    });
    expect(normalizePreferences(null)).toEqual({ muted: [] });
    expect(normalizePreferences({ muted: 'nope' })).toEqual({ muted: [] });
    expect(normalizePreferences('garbage')).toEqual({ muted: [] });
  });

  it('accepts a valid reminder lead time and rejects invalid ones', () => {
    expect(normalizePreferences({ muted: [], reminderLeadMinutes: 1440 })).toEqual({ muted: [], reminderLeadMinutes: 1440 });
    expect(normalizePreferences({ muted: [], reminderLeadMinutes: 0 })).toEqual({ muted: [], reminderLeadMinutes: 0 });
    expect(normalizePreferences({ muted: [], reminderLeadMinutes: -5 })).toEqual({ muted: [] });
    expect(normalizePreferences({ muted: [], reminderLeadMinutes: 1.5 })).toEqual({ muted: [] });
    expect(normalizePreferences({ muted: [], reminderLeadMinutes: 9_999_999 })).toEqual({ muted: [] });
  });

  it('reports muted types', () => {
    const prefs = { muted: ['TASK_COMMENT'] };
    expect(isMuted(prefs, 'TASK_COMMENT')).toBe(true);
    expect(isMuted(prefs, 'TASK_ASSIGNED')).toBe(false);
    expect(isMuted(null, 'TASK_COMMENT')).toBe(false);
  });
});

describe('daily task email settings', () => {
  const ALL_ON = { pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true, glance: true, week: true, priority: true, comingUp: true, projects: true };
  const ALL_OFF = { pending: false, completed: false, time: '06:00', schedule: false, urgent: false, managed: false, glance: false, week: false, priority: false, comingUp: false, projects: false };

  it('are all on at 06:00 for someone who never chose', () => {
    expect(DEFAULT_DAILY_EMAILS).toEqual(ALL_ON);
    expect(dailyEmailPrefs(emptyPreferences())).toEqual(DEFAULT_DAILY_EMAILS);
    expect(dailyEmailOn(dailyEmailPrefs(emptyPreferences()))).toBe(true);
  });

  it('keep what was chosen, and fill in or fix the rest', () => {
    const chosen = { pending: false, completed: true, time: '07:30', schedule: false, urgent: true, managed: false, glance: false, week: true, priority: false, comingUp: true, projects: false };
    expect(normalizePreferences({ muted: [], dailyEmails: chosen }).dailyEmails).toEqual(chosen);
    expect(normalizePreferences({ dailyEmails: { completed: 'yes', time: '25:00' } }).dailyEmails).toEqual(DEFAULT_DAILY_EMAILS);
    expect(normalizePreferences({ dailyEmails: { time: '6:5' } }).dailyEmails?.time).toBe('06:00');
    // A part that isn't true or false is filled in as if it had never been saved.
    expect(normalizePreferences({ dailyEmails: { ...ALL_ON, glance: 'yes' } }).dailyEmails?.glance).toBe(true);
  });

  it('1.22: settings saved before the one email keep their meaning — both old emails off means no email', () => {
    // "Pending tasks" was the task list: it now stands for every part about the person's open tasks.
    expect(normalizePreferences({ dailyEmails: { pending: false, completed: true, time: '07:30' } }).dailyEmails).toEqual({
      pending: false, completed: true, time: '07:30', schedule: true, urgent: false, managed: true, glance: false, week: true, priority: false, comingUp: false, projects: true,
    });
    expect(normalizePreferences({ dailyEmails: { pending: true, completed: false, time: '06:00' } }).dailyEmails).toEqual({
      pending: true, completed: false, time: '06:00', schedule: true, urgent: true, managed: true, glance: true, week: false, priority: true, comingUp: true, projects: true,
    });
    const off = dailyEmailPrefs(normalizePreferences({ dailyEmails: { pending: false, completed: false, time: '06:00' } }));
    expect(off).toEqual(ALL_OFF);
    expect(dailyEmailOn(off)).toBe(false);
  });

  it('redesign: settings saved before the new parts — new parts on, except those matching a part turned off', () => {
    // Saved by the 1.22 website: every 1.22 part chosen, none of the new ones.
    const saved = (d: Record<string, unknown>) => normalizePreferences({ dailyEmails: { time: '06:00', ...d } }).dailyEmails;
    expect(saved({ pending: true, completed: true, schedule: true, urgent: true, managed: true })).toEqual(ALL_ON);
    // "Your tasks" off: At a glance, By priority and Coming up (all about the person's open tasks) stay off.
    expect(saved({ pending: false, completed: true, schedule: true, urgent: true, managed: true })).toMatchObject({ glance: false, priority: false, comingUp: false, week: true, projects: true });
    // "Recently completed" off: This week (how much got done) stays off.
    expect(saved({ pending: true, completed: false, schedule: true, urgent: true, managed: true })).toMatchObject({ glance: true, priority: true, comingUp: true, week: false, projects: true });
    // "In your projects" off: Your projects stays off.
    expect(saved({ pending: true, completed: true, schedule: true, urgent: true, managed: false })).toMatchObject({ projects: false, glance: true, week: true });
    // Read straight from storage (not through normalizePreferences) the same.
    expect(dailyEmailPrefs({ muted: [], dailyEmails: { pending: false, completed: true, time: '06:00', schedule: true, urgent: true, managed: false } })).toMatchObject({ glance: false, week: true, projects: false });
  });

  it('the email is on while any one part is on; the parts are in the email’s order', () => {
    expect(dailyEmailOn(ALL_OFF)).toBe(false);
    for (const part of DAILY_EMAIL_PARTS) expect(dailyEmailOn({ ...ALL_OFF, [part]: true })).toBe(true);
    expect([...DAILY_EMAIL_PARTS]).toEqual(['glance', 'week', 'priority', 'urgent', 'comingUp', 'pending', 'schedule', 'completed', 'projects', 'managed']);
  });

  it('are left out when they were never saved (older stored settings stay as they are)', () => {
    expect(normalizePreferences({ muted: ['TASK_COMMENT'] })).toEqual({ muted: ['TASK_COMMENT'] });
  });
});

describe('weekly management summary setting', () => {
  it('is on unless it was turned off (only a real false turns it off)', () => {
    expect(weeklySummaryOn(emptyPreferences())).toBe(true);
    expect(weeklySummaryOn(null)).toBe(true);
    expect(weeklySummaryOn(normalizePreferences({ weeklySummary: false }))).toBe(false);
    expect(weeklySummaryOn(normalizePreferences({ weeklySummary: true }))).toBe(true);
    expect(weeklySummaryOn(normalizePreferences({ weeklySummary: 'no' }))).toBe(true);
  });

  it('is kept when saved and left out when never saved', () => {
    expect(normalizePreferences({ muted: [], weeklySummary: false })).toEqual({ muted: [], weeklySummary: false });
    expect(normalizePreferences({ muted: [], weeklySummary: 0 })).toEqual({ muted: [] });
  });
});
