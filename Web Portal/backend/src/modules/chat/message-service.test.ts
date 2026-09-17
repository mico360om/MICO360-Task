import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMessageService, type MessageService } from './message-service';
import type {
  Conversation,
  Participant,
  Message,
  Reaction,
  MessageAttachmentRecord,
  ConversationRepository,
  ParticipantRepository,
  MessageRepository,
  ReactionRepository,
  ChatAttachmentRepository,
  ChatMemberLookup,
} from './chat-repository';

/** In-memory repositories for the chat domain, sufficient to exercise the service. */
function makeRepos(opts?: { projectMembers?: Record<string, string[]> }) {
  const projectMembers = opts?.projectMembers ?? { p1: ['u1', 'u2', 'u3'] };
  const convs = new Map<string, Conversation>();
  const parts: Participant[] = [];
  const msgs = new Map<string, Message>();
  const reactions: Reaction[] = [];
  let seq = 0;
  const id = (p: string) => `${p}${seq++}`;

  const conversations: ConversationRepository = {
    async findById(cid) { return convs.get(cid) ?? null; },
    async findProjectConversation(projectId) {
      return [...convs.values()].find((c) => c.kind === 'PROJECT' && c.projectId === projectId) ?? null;
    },
    async findDirectConversation(a, b) {
      for (const c of convs.values()) {
        if (c.kind !== 'DIRECT') continue;
        const ids = parts.filter((p) => p.conversationId === c.id).map((p) => p.userId);
        if (ids.includes(a) && ids.includes(b)) return c;
      }
      return null;
    },
    async createProject(projectId) {
      const c: Conversation = { id: id('conv'), kind: 'PROJECT', projectId, createdAt: new Date() };
      convs.set(c.id, c);
      return c;
    },
    async createDirect() {
      const c: Conversation = { id: id('conv'), kind: 'DIRECT', projectId: null, createdAt: new Date() };
      convs.set(c.id, c);
      return c;
    },
    async listByIds(ids) { return ids.map((i) => convs.get(i)).filter((c): c is Conversation => !!c); },
  };

  const participants: ParticipantRepository = {
    async add(conversationId, userId) {
      let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId);
      if (!p) { p = { conversationId, userId, lastReadAt: null, addedAt: new Date() }; parts.push(p); }
      return p;
    },
    async find(conversationId, userId) {
      return parts.find((x) => x.conversationId === conversationId && x.userId === userId) ?? null;
    },
    async listByConversation(conversationId) { return parts.filter((x) => x.conversationId === conversationId); },
    async listConversationIdsForUser(userId) {
      return [...new Set(parts.filter((x) => x.userId === userId).map((x) => x.conversationId))];
    },
    async setLastRead(conversationId, userId, at) {
      let p = parts.find((x) => x.conversationId === conversationId && x.userId === userId);
      if (!p) { p = { conversationId, userId, lastReadAt: at, addedAt: new Date() }; parts.push(p); }
      else p.lastReadAt = at;
    },
  };

  const messages: MessageRepository = {
    async create(conversationId, userId, body) {
      const m: Message = { id: id('msg'), conversationId, userId, body, editedAt: null, deletedAt: null, createdAt: new Date(Date.now() + seq) };
      msgs.set(m.id, m);
      return m;
    },
    async findById(mid) { return msgs.get(mid) ?? null; },
    async list(conversationId, o) {
      let list = [...msgs.values()].filter((m) => m.conversationId === conversationId);
      if (o.before) list = list.filter((m) => m.createdAt < o.before!);
      return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, o.limit);
    },
    async update(mid, body) { const m = { ...msgs.get(mid)!, body, editedAt: new Date() }; msgs.set(mid, m); return m; },
    async softDelete(mid) { const m = { ...msgs.get(mid)!, deletedAt: new Date() }; msgs.set(mid, m); return m; },
    async countAfter(conversationId, after, excludeUserId) {
      return [...msgs.values()].filter((m) =>
        m.conversationId === conversationId && !m.deletedAt && m.userId !== excludeUserId && (!after || m.createdAt > after),
      ).length;
    },
    async latest(conversationId) {
      return [...msgs.values()].filter((m) => m.conversationId === conversationId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    },
  };

  const reactionRepo: ReactionRepository = {
    async add(messageId, userId, emoji) {
      if (!reactions.find((r) => r.messageId === messageId && r.userId === userId && r.emoji === emoji)) {
        reactions.push({ messageId, userId, emoji });
      }
    },
    async remove(messageId, userId, emoji) {
      const i = reactions.findIndex((r) => r.messageId === messageId && r.userId === userId && r.emoji === emoji);
      if (i >= 0) reactions.splice(i, 1);
    },
    async listByMessages(ids) { return reactions.filter((r) => ids.includes(r.messageId)); },
  };

  const attachmentRows: MessageAttachmentRecord[] = [];
  const attachments: ChatAttachmentRepository = {
    async create(messageId, meta) {
      const rec: MessageAttachmentRecord = { id: id('att'), messageId, ...meta, createdAt: new Date() };
      attachmentRows.push(rec);
      return rec;
    },
    async listByMessages(ids) { return attachmentRows.filter((a) => ids.includes(a.messageId)); },
    async deleteByMessage(messageId) {
      for (let i = attachmentRows.length - 1; i >= 0; i--) if (attachmentRows[i]!.messageId === messageId) attachmentRows.splice(i, 1);
    },
  };

  // Fake storage that records which files it was told to remove (assert deletes reach disk).
  const removedKeys: string[] = [];
  const storage = { async save() { return { storageKey: 'x', url: '/uploads/x', sizeBytes: 0 }; }, async remove(key: string) { removedKeys.push(key); } };

  const members: ChatMemberLookup = {
    async isProjectMember(projectId, userId) { return (projectMembers[projectId] ?? []).includes(userId); },
    async projectIdsForUser(userId) { return Object.keys(projectMembers).filter((pid) => projectMembers[pid]!.includes(userId)); },
  };

  return { conversations, participants, messages, reactions: reactionRepo, attachments, members, storage, removedKeys };
}

