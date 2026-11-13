import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { createMessageService } from './message-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type {
  Conversation, Participant, Message, Reaction, MessageAttachmentRecord, ChatAttachmentRepository,
  ConversationRepository, ParticipantRepository, MessageRepository, ReactionRepository, ChatMemberLookup,
} from './chat-repository';

/** Compact in-memory chat repositories for HTTP-level route tests. */
function makeRepos() {
  const convs = new Map<string, Conversation>();
  const parts: Participant[] = [];
  const msgs = new Map<string, Message>();
  const reactions: Reaction[] = [];
  let seq = 0;
  const id = (p: string) => `${p}${seq++}`;
  const members = { p1: ['u1', 'u2', 'u3'] } as Record<string, string[]>;

  const conversations: ConversationRepository = {
    async findById(cid) { return convs.get(cid) ?? null; },
    async findProjectConversation(pid) { return [...convs.values()].find((c) => c.kind === 'PROJECT' && c.projectId === pid) ?? null; },
    async findDirectConversation(a, b) {
      for (const c of convs.values()) {
        if (c.kind !== 'DIRECT') continue;
        const ids = parts.filter((p) => p.conversationId === c.id).map((p) => p.userId);
        if (ids.includes(a) && ids.includes(b)) return c;
      }
      return null;
    },
    async createProject(pid) { const c: Conversation = { id: id('conv'), kind: 'PROJECT', projectId: pid, createdAt: new Date() }; convs.set(c.id, c); return c; },
    async createDirect() { const c: Conversation = { id: id('conv'), kind: 'DIRECT', projectId: null, createdAt: new Date() }; convs.set(c.id, c); return c; },
    async listByIds(ids) { return ids.map((i) => convs.get(i)).filter((c): c is Conversation => !!c); },
    async listProjectConversations(pids) { return [...convs.values()].filter((c) => c.kind === 'PROJECT' && c.projectId !== null && pids.includes(c.projectId)); },
  };
  const participants: ParticipantRepository = {
    async add(conversationId, userId) { let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId); if (!p) { p = { conversationId, userId, lastReadAt: null, addedAt: new Date() }; parts.push(p); } return p; },
    async remove(conversationId, userId) { const i = parts.findIndex((x) => x.conversationId === conversationId && x.userId === userId); if (i >= 0) parts.splice(i, 1); },
    async find(conversationId, userId) { return parts.find((x) => x.conversationId === conversationId && x.userId === userId) ?? null; },
    async listByConversation(conversationId) { return parts.filter((x) => x.conversationId === conversationId); },
    async listConversationIdsForUser(userId) { return [...new Set(parts.filter((x) => x.userId === userId).map((x) => x.conversationId))]; },
    async setLastRead(conversationId, userId, at) { let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId); if (!p) { p = { conversationId, userId, lastReadAt: at, addedAt: new Date() }; parts.push(p); } else p.lastReadAt = at; },
    async setPrefs(conversationId, userId, patch) { const p = parts.find((x) => x.conversationId === conversationId && x.userId === userId)!; Object.assign(p, patch); return p; },
    async setLastDelivered(conversationId, userId, at) { const p = parts.find((x) => x.conversationId === conversationId && x.userId === userId); if (p) p.lastDeliveredAt = at; },
  };
  const messages: MessageRepository = {
    async create(conversationId, userId, body, extra) { const m: Message = { id: id('msg'), conversationId, userId, body, editedAt: null, deletedAt: null, createdAt: new Date(Date.now() + seq), replyToId: extra?.replyToId ?? null, clientId: extra?.clientId ?? null }; msgs.set(m.id, m); return m; },
    async findByClientId(cid, uid, clientId) { return [...msgs.values()].find((m) => m.conversationId === cid && m.userId === uid && m.clientId === clientId) ?? null; },
    async search(ids, q, limit) { return [...msgs.values()].filter((m) => ids.includes(m.conversationId) && !m.deletedAt && m.body.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit); },
    async findById(mid) { return msgs.get(mid) ?? null; },
    async list(conversationId, o) { let l = [...msgs.values()].filter((m) => m.conversationId === conversationId); if (o.before) l = l.filter((m) => m.createdAt < o.before!); return l.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, o.limit); },
    async update(mid, body) { const m = { ...msgs.get(mid)!, body, editedAt: new Date() }; msgs.set(mid, m); return m; },
    async softDelete(mid) { const m = { ...msgs.get(mid)!, body: '', deletedAt: new Date() }; msgs.set(mid, m); return m; },
    async countAfter(cid, after, ex) { return [...msgs.values()].filter((m) => m.conversationId === cid && !m.deletedAt && m.userId !== ex && (!after || m.createdAt > after)).length; },
    async latest(cid) { return [...msgs.values()].filter((m) => m.conversationId === cid).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null; },
  };
  const reactionRepo: ReactionRepository = {
    async add(mid, uid, e) { if (!reactions.find((r) => r.messageId === mid && r.userId === uid && r.emoji === e)) reactions.push({ messageId: mid, userId: uid, emoji: e }); },
    async remove(mid, uid, e) { const i = reactions.findIndex((r) => r.messageId === mid && r.userId === uid && r.emoji === e); if (i >= 0) reactions.splice(i, 1); },
    async listByMessages(ids) { return reactions.filter((r) => ids.includes(r.messageId)); },
  };
  const memberLookup: ChatMemberLookup = {
    async canAccessProject(pid, uid) { return (members[pid] ?? []).includes(uid); },
    async accessibleProjectIds(uid) { return Object.keys(members).filter((pid) => members[pid]!.includes(uid)); },
    async isActiveUser(uid) { return ['u1', 'u2', 'u3'].includes(uid); },
    async projectMemberIds(pid) { return [...(members[pid] ?? [])]; },
  };
  return { conversations, participants, messages, reactions: reactionRepo, members: memberLookup };
}

