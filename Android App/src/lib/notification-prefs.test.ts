import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NOTIFICATION_TYPES,
  REMINDER_OPTIONS,
  isTypeOn,
  toggleType,
  withReminderLead,
  reminderLabel,
  DAILY_EMAIL_ITEMS,
  DEFAULT_DAILY_EMAILS,
  dailyEmailChange,
  dailyEmailPrefs,
  dailyEmailTestProblem,
  dailyEmailTestSummary,
  hasDailyEmails,
  mergePreferences,
  prefsSaveProblem,
  readDailyEmailTime,
  timeFieldKeyboard,
  type NotificationPreferences,
} from './notification-prefs';
import { ApiError, NetworkError } from './api-client';

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

  it('never sends the daily email settings with a notification switch (the server keeps them)', () => {
    const prefs: NotificationPreferences = { muted: ['TASK_STATUS'], reminderLeadMinutes: 60, dailyEmails: { pending: false, completed: true, time: '07:30' } };
    expect(toggleType(prefs, 'MENTION')).toEqual({ muted: ['TASK_STATUS', 'MENTION'], reminderLeadMinutes: 60 });
    expect(withReminderLead(prefs, 240)).toEqual({ muted: ['TASK_STATUS'], reminderLeadMinutes: 240 });
  });
});

