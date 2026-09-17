import { describe, it, expect } from 'vitest';
import { emptyPreferences, isMuted, normalizePreferences } from './notification-preferences';

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
