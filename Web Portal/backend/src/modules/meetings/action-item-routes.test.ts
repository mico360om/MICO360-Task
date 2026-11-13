import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createActionItemService } from './action-item-service';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import type { ActionItemRepository, ActionItemRecord, CreateActionItemData, UpdateActionItemData, AssigneeListFilter } from './action-item-repository';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function actionRepo(): ActionItemRepository {
  const rows = new Map<string, ActionItemRecord>();
  let seq = 0;
  return {
    async create(d: CreateActionItemData) {
      const now = new Date();
      const rec: ActionItemRecord = { id: `ai${seq++}`, meetingId: d.meetingId ?? null, agendaItemId: d.agendaItemId ?? null, sourceNoteId: d.sourceNoteId ?? null, projectId: d.projectId ?? null, description: d.description, assigneeId: d.assigneeId ?? null, priority: d.priority ?? 'NORMAL', status: d.status ?? 'OPEN', dueDate: d.dueDate ?? null, progress: 0, completedAt: null, taskId: d.taskId ?? null, createdById: d.createdById, createdAt: now, updatedAt: now };
      rows.set(rec.id, rec); return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId); },
    async listByTask(taskId) { return [...rows.values()].filter((a) => a.taskId === taskId); },
    async listForAssignee(userId, filter: AssigneeListFilter = {}) {
      let all = [...rows.values()].filter((a) => a.assigneeId === userId);
      if (filter.status) all = all.filter((a) => a.status === filter.status);
      if (filter.openOnly) all = all.filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
      return all;
    },
    async update(id, patch: UpdateActionItemData) { const u = { ...rows.get(id)!, ...patch, updatedAt: new Date() } as ActionItemRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

function meetingRepo(): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  return {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = { id: `m${seq++}`, title: d.title, description: null, category: null, status: d.status ?? 'DRAFT', projectId: d.projectId ?? null, organizerId: d.organizerId, location: null, onlineLink: null, startAt: d.startAt, endAt: null, timeZone: null, recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now };
      rows.set(rec.id, rec); return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent() {}, async markReminderSent() {},
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: [] } : null; },
  };
}

const tokenService = createTokenService({ accessSecret: 'ai-a', refreshSecret: 'ai-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

async function makeApp() {
  const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
  const meetings = meetingRepo();
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess: { async canViewProject() { return false; }, async accessibleProjectIds() { return []; } } });
  const actionItemService = createActionItemService({ actionItems: actionRepo() });
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, actionItemService, resolveMeetingProjectId: async (id) => (await meetings.accessCore(id))?.projectId ?? null });
  return app;
}