const tokenService = createTokenService({
  accessSecret: 'chat-access', refreshSecret: 'chat-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const projectEvents: { projectId: string; event: string; payload: unknown }[] = [];
const userEvents: { userId: string; event: string; payload: unknown }[] = [];

/** Fake disk: records saved and removed keys so tests can assert nothing is orphaned. */
function fakeStorage() {
  const saved: string[] = [];
  const removed: string[] = [];
  let seq = 0;
  return {
    saved,
    removed,
    async save() { const storageKey = `file-${seq++}`; saved.push(storageKey); return { storageKey, url: `/uploads/${storageKey}`, sizeBytes: 5 }; },
    async remove(key: string) { removed.push(key); },
  };
}
let storage = fakeStorage();

async function makeApp() {
  const chatService = createMessageService(makeRepos());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  storage = fakeStorage();
  return buildApp({
    authService, tokenService, chatService, chatAttachmentStorage: storage,
    onTaskEvent: (projectId, event, payload) => { projectEvents.push({ projectId, event, payload }); },
    onChatUserEvent: (userId, event, payload) => { userEvents.push({ userId, event, payload }); },
  });
}

/** A multipart body with an optional `body` caption field before a small text file. */
function multipart(caption?: string) {
  const boundary = '----mico360test';
  const parts = [
    ...(caption !== undefined ? [`--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\n${caption}\r\n`] : []),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n`,
    `--${boundary}--\r\n`,
  ];
  return { payload: parts.join(''), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
async function token(id: string) { return (await tokenService.issueTokens({ id, roles: ['EMPLOYEE'] })).accessToken; }

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { projectEvents.length = 0; userEvents.length = 0; app = await makeApp(); });

const auth = async (id: string) => ({ authorization: `Bearer ${await token(id)}` });

describe('Chat routes — project channel', () => {
  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(res.statusCode).toBe(401);
  });

  it('opens a project channel, sends a message (201), and broadcasts to the project room', async () => {
    const headers = await auth('u1');
    const open = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers });
    expect(open.statusCode).toBe(200);
    const convId = open.json().data.conversation.id;

    const sent = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: 'hello team' } });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().data.body).toBe('hello team');
    expect(projectEvents.some((e) => e.event === 'chat:message' && e.projectId === 'p1')).toBe(true);
  });

  it('forbids a non-member from opening the project channel (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers: await auth('stranger') });
    expect(res.statusCode).toBe(403);
  });

  it('forbids editing another user’s message (403)', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const msgId = (await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: 'mine' } })).json().data.id;
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/messages/${msgId}`, headers: await auth('u2'), payload: { body: 'hacked' } });
    expect(res.statusCode).toBe(403);
  });

  it('adds a reaction (201) and broadcasts chat:reaction', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const msgId = (await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: 'ship it' } })).json().data.id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/messages/${msgId}/reactions`, headers: await auth('u2'), payload: { emoji: '👍' } });
    expect(res.statusCode).toBe(201);
    expect(projectEvents.some((e) => e.event === 'chat:reaction')).toBe(true);
  });
});

describe('Chat routes — retries, replies, settings, delivery, search, members', () => {
  const dm = async () => (await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: await auth('u1'), payload: { userId: 'u2' } })).json().data.id as string;

  it('a retried send with the same client id answers 200 with the same message and announces it once', async () => {
    const convId = await dm();
    const headers = await auth('u1');
    const first = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: 'hello', clientId: 'c-1' } });
    const again = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: 'hello', clientId: 'c-1' } });
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.json().data.id).toBe(first.json().data.id);
    expect(userEvents.filter((e) => e.event === 'chat:message' && e.userId === 'u2')).toHaveLength(1);
  });

  it('a retried file upload with the same client id stores nothing new', async () => {
    const convId = await dm();
    const headers = await auth('u1');
    const send = () => {
      const boundary = '----mico360retry';
      const payload = [`--${boundary}\r\nContent-Disposition: form-data; name="clientId"\r\n\r\nup-1\r\n`, `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n`, `--${boundary}--\r\n`].join('');
      return app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    };
    const a = await send();
    const b = await send();
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.json().data.id).toBe(a.json().data.id);
    expect(storage.saved).toHaveLength(1);
  });

  it('a reply comes back with the quote of the message it answers', async () => {
    const convId = await dm();
    const q = (await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers: await auth('u2'), payload: { body: 'Ready?' } })).json().data;
    const r = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers: await auth('u1'), payload: { body: 'Yes', replyToId: q.id } });
    expect(r.json().data.replyTo).toMatchObject({ id: q.id, userId: 'u2', body: 'Ready?' });
  });

  it('saves favorite / archived / muted for the caller only; outsiders are refused', async () => {
    const convId = await dm();
    const res = await app.inject({ method: 'PUT', url: `/api/v1/conversations/${convId}/prefs`, headers: await auth('u1'), payload: { favorite: true, muted: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ favorite: true, archived: false, muted: true });
    const inbox = (await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: await auth('u1') })).json().data;
    expect(inbox.find((s: { conversation: { id: string } }) => s.conversation.id === convId).prefs.favorite).toBe(true);
    // Your other tabs and your phone hear about it (a muted or archived conversation leaves the Chat badge), and nobody else does.
    const told = userEvents.filter((e) => e.event === 'chat:prefs');
    expect(told.map((e) => e.userId)).toEqual(['u1']);
    expect(told[0]!.payload).toMatchObject({ conversationId: convId, prefs: { favorite: true, muted: true } });
    expect((await app.inject({ method: 'PUT', url: `/api/v1/conversations/${convId}/prefs`, headers: await auth('u3'), payload: { favorite: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/conversations/${convId}/prefs`, headers: await auth('u1'), payload: { favorite: 'yes' } })).statusCode).toBe(400);
  });

  it('records delivery and tells the sender (chat:delivered)', async () => {
    const convId = await dm();
    const res = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/delivered`, headers: await auth('u2') });
    expect(res.statusCode).toBe(204);
    expect(userEvents.some((e) => e.event === 'chat:delivered' && e.userId === 'u1')).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/delivered`, headers: await auth('u3') })).statusCode).toBe(403);
  });

  it('searches the caller’s own conversations (and one conversation), never others', async () => {
    const convId = await dm();
    await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers: await auth('u2'), payload: { body: 'Quarterly budget attached' } });
    const all = await app.inject({ method: 'GET', url: '/api/v1/chat/search?q=budget', headers: await auth('u1') });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((m: { body: string; conversationId: string }) => [m.body, m.conversationId])).toEqual([['Quarterly budget attached', convId]]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/chat/search?q=budget', headers: await auth('u3') })).json().data).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/v1/chat/search?q=budget&conversationId=${convId}`, headers: await auth('u3') })).statusCode).toBe(403);
  });

  it('lists the members of a channel and of a direct conversation', async () => {
    const headers = await auth('u1');
    const channel = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${channel}/members`, headers })).json().data.sort()).toEqual(['u1', 'u2', 'u3']);
    const convId = await dm();
    expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/members`, headers: await auth('u3') })).statusCode).toBe(403);
  });
});

