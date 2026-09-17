import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createMessageService } from './message-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type {
  Conversation, Participant, Message, Reaction,
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
  };
  const participants: ParticipantRepository = {
    async add(conversationId, userId) { let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId); if (!p) { p = { conversationId, userId, lastReadAt: null, addedAt: new Date() }; parts.push(p); } return p; },
    async find(conversationId, userId) { return parts.find((x) => x.conversationId === conversationId && x.userId === userId) ?? null; },
    async listByConversation(conversationId) { return parts.filter((x) => x.conversationId === conversationId); },
    async listConversationIdsForUser(userId) { return [...new Set(parts.filter((x) => x.userId === userId).map((x) => x.conversationId))]; },
    async setLastRead(conversationId, userId, at) { let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId); if (!p) { p = { conversationId, userId, lastReadAt: at, addedAt: new Date() }; parts.push(p); } else p.lastReadAt = at; },
  };
  const messages: MessageRepository = {
    async create(conversationId, userId, body) { const m: Message = { id: id('msg'), conversationId, userId, body, editedAt: null, deletedAt: null, createdAt: new Date(Date.now() + seq) }; msgs.set(m.id, m); return m; },
    async findById(mid) { return msgs.get(mid) ?? null; },
    async list(conversationId, o) { let l = [...msgs.values()].filter((m) => m.conversationId === conversationId); if (o.before) l = l.filter((m) => m.createdAt < o.before!); return l.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, o.limit); },
    async update(mid, body) { const m = { ...msgs.get(mid)!, body, editedAt: new Date() }; msgs.set(mid, m); return m; },
    async softDelete(mid) { const m = { ...msgs.get(mid)!, deletedAt: new Date() }; msgs.set(mid, m); return m; },
    async countAfter(cid, after, ex) { return [...msgs.values()].filter((m) => m.conversationId === cid && !m.deletedAt && m.userId !== ex && (!after || m.createdAt > after)).length; },
    async latest(cid) { return [...msgs.values()].filter((m) => m.conversationId === cid).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null; },
  };
  const reactionRepo: ReactionRepository = {
    async add(mid, uid, e) { if (!reactions.find((r) => r.messageId === mid && r.userId === uid && r.emoji === e)) reactions.push({ messageId: mid, userId: uid, emoji: e }); },
    async remove(mid, uid, e) { const i = reactions.findIndex((r) => r.messageId === mid && r.userId === uid && r.emoji === e); if (i >= 0) reactions.splice(i, 1); },
    async listByMessages(ids) { return reactions.filter((r) => ids.includes(r.messageId)); },
  };
  const memberLookup: ChatMemberLookup = {
    async isProjectMember(pid, uid) { return (members[pid] ?? []).includes(uid); },
    async projectIdsForUser(uid) { return Object.keys(members).filter((pid) => members[pid]!.includes(uid)); },
  };
  return { conversations, participants, messages, reactions: reactionRepo, members: memberLookup };
}

const tokenService = createTokenService({
  accessSecret: 'chat-access', refreshSecret: 'chat-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const projectEvents: { projectId: string; event: string; payload: unknown }[] = [];
const userEvents: { userId: string; event: string; payload: unknown }[] = [];

async function makeApp() {
  const chatService = createMessageService(makeRepos());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({
    authService, tokenService, chatService,
    onTaskEvent: (projectId, event, payload) => { projectEvents.push({ projectId, event, payload }); },
    onChatUserEvent: (userId, event, payload) => { userEvents.push({ userId, event, payload }); },
  });
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
});
