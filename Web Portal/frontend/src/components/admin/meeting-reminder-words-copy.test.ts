import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MEETING_REMINDERS, MAX_REMINDER_MINUTES, MAX_REMINDER_TIMES, MIN_REMINDER_MINUTES } from './meeting-reminder-words';

// The server owns the meeting reminder setting (settings-service.ts: its defaults and limits); the
// System Settings card keeps a copy to show the defaults and check the times before saving. This
// fails when the copy drifts (skipped where the server's code isn't checked out).
const server = resolve(__dirname, '../../../../backend/src/modules/settings/settings-service.ts');

describe('meeting reminders: the website’s copy of the server’s setting', () => {
  it.skipIf(!existsSync(server))('same defaults and limits as settings-service.ts', () => {
    const src = readFileSync(server, 'utf8').replace(/\s+/g, ' ');
    expect(src).toContain(`MEETING_REMINDER_MIN_MINUTES = ${MIN_REMINDER_MINUTES};`);
    expect(src).toContain('MEETING_REMINDER_MAX_MINUTES = 7 * 24 * 60;');
    expect(MAX_REMINDER_MINUTES).toBe(7 * 24 * 60);
    expect(src).toContain(`MEETING_REMINDER_MAX_TIMES = ${MAX_REMINDER_TIMES};`);
    const times = DEFAULT_MEETING_REMINDERS.times.map((t) => `{ minutes: ${t.minutes === 1440 ? '24 * 60' : t.minutes === 720 ? '12 * 60' : t.minutes}, email: ${t.email} }`);
    expect(src).toContain(`DEFAULT_MEETING_REMINDERS: MeetingReminderSettings = { enabled: ${DEFAULT_MEETING_REMINDERS.enabled}, times: [ ${times.join(', ')}, ], };`);
  });
});
