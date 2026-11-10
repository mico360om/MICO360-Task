import { describe, it, expect, vi } from 'vitest';
import { inspectPdf } from '../../lib/pdf-inspect';
import { solidPng } from '../../lib/test-images';
import { buildApp } from '../../app';
import { createMemoryFinalMinutesRepository } from './final-minutes-repository';
import { createMemoryMinutesSendRepository } from './minutes-send-repository';
import { HttpError, ValidationError } from '../../lib/http-errors';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createAttendeeService } from './attendee-service';
import { createAgendaService } from './agenda-service';
import { createNoteService } from './note-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { AttendeeRepository, AttendeeRecord, CreateAttendeeData, UpdateAttendeeData } from './attendee-repository';
import type { AgendaRepository, AgendaItemRecord, CreateAgendaData, UpdateAgendaData } from './agenda-repository';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMemoryAiJobStore } from '../ai-jobs/ai-job-store';
import { createAiJobRunner } from '../ai-jobs/ai-job-runner';
import { createFinalMinutesAi } from './final-minutes-ai';
import { AiRateLimitedError } from '../ai/ai-limits';
import { AiTimeoutError } from '../ai/ai-network';
import { ProviderRefusedError } from '../ai/ai-completion';

function meetingRepo(attendeesOf: Record<string, string[]> = {}): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  return {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = {
        id: `m${seq++}`, title: d.title, description: d.description ?? null, category: null, status: d.status ?? 'DRAFT',
        projectId: d.projectId ?? null, organizerId: d.organizerId, location: d.location ?? null, onlineLink: d.onlineLink ?? null,
        startAt: d.startAt, endAt: d.endAt ?? null, timeZone: d.timeZone ?? null, recurrenceRule: null, recurrenceParentId: null,
        templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent() {},
    async markReminderSent() {},
   
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: attendeesOf[id] ?? [] } : null; },
  };
}
function attendeeRepo(): AttendeeRepository {
  const rows = new Map<string, AttendeeRecord>();
  let seq = 0;
  return {
    async add(d: CreateAttendeeData) {
      const rec: AttendeeRecord = { id: `a${seq++}`, meetingId: d.meetingId, userId: d.userId ?? null, externalName: d.externalName ?? null, externalEmail: d.externalEmail ?? null, role: d.role ?? 'REQUIRED', attendance: d.attendance ?? 'INVITED', department: d.department ?? null, response: 'PENDING', respondedAt: null, invitedAt: null, createdAt: new Date() };
      rows.set(rec.id, rec); return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId); },
    async distinctUserIdsForMeetings() { return []; },
    async update(id, patch: UpdateAttendeeData) { const u = { ...rows.get(id)!, ...patch } as AttendeeRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}
function agendaRepo(): AgendaRepository {
  const rows = new Map<string, AgendaItemRecord>();
  let seq = 0;
  return {
    async add(d: CreateAgendaData) { const rec: AgendaItemRecord = { id: `g${seq++}`, meetingId: d.meetingId, title: d.title, ownerId: d.ownerId ?? null, expectedMinutes: d.expectedMinutes ?? null, position: d.position, completed: false, linkedPrevActionId: d.linkedPrevActionId ?? null, createdAt: new Date() }; rows.set(rec.id, rec); return rec; },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId).sort((a, b) => a.position - b.position); },
    async update(id, patch: UpdateAgendaData) { const u = { ...rows.get(id)!, ...patch } as AgendaItemRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
    async setPositions(updates) { for (const u of updates) { const r = rows.get(u.id); if (r) r.position = u.position; } },
  };
}
function noteRepo(): NoteRepository {
  const rows = new Map<string, NoteRecord>();
  const deleted = new Set<string>();
  let seq = 0;
  return {
    async add(d: CreateNoteData) { const rec: NoteRecord = { id: `n${seq++}`, meetingId: d.meetingId, agendaItemId: d.agendaItemId ?? null, authorId: d.authorId, type: d.type, body: d.body, highlighted: d.highlighted ?? false, taskId: null, actionItemId: null, decisionId: null, createdAt: new Date(), editedAt: null }; rows.set(rec.id, rec); return rec; },
    async findById(id) { return deleted.has(id) ? null : rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((n) => n.meetingId === meetingId && !deleted.has(n.id)); },
    async update(id, patch: UpdateNoteData) { const u = { ...rows.get(id)!, ...patch } as NoteRecord; rows.set(id, u); return u; },
    async remove(id) { deleted.add(id); },
    async findDeleted(id) { return deleted.has(id) ? rows.get(id) ?? null : null; },
    async restore(id) { deleted.delete(id); return rows.get(id)!; },
    async claimTask() { return false; },
    async releaseTaskClaim() {},
  };
}

const tokenService = createTokenService({
  accessSecret: 'min-access', refreshSecret: 'min-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

async function makeApp(attendeesOf: Record<string, string[]> = {}, actionItemService?: unknown, meetingNotifyService?: unknown, extra: Record<string, unknown> = {}, projectVisible = false) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const meetings = meetingRepo(attendeesOf);
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess: { async canViewProject() { return projectVisible; }, async accessibleProjectIds() { return projectVisible ? ['p1'] : []; } } });
  const attendeeService = createAttendeeService({ attendees: attendeeRepo() });
  const agendaService = createAgendaService({ agenda: agendaRepo() });
  const noteService = createNoteService({ notes: noteRepo() });
  const resolveUserNames = async (ids: string[]) => new Map(ids.map((i) => [i, `User ${i}`]));
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, attendeeService, agendaService, noteService, resolveUserNames, actionItemService: actionItemService as never, meetingNotifyService: meetingNotifyService as never, resolveTaskKeys: async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, `KEY-${i}`])), appConfig: { timeZone: 'UTC', productName: 'MICO360', companyName: 'MICO360 Softwares' }, ...extra });
  return app;
}