let svc: MessageService;
let deps: ReturnType<typeof makeRepos>;
beforeEach(() => {
  deps = makeRepos();
  svc = createMessageService(deps);
});

describe('project conversations', () => {
  it('gets-or-creates one channel per project for a member (idempotent)', async () => {
    const a = await svc.getOrCreateProjectConversation('p1', 'u1');
    const b = await svc.getOrCreateProjectConversation('p1', 'u2');
    expect(a.kind).toBe('PROJECT');
    expect(a.id).toBe(b.id); // same channel
  });

  it('forbids a non-member from opening the project channel', async () => {
    await expect(svc.getOrCreateProjectConversation('p1', 'stranger')).rejects.toThrow(/forbidden|access|member/i);
  });
});

describe('direct conversations', () => {
  it('creates a 1:1 conversation with both participants and is order-independent', async () => {
    const a = await svc.getOrCreateDirectConversation('u1', 'u2');
    const b = await svc.getOrCreateDirectConversation('u2', 'u1');
    expect(a.id).toBe(b.id);
    const ps = await deps.participants.listByConversation(a.id);
    expect(ps.map((p) => p.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('rejects a DM with yourself', async () => {
    await expect(svc.getOrCreateDirectConversation('u1', 'u1')).rejects.toThrow();
  });
});

describe('sending + listing messages', () => {
  it('sends and lists messages oldest-first', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    await svc.sendMessage(c.id, 'u1', 'first');
    await svc.sendMessage(c.id, 'u2', 'second');
    const view = await svc.listMessages(c.id, 'u1', { limit: 50 });
    expect(view.messages.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('forbids sending to a project channel you are not a member of', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    await expect(svc.sendMessage(c.id, 'stranger', 'hi')).rejects.toThrow(/forbidden|access/i);
  });

  it('fires onMention for each @username in a message', async () => {
    const onMention = vi.fn();
    svc = createMessageService({ ...deps, onMention });
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    await svc.sendMessage(c.id, 'u1', 'hey @ada and @ben');
    expect(onMention).toHaveBeenCalledWith(expect.objectContaining({ authorId: 'u1', usernames: ['ada', 'ben'] }));
  });

  it('fires onDirectMessage to the recipient of a DM', async () => {
    const onDirectMessage = vi.fn();
    svc = createMessageService({ ...deps, onDirectMessage });
    const c = await svc.getOrCreateDirectConversation('u1', 'u2');
    await svc.sendMessage(c.id, 'u1', 'hello');
    expect(onDirectMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'u2', authorId: 'u1' }));
  });
});

describe('editing + deleting', () => {
  it('lets the author edit their message and stamps editedAt', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    const m = await svc.sendMessage(c.id, 'u1', 'typo');
    const edited = await svc.editMessage(m.id, 'u1', 'fixed');
    expect(edited.body).toBe('fixed');
    expect(edited.editedAt).not.toBeNull();
  });

  it('forbids editing someone else’s message', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    const m = await svc.sendMessage(c.id, 'u1', 'mine');
    await expect(svc.editMessage(m.id, 'u2', 'hacked')).rejects.toThrow(/forbidden|own/i);
  });

  it('soft-deletes your own message; a moderator can delete others’', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    const m = await svc.sendMessage(c.id, 'u1', 'oops');
    const del = await svc.deleteMessage(m.id, 'u2', true); // moderator
    expect(del.deletedAt).not.toBeNull();
  });

  it('forbids a non-moderator from deleting someone else’s message', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    const m = await svc.sendMessage(c.id, 'u1', 'mine');
    await expect(svc.deleteMessage(m.id, 'u2', false)).rejects.toThrow(/forbidden|own/i);
  });
});