describe('Chat routes — direct messages', () => {
  it('creates a DM (201) and broadcasts a sent message to both users', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: await auth('u1'), payload: { userId: 'u2' } });
    expect(created.statusCode).toBe(201);
    const convId = created.json().data.id;
    expect(created.json().data.kind).toBe('DIRECT');

    await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers: await auth('u1'), payload: { body: 'hey' } });
    const recipients = userEvents.filter((e) => e.event === 'chat:message').map((e) => e.userId).sort();
    expect(recipients).toEqual(['u1', 'u2']);
  });

  it('refuses a DM with a user who does not exist (404)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: await auth('u1'), payload: { userId: 'ghost' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('Chat routes — validation and deleted messages (CHAT-01/04)', () => {
  it('rejects bad paging parameters with 400 instead of 500', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    for (const q of ['before=yesterday', 'limit=abc', 'limit=0', 'limit=1000']) {
      expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages?${q}`, headers })).statusCode).toBe(400);
    }
    const ok = await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages?limit=10&before=${encodeURIComponent(new Date().toISOString())}`, headers });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects a whitespace-only message (400)', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: '   ' } })).statusCode).toBe(400);
  });

  it('returns a deleted message with an empty body through the API', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const msgId = (await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers, payload: { body: 'pw: hunter2' } })).json().data.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/messages/${msgId}`, headers })).statusCode).toBe(204);
    const history = (await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages`, headers: await auth('u2') })).json().data;
    expect(history[0]).toMatchObject({ id: msgId, body: '', attachments: [] });
    expect(history[0].deletedAt).toBeTruthy();
    const inbox = (await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: await auth('u2') })).json().data;
    expect(JSON.stringify(inbox)).not.toContain('hunter2');
  });
});