describe('Minutes PDF route', () => {
  it('returns a PDF with the right content-type and filename for an authorized viewer', async () => {
    const app = await makeApp();
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Q4 Planning Sync', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'Review outcomes' } });
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: auth }, payload: { body: 'Adopt sprint cadence', type: 'DECISION' } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('minutes-q4-planning-sync.pdf');
    const body = res.rawPayload.toString('latin1');
    expect(body.startsWith('%PDF-1.')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('puts the meeting’s action items in the minutes', async () => {
    const actionItemService = {
      listByMeeting: async (meetingId: string) => [
        { id: 'a1', meetingId, description: 'Book the conference room', assigneeId: 'u7', priority: 'HIGH', status: 'IN_PROGRESS', dueDate: new Date('2026-10-05T00:00:00Z') },
      ],
    };
    const app = await makeApp({}, actionItemService);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Q4 Planning Sync', startAt: '2026-10-01T09:00:00Z' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    const text = inspectPdf(res.rawPayload).pages.flat();
    expect(text).toContain('Action Items');
    expect(text).toContain('Book the conference room');
    expect(text).toEqual(expect.arrayContaining(['User u7', 'In progress', 'High']));
    // Day-month-year; still open, so marked Overdue once 5 Oct has passed (the PDF is made today).
    expect(text.some((l) => /^5 Oct 2026( · Overdue)?$/.test(l))).toBe(true);
  });

  it('prints an action item’s due day in the meeting’s time zone (a due date stored as local midnight is not a day early)', async () => {
    const actionItemService = {
      listByMeeting: async (meetingId: string) => [
        // 10 Oct 2026 00:00 in Muscat (UTC+4) = 9 Oct 20:00 UTC.
        { id: 'a1', meetingId, description: 'Send the revised quote', assigneeId: 'u7', priority: 'NORMAL', status: 'OPEN', dueDate: new Date('2026-10-09T20:00:00Z') },
      ],
    };
    const app = await makeApp({}, actionItemService);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Pricing review', startAt: '2026-10-01T09:00:00Z', timeZone: 'Asia/Muscat' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    const text = inspectPdf(res.rawPayload).pages.flat();
    expect(text.some((l) => l.includes('Send the revised quote'))).toBe(true);
    expect(text.some((l) => l.includes('10 Oct 2026'))).toBe(true);
    expect(text.some((l) => l.includes('9 Oct 2026'))).toBe(false);
  });

  it('names each action item’s task, and doesn’t print a tracked action note twice', async () => {
    const actionItemService = {
      listByMeeting: async (meetingId: string) => [
        { id: 'a1', meetingId, description: 'Order the banners', assigneeId: null, priority: 'NORMAL', status: 'OPEN', dueDate: null, taskId: 't9', sourceNoteId: null },
      ],
    };
    const app = await makeApp({}, actionItemService);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Launch prep', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    const note = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: auth }, payload: { body: 'Order the banners', type: 'ACTION' } })).json().data;
    // The fake action item came from this note.
    actionItemService.listByMeeting = async (meetingId: string) => [
      { id: 'a1', meetingId, description: 'Order the banners', assigneeId: null, priority: 'NORMAL', status: 'OPEN', dueDate: null, taskId: 't9', sourceNoteId: note.id },
    ];
    const text = inspectPdf((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes.pdf`, headers: { authorization: auth } })).rawPayload).pages.flat();
    expect(text).toContain('KEY-t9');
    expect(text.filter((l) => l === 'Order the banners')).toHaveLength(1);
  });

  it('hides the minutes from an outsider (404)', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` }, payload: { title: 'Private', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes.pdf`, headers: { authorization: `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe('Minutes email route', () => {
  it('lets only a meeting editor email the minutes to everyone (SEC-06)', async () => {
    const attendeesOf: Record<string, string[]> = {};
    const app = await makeApp(attendeesOf);
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    attendeesOf[id] = ['u2'];
    const attendee = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` } });
    expect(attendee.statusCode).toBe(403);
    // The organizer passes the permission check (then hits "email not configured" in this app).
    const organizer = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(organizer.statusCode).toBe(503);
  });

  function notifyFake() {
    return {
      sendMinutes: vi.fn(async () => ({ sent: 1, failed: 0, recipients: [], skipped: [] })),
      previewMinutes: vi.fn(async () => ({ subject: 'Minutes: Board sync', html: '<p>Board sync</p>', text: 'Board sync', attachmentName: 'minutes-board-sync.pdf', recipients: [], missingEmail: [] })),
    };
  }

  it('emails the minutes only to the people the organizer picked', async () => {
    const notify = notifyFake();
    const app = await makeApp({}, undefined, notify);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth }, payload: { recipients: ['a@x.co'] } });
    expect(res.statusCode).toBe(200);
    expect(notify.sendMinutes).toHaveBeenCalledWith(id, expect.any(Buffer), { only: ['a@x.co'], attachmentFor: expect.any(Function) });
    // Companies: each of the meeting's users is asked about; without companies everyone sees it in
    // full, so everyone gets the shared PDF (undefined), as before.
    const { attachmentFor } = (notify.sendMinutes.mock.calls[0] as unknown as [string, Buffer, { attachmentFor: (u: string) => Promise<unknown> }])[2];
    expect(await attachmentFor('u1')).toBeUndefined();
    // No list = everyone, as before.
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth } });
    expect(notify.sendMinutes).toHaveBeenLastCalledWith(id, expect.any(Buffer), { attachmentFor: expect.any(Function) });
  });

  // 1.23 security review: a client attendee never gets the team's minutes. Only the client copy of
  // approved minutes shown to them (with the Meetings module), in an email of its own — else nothing.
  it('a client gets the client copy of shown minutes in their own email, otherwise nothing', async () => {
    const notify = notifyFake();
    const clientPdf = Buffer.from('%PDF-client-copy');
    const allowed = new Set<string>(['c-ok']);
    const app = await makeApp({}, undefined, notify, {
      userState: async (u: string) => ({ tokenVersion: 0, active: true, roles: u.startsWith('c-') ? ['CLIENT'] : ['EMPLOYEE'] }),
      clientMinutes: { mayHave: async (_m: string, u: string) => allowed.has(u), pdf: async (_m: string, u: string) => (allowed.has(u) ? clientPdf : null) },
    });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth } })).statusCode).toBe(200);
    const { attachmentFor } = (notify.sendMinutes.mock.calls[0] as unknown as [string, Buffer, { attachmentFor: (u: string) => Promise<unknown> }])[2];
    expect(await attachmentFor('u1')).toBeUndefined(); // staff: the shared email, as before
    expect(await attachmentFor('c-no')).toBeNull(); // no access: nothing at all
    expect(await attachmentFor('c-ok')).toEqual(clientPdf); // the client copy, in an email of their own
    await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes/preview`, headers: { authorization: auth } });
    const { copyOf } = (notify.previewMinutes.mock.calls[0] as unknown as [string, { copyOf: (u: string) => Promise<string> }])[1];
    expect([await copyOf('u1'), await copyOf('c-no'), await copyOf('c-ok')]).toEqual(['shared', 'none', 'own']);
  });

  // 1.23.7: approved minutes are a notification kind a client may switch off (and "Receive notifications"
  // on their grant): then no copy goes — the preview, the send report and the log say why — and a client
  // who got their copy gets its line on the portal bell.
  it('a client whose minutes are off gets no copy (copy "off", with why); one who got theirs is told on the bell', async () => {
    const notify = notifyFake();
    notify.sendMinutes.mockImplementation(async () => ({
      sent: 1,
      failed: 0,
      recipients: [
        { name: 'C Ok', email: 'ok@c.test', kind: 'member', ok: true, line: 'to', copy: 'own', userId: 'c-ok' },
        { name: 'C Off', email: 'off@c.test', kind: 'member', ok: false, notSent: true, error: 'not sent — the client turned these off', line: 'to', copy: 'own', userId: 'c-off' },
      ],
      skipped: [],
    }) as never);
    const clientPdf = Buffer.from('%PDF-client-copy');
    const told: string[] = [];
    const sends = { create: vi.fn(async () => ({})), listByMeeting: async () => [], suggestions: async () => [] };
    const app = await makeApp({}, undefined, notify, {
      userState: async (u: string) => ({ tokenVersion: 0, active: true, roles: u.startsWith('c-') ? ['CLIENT'] : ['EMPLOYEE'] }),
      minutesSendRepository: sends,
      clientMinutes: {
        mayHave: async () => true,
        pdf: async () => clientPdf,
        notSent: async (_m: string, u: string) => (u === 'c-off' ? 'not sent — the client turned these off' : null),
        sent: async (_m: string, u: string) => void told.push(u),
      },
    });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    const r = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth } });
    expect(r.statusCode).toBe(200);
    const { attachmentFor } = (notify.sendMinutes.mock.calls[0] as unknown as [string, Buffer, { attachmentFor: (u: string) => Promise<unknown> }])[2];
    expect(await attachmentFor('c-off')).toEqual({ notSent: 'not sent — the client turned these off' });
    expect(await attachmentFor('c-ok')).toEqual(clientPdf);
    expect(told).toEqual(['c-ok']);
    // The log keeps the reason beside the address.
    expect(sends.create).toHaveBeenCalledWith(expect.objectContaining({ results: expect.arrayContaining([{ email: 'off@c.test', ok: false, notSent: true, error: 'not sent — the client turned these off' }]) }));
    await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes/preview`, headers: { authorization: auth } });
    const { copyOf } = (notify.previewMinutes.mock.calls[0] as unknown as [string, { copyOf: (u: string) => Promise<string> }])[1];
    expect([await copyOf('c-ok'), await copyOf('c-off')]).toEqual(['own', 'off']);
  });

  it('without the companies rules a client still never gets the shared minutes', async () => {
    const notify = notifyFake();
    const app = await makeApp({}, undefined, notify, { userState: async (u: string) => ({ tokenVersion: 0, active: true, roles: u.startsWith('c-') ? ['CLIENT'] : ['EMPLOYEE'] }) });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth } });
    const { attachmentFor } = (notify.sendMinutes.mock.calls[0] as unknown as [string, Buffer, { attachmentFor: (u: string) => Promise<unknown> }])[2];
    expect(await attachmentFor('c-x')).toBeNull();
  });

  it('previews the minutes email for a meeting editor only', async () => {
    const attendeesOf: Record<string, string[]> = {};
    const notify = notifyFake();
    const app = await makeApp(attendeesOf, undefined, notify);
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    attendeesOf[id] = ['u2'];
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes/preview`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.subject).toBe('Minutes: Board sync');
    expect(notify.sendMinutes).not.toHaveBeenCalled();
    const attendee = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes/preview`, headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` } });
    expect(attendee.statusCode).toBe(403);
  });

  it('the preview says which copy each of the meeting’s users gets (without companies: the shared email)', async () => {
    const notify = notifyFake();
    const app = await makeApp({}, undefined, notify);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes/preview`, headers: { authorization: auth } });
    const opts = (notify.previewMinutes.mock.calls[0] as unknown as [string, { copyOf: (u: string) => Promise<string> }])[1];
    expect(await opts.copyOf('u1')).toBe('shared');
    expect(await opts.copyOf('u7')).toBe('shared');
  });
});

describe('Minutes email route: To, Cc and the sent log (1.22)', () => {
  const report = {
    sent: 2,
    failed: 1,
    skipped: [],
    recipients: [
      { name: 'User u1', email: 'u1@x.co', kind: 'organizer', ok: true, line: 'to', copy: 'shared', userId: 'u1' },
      { name: 'client@outside.co', email: 'client@outside.co', kind: 'guest', ok: true, line: 'to', copy: 'shared' },
      { name: 'boss@outside.co', email: 'boss@outside.co', kind: 'guest', ok: false, error: 'The mail server didn’t accept it.', line: 'cc', copy: 'shared' },
    ],
  };
  async function sendingApp(sendMinutes: (...a: unknown[]) => Promise<unknown> = async () => report) {
    const notify = { sendMinutes: vi.fn(sendMinutes), previewMinutes: vi.fn(async () => ({})) };
    const sends = createMemoryMinutesSendRepository();
    const audit = { record: vi.fn(async () => ({})), list: async () => [], modules: async () => [] };
    // The invite picker offers nobody here: a picked colleague other than the meeting's own people is refused.
    const invitees = {
      candidates: async () => [],
      assertInvitable: vi.fn(async (_viewer: unknown, _target: unknown, ids: readonly string[]) => {
        if (ids.length) throw new ValidationError(`User ${ids[0]} can’t be invited: they aren’t in this meeting’s companies.`);
      }),
    };
    const app = await makeApp({}, undefined, notify, { minutesSendRepository: sends, auditService: audit, meetingInvitees: invitees });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Board sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id as string;
    const send = (payload: unknown) => app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth }, payload: payload as object });
    const get = async (path: string, who = 'u1') => app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes/${path}`, headers: { authorization: `Bearer ${await tokenFor(who, ['EMPLOYEE'])}` } });
    return { app, notify, sends, audit, invitees, id, send, get };
  }

  it('sends to the To and Cc chosen, keeps the send in the meeting’s log, and records it in the audit log', async () => {
    const { notify, audit, id, send, get } = await sendingApp();
    const res = await send({ to: [{ email: 'u1@x.co' }, { email: 'client@outside.co' }], cc: [{ email: 'boss@outside.co' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ sent: 2, failed: 1 });
    expect(notify.sendMinutes).toHaveBeenCalledWith(id, expect.any(Buffer), {
      to: [{ email: 'u1@x.co' }, { email: 'client@outside.co' }],
      cc: [{ email: 'boss@outside.co' }],
      attachmentFor: expect.any(Function),
    });
    const log = await get('sends');
    expect(log.statusCode).toBe(200);
    expect(log.json().data).toEqual([
      {
        id: expect.any(String),
        sentAt: expect.any(String),
        sentBy: { id: 'u1', name: 'User u1' },
        final: false,
        to: [
          { email: 'u1@x.co', name: 'User u1', userId: 'u1', copy: 'shared', ok: true },
          { email: 'client@outside.co', name: null, copy: 'shared', ok: true },
        ],
        cc: [{ email: 'boss@outside.co', name: null, copy: 'shared', ok: false, error: 'The mail server didn’t accept it.' }],
      },
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        module: 'meetings',
        action: 'meeting.minutes.send',
        entityId: id,
        newValue: { final: false, to: ['u1@x.co', 'client@outside.co'], cc: ['boss@outside.co'], sent: 2, failed: 1 },
      }),
    );
  });

  it('lists the sends newest first', async () => {
    const { send, get } = await sendingApp();
    await send({ to: [{ email: 'u1@x.co' }] });
    await new Promise((r) => setTimeout(r, 5));
    await send({ to: [{ email: 'client@outside.co' }] });
    const sentAt = (await get('sends')).json().data.map((s: { sentAt: string }) => Date.parse(s.sentAt));
    expect(sentAt).toHaveLength(2);
    expect(sentAt[0]).toBeGreaterThan(sentAt[1]);
  });

  it('the log and the Cc suggestions are for the people who may send', async () => {
    const { send, get } = await sendingApp();
    await send({ to: [{ email: 'u1@x.co' }], cc: [{ email: 'boss@outside.co' }] });
    expect((await get('sends', 'u2')).statusCode).toBe(403);
    expect((await get('suggestions', 'u2')).statusCode).toBe(403);
    const suggested = await get('suggestions');
    expect(suggested.statusCode).toBe(200);
    expect(suggested.json().data).toEqual([
      { email: 'u1@x.co', name: 'User u1' },
      { email: 'client@outside.co', name: null },
      { email: 'boss@outside.co', name: null },
    ]);
  });

  it('checks every address as an email, at most 50, and To can’t be empty', async () => {
    const { notify, send } = await sendingApp();
    const many = Array.from({ length: 51 }, (_, i) => ({ email: `p${i}@outside.co` }));
    expect((await send({ to: many })).statusCode).toBe(400);
    expect((await send({ to: [{ email: 'not an address' }] })).statusCode).toBe(400);
    expect((await send({ to: [] })).statusCode).toBe(400);
    expect((await send({ cc: [{ email: 'boss@outside.co' }] })).statusCode).toBe(400);
    expect(notify.sendMinutes).not.toHaveBeenCalled();
  });

  it('a colleague picked by name must be one the invite picker offers (the meeting’s own people always are)', async () => {
    const { notify, invitees, send, get } = await sendingApp();
    const refused = await send({ to: [{ email: 'u1@x.co' }], cc: [{ userId: 'u9' }] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/User u9 can’t be invited/);
    expect(notify.sendMinutes).not.toHaveBeenCalled();
    expect((await send({ to: [{ userId: 'u1' }] })).statusCode).toBe(200); // the organizer
    expect(invitees.assertInvitable).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), ['u9']);
    expect((await get('sends')).json().data).toHaveLength(1);
  });

  it('nothing is logged when nothing could be sent (email isn’t set up)', async () => {
    const { send, get } = await sendingApp(async () => {
      throw new HttpError('Email sending is not configured, so nothing was sent.', 'EMAIL_NOT_CONFIGURED', 503);
    });
    expect((await send({ to: [{ email: 'u1@x.co' }] })).statusCode).toBe(503);
    expect((await get('sends')).json().data).toEqual([]);
  });

  it('the email still counts as sent when the log can’t be written', async () => {
    const { sends, send } = await sendingApp();
    sends.create = async () => {
      throw new Error('database away');
    };
    const res = await send({ to: [{ email: 'u1@x.co' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ sent: 2 });
  });
});