async function ownedMeeting(app: Awaited<ReturnType<typeof makeApp>>, owner: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor(owner, ['EMPLOYEE'])}` }, payload: { title: 'Sync', startAt: '2026-10-01T09:00:00Z' } });
  return res.json().data.id as string;
}

describe('Action item routes', () => {
  it('names the linked task of each item by its key, so the list can open it', async () => {
    const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
    const meetings = meetingRepo();
    const meetingService = createMeetingService({ meetings });
    const actionItemService = createActionItemService({ actionItems: actionRepo() });
    const app = await buildApp({ authService, tokenService, meetingService, actionItemService, resolveTaskKeys: async (ids) => Object.fromEntries(ids.map((i) => [i, `KEY-${i}`])) });
    const id = await ownedMeeting(app, 'u1');
    await actionItemService.addItem(id, 'u1', { description: 'Linked', taskId: 't7' });
    await actionItemService.addItem(id, 'u1', { description: 'Not linked' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    const items = res.json().data as Array<{ description: string; taskKey: string | null }>;
    expect(items.map((i) => [i.description, i.taskKey])).toEqual([['Linked', 'KEY-t7'], ['Not linked', null]]);
  });

  it('1.22.3 review: no number for a linked task the reader may not open — the meeting’s list and My Action Items; an administrator sees it', async () => {
    const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
    const meetingService = createMeetingService({ meetings: meetingRepo() });
    const actionItemService = createActionItemService({ actionItems: actionRepo() });
    // t7 is on p1 now (it moved there); u1 may open p2's tasks only.
    const projectAccess = {
      async canViewProject() { return true; }, async canViewTask() { return true; }, async canViewColumn() { return true; },
      async accessibleProjectIds(_u: string, roles: string[]) { return roles.includes('ADMIN') ? null : ['p2']; },
    };
    const resolveTaskKeys = async (ids: string[], projectIds?: readonly string[] | null) => (!projectIds || projectIds.includes('p1') ? Object.fromEntries(ids.map((i) => [i, `KEY-${i}`])) : {});
    const app = await buildApp({ authService, tokenService, meetingService, actionItemService, projectAccess, resolveTaskKeys });
    const id = await ownedMeeting(app, 'u1');
    await actionItemService.addItem(id, 'u1', { description: 'Linked', taskId: 't7', assigneeId: 'u1' });
    const keysFor = async (url: string, roles: string[]) =>
      ((await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${await tokenFor('u1', roles)}` } })).json().data as Array<{ taskId: string | null; taskKey: string | null }>).map((i) => [i.taskId, i.taskKey]);
    expect(await keysFor(`/meetings/${id}/action-items`, ['EMPLOYEE'])).toEqual([['t7', null]]);
    expect(await keysFor('/me/action-items', ['EMPLOYEE'])).toEqual([['t7', null]]);
    expect(await keysFor('/me/action-items', ['ADMIN'])).toEqual([['t7', 'KEY-t7']]);
  });

  it('adds an action item to a meeting the caller organizes', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Draft OKRs', assigneeId: 'u2', priority: 'HIGH' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ description: 'Draft OKRs', assigneeId: 'u2', priority: 'HIGH', status: 'OPEN', meetingId: id });
  });

  it('hides the register from an outsider (404) and forbids adding (403)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const outsider = `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}`;
    expect((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: outsider } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: outsider }, payload: { description: 'x' } })).statusCode).toBe(403);
  });

  it('changes status via PATCH and returns the assignee’s own items via /me/action-items', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Do it', assigneeId: 'u2' } });
    const aid = created.json().data.id;
    const patched = await app.inject({ method: 'PATCH', url: `/api/v1/action-items/${aid}`, headers: { authorization: auth }, payload: { status: 'IN_PROGRESS' } });
    expect(patched.json().data.status).toBe('IN_PROGRESS');
    // u2 sees it in their personal register
    const mine = await app.inject({ method: 'GET', url: '/api/v1/me/action-items', headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.map((x: { id: string }) => x.id)).toContain(aid);
    // u3 (not the assignee) sees none
    const other = await app.inject({ method: 'GET', url: '/api/v1/me/action-items', headers: { authorization: `Bearer ${await tokenFor('u3', ['EMPLOYEE'])}` } });
    expect(other.json().data).toHaveLength(0);
  });

  // Review fix #30 (13 Nov 2026): openOnly=false means false (z.coerce.boolean read "false" as true).
  it('openOnly: true/1 leave out finished items; false/0 keep them; anything else is a 400', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const done = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Done one', assigneeId: 'u2' } })).json().data.id;
    await app.inject({ method: 'PATCH', url: `/api/v1/action-items/${done}`, headers: { authorization: auth }, payload: { status: 'COMPLETED' } });
    const open = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Open one', assigneeId: 'u2' } })).json().data.id;
    const u2 = { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` };
    const ids = async (q: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/me/action-items${q}`, headers: u2 });
      return res.statusCode === 200 ? res.json().data.map((x: { id: string }) => x.id).sort() : res.statusCode;
    };
    const both = [done, open].sort();
    expect(await ids('')).toEqual(both);
    expect(await ids('?openOnly=true')).toEqual([open]);
    expect(await ids('?openOnly=1')).toEqual([open]);
    expect(await ids('?openOnly=false')).toEqual(both);
    expect(await ids('?openOnly=0')).toEqual(both);
    expect(await ids('?openOnly=maybe')).toBe(400);
  });

  it('1.23.0: PATCH sets an item’s topic — one of the same meeting’s, else 400', async () => {
    const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
    const meetings = meetingRepo();
    const meetingService = createMeetingService({ meetings });
    let other = '';
    const actionItemService = createActionItemService({ actionItems: actionRepo(), topicMeetingOf: async (agendaItemId) => (agendaItemId === 'topic-here' ? mine : agendaItemId === 'topic-elsewhere' ? other : null) });
    const app = await buildApp({ authService, tokenService, meetingService, actionItemService });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const mine = await ownedMeeting(app, 'u1');
    other = await ownedMeeting(app, 'u1');
    const created = await app.inject({ method: 'POST', url: `/api/v1/meetings/${mine}/action-items`, headers: { authorization: auth }, payload: { description: 'Do it', agendaItemId: 'topic-here' } });
    expect(created.statusCode).toBe(201);
    const aid = created.json().data.id;
    expect(created.json().data.agendaItemId).toBe('topic-here');
    const moved = await app.inject({ method: 'PATCH', url: `/api/v1/action-items/${aid}`, headers: { authorization: auth }, payload: { agendaItemId: null } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.agendaItemId).toBeNull();
    const refused = await app.inject({ method: 'PATCH', url: `/api/v1/action-items/${aid}`, headers: { authorization: auth }, payload: { agendaItemId: 'topic-elsewhere' } });
    expect(refused.statusCode).toBe(400);
    const badAdd = await app.inject({ method: 'POST', url: `/api/v1/meetings/${mine}/action-items`, headers: { authorization: auth }, payload: { description: 'x', agendaItemId: 'topic-elsewhere' } });
    expect(badAdd.statusCode).toBe(400);
  });

  it('lets the assignee update their own standalone-accessible item but forbids an unrelated user', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const aid = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Owned', assigneeId: 'u2' } })).json().data.id;
    // u9 is not organizer/attendee of the meeting → 403
    const forbidden = await app.inject({ method: 'PATCH', url: `/api/v1/action-items/${aid}`, headers: { authorization: `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}` }, payload: { progress: 50 } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('lets the assignee and creator work on their item even without meeting access (MTG-05)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const aid = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Follow up', assigneeId: 'u2' } })).json().data.id;
    // u2 never attended the meeting but owns the item.
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/action-items/${aid}`, headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` }, payload: { status: 'COMPLETED' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('COMPLETED');
    // …but may not delete someone else's item.
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/action-items/${aid}`, headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` } })).statusCode).toBe(403);
  });

  it('deletes an item (204)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const aid = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth }, payload: { description: 'Bye' } })).json().data.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/action-items/${aid}`, headers: { authorization: auth } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/action-items`, headers: { authorization: auth } })).json().data).toHaveLength(0);
  });
});
