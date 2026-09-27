import { describe, it, expect, vi } from 'vitest';
import { createMeetingNotifyService } from './meeting-notify-service';
import type { MeetingRecord } from './meeting-repository';
import type { AttendeeRecord } from './attendee-repository';
import { EmailDeliveryError, EmailNotConfiguredError } from '../email/delivery-error';

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

function makeService(over: { meetingRow?: MeetingRecord; attendees?: AttendeeRecord[]; upcoming?: MeetingRecord[]; failFor?: (email: string) => Error | null } = {}) {
  const row = over.meetingRow ?? meeting();
  // Mirrors the email service contract: a failed delivery throws (EmailDeliveryError).
  const maybeFail = (to: string) => {
    const err = over.failFor?.(to);
    if (err) throw err;
  };
  const email = {
    sendMeetingInvite: vi.fn(async (to: string, _params: unknown, _ics: unknown) => maybeFail(to)),
    sendMeetingReminder: vi.fn(async (to: string, _params: unknown) => maybeFail(to)),
    sendMeetingCancelled: vi.fn(async (to: string, _params: unknown, _ics: unknown) => maybeFail(to)),
    sendMeetingMinutes: vi.fn(async (to: string, _params: unknown, _pdf: unknown) => maybeFail(to)),
  };
  const meetings = {
    findById: vi.fn(async (id: string) => (id === row.id ? row : null)),
    markInvitesSent: vi.fn(async () => {}),
    markReminderSent: vi.fn(async () => {}),
    listUpcomingWithoutReminder: vi.fn(async () => over.upcoming ?? []),
  };
  const attendees = { listByMeeting: vi.fn(async () => over.attendees ?? []) };
  const logger = { error: vi.fn(), warn: vi.fn() };
  const svc = createMeetingNotifyService({
    meetings: meetings as never,
    attendees,
    email,
    resolveUser: async (uid: string) => directory[uid] ?? null,
    resolveProjectName: async () => 'Falcon CRM',
    appUrl: 'https://app.mico360.test',
    defaultTimeZone: 'Asia/Muscat',
    logger,
    now: () => new Date('2026-10-05T13:00:00Z'),
  });
  return { svc, email, meetings, attendees, logger };
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

describe('MeetingNotifyService — delivery results (NTF-02)', () => {
  const guests = [attendee({ userId: 'u2' }), attendee({ externalName: 'Guest', externalEmail: 'guest@ext.co' })];

  it('reports sent/failed per recipient and still stamps invitesSentAt when some were delivered', async () => {
    const { svc, meetings, logger } = makeService({ attendees: guests, failFor: (to) => (to === 'guest@ext.co' ? new EmailDeliveryError(to, 400) : null) });
    expect(await svc.sendInvites('m1')).toEqual({ sent: 2, failed: 1 });
    expect(meetings.markInvitesSent).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not mark invitations sent when none were delivered', async () => {
    const { svc, meetings } = makeService({ attendees: guests, failFor: (to) => new EmailDeliveryError(to, 500) });
    expect(await svc.sendInvites('m1')).toEqual({ sent: 0, failed: 3 });
    expect(meetings.markInvitesSent).not.toHaveBeenCalled();
  });

  it('answers 503 when email is not configured at all, instead of "sent to 0"', async () => {
    const { svc, meetings } = makeService({ attendees: guests, failFor: (to) => new EmailNotConfiguredError(to) });
    await expect(svc.sendInvites('m1')).rejects.toMatchObject({ status: 503 });
    await expect(svc.sendMinutes('m1', Buffer.from('%PDF'))).rejects.toMatchObject({ status: 503 });
    expect(meetings.markInvitesSent).not.toHaveBeenCalled();
  });

  it('refuses to send invitations for a cancelled meeting', async () => {
    const { svc, email } = makeService({ meetingRow: meeting({ status: 'CANCELLED' }) });
    await expect(svc.sendInvites('m1')).rejects.toMatchObject({ status: 409 });
    expect(email.sendMeetingInvite).not.toHaveBeenCalled();
  });

  it('counts cancellation and minutes results too', async () => {
    const { svc } = makeService({ attendees: guests, failFor: (to) => (to === 'khurram@mico360.test' ? new EmailDeliveryError(to) : null) });
    expect(await svc.sendCancellation('m1')).toEqual({ sent: 2, failed: 1 });
    expect(await svc.sendMinutes('m1', Buffer.from('%PDF'))).toEqual({ sent: 2, failed: 1 });
  });

  it('leaves the reminder unmarked when every send failed, so the next sweep retries', async () => {
    const m = meeting({ id: 'm9' });
    const { svc, meetings } = makeService({ meetingRow: m, upcoming: [m], failFor: (to) => new EmailDeliveryError(to, 500) });
    expect(await svc.runReminderSweep(60 * 60 * 1000)).toEqual({ meetings: 1, sent: 0, failed: 1 });
    expect(meetings.markReminderSent).not.toHaveBeenCalled();
  });
});

describe('MeetingNotifyService — time zones and resilience (MTG-01/03)', () => {
  it('formats times in the company zone when the meeting has none', async () => {
    const { svc, email } = makeService({ meetingRow: meeting({ timeZone: null, startAt: new Date('2026-10-05T06:00:00Z'), endAt: new Date('2026-10-05T07:00:00Z') }) });
    await svc.sendInvites('m1');
    const params = email.sendMeetingInvite.mock.calls[0]![1] as { whenLabel: string };
    expect(params.whenLabel).toContain('10:00 AM – 11:00 AM');
    expect(params.whenLabel).toMatch(/GMT\+4/);
  });

  it('falls back to the company zone for an invalid stored zone instead of failing', async () => {
    const { svc, email } = makeService({ meetingRow: meeting({ timeZone: 'Muscat', startAt: new Date('2026-10-05T06:00:00Z'), endAt: null }) });
    await expect(svc.sendInvites('m1')).resolves.toEqual({ sent: 1, failed: 0 });
    expect((email.sendMeetingInvite.mock.calls[0]![1] as { whenLabel: string }).whenLabel).toContain('10:00 AM');
  });

  it('keeps sweeping other meetings when one meeting fails', async () => {
    const broken = meeting({ id: 'broken' });
    const fine = meeting({ id: 'fine' });
    const { svc, meetings, attendees, logger } = makeService({ upcoming: [broken, fine] });
    attendees.listByMeeting.mockImplementationOnce(async () => { throw new Error('directory down'); });
    const res = await svc.runReminderSweep(60 * 60 * 1000);
    expect(res.meetings).toBe(2);
    expect(meetings.markReminderSent).toHaveBeenCalledWith('fine', expect.any(Date));
    expect(meetings.markReminderSent).not.toHaveBeenCalledWith('broken', expect.any(Date));
    expect(logger.error).toHaveBeenCalledWith('meeting reminder failed', expect.objectContaining({ meetingId: 'broken' }));
  });

  it('anchors a recurring invitation in the meeting zone and omits a paused rule (MTG-09)', async () => {
    const recurring = makeService({ meetingRow: meeting({ timeZone: 'Asia/Muscat', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } }) });
    await recurring.svc.sendInvites('m1');
    const ics = (recurring.email.sendMeetingInvite.mock.calls[0]![2] as { content: Buffer }).content.toString('utf8');
    expect(ics).toContain('DTSTART;TZID=Asia/Muscat:20261005T180000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    const paused = makeService({ meetingRow: meeting({ timeZone: 'Asia/Muscat', recurrenceRule: { freq: 'WEEKLY', interval: 1, paused: true } }) });
    await paused.svc.sendInvites('m1');
    expect((paused.email.sendMeetingInvite.mock.calls[0]![2] as { content: Buffer }).content.toString('utf8')).not.toContain('RRULE');
  });
});

describe('MeetingNotifyService — attendee removed (MTG-02)', () => {
  it('retracts the invitation from just that attendee once invites went out', async () => {
    const removed = attendee({ userId: 'u2' });
    const { svc, email } = makeService({ meetingRow: meeting({ invitesSentAt: new Date('2026-10-01T00:00:00Z') }), attendees: [attendee({ externalName: 'Guest', externalEmail: 'guest@ext.co' })] });
    expect(await svc.sendAttendeeRemoved('m1', removed)).toEqual({ sent: 1, failed: 0 });
    expect(email.sendMeetingCancelled).toHaveBeenCalledTimes(1);
    expect(email.sendMeetingCancelled.mock.calls[0]![0]).toBe('khurram@mico360.test');
    const ics = (email.sendMeetingCancelled.mock.calls[0]![2] as { content: Buffer }).content.toString('utf8').replace(/\r\n[ \t]/g, '');
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('mailto:khurram@mico360.test');
    expect(ics).not.toContain('guest@ext.co');
  });

  it('sends nothing when invitations were never sent', async () => {
    const { svc, email } = makeService();
    expect(await svc.sendAttendeeRemoved('m1', attendee({ userId: 'u2' }))).toEqual({ sent: 0, failed: 0 });
    expect(email.sendMeetingCancelled).not.toHaveBeenCalled();
  });
});