describe('Minutes PDF route: the meeting’s status', () => {
  const statusLine = (pdf: Buffer) => {
    const text = inspectPdf(pdf).pages.flat();
    return text[text.indexOf('Status') + 1];
  };
  async function pdfFor(startAt: string, endAt?: string, status?: string) {
    const app = await makeApp();
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt, ...(endAt ? { endAt } : {}), status: status ?? 'SCHEDULED' } });
    expect(created.statusCode).toBe(201);
    return (await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } })).rawPayload;
  }

  it('says Completed for a scheduled meeting that is already over, even before the sweep closes it', async () => {
    expect(statusLine(await pdfFor('2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'))).toBe('Completed');
    expect(statusLine(await pdfFor('2026-10-01T09:00:00Z'))).toBe('Completed'); // no end: an hour
  });

  it('keeps Scheduled for a meeting still to come, and Cancelled for a cancelled one', async () => {
    const soon = new Date(Date.now() + 864e5).toISOString();
    expect(statusLine(await pdfFor(soon))).toBe('Scheduled');
    expect(statusLine(await pdfFor('2026-10-01T09:00:00Z', undefined, 'CANCELLED'))).toBe('Cancelled');
  });
});

describe('Minutes PDF route: the project header', () => {
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

  it('prints the project’s picture, code and number at the top of a project meeting’s minutes', async () => {
    const read: string[] = [];
    const app = await makeApp({}, undefined, undefined, {
      resolveProject: async () => ({ name: 'Falcon CRM', code: 'FAL', number: 'PDO-2026-014', clientName: 'Acme Corp', status: 'ACTIVE', ownerId: null, startDate: null, targetDate: null, color: '#1E5A8B', imageUrl: '/uploads/projects/falcon.jpg' }),
      readProjectImage: async (url: string) => { read.push(url); return jpeg; },
    }, true);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z', projectId: 'p1' } });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    const { pages, contents } = inspectPdf(res.rawPayload);
    expect(read).toEqual(['/uploads/projects/falcon.jpg']);
    // Its code, number and client are among the facts under the title.
    expect(pages[0]).toEqual(expect.arrayContaining(['Code', 'FAL', 'Project no.', 'PDO-2026-014', 'Client', 'Acme Corp']));
    expect(contents[0]).toMatch(/\/I\d+ Do/);
  });

  it('prints a picture the PDF can’t take as stored (WebP) once it is converted', async () => {
    const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1');
    const converted: Buffer[] = [];
    const app = await makeApp({}, undefined, undefined, {
      resolveProject: async () => ({ name: 'Falcon CRM', code: 'FAL', clientName: null, status: 'ACTIVE', ownerId: null, startDate: null, targetDate: null, color: '#1E5A8B', imageUrl: '/uploads/projects/falcon.webp' }),
      readProjectImage: async () => webp,
      printableProjectImage: async (raw: Buffer) => { converted.push(raw); return jpeg; },
    }, true);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z', projectId: 'p1' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    const { pages, contents } = inspectPdf(res.rawPayload);
    expect(converted).toEqual([webp]);
    expect(contents[0]).toMatch(/\/I\d+ Do/);
    expect(pages[0]).not.toContain('FC');
  });

  it('prints the project’s icon when it has no picture', async () => {
    const app = await makeApp({}, undefined, undefined, {
      resolveProject: async () => ({ name: 'Falcon CRM', code: 'FAL', clientName: null, status: 'ACTIVE', ownerId: null, startDate: null, targetDate: null, color: '#1E5A8B', icon: 'rocket', imageUrl: null }),
      readProjectImage: async () => { throw new Error('not read without a picture'); },
    }, true);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z', projectId: 'p1' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    const { pages, contents } = inspectPdf(res.rawPayload);
    expect(pages[0]).not.toContain('FC');
    expect(contents[0]).toMatch(/1 1 1 SCN\nS\n/);
  });

  it('still prints the minutes when the picture can’t be read', async () => {
    const app = await makeApp({}, undefined, undefined, {
      resolveProject: async () => ({ name: 'Falcon CRM', code: 'FAL', clientName: null, status: 'ACTIVE', ownerId: null, startDate: null, targetDate: null, imageUrl: '/uploads/gone.jpg' }),
      readProjectImage: async () => { throw new Error('ENOENT'); },
    }, true);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z', projectId: 'p1' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(inspectPdf(res.rawPayload).pages[0]).toContain('FC');
  });

  it('prints the initials, not an error, when the PDF can’t read the stored picture (a damaged JPEG)', async () => {
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xd9])]);
    const app = await makeApp({}, undefined, undefined, {
      resolveProject: async () => ({ name: 'Falcon CRM', code: 'FAL', clientName: null, status: 'ACTIVE', ownerId: null, startDate: null, targetDate: null, imageUrl: '/uploads/projects/falcon.jpg' }),
      readProjectImage: async () => damaged,
    }, true);
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z', projectId: 'p1' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(inspectPdf(res.rawPayload).pages[0]).toContain('FC');
  });
});

