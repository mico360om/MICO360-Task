import { describe, it, expect, vi } from 'vitest';
import { inspectPdf } from '../../lib/pdf-inspect';
import { buildApp } from '../../app';
import { createMemoryFinalMinutesRepository } from './final-minutes-repository';
import { ValidationError } from '../../lib/http-errors';
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
    async listUpcomingWithoutReminder() { return []; },
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
    expect(text).toEqual(expect.arrayContaining(['User u7', 'Oct 5, 2026', 'In progress', 'High']));
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
    expect(text.some((l) => l.includes('Oct 10, 2026'))).toBe(true);
    expect(text.some((l) => l.includes('Oct 9, 2026'))).toBe(false);
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
    expect(notify.sendMinutes).toHaveBeenCalledWith(id, expect.any(Buffer), { only: ['a@x.co'] });
    // No list = everyone, as before.
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/minutes/send`, headers: { authorization: auth } });
    expect(notify.sendMinutes).toHaveBeenLastCalledWith(id, expect.any(Buffer));
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
    expect(pages[0]).toContain('FAL  ·  Project no. PDO-2026-014  ·  Acme Corp');
    expect(contents[0]).toMatch(/\/I\d+ Do/);
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
});

describe('Final minutes (Final MOM)', () => {
  async function setup(opts: { ai?: (facts: string) => Promise<unknown>; notify?: unknown } = {}) {
    const attendeesOf: Record<string, string[]> = {};
    const aiFacts: string[] = [];
    const app = await makeApp(attendeesOf, undefined, opts.notify, {
      finalMinutesRepository: createMemoryFinalMinutesRepository(() => new Date('2026-10-14T08:00:00Z')),
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

  it('prints the final minutes as a PDF marked FINAL, with who approved them', async () => {
    const { call } = await setup();
    expect((await call('GET', '/minutes.pdf?version=final')).statusCode).toBe(409);
    await call('POST', '/final-minutes/approve', undefined, { content });
    const res = await call('GET', '/minutes.pdf?version=final');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('minutes-final-weekly-review.pdf');
    const text = inspectPdf(res.rawPayload).pages.flat();
    expect(text).toEqual(expect.arrayContaining(['FINAL', 'Progress was reviewed and go-live moved.', 'Go-live plan', 'The client needs time to test.', 'Tablets may be late.', 'Send the form — Bilal, by Oct 18']));
    expect(text.some((l) => l.includes('Approved by User u1'))).toBe(true);
    // The working minutes are still there.
    expect(inspectPdf((await call('GET', '/minutes.pdf')).rawPayload).pages.flat()).toContain('WORKING DRAFT');
  });

  it('emails the final minutes once they are approved', async () => {
    const notify = { sendMinutes: vi.fn(async () => ({ sent: 1, failed: 0 })), previewMinutes: vi.fn() };
    const { call, id } = await setup({ notify });
    await call('POST', '/final-minutes/approve', undefined, { content });
    await call('POST', '/minutes/send');
    const args = notify.sendMinutes.mock.calls[0] as unknown as [string, Buffer];
    expect(args[0]).toBe(id);
    expect(inspectPdf(args[1]).pages.flat()).toContain('FINAL');
  });
});
