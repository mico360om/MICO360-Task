import { describe, it, expect } from 'vitest';
import { dailyEmailPrefs, emptyPreferences, isMuted, normalizePreferences, weeklySummaryOn, DEFAULT_DAILY_EMAILS } from './notification-preferences';

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
  it('are both on at 06:00 for someone who never chose', () => {
    expect(DEFAULT_DAILY_EMAILS).toEqual({ pending: true, completed: true, time: '06:00' });
    expect(dailyEmailPrefs(emptyPreferences())).toEqual(DEFAULT_DAILY_EMAILS);
  });

  it('keep what was chosen, and fill in or fix the rest', () => {
    const p = normalizePreferences({ muted: [], dailyEmails: { pending: false, time: '07:30' } });
    expect(p.dailyEmails).toEqual({ pending: false, completed: true, time: '07:30' });
    expect(normalizePreferences({ dailyEmails: { completed: 'yes', time: '25:00' } }).dailyEmails).toEqual(DEFAULT_DAILY_EMAILS);
    expect(normalizePreferences({ dailyEmails: { time: '6:5' } }).dailyEmails?.time).toBe('06:00');
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