describe('Final minutes (Final MOM)', () => {
  async function setup(opts: { ai?: (facts: string) => Promise<unknown>; notify?: unknown; changed?: (meetingId: string) => void } = {}) {
    const attendeesOf: Record<string, string[]> = {};
    const aiFacts: string[] = [];
    const app = await makeApp(attendeesOf, undefined, opts.notify, {
      finalMinutesRepository: createMemoryFinalMinutesRepository(() => new Date('2026-10-14T08:00:00Z')),
      ...(opts.changed ? { onFinalMinutesChanged: opts.changed } : {}),
      draftMinutesWithAi: async (facts: string) => {
        aiFacts.push(facts);
        if (!opts.ai) throw new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
        return opts.ai(facts);
      },
    });
    const organizer = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const attendee = { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` };
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: organizer, payload: { title: 'Weekly review', startAt: '2026-10-14T06:00:00Z' } })).json().data.id as string;
    attendeesOf[id] = ['u2'];
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: organizer, payload: { type: 'DECISION', body: 'Go-live moves to 1 November.' } });
    const call = (method: 'GET' | 'POST' | 'PUT', path: string, who = organizer, payload?: unknown) =>
      app.inject({ method, url: `/api/v1/meetings/${id}${path}`, headers: who, ...(payload ? { payload: payload as Record<string, unknown> } : {}) });
    return { app, id, organizer, attendee, call, aiFacts };
  }
  const content = {
    summary: 'Progress was reviewed and go-live moved.',
    discussion: [{ topic: 'Go-live plan', text: 'The client needs time to test.' }],
    decisions: ['Go-live moves to 1 November.'],
    risks: ['Tablets may be late.'],
    nextSteps: ['Send the form — Bilal, by Oct 18'],
  };

  it('drafts them from the notes, keeps edits as a draft, then marks them final and locks them', async () => {
    const { call } = await setup();
    expect((await call('GET', '/final-minutes')).json().data).toMatchObject({ status: 'NONE', content: null, canEdit: true });
    const draft = await call('POST', '/final-minutes/draft', undefined, { source: 'notes' });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().data.content.decisions).toEqual(['Go-live moves to 1 November.']);
    expect((await call('GET', '/final-minutes')).json().data.status).toBe('NONE'); // a draft isn't kept until saved

    const saved = await call('PUT', '/final-minutes', undefined, { content });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ status: 'DRAFT', content, approvedBy: null });

    const final = await call('POST', '/final-minutes/approve');
    expect(final.json().data).toMatchObject({ status: 'FINAL', content, approvedBy: { id: 'u1', name: 'User u1' } });
    expect(final.json().data.approvedAt).toBeTruthy();

    const locked = await call('PUT', '/final-minutes', undefined, { content: { ...content, summary: 'Changed' } });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('FINAL_MINUTES_LOCKED');

    const reopened = await call('POST', '/final-minutes/reopen');
    expect(reopened.json().data).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
  });

  it('can approve what is on screen in one step, but not empty minutes', async () => {
    const { call } = await setup();
    expect((await call('POST', '/final-minutes/approve')).statusCode).toBe(400); // nothing saved yet
    const res = await call('POST', '/final-minutes/approve', undefined, { content });
    expect(res.json().data).toMatchObject({ status: 'FINAL', content });
  });

  // Pinned before the zod 4 upgrade (1.23.13): a save with no content in the body is refused with the minutes' own words.
  it('a save with nothing in the body is refused in words', async () => {
    const { call } = await setup();
    const res = await call('PUT', '/final-minutes', undefined, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({ code: 'VALIDATION', message: 'The minutes are not in the expected form.' });
  });

  it('drafts them with the AI from the meeting facts', async () => {
    const { call, aiFacts } = await setup({ ai: async () => ({ summary: ' A short meeting. ', decisions: ['Ship it'], extra: 1 }) });
    const res = await call('POST', '/final-minutes/draft', undefined, { source: 'ai' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toEqual({ summary: 'A short meeting.', discussion: [], decisions: ['Ship it'], risks: [], nextSteps: [] });
    expect(aiFacts[0]).toContain('Meeting: Weekly review');
    expect(aiFacts[0]).toContain('Go-live moves to 1 November.');
  });

  it('says why the AI could not draft them (so the notes can be used instead)', async () => {
    const { call } = await setup();
    const res = await call('POST', '/final-minutes/draft', undefined, { source: 'ai' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/AI is not configured/);
  });

  it('lets only the organizer (or another editor) write them; attendees see them once final', async () => {
    const { call, attendee } = await setup();
    await call('PUT', '/final-minutes', undefined, { content });
    expect((await call('GET', '/final-minutes', attendee)).json().data).toMatchObject({ status: 'NONE', content: null, canEdit: false });
    const writes: Array<['POST' | 'PUT', string, unknown]> = [
      ['POST', '/final-minutes/draft', { source: 'notes' }],
      ['PUT', '/final-minutes', { content }],
      ['POST', '/final-minutes/approve', undefined],
      ['POST', '/final-minutes/reopen', undefined],
    ];
    for (const [method, path, body] of writes) {
      expect((await call(method, path, attendee, body)).statusCode, path).toBe(403);
    }
    await call('POST', '/final-minutes/approve');
    expect((await call('GET', '/final-minutes', attendee)).json().data).toMatchObject({ status: 'FINAL', content });
  });

  it('is one minutes PDF: a draft until final, then opening with the Final MOM — marked FINAL, with who approved it', async () => {
    const { call } = await setup();
    const before = inspectPdf((await call('GET', '/minutes.pdf')).rawPayload).pages.flat();
    expect(before).toContain('DRAFT');
    expect(before).not.toContain('Final Minutes of Meeting');
    await call('POST', '/final-minutes/approve', undefined, { content });
    const res = await call('GET', '/minutes.pdf');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('minutes-final-weekly-review.pdf');
    const text = inspectPdf(res.rawPayload).pages.flat();
    expect(text).toEqual(expect.arrayContaining(['FINAL', 'Final Minutes of Meeting', 'Progress was reviewed and go-live moved.', 'Go-live plan', 'The client needs time to test.', 'Tablets may be late.', 'Send the form — Bilal, by Oct 18']));
    expect(text.some((l) => l.includes('Approved by User u1'))).toBe(true);
    expect(text.indexOf('Final Minutes of Meeting')).toBeLessThan(text.indexOf('Attendees'));
    // Older links asking for the final version get the same document.
    const old = await call('GET', '/minutes.pdf?version=final');
    expect(old.statusCode).toBe(200);
    expect(inspectPdf(old.rawPayload).pages.flat()).toContain('Final Minutes of Meeting');
  });

  it('shows the organizer a drafted Final MOM in their PDF, marked not yet approved — and no one else', async () => {
    const { call, attendee } = await setup();
    await call('PUT', '/final-minutes', undefined, { content });
    const mine = inspectPdf((await call('GET', '/minutes.pdf')).rawPayload).pages.flat();
    expect(mine).toContain('Final Minutes of Meeting');
    expect(mine.some((l) => l.includes('Not yet approved'))).toBe(true);
    const theirs = inspectPdf((await call('GET', '/minutes.pdf', attendee)).rawPayload).pages.flat();
    expect(theirs).not.toContain('Final Minutes of Meeting');
    expect(theirs).not.toContain('Progress was reviewed and go-live moved.');
  });

  it('tells the meeting’s people when the final minutes are saved, approved or reopened — not for a draft never kept, or a refused change', async () => {
    const changed = vi.fn();
    const { call, id, attendee } = await setup({ changed });
    await call('POST', '/final-minutes/draft', undefined, { source: 'notes' });
    expect(changed).not.toHaveBeenCalled();
    await call('PUT', '/final-minutes', undefined, { content });
    await call('POST', '/final-minutes/approve');
    await call('PUT', '/final-minutes', undefined, { content }); // final: refused (409)
    await call('POST', '/final-minutes/reopen', attendee); // not theirs to reopen (403)
    await call('POST', '/final-minutes/reopen');
    expect(changed.mock.calls).toEqual([[id], [id], [id]]);
  });

  it('emails the final minutes once they are approved — never a Final MOM that is only drafted', async () => {
    const notify = { sendMinutes: vi.fn(async () => ({ sent: 1, failed: 0 })), previewMinutes: vi.fn() };
    const { call, id } = await setup({ notify });
    await call('PUT', '/final-minutes', undefined, { content });
    await call('POST', '/minutes/send');
    const draftSent = notify.sendMinutes.mock.calls[0] as unknown as [string, Buffer];
    expect(inspectPdf(draftSent[1]).pages.flat()).not.toContain('Final Minutes of Meeting');
    await call('POST', '/final-minutes/approve', undefined, { content });
    await call('POST', '/minutes/send');
    const args = notify.sendMinutes.mock.calls[1] as unknown as [string, Buffer];
    expect(args[0]).toBe(id);
    const text = inspectPdf(args[1]).pages.flat();
    expect(text).toContain('FINAL');
    expect(text).toContain('Final Minutes of Meeting');
  });
});

// 1.22 (§10): "Draft with AI" keeps running after the page is closed — a job, saved as the draft
// when nothing was written meanwhile, else offered beside the minutes; the requester is told.
describe('Final minutes: Draft with AI in the background (1.22)', () => {
  const aiContent = { summary: 'Drafted by the AI.', discussion: [], decisions: ['Go-live moves to 1 November.'], risks: [], nextSteps: [] };
  const theirs = { summary: 'Written by the organizer.', discussion: [], decisions: [], risks: [], nextSteps: [] };

  async function setup(opts: { replies?: unknown[]; ready?: boolean; overLimit?: boolean; legacyWaitMs?: number } = {}) {
    const attendeesOf: Record<string, string[]> = {};
    const store = createMemoryAiJobStore();
    const runner = createAiJobRunner({ store, owner: 'test', retryDelaysMs: [10, 10, 10] });
    const finalMinutes = createMemoryFinalMinutesRepository();
    const told: Array<{ userId: string; type: string; title: string; body: string; entityType: string; entityId: string }> = [];
    const changed = vi.fn();
    let release: () => void = () => {};
    let held: Promise<void> | null = null;
    const calls: string[] = [];
    const replies = [...(opts.replies ?? [aiContent])];
    const ai = createFinalMinutesAi({
      jobs: runner,
      store,
      finalMinutes,
      ready: async () => opts.ready ?? true,
      checkLimits: () => {
        if (opts.overLimit) throw new AiRateLimitedError('You’ve reached today’s AI request limit. It resets tomorrow.');
      },
      draftMinutesWithAi: async (facts) => {
        calls.push(facts);
        if (held) await held;
        const r = replies.length > 1 ? replies.shift() : replies[0];
        if (r instanceof Error) throw r;
        return r;
      },
      notify: async (n) => void told.push(n),
      onChanged: changed,
      userNames: async (ids) => new Map(ids.map((i) => [i, `User ${i}`])),
      legacyWaitMs: opts.legacyWaitMs,
      pollMs: 5,
    });
    runner.register('final-minutes', ai.handler);
    const app = await makeApp(attendeesOf, undefined, undefined, { finalMinutesRepository: finalMinutes, finalMinutesAi: ai, onFinalMinutesChanged: changed });
    const organizer = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const attendee = { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` };
    // Another editor (an administrator), writing the minutes while the AI drafts.
    const admin = { authorization: `Bearer ${await tokenFor('u9', ['ADMIN'])}` };
    const id = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: organizer, payload: { title: 'Weekly review', startAt: '2026-10-14T06:00:00Z' } })).json().data.id as string;
    attendeesOf[id] = ['u2'];
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: organizer, payload: { type: 'DECISION', body: 'Go-live moves to 1 November.' } });
    const call = (method: 'GET' | 'POST' | 'PUT', path: string, who = organizer, payload?: unknown) =>
      app.inject({ method, url: `/api/v1/meetings/${id}${path}`, headers: who, ...(payload ? { payload: payload as Record<string, unknown> } : {}) });
    const hold = () => {
      held = new Promise<void>((r) => (release = r));
    };
    const draft = (who = organizer) => call('POST', '/final-minutes/draft', who, { source: 'ai', background: true });
    const minutes = async (who = organizer) => (await call('GET', '/final-minutes', who)).json().data;
    return { app, id, call, draft, minutes, runner, store, told, changed, calls, hold, release: () => release(), organizer, attendee, admin };
  }

  it('answers at once; the AI’s text is then saved as the draft and the requester is told (bell + push)', async () => {
    const s = await setup();
    s.hold();
    const res = await s.draft();
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ source: 'ai', joined: false, aiDraft: { status: 'running', attempt: 1, maxAttempts: 4, requestedBy: { id: 'u1', name: 'User u1' } } });
    expect((await s.minutes()).aiDraft).toMatchObject({ status: 'running', mine: true });
    expect(s.calls[0]).toContain('Meeting: Weekly review');
    // The page is closed: the job finishes on its own.
    s.release();
    await s.runner.idle();
    const after = await s.minutes();
    expect(after).toMatchObject({ status: 'DRAFT', content: aiContent, aiDraft: { status: 'saved' } });
    expect(s.told).toEqual([]); // the page above was reading it a moment ago
  });

  it('a requester who left is told by the bell and a push: “The AI draft of the minutes for … is ready”', async () => {
    const s = await setup();
    await s.draft();
    await s.runner.idle();
    expect(s.told).toEqual([
      { userId: 'u1', type: 'AI_DRAFT_READY', title: 'The AI draft of the minutes for “Weekly review” is ready', body: 'It was saved as the draft. Check it, then mark it final.', entityType: 'meeting', entityId: s.id },
    ]);
    expect(s.changed).toHaveBeenCalledWith(s.id); // open pages read the minutes again
  });

  it('a second click joins the running job: one AI call, one draft', async () => {
    const s = await setup();
    s.hold();
    const [a, b] = await Promise.all([s.draft(), s.draft()]);
    const c = await s.draft();
    const ids = [a, b, c].map((r) => r.json().data.aiDraft.id);
    expect(new Set(ids).size).toBe(1);
    expect([a, b, c].map((r) => r.json().data.joined).sort()).toEqual([false, true, true]);
    s.release();
    await s.runner.idle();
    expect(s.calls).toHaveLength(1);
    expect(s.told.filter((t) => t.type === 'AI_DRAFT_READY')).toHaveLength(1);
  });

  it('someone saved the minutes meanwhile: their text stays and the AI draft is offered — Use it', async () => {
    const s = await setup();
    s.hold();
    await s.draft();
    await s.call('PUT', '/final-minutes', s.admin, { content: theirs });
    s.release();
    await s.runner.idle();
    const offered = await s.minutes();
    expect(offered).toMatchObject({ status: 'DRAFT', content: theirs, aiDraft: { status: 'ready', reason: 'changed', content: aiContent } });
    expect(s.told[0]).toMatchObject({ type: 'AI_DRAFT_READY', body: 'The minutes were changed while the AI was drafting, so they were kept. Open them to use the AI draft, compare or discard it.' });
    const used = await s.call('POST', `/final-minutes/ai-draft/${offered.aiDraft.id}/use`);
    expect(used.statusCode).toBe(200);
    expect(used.json().data).toMatchObject({ status: 'DRAFT', content: aiContent, aiDraft: null });
    // Once only.
    const again = await s.call('POST', `/final-minutes/ai-draft/${offered.aiDraft.id}/use`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('AI_DRAFT_GONE');
  });

  it('…or Discard: the offer goes, their text stays', async () => {
    const s = await setup();
    s.hold();
    await s.draft();
    await s.call('PUT', '/final-minutes', undefined, { content: theirs });
    s.release();
    await s.runner.idle();
    const { aiDraft } = await s.minutes();
    const res = await s.call('POST', `/final-minutes/ai-draft/${aiDraft.id}/discard`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ content: theirs, aiDraft: null });
    expect((await s.call('POST', `/final-minutes/ai-draft/${aiDraft.id}/use`)).statusCode).toBe(409);
  });

  it('marked final meanwhile: kept, the offer says so, and Use it waits for Reopen', async () => {
    const s = await setup();
    s.hold();
    await s.draft();
    await s.call('POST', '/final-minutes/approve', undefined, { content: theirs });
    s.release();
    await s.runner.idle();
    const { aiDraft, status } = await s.minutes();
    expect(status).toBe('FINAL');
    expect(aiDraft).toMatchObject({ status: 'ready', reason: 'final' });
    const refused = await s.call('POST', `/final-minutes/ai-draft/${aiDraft.id}/use`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('FINAL_MINUTES_LOCKED');
    await s.call('POST', '/final-minutes/reopen');
    expect((await s.call('POST', `/final-minutes/ai-draft/${aiDraft.id}/use`)).json().data).toMatchObject({ status: 'DRAFT', content: aiContent });
  });

  it('a time-out is tried again, then the draft is saved', async () => {
    const s = await setup({ replies: [new AiTimeoutError(), new ProviderRefusedError(503, null), aiContent] });
    await s.draft();
    await vi.waitFor(async () => expect((await s.minutes()).aiDraft?.status).toBe('waiting'), { timeout: 2000, interval: 1 }).catch(() => {});
    await vi.waitFor(async () => expect((await s.minutes()).content).toEqual(aiContent), { timeout: 3000 });
    await s.runner.idle();
    expect(s.calls).toHaveLength(3);
  });

  it('failing every try ends with the final-fail notice — on the page and by the bell — and a try again', async () => {
    const s = await setup({ replies: [new AiTimeoutError()] });
    await s.draft();
    // The page was closed: nobody reads the minutes until it has failed.
    await vi.waitFor(async () => expect((await s.store.latest('final-minutes', s.id))?.status).toBe('FAILED'), { timeout: 3000 });
    await s.runner.idle();
    expect(s.calls).toHaveLength(4);
    expect((await s.minutes()).aiDraft).toMatchObject({ status: 'failed', error: 'The AI provider did not respond in time. Try again later.' });
    expect(s.told.filter((t) => t.type === 'AI_DRAFT_FAILED')).toEqual([
      expect.objectContaining({ title: 'Couldn’t draft the minutes for “Weekly review” with AI — try again', body: 'The AI provider did not respond in time. Try again later.', entityType: 'meeting' }),
    ]);
    // Trying again starts a new job; the old failure is dismissed by Discard too.
    const { aiDraft } = await s.minutes();
    expect((await s.call('POST', `/final-minutes/ai-draft/${aiDraft.id}/discard`)).json().data.aiDraft).toBeNull();
  });

  it('AI off, or over the person’s limit: said at once, as before — no job', async () => {
    const off = await setup({ ready: false });
    const res = await off.draft();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
    expect(await off.store.latest('final-minutes', off.id)).toBeNull();
    const limited = await setup({ overLimit: true });
    const r2 = await limited.draft();
    expect(r2.statusCode).toBe(429);
    expect(r2.json().error.message).toBe('You’ve reached today’s AI request limit. It resets tomorrow.');
  });

  it('attendees still can’t draft, see no AI state; final minutes can’t be redrafted; the notes stay instant', async () => {
    const s = await setup();
    expect((await s.draft(s.attendee)).statusCode).toBe(403);
    await s.draft();
    await s.runner.idle();
    expect(await s.minutes(s.attendee)).not.toHaveProperty('aiDraft');
    await s.call('POST', '/final-minutes/approve');
    const refused = await s.draft();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('FINAL_MINUTES_LOCKED');
    await s.call('POST', '/final-minutes/reopen');
    const notes = await s.call('POST', '/final-minutes/draft', undefined, { source: 'notes' });
    expect(notes.statusCode).toBe(200);
    expect(notes.json().data.source).toBe('notes');
    expect(s.calls).toHaveLength(1);
    expect((await s.call('POST', `/final-minutes/ai-draft/nope/use`, s.attendee)).statusCode).toBe(403);
  });

  it('older apps (no background flag) still get the text in the answer — it is saved as the draft too, without a bell', async () => {
    const s = await setup();
    const res = await s.call('POST', '/final-minutes/draft', undefined, { source: 'ai' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ content: aiContent, source: 'ai' });
    await s.runner.idle();
    expect((await s.minutes()).content).toEqual(aiContent);
    expect(s.told).toEqual([]);
  });

  it('older apps: a failure is said as before; a draft still running after the wait says it will be saved', async () => {
    const failing = await setup({ replies: [new ValidationError('The AI’s draft couldn’t be read. Try again, or start from the notes.')] });
    const res = await failing.call('POST', '/final-minutes/draft', undefined, { source: 'ai' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('The AI’s draft couldn’t be read. Try again, or start from the notes.');
    const slow = await setup({ legacyWaitMs: 30 });
    slow.hold();
    const late = await slow.call('POST', '/final-minutes/draft', undefined, { source: 'ai' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toEqual({ code: 'AI_DRAFT_RUNNING', message: 'The AI is still drafting. It will be saved as the draft, and you’ll be told when it’s ready.' });
    slow.release();
    await slow.runner.idle();
    expect((await slow.minutes()).content).toEqual(aiContent);
  });
});

describe('Minutes PDF route: the meeting’s company (companies)', () => {
  const widths = (pdf: Buffer) => [...inspectPdf(pdf).objects.values()].filter((d) => /\/Subtype \/Image/.test(d)).map((d) => Number(/\/Width (\d+)/.exec(d)?.[1]));

  it('prints the company’s name in the footer and its logo in the header, for that meeting', async () => {
    const asked: string[] = [];
    const app = await makeApp({}, undefined, undefined, {
      pdfBranding: { meeting: async (id: string) => { asked.push(id); return { companyName: 'Alpha LLC', logo: solidPng(250, 50) }; } },
    });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(asked).toEqual([id]);
    expect(inspectPdf(res.rawPayload).pages.flat().join('\n')).toContain('Alpha LLC');
    expect(widths(res.rawPayload)).toEqual([250]);
  });

  it('a brand that can’t be read leaves the PDF as before', async () => {
    const app = await makeApp({}, undefined, undefined, { pdfBranding: { meeting: async () => { throw new Error('database away'); } } });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Weekly review', startAt: '2026-10-01T09:00:00Z' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${created.json().data.id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(inspectPdf(res.rawPayload).pages.flat().join('\n')).toContain('MICO360');
    expect(widths(res.rawPayload)).toEqual([155]); // tpdf: 1.23.11 — the built-in logo (every header carries one; 200 dpi, 155 pixels)
  });
});
