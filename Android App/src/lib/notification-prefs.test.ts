import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES, REMINDER_OPTIONS, isTypeOn, toggleType, withReminderLead, reminderLabel } from './notification-prefs';

describe('notification preferences', () => {
  it('offers the same six notification types as the web app', () => {
    expect(NOTIFICATION_TYPES.map((t) => t.type)).toEqual(['TASK_ASSIGNED', 'TASK_STATUS', 'TASK_COMMENT', 'MENTION', 'TASK_DUE_SOON', 'TASK_OVERDUE']);
  });

  it('treats every type as on until muted, and toggles one without touching the rest', () => {
    expect(isTypeOn(undefined, 'MENTION')).toBe(true);
    const off = toggleType({ muted: ['TASK_STATUS'], reminderLeadMinutes: 60 }, 'MENTION');
    expect(off).toEqual({ muted: ['TASK_STATUS', 'MENTION'], reminderLeadMinutes: 60 });
    expect(isTypeOn(off, 'MENTION')).toBe(false);
    expect(toggleType(off, 'MENTION')).toEqual({ muted: ['TASK_STATUS'], reminderLeadMinutes: 60 });
  });

  it('sets and clears the reminder lead time', () => {
    expect(withReminderLead({ muted: ['MENTION'] }, 240)).toEqual({ muted: ['MENTION'], reminderLeadMinutes: 240 });
    expect(withReminderLead({ muted: ['MENTION'], reminderLeadMinutes: 240 }, null)).toEqual({ muted: ['MENTION'] });
    expect(withReminderLead(undefined, 0)).toEqual({ muted: [], reminderLeadMinutes: 0 });
  });

  it('labels the current reminder choice', () => {
    expect(reminderLabel(undefined)).toBe('Default (1 day)');
    expect(reminderLabel({ muted: [], reminderLeadMinutes: 60 })).toBe('1 hour before');
    expect(reminderLabel({ muted: [], reminderLeadMinutes: 90 })).toBe('90 minutes before');
    expect(REMINDER_OPTIONS[0]!.minutes).toBeNull();
  });
});