describe('Chat routes — attachments (SEC-14)', () => {
  it('checks access before storing anything', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const mp = multipart('hi');
    const missing = await app.inject({ method: 'POST', url: '/api/v1/conversations/made-up/attachments', headers: { ...(await auth('u1')), ...mp.headers }, payload: mp.payload });
    expect(missing.statusCode).toBe(404);
    const forbidden = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...(await auth('stranger')), ...mp.headers }, payload: mp.payload });
    expect(forbidden.statusCode).toBe(403);
    expect(storage.saved).toHaveLength(0);
  });

  it('stores the file and posts the message for a member', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const mp = multipart('  the notes  ');
    const res = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.body).toBe('the notes');
    expect(storage.saved).toHaveLength(1);
    expect(storage.removed).toHaveLength(0);
  });

  it('removes the stored file when the message cannot be saved', async () => {
    const repos = makeRepos();
    const chatService = createMessageService({ ...repos, messages: { ...repos.messages, async create() { throw new Error('db down'); } } });
    const disk = fakeStorage();
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const failing = await buildApp({ authService, tokenService, chatService, chatAttachmentStorage: disk });
    const headers = await auth('u1');
    const convId = (await failing.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const mp = multipart();
    const res = await failing.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(500);
    expect(disk.saved).toHaveLength(1);
    expect(disk.removed).toEqual(disk.saved);
  });

  it('stores a picture made smaller, and the message gives the stored size', async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const smaller = Buffer.concat([PNG, Buffer.from('s')]);
    const stored: { content: Buffer; mimeType: string }[] = [];
    const disk = {
      async save(f: { content: Buffer; mimeType: string }) { stored.push(f); return { storageKey: 'pic-0', url: '/uploads/pic-0', sizeBytes: f.content.length }; },
      async remove() {},
    };
    const shrinkImage = vi.fn(async () => smaller);
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const chatService = createMessageService(makeRepos());
    const post = vi.spyOn(chatService, 'postMessage');
    const pics = await buildApp({ authService, tokenService, chatService, chatAttachmentStorage: disk, shrinkImage });
    const headers = await auth('u1');
    const convId = (await pics.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const boundary = '----mico360pic';
    const original = Buffer.concat([PNG, Buffer.alloc(200, 1)]);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
      original,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await pics.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(res.statusCode).toBe(201);
    expect(shrinkImage).toHaveBeenCalledWith(original, 'image/png');
    expect(stored[0]!.content).toEqual(smaller);
    expect(post.mock.calls[0]![2].attachment).toMatchObject({ fileName: 'photo.png', mimeType: 'image/png', sizeBytes: smaller.length });
  });

  it('applies the 4,000-character limit to captions before storing the file', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const mp = multipart('x'.repeat(4001));
    const res = await app.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(400);
    expect(storage.saved).toHaveLength(0);
  });
});

