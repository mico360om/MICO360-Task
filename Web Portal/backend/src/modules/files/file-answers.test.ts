import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createTokenService } from '../auth/token-service';
import { createAuthGuard, type UserState } from '../auth/auth-guard';
import { createAttachmentService } from '../tasks/attachment-service';
import type { AttachmentRecord, AttachmentRepository } from '../tasks/attachment-repository';
import { registerAttachmentRoutes } from '../tasks/attachment-routes';
import { createMessageService } from '../chat/message-service';
import { registerChatRoutes } from '../chat/chat-routes';
import type { Conversation, Participant, Message, MessageAttachmentRecord } from '../chat/chat-repository';
import { registerUserRoutes } from '../users/user-routes';
import { createFileLinks, isSignedUploadUrl, type FileViewer } from './file-links';

// 1.23.29 Private file links (design §7.3, §7.4, §10 "Answers"): every answer that carries a task's or a
// chat's file address carries it signed for the person asking — two people get different links, each
// working for its own person only — and a live chat message with a file goes out signed per person.

const ACCESS = 'pf-answers-access-secret';
const tokenService = createTokenService({
  accessSecret: ACCESS, refreshSecret: 'pf-answers-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const states: Record<string, UserState> = {
  amal: { tokenVersion: 2, active: true, roles: ['EMPLOYEE'] },
  basim: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] },
};
const guard = () => createAuthGuard(tokenService, { userState: async (id) => states[id] ?? null });
const links = createFileLinks({ secret: ACCESS });
const bearer = async (id: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: ['EMPLOYEE'], tokenVersion: states[id]!.tokenVersion })).accessToken}` });
const viewerOf = (id: string): FileViewer => ({ id, ver: states[id]!.tokenVersion });

/** The link opens this stored file for this person only. */
function opensFor(url: string, key: string, who: string): boolean {
  const u = new URL(url, 'https://x.example');
  if (u.pathname !== `/uploads/${encodeURIComponent(key)}`) return false;
  const p = links.parse(Object.fromEntries(u.searchParams));
  return !!p && p.u === who && links.fresh(p) && links.verify(key, p, states[who]!.tokenVersion);
}

const BOUNDARY = '----pfanswers';
function upload(filename: string, mime: string, content: string, fields: Record<string, string> = {}) {
  const parts = [
    ...Object.entries(fields).map(([k, v]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n${content}\r\n`,
    `--${BOUNDARY}--\r\n`,
  ];
  return { payload: parts.join(''), headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` } };
}

let seq = 0;
const storage = {
  async save() { const storageKey = `file-${++seq}.png`; return { storageKey, url: `/uploads/${storageKey}`, sizeBytes: 5 }; },
  async remove() {},
};

// ---- task files --------------------------------------------------------------------------------
describe('task files: every answer signs each file for the person asking', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const rows = new Map<string, AttachmentRecord>();
    const repo: AttachmentRepository = {
      async create(data) { const rec: AttachmentRecord = { id: `a${++seq}`, createdAt: new Date(), ...data }; rows.set(rec.id, rec); return rec; },
      async list(taskId) { return [...rows.values()].filter((a) => a.taskId === taskId); },
      async findById(id) { return rows.get(id) ?? null; },
      async delete(id) { rows.delete(id); },
      async setClientVisible(id, visible) { const r = { ...rows.get(id)!, clientVisible: visible }; rows.set(id, r); return r; },
    };
    const attachmentService = createAttachmentService({ repo, storage, taskLookup: { async exists(id) { return id === 't1'; } }, maxSizeBytes: 1024, allowedMimeTypes: ['image/png', 'text/plain'] });
    app = Fastify();
    await app.register(multipart);
    await registerAttachmentRoutes(app, { attachmentService, guard: guard(), canViewTask: async () => true, canManageTask: async () => true, fileLinks: links });
    await app.ready();
  });

  it('upload (201), list, and "Show to client" answer signed links; two people get different ones', async () => {
    const up = await app.inject({ method: 'POST', url: '/tasks/t1/attachments', headers: { ...(await bearer('amal')), ...upload('plan.txt', 'text/plain', 'hello').headers }, payload: upload('plan.txt', 'text/plain', 'hello').payload });
    expect(up.statusCode).toBe(201);
    const rec = up.json().data;
    expect(isSignedUploadUrl(rec.url)).toBe(true);
    expect(opensFor(rec.url, rec.storageKey, 'amal')).toBe(true);

    const mine = (await app.inject({ method: 'GET', url: '/tasks/t1/attachments', headers: await bearer('amal') })).json().data[0];
    const theirs = (await app.inject({ method: 'GET', url: '/tasks/t1/attachments', headers: await bearer('basim') })).json().data[0];
    expect(mine.url).not.toBe(theirs.url);
    expect(opensFor(mine.url, rec.storageKey, 'amal')).toBe(true);
    expect(opensFor(theirs.url, rec.storageKey, 'basim')).toBe(true);
    expect(opensFor(mine.url, rec.storageKey, 'basim')).toBe(false);

    const shown = await app.inject({ method: 'PUT', url: `/tasks/t1/attachments/${rec.id}/client-visible`, headers: await bearer('basim'), payload: { visible: true } });
    expect(shown.statusCode).toBe(200);
    expect(opensFor(shown.json().data.url, rec.storageKey, 'basim')).toBe(true);
  });
});

// ---- chat files --------------------------------------------------------------------------------
function chatRepos() {
  const convs = new Map<string, Conversation>();
  const parts: Participant[] = [];
  const msgs = new Map<string, Message>();
  const files: MessageAttachmentRecord[] = [];
  const members: Record<string, string[]> = { p1: ['amal', 'basim'] };
  const id = (p: string) => `${p}${++seq}`;
  return {
    conversations: {
      async findById(cid: string) { return convs.get(cid) ?? null; },
      async findProjectConversation(pid: string) { return [...convs.values()].find((c) => c.kind === 'PROJECT' && c.projectId === pid) ?? null; },
      async findDirectConversation(a: string, b: string) {
        return [...convs.values()].find((c) => c.kind === 'DIRECT' && [a, b].every((u) => parts.some((p) => p.conversationId === c.id && p.userId === u))) ?? null;
      },
      async createProject(pid: string) { const c: Conversation = { id: id('conv'), kind: 'PROJECT', projectId: pid, createdAt: new Date() }; convs.set(c.id, c); return c; },
      async createDirect() { const c: Conversation = { id: id('conv'), kind: 'DIRECT', projectId: null, createdAt: new Date() }; convs.set(c.id, c); return c; },
      async listByIds(ids: string[]) { return ids.map((i) => convs.get(i)).filter((c): c is Conversation => !!c); },
      async listProjectConversations() { return []; },
    },
    participants: {
      async add(conversationId: string, userId: string) { let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId); if (!p) { p = { conversationId, userId, lastReadAt: null, addedAt: new Date() }; parts.push(p); } return p; },
      async remove() {},
      async find(conversationId: string, userId: string) { return parts.find((x) => x.conversationId === conversationId && x.userId === userId) ?? null; },
      async listByConversation(conversationId: string) { return parts.filter((x) => x.conversationId === conversationId); },
      async listConversationIdsForUser(userId: string) { return [...new Set(parts.filter((x) => x.userId === userId).map((x) => x.conversationId))]; },
      async setLastRead() {},
      async setPrefs(conversationId: string, userId: string) { return parts.find((x) => x.conversationId === conversationId && x.userId === userId)!; },
      async setLastDelivered() {},
    },
    messages: {
      async create(conversationId: string, userId: string, body: string, extra?: { replyToId?: string | null; clientId?: string | null }) {
        const m: Message = { id: id('msg'), conversationId, userId, body, editedAt: null, deletedAt: null, createdAt: new Date(Date.now() + seq), replyToId: extra?.replyToId ?? null, clientId: extra?.clientId ?? null };
        msgs.set(m.id, m);
        return m;
      },
      async findByClientId(cid: string, uid: string, clientId: string) { return [...msgs.values()].find((m) => m.conversationId === cid && m.userId === uid && m.clientId === clientId) ?? null; },
      async search() { return []; },
      async findById(mid: string) { return msgs.get(mid) ?? null; },
      async list(conversationId: string, o: { before?: Date; limit: number }) { return [...msgs.values()].filter((m) => m.conversationId === conversationId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, o.limit); },
      async update(mid: string, body: string) { const m = { ...msgs.get(mid)!, body, editedAt: new Date() }; msgs.set(mid, m); return m; },
      async softDelete(mid: string) { const m = { ...msgs.get(mid)!, body: '', deletedAt: new Date() }; msgs.set(mid, m); return m; },
      async countAfter() { return 0; },
      async latest() { return null; },
    },
    reactions: { async add() {}, async remove() {}, async listByMessages() { return []; } },
    members: {
      async canAccessProject(pid: string, uid: string) { return (members[pid] ?? []).includes(uid); },
      async accessibleProjectIds(uid: string) { return Object.keys(members).filter((pid) => members[pid]!.includes(uid)); },
      async isActiveUser(uid: string) { return ['amal', 'basim'].includes(uid); },
      async projectMemberIds(pid: string) { return [...(members[pid] ?? [])]; },
    },
    attachments: {
      async create(messageId: string, meta: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string }) { const r: MessageAttachmentRecord = { id: id('ca'), messageId, createdAt: new Date(), ...meta }; files.push(r); return r; },
      async listByMessages(ids: string[]) { return files.filter((f) => ids.includes(f.messageId)); },
      async deleteByMessage(messageId: string) { for (let i = files.length - 1; i >= 0; i--) if (files[i]!.messageId === messageId) files.splice(i, 1); },
    },
  };
}

describe('chat files: history, sending and the live event are signed per person', () => {
  let app: FastifyInstance;
  let room: { projectId: string; event: string; payload: unknown }[];
  let personal: { audience: { projectId?: string | null; userIds?: string[] }; event: string; build: (v: FileViewer) => unknown }[];
  beforeEach(async () => {
    room = [];
    personal = [];
    const messageService = createMessageService(chatRepos() as never);
    app = Fastify();
    await app.register(multipart);
    await registerChatRoutes(app, {
      messageService,
      guard: guard(),
      storage,
      fileLinks: links,
      broadcastToProject: (projectId, event, payload) => room.push({ projectId, event, payload }),
      broadcastToUser: () => {},
      broadcastPersonal: (audience, event, build) => personal.push({ audience, event, build }),
    });
    await app.ready();
  });

  async function postFile(who: string, cid: string, clientId?: string) {
    const body = upload('photo.png', 'text/plain', 'hello', clientId ? { clientId } : {});
    return app.inject({ method: 'POST', url: `/conversations/${cid}/attachments`, headers: { ...(await bearer(who)), ...body.headers }, payload: body.payload });
  }

  it('upload (201) answers a link for the sender; the live event is one copy per person, never the room broadcast', async () => {
    const cid = (await app.inject({ method: 'GET', url: '/projects/p1/chat', headers: await bearer('amal') })).json().data.conversation.id;
    const sent = await postFile('amal', cid, 'c-1');
    expect(sent.statusCode).toBe(201);
    const att = sent.json().data.attachments[0];
    expect(opensFor(att.url, att.storageKey, 'amal')).toBe(true);

    expect(room.filter((e) => e.event === 'chat:message')).toEqual([]);
    expect(personal).toHaveLength(1);
    expect(personal[0]!.audience).toEqual({ projectId: 'p1' });
    const forBasim = personal[0]!.build(viewerOf('basim')) as { conversationId: string; message: { attachments: { url: string; storageKey: string }[] } };
    expect(forBasim.conversationId).toBe(cid);
    expect(opensFor(forBasim.message.attachments[0]!.url, att.storageKey, 'basim')).toBe(true);
    expect(opensFor(forBasim.message.attachments[0]!.url, att.storageKey, 'amal')).toBe(false);

    // A retried upload (same client id) answers the first message, signed too (200).
    const again = await postFile('amal', cid, 'c-1');
    expect(again.statusCode).toBe(200);
    expect(opensFor(again.json().data.attachments[0].url, att.storageKey, 'amal')).toBe(true);
  });

  it('history (the project channel page and the paged history) signs every file for its reader', async () => {
    const cid = (await app.inject({ method: 'GET', url: '/projects/p1/chat', headers: await bearer('amal') })).json().data.conversation.id;
    const key = (await postFile('amal', cid)).json().data.attachments[0].storageKey;
    const channel = (await app.inject({ method: 'GET', url: '/projects/p1/chat', headers: await bearer('basim') })).json().data.messages;
    expect(opensFor(channel[0].attachments[0].url, key, 'basim')).toBe(true);
    const page = (await app.inject({ method: 'GET', url: `/conversations/${cid}/messages`, headers: await bearer('amal') })).json().data;
    expect(opensFor(page[0].attachments[0].url, key, 'amal')).toBe(true);
    const basimPage = (await app.inject({ method: 'GET', url: `/conversations/${cid}/messages`, headers: await bearer('basim') })).json().data;
    expect(basimPage[0].attachments[0].url).not.toBe(page[0].attachments[0].url);
  });

  it('a message without files keeps the one room broadcast', async () => {
    const cid = (await app.inject({ method: 'GET', url: '/projects/p1/chat', headers: await bearer('amal') })).json().data.conversation.id;
    const sent = await app.inject({ method: 'POST', url: `/conversations/${cid}/messages`, headers: await bearer('amal'), payload: { body: 'hello' } });
    expect(sent.statusCode).toBe(201);
    expect(room.filter((e) => e.event === 'chat:message')).toHaveLength(1);
    expect(personal).toEqual([]);
  });

  it('a direct chat’s file goes to each participant, signed for each', async () => {
    const dm = (await app.inject({ method: 'POST', url: '/conversations/direct', headers: await bearer('amal'), payload: { userId: 'basim' } })).json().data;
    const sent = await postFile('amal', dm.id);
    expect(sent.statusCode).toBe(201);
    expect(personal[0]!.audience.userIds?.sort()).toEqual(['amal', 'basim']);
    const key = sent.json().data.attachments[0].storageKey;
    const copy = personal[0]!.build(viewerOf('basim')) as { message: { attachments: { url: string }[] } };
    expect(opensFor(copy.message.attachments[0]!.url, key, 'basim')).toBe(true);
  });
});

// ---- data export -------------------------------------------------------------------------------
describe('"Download my data": the files listed are signed for the person', () => {
  it('each attachment url is a working link for them', async () => {
    const app = Fastify();
    await registerUserRoutes(app, {
      userService: {} as never,
      guard: guard(),
      fileLinks: links,
      exportData: async () => ({
        exportedAt: new Date().toISOString(), profile: { avatarUrl: '/uploads/me.png' }, projects: [], tasksAssignedToMe: [], tasksICreated: [], comments: [],
        attachments: [{ filename: 'plan.pdf', url: '/uploads/k-plan.pdf' }], chatMessages: [], meetingNotes: [], actionItems: [], activity: [], accountEvents: [], micoAiChats: [],
      }),
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/users/me/export', headers: await bearer('amal') });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(opensFor(data.attachments[0].url, 'k-plan.pdf', 'amal')).toBe(true);
    expect(data.profile.avatarUrl).toBe('/uploads/me.png'); // a photo stays public
  });
});

// Review (1.23.29): the Word/Excel/PowerPoint text preview was the one other way to a file's contents, and it
// let an administrator through a binned task (canViewTask does). A binned task's files give nothing.
describe('the text preview of a file of a binned task', () => {
  it('is refused (404) for everyone, administrators included; a live task’s file goes on to the preview', async () => {
    let live = true;
    const rows = new Map<string, AttachmentRecord>([['a1', { id: 'a1', taskId: 't1', uploadedById: 'amal', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5, storageKey: 'k1.txt', url: '/uploads/k1.txt', createdAt: new Date() }]]);
    const repo: AttachmentRepository = {
      async create() { throw new Error('no'); },
      async list() { return [...rows.values()]; },
      async findById(id) { return rows.get(id) ?? null; },
      async delete() {},
    };
    const attachmentService = createAttachmentService({ repo, storage, taskLookup: { async exists() { return live; } }, maxSizeBytes: 1024, allowedMimeTypes: [] });
    const app = Fastify();
    await registerAttachmentRoutes(app, { attachmentService, guard: guard(), canViewTask: async () => true, fileLinks: links });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/attachments/a1/preview', headers: await bearer('amal') })).statusCode).toBe(415); // not an Office file: no preview
    live = false;
    expect((await app.inject({ method: 'GET', url: '/attachments/a1/preview', headers: await bearer('amal') })).statusCode).toBe(404);
    await app.close();
  });
});