describe('reactions', () => {
  it('adds and removes a reaction, grouped in the message view', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    const m = await svc.sendMessage(c.id, 'u1', 'ship it');
    await svc.addReaction(m.id, 'u2', '👍');
    await svc.addReaction(m.id, 'u3', '👍');
    let view = await svc.listMessages(c.id, 'u1', { limit: 50 });
    const g = view.messages[0]!.reactions.find((r) => r.emoji === '👍');
    expect(g?.userIds.sort()).toEqual(['u2', 'u3']);
    await svc.removeReaction(m.id, 'u2', '👍');
    view = await svc.listMessages(c.id, 'u1', { limit: 50 });
    expect(view.messages[0]!.reactions.find((r) => r.emoji === '👍')?.userIds).toEqual(['u3']);
  });
});

describe('attachments', () => {
  it('persists an attachment sent with a message and surfaces it (with a url) in the view', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    await svc.sendMessage(c.id, 'u1', 'here is the spec', {
      fileName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 1234, storageKey: 'abc.pdf',
    });
    const view = await svc.listMessages(c.id, 'u1', { limit: 50 });
    const att = view.messages[0]!.attachments;
    expect(att).toHaveLength(1);
    expect(att[0]!.fileName).toBe('spec.pdf');
    expect(att[0]!.url).toBe('/uploads/abc.pdf');
  });

  it('removes the attachment file + rows from storage when the message is deleted', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    const m = await svc.sendMessage(c.id, 'u1', 'here is the spec', {
      fileName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 1234, storageKey: 'gone.pdf',
    });
    await svc.deleteMessage(m.id, 'u1', false);
    // the physical file was removed from storage…
    expect(deps.removedKeys).toContain('gone.pdf');
    // …and the attachment row no longer surfaces (even though the tombstone message row remains)
    expect(await deps.attachments.listByMessages([m.id])).toHaveLength(0);
  });
});

describe('unread + read state', () => {
  it('counts messages from others as unread and clears them on markRead', async () => {
    const c = await svc.getOrCreateProjectConversation('p1', 'u1');
    await svc.sendMessage(c.id, 'u2', 'you around?');
    await svc.sendMessage(c.id, 'u2', 'ping');
    expect(await svc.unreadCount(c.id, 'u1')).toBe(2);
    // your own messages never count as unread for you
    await svc.sendMessage(c.id, 'u1', 'here');
    expect(await svc.unreadCount(c.id, 'u1')).toBe(2);
    await svc.markRead(c.id, 'u1');
    expect(await svc.unreadCount(c.id, 'u1')).toBe(0);
  });
});

describe('conversation inbox', () => {
  it('lists my project channels and DMs with unread counts and a last message', async () => {
    const chan = await svc.getOrCreateProjectConversation('p1', 'u1');
    await svc.sendMessage(chan.id, 'u2', 'channel hi');
    const dm = await svc.getOrCreateDirectConversation('u1', 'u2');
    await svc.sendMessage(dm.id, 'u2', 'dm hi');

    const inbox = await svc.listConversations('u1');
    expect(inbox.length).toBe(2);
    const chanSummary = inbox.find((s) => s.conversation.id === chan.id);
    expect(chanSummary?.unread).toBe(1);
    expect(chanSummary?.lastMessage?.body).toBe('channel hi');
    const dmSummary = inbox.find((s) => s.conversation.id === dm.id);
    expect(dmSummary?.unread).toBe(1);
  });
});