describe('Chat routes — every author has a name, read-only direct chats (companies)', () => {
  async function companyApp() {
    const repos = makeRepos();
    const chatService = createMessageService({
      ...repos,
      members: {
        ...repos.members,
        colleagues: async (a, b) => !(a === 'u3' || b === 'u3'), // u3 shares no company with anyone
        people: async (ids) => ids.map((id) => ({ id, firstName: id.toUpperCase(), lastName: 'Person', username: id, avatarUrl: null })),
      },
    });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return { app: await buildApp({ authService, tokenService, chatService }), repos };
  }

  it('a page of messages carries `authors` beside its messages', async () => {
    const { app: a } = await companyApp();
    const headers = await auth('u1');
    const convId = (await a.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    await a.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/messages`, headers: await auth('u2'), payload: { body: 'hello' } });
    const page = await a.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages`, headers });
    expect(page.json().data).toHaveLength(1);
    expect(page.json().authors).toEqual([{ id: 'u2', name: 'U2 Person', avatarUrl: null }]);
    expect((await a.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.authors).toEqual([{ id: 'u2', name: 'U2 Person', avatarUrl: null }]);
  });

  it('starting a chat with someone who isn’t a colleague is refused; an old one comes back read-only', async () => {
    const { app: a, repos } = await companyApp();
    const refused = await a.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: await auth('u1'), payload: { userId: 'u3' } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toEqual({ code: 'NOT_A_COLLEAGUE', message: 'You can only message people who share a company with you.' });
    const old = await repos.conversations.createDirect();
    await repos.participants.add(old.id, 'u1');
    await repos.participants.add(old.id, 'u3');
    const back = await a.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: await auth('u1'), payload: { userId: 'u3' } });
    expect(back.json().data).toMatchObject({ id: old.id, readOnly: { message: 'You no longer share a company with U3.' } });
    const send = await a.inject({ method: 'POST', url: `/api/v1/conversations/${old.id}/messages`, headers: await auth('u1'), payload: { body: 'hi' } });
    expect(send.statusCode).toBe(403);
    expect(send.json().error.code).toBe('DM_READ_ONLY');
  });
});

