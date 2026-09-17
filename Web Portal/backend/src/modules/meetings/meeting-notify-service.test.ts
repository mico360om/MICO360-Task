import { describe, it, expect, vi } from 'vitest';
import { createMeetingNotifyService } from './meeting-notify-service';
import type { MeetingRecord } from './meeting-repository';
import type { AttendeeRecord } from './attendee-repository';

function meeting(over: Partial<MeetingRecord> = {}): MeetingRecord {
  const now = new Date('2026-10-01T00:00:00Z');
  return {
    id: 'm1', title: 'Sprint Review', description: 'Demo + retro', category: null, status: 'SCHEDULED',
    projectId: 'p1', organizerId: 'u1', location: 'Boardroom A', onlineLink: 'https://meet/x',
    startAt: new Date('2026-10-05T14:00:00Z'), endAt: new Date('2026-10-05T15:00:00Z'), timeZone: 'UTC',
    recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null,
    invitesSentAt: null, reminderSentAt: null, createdById: 'u1', createdAt: now, updatedAt: now, ...over,
  };
}

function attendee(over: Partial<AttendeeRecord>): AttendeeRecord {
  return { id: 'a', meetingId: 'm1', userId: null, externalName: null, externalEmail: null, role: 'REQUIRED', attendance: 'INVITED', department: null, createdAt: new Date(), ...over };
}

const directory: Record<string, { name: string; email: string }> = {
  u1: { name: 'Aisha Khan', email: 'aisha@mico360.test' },
  u2: { name: 'Khurram Admin', email: 'khurram@mico360.test' },
};

function makeService(over: { meetingRow?: MeetingRecord; attendees?: AttendeeRecord[]; upcoming?: MeetingRecord[] } = {}) {
  const row = over.meetingRow ?? meeting();
  const email = {
    sendMeetingInvite: vi.fn(async (_email: string, _params: unknown, _ics: unknown) => {}),
    sendMeetingReminder: vi.fn(async (_email: string, _params: unknown) => {}),
    sendMeetingCancelled: vi.fn(async (_email: string, _params: unknown, _ics: unknown) => {}),
    sendMeetingMinutes: vi.fn(async (_email: string, _params: unknown, _pdf: unknown) => {}),
  };
  const meetings = {
    findById: vi.fn(async (id: string) => (id === row.id ? row : null)),
    markInvitesSent: vi.fn(async () => {}),
    markReminderSent: vi.fn(async () => {}),
    listUpcomingWithoutReminder: vi.fn(async () => over.upcoming ?? []),
  };
  const attendees = { listByMeeting: vi.fn(async () => over.attendees ?? []) };
  const svc = createMeetingNotifyService({
    meetings: meetings as never,
    attendees,
    email,
    resolveUser: async (uid: string) => directory[uid] ?? null,
    resolveProjectName: async () => 'Falcon CRM',
    appUrl: 'https://app.mico360.test',
    now: () => new Date('2026-10-05T13:00:00Z'),
  });
  return { svc, email, meetings, attendees };
}

describe('MeetingNotifyService', () => {
  it('sends an invite with an .ics attachment to the organizer + attendees, deduped, and marks invitesSent', async () => {
    const { svc, email, meetings } = makeService({
      attendees: [attendee({ userId: 'u2' }), attendee({ userId: 'u1' }), attendee({ externalName: 'Guest', externalEmail: 'guest@ext.co', role: 'OPTIONAL' })],
    });
    const res = await svc.sendInvites('m1');
    // organizer (u1) + u2 + guest = 3 unique recipients (u1 attendee is deduped against organizer)
    expect(res.sent).toBe(3);
    expect(email.sendMeetingInvite).toHaveBeenCalledTimes(3);
    const emails = email.sendMeetingInvite.mock.calls.map((c) => c[0]).sort();
    expect(emails).toEqual(['aisha@mico360.test', 'guest@ext.co', 'khurram@mico360.test']);
    // the attachment is a text/calendar REQUEST .ics
    const ics = email.sendMeetingInvite.mock.calls[0]![2] as { contentType: string; filename: string; content: Buffer };
    expect(ics.contentType).toContain('text/calendar');
    expect(ics.filename).toMatch(/\.ics$/);
    expect(ics.content.toString('utf8')).toContain('METHOD:REQUEST');
    expect(ics.content.toString('utf8')).toContain('SUMMARY:Sprint Review');
    // the invite email params carry the app link + resolved project + when label
    const params = email.sendMeetingInvite.mock.calls[0]![1] as { link: string; projectName: string; whenLabel: string };
    expect(params.link).toBe('https://app.mico360.test/meetings/m1');
    expect(params.projectName).toBe('Falcon CRM');
    expect(params.whenLabel).toMatch(/2026/);
    expect(meetings.markInvitesSent).toHaveBeenCalledWith('m1', expect.any(Date));
  });

  it('skips attendees with no resolvable email', async () => {
    const { svc, email } = makeService({ attendees: [attendee({ userId: 'ghost' }), attendee({ externalName: 'No Email' })] });
    const res = await svc.sendInvites('m1');
    expect(res.sent).toBe(1); // only the organizer has an email
    expect(email.sendMeetingInvite).toHaveBeenCalledTimes(1);
  });

  it('sends a cancellation with a METHOD:CANCEL .ics', async () => {
    const { svc, email } = makeService({ attendees: [attendee({ userId: 'u2' })] });
    const res = await svc.sendCancellation('m1');
    expect(res.sent).toBe(2);
    const ics = email.sendMeetingCancelled.mock.calls[0]![2] as { content: Buffer };
    expect(ics.content.toString('utf8')).toContain('METHOD:CANCEL');
    expect(ics.content.toString('utf8')).toContain('STATUS:CANCELLED');
  });

  it('emails minutes with the PDF attached', async () => {
    const { svc, email } = makeService({ attendees: [attendee({ userId: 'u2' })] });
    const pdf = Buffer.from('%PDF-1.4 fake');
    const res = await svc.sendMinutes('m1', pdf);
    expect(res.sent).toBe(2);
    const att = email.sendMeetingMinutes.mock.calls[0]![2] as { contentType: string; content: Buffer };
    expect(att.contentType).toContain('application/pdf');
    expect(att.content).toBe(pdf);
  });

  it('reminder sweep sends to upcoming meetings and marks each reminded', async () => {
    const m = meeting({ id: 'm9' });
    const { svc, email, meetings } = makeService({ meetingRow: m, upcoming: [m] });
    // the sweep resolves attendees per meeting via the same attendees.listByMeeting
    const res = await svc.runReminderSweep(60 * 60 * 1000);
    expect(res.meetings).toBe(1);
    expect(email.sendMeetingReminder).toHaveBeenCalled();
    const params = email.sendMeetingReminder.mock.calls[0]![1] as { startsInLabel: string };
    expect(params.startsInLabel).toMatch(/start/i);
    expect(meetings.markReminderSent).toHaveBeenCalledWith('m9', expect.any(Date));
  });
});