describe('daily task emails (the website’s Settings → Daily task emails)', () => {
  it('offers the two morning emails with the website’s words', () => {
    expect(DAILY_EMAIL_ITEMS).toEqual([
      { key: 'pending', label: 'Pending tasks', description: 'Overdue, due today, upcoming and undated — with priority, status and a link to each.', a11y: 'Pending tasks email' },
      { key: 'completed', label: 'Completed yesterday', description: 'Your tasks that were completed the day before, and whether they were on time.', a11y: 'Completed yesterday email' },
    ]);
  });

  it('reads the settings in force: the saved ones, else both at 06:00', () => {
    expect(DEFAULT_DAILY_EMAILS).toEqual({ pending: true, completed: true, time: '06:00' });
    expect(dailyEmailPrefs(undefined)).toEqual(DEFAULT_DAILY_EMAILS);
    expect(dailyEmailPrefs({ muted: [], dailyEmails: { pending: false, completed: true, time: '08:15' } })).toEqual({ pending: false, completed: true, time: '08:15' });
  });

  it('shows them only when the server knows them (it always sends them since 1.5.0)', () => {
    expect(hasDailyEmails({ muted: [], dailyEmails: DEFAULT_DAILY_EMAILS })).toBe(true);
    expect(hasDailyEmails({ muted: [] })).toBe(false);
    expect(hasDailyEmails(undefined)).toBe(false);
  });

  it('sends only the one setting that changed, so nothing else is overwritten', () => {
    expect(dailyEmailChange({ pending: false })).toEqual({ dailyEmails: { pending: false } });
    expect(dailyEmailChange({ time: '07:00' })).toEqual({ dailyEmails: { time: '07:00' } });
  });

  it('reads a typed time as HH:MM, or says how to write it', () => {
    expect(readDailyEmailTime('7:30')).toEqual({ ok: true, value: '07:30' });
    expect(readDailyEmailTime(' 6 ')).toEqual({ ok: true, value: '06:00' });
    expect(readDailyEmailTime('23.59')).toEqual({ ok: true, value: '23:59' });
    expect(readDailyEmailTime('٠٧:٣٠')).toEqual({ ok: true, value: '07:30' });
    expect(readDailyEmailTime('')).toEqual({ ok: false, error: 'Choose a time, for example 06:00.' });
    expect(readDailyEmailTime('25:00')).toEqual({ ok: false, error: 'Choose a time, for example 06:00.' });
    expect(readDailyEmailTime('noon')).toEqual({ ok: false, error: 'Choose a time, for example 06:00.' });
  });

  it('says what a test sent, in the website’s words', () => {
    expect(dailyEmailTestSummary({ pending: 'sent', completed: 'sent' })).toBe('Sent both emails: pending tasks and completed tasks.');
    expect(dailyEmailTestSummary({ pending: 'sent', completed: 'empty' })).toBe('Sent the pending tasks email. Nothing was completed yesterday, so there was no completed tasks email to send.');
    expect(dailyEmailTestSummary({ pending: 'empty', completed: 'sent' })).toBe('Sent the completed tasks email. You have no pending tasks, so there was no pending tasks email to send.');
    expect(dailyEmailTestSummary({ pending: 'empty', completed: 'empty' })).toBe(
      'You have no pending tasks, so there was no pending tasks email to send. Nothing was completed yesterday, so there was no completed tasks email to send.',
    );
  });

  it('shows the server’s reason when a test isn’t sent, and says plainly when offline', () => {
    expect(dailyEmailTestProblem(new ApiError(429, 'TOO_SOON', 'A test was just sent. Wait a minute before sending another.'))).toBe('A test was just sent. Wait a minute before sending another.');
    expect(dailyEmailTestProblem(new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email isn’t set up on this server yet, so no email can be sent.'))).toBe('Email isn’t set up on this server yet, so no email can be sent.');
    expect(dailyEmailTestProblem(new ApiError(502, 'ERROR', 'Request failed (502)'))).toBe('Couldn’t send the test. Check your connection and try again.');
    expect(dailyEmailTestProblem(new NetworkError('Network request failed.'))).toBe('You’re offline — a test can be sent when you’re connected.');
  });
});

describe('saving preferences: the screen shows what the server will keep', () => {
  const saved: NotificationPreferences = { muted: ['MENTION'], reminderLeadMinutes: 60, dailyEmails: { pending: true, completed: true, time: '06:00' } };

  it('a daily email change keeps the notification switches and the reminder time', () => {
    expect(mergePreferences(saved, { dailyEmails: { pending: false } })).toEqual({ muted: ['MENTION'], reminderLeadMinutes: 60, dailyEmails: { pending: false, completed: true, time: '06:00' } });
  });

  it('a notification switch keeps the daily emails; a reminder time left out is the default again (as the server does it)', () => {
    expect(mergePreferences(saved, { muted: [] })).toEqual({ muted: [], dailyEmails: saved.dailyEmails });
    expect(mergePreferences(saved, { muted: [], reminderLeadMinutes: 240 })).toEqual({ muted: [], reminderLeadMinutes: 240, dailyEmails: saved.dailyEmails });
  });

  it('works before anything is loaded', () => {
    expect(mergePreferences(undefined, { dailyEmails: { time: '07:00' } })).toEqual({ muted: [], dailyEmails: { pending: true, completed: true, time: '07:00' } });
    expect(mergePreferences(undefined, { muted: ['MENTION'] })).toEqual({ muted: ['MENTION'] });
  });

  it('says plainly why a change wasn’t saved', () => {
    expect(prefsSaveProblem(new NetworkError('Network request failed.'))).toBe('You’re offline — this change can be saved when you’re connected.');
    expect(prefsSaveProblem(new ApiError(400, 'VALIDATION', 'Choose a time as HH:MM.'))).toBe('Choose a time as HH:MM.');
    expect(prefsSaveProblem(new ApiError(400, 'ERROR', 'Request failed (400)'))).toBe('Couldn’t save that change. Please try again.');
    expect(prefsSaveProblem(new ApiError(500, 'INTERNAL', 'x'))).toBe('Couldn’t save that change. Please try again.');
  });
});

describe('nothing saves the whole preferences object any more (6a review)', () => {
  it('only the save that sends what changed is left (a whole-object PUT would wipe the daily email settings)', () => {
    const queries = readFileSync(resolve(__dirname, '../core/queries.ts'), 'utf8');
    const resources = readFileSync(resolve(__dirname, './resources.ts'), 'utf8');
    expect(queries).not.toMatch(/useSaveNotificationPreferences/);
    expect(resources).not.toMatch(/setPreferences:/);
  });
});

describe('typing the daily emails’ time on an Android keyboard (6a review)', () => {
  it('uses a keyboard Android has (digits and a point), and reads what it can type', () => {
    expect(timeFieldKeyboard('android')).toEqual({ keyboardType: 'decimal-pad', placeholder: 'HH.MM' });
    expect(timeFieldKeyboard('ios')).toEqual({ keyboardType: 'numbers-and-punctuation', placeholder: 'HH:MM' });
    expect(readDailyEmailTime('7,30')).toEqual({ ok: true, value: '07:30' });
    expect(readDailyEmailTime('0730')).toEqual({ ok: true, value: '07:30' });
    expect(readDailyEmailTime('730')).toEqual({ ok: true, value: '07:30' });
    expect(readDailyEmailTime('1745')).toEqual({ ok: true, value: '17:45' });
    expect(readDailyEmailTime('2460')).toEqual({ ok: false, error: 'Choose a time, for example 06:00.' });
  });
});