describe('Chat routes — review batch 4b', () => {
  /** The route-test repositories with a file store too (the in-memory one keeps rows). */
  async function appWithFiles(opts: { failAfterSave?: boolean; failSave?: boolean } = {}) {
    const repos = makeRepos();
    const rows: MessageAttachmentRecord[] = [];
    let n = 0;
    let saved = false;
    const attachments: ChatAttachmentRepository = {
      async create(messageId, meta) { const r = { id: `att${n++}`, messageId, ...meta, createdAt: new Date() }; rows.push(r); return r; },
      async listByMessages(ids) { if (opts.failAfterSave && saved) throw new Error('db blip after the save'); return rows.filter((r) => ids.includes(r.messageId)); },
      async deleteByMessage(messageId) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.messageId === messageId) rows.splice(i, 1); },
      async storageKeyInUse(key) { return rows.some((r) => r.storageKey === key); },
    };
    // As the database store: the message and its file in one go (or neither).
    const messages: MessageRepository = {
      ...repos.messages,
      async createWithAttachment(conversationId, userId, body, extra, file) {
        if (opts.failSave) throw new Error('the save failed');
        const message = await repos.messages.create(conversationId, userId, body, extra);
        const attachment = await attachments.create(message.id, file);
        saved = true;
        return { message, attachment };
      },
    };
    const participants: ParticipantRepository = opts.failAfterSave
      ? { ...repos.participants, async listByConversation(id) { if (saved) { saved = saved && true; throw new Error('db blip after the save'); } return repos.participants.listByConversation(id); } }
      : repos.participants;
    const chatService = createMessageService({ ...repos, messages, participants, attachments });
    const disk = fakeStorage();
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const built = await buildApp({
      authService, tokenService, chatService, chatAttachmentStorage: disk,
      onTaskEvent: (projectId, event, payload) => { projectEvents.push({ projectId, event, payload }); },
      onChatUserEvent: (userId, event, payload) => { userEvents.push({ userId, event, payload }); },
    });
    return { app: built, repos, rows, disk };
  }
  function upload(name: string, clientId?: string) {
    const boundary = '----mico360b4b';
    const payload = Buffer.concat([
      Buffer.from(clientId ? `--${boundary}\r\nContent-Disposition: form-data; name="clientId"\r\n\r\n${clientId}\r\n` : ''),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="`),
      Buffer.from(name, 'utf8'),
      Buffer.from(`"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }

  it('N6: a file with a long, odd name is kept with a clean one (no hidden or right-to-left characters, at most 180)', async () => {
    const { app: a, disk } = await appWithFiles();
    const headers = await auth('u1');
    const convId = (await a.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const odd = `Site visit \u202Etxt.exe notes for Fabrikam ${'x'.repeat(220)}.txt`;
    const mp = upload(odd);
    const res = await a.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(201);
    const name: string = res.json().data.attachments[0].fileName;
    const hiddenOrTurning = (c: number) => c < 0x20 || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    expect([...name].filter((ch) => hiddenOrTurning(ch.codePointAt(0)!))).toEqual([]);
    expect([...name].length).toBeLessThanOrEqual(180);
    expect(name.startsWith('Site visit txt.exe notes for Fabrikam')).toBe(true);
    expect(name.endsWith('.txt')).toBe(true);
    expect(disk.saved).toHaveLength(1);
  });

  it('#18: a retry with the client id of a message that has no file stores nothing and adds nothing to it (review M2: no back-dating)', async () => {
    const { app: a, repos, rows, disk } = await appWithFiles();
    const headers = await auth('u1');
    const convId = (await a.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers, payload: { userId: 'u2' } })).json().data.id;
    const old = await repos.messages.create(convId, 'u1', 'an old text message', { clientId: 'up-old' });
    const mp = upload('plan.txt', 'up-old');
    const res = await a.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(old.id);
    expect(res.json().data.attachments).toEqual([]);
    expect(rows).toHaveLength(0);
    expect(disk.saved).toHaveLength(0);
  });

  it('review I1: once the message and its file are saved, a failure in what follows never deletes the file', async () => {
    const { app: a, repos, rows, disk } = await appWithFiles({ failAfterSave: true });
    const headers = await auth('u1');
    const convId = (await a.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers, payload: { userId: 'u2' } })).json().data.id;
    const mp = upload('plan.txt', 'up-i1');
    const res = await a.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(rows).toHaveLength(1);
    expect(disk.saved).toHaveLength(1);
    expect(disk.removed).toEqual([]);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.attachments.map((x: { storageKey: string }) => x.storageKey)).toEqual([disk.saved[0]]);
    void repos;
  });

  it('review I1: when the save itself fails, the stored file is removed only if no record keeps it', async () => {
    const { app: a, rows, disk } = await appWithFiles({ failSave: true });
    const headers = await auth('u1');
    const convId = (await a.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers, payload: { userId: 'u2' } })).json().data.id;
    const mp = upload('plan.txt', 'up-i1b');
    const res = await a.inject({ method: 'POST', url: `/api/v1/conversations/${convId}/attachments`, headers: { ...headers, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(500);
    expect(rows).toHaveLength(0);
    expect(disk.removed).toEqual(disk.saved);
  });

  it('#20: history takes the new cursor (before + beforeId) and still the old one (before only); an id alone is refused', async () => {
    const headers = await auth('u1');
    const convId = (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/chat', headers })).json().data.conversation.id;
    const at = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages?before=${at}&beforeId=msg42&limit=10`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages?before=${at}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages?beforeId=msg42`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/conversations/${convId}/messages?before=${at}&beforeId=${'x'.repeat(65)}`, headers })).statusCode).toBe(400);
  });
});
