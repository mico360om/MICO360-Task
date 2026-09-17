import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { MeetingNotifyService } from './meeting-notify-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function meetingRepo() {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  const repo: MeetingRepository = {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = {
        id: `m${seq++}`, title: d.title, description: null, category: null, status: d.status ?? 'DRAFT', projectId: d.projectId ?? null,
        organizerId: d.organizerId, location: null, onlineLink: null, startAt: d.startAt, endAt: null, timeZone: null, recurrenceRule: null,
        recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now,
      };
      rows.set(rec.id, rec); return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent(id, at) { const r = rows.get(id); if (r) r.invitesSentAt = at; },
    async markReminderSent(id, at) { const r = rows.get(id); if (r) r.reminderSentAt = at; },
    async listUpcomingWithoutReminder() { return []; },
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: [] } : null; },
  };
  return repo;
}

const tokenService = createTokenService({
  accessSecret: 'ntf-access', refreshSecret: 'ntf-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

async function makeApp(withNotify: boolean) {
  const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
  const meetings = meetingRepo();
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess: { async canViewProject() { return false; }, async accessibleProjectIds() { return []; } } });
  const notify = {
    sendInvites: vi.fn(async () => ({ sent: 3 })),
    sendCancellation: vi.fn(async () => ({ sent: 3 })),
    sendMinutes: vi.fn(async () => ({ sent: 3 })),
    runReminderSweep: vi.fn(async () => ({ meetings: 0, sent: 0 })),
  } as unknown as MeetingNotifyService;
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, ...(withNotify ? { meetingNotifyService: notify } : {}) });
  return { app, notify, meetings };
}

async function makeMeeting(app: Awaited<ReturnType<typeof makeApp>>['app'], owner: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor(owner, ['EMPLOYEE'])}` }, payload: { title: 'Weekly', startAt: '2026-10-05T09:00:00Z' } });
  return res.json().data.id as string;
}

describe('Meeting invite/cancel routes', () => {
  it('sends invites for the organizer and returns the count', async () => {
    const { app, notify } = await makeApp(true);
    const id = await makeMeeting(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/invites`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sent).toBe(3);
    expect(notify.sendInvites).toHaveBeenCalledWith(id);
  });

  it('forbids an outsider from sending invites (403)', async () => {
    const { app, notify } = await makeApp(true);
    const id = await makeMeeting(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/invites`, headers: { authorization: `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(403);
    expect(notify.sendInvites).not.toHaveBeenCalled();
  });

  it('returns 503 when email is not configured', async () => {
    const { app } = await makeApp(false);
    const id = await makeMeeting(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/invites`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(503);
  });

  it('sends a cancellation notice on cancel only when invites had been sent', async () => {
    const { app, notify, meetings } = await makeApp(true);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const noInvites = await makeMeeting(app, 'u1');
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${noInvites}/cancel`, headers: { authorization: auth } });
    expect(notify.sendCancellation).not.toHaveBeenCalled();

    const withInvites = await makeMeeting(app, 'u1');
    await meetings.markInvitesSent(withInvites, new Date());
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${withInvites}/cancel`, headers: { authorization: auth } });
    expect(notify.sendCancellation).toHaveBeenCalledWith(withInvites);
  });
});
