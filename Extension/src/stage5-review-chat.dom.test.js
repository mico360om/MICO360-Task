// @vitest-environment jsdom
/**
 * Stage 5 review fixes, the chat thread: what was typed and messages that weren't sent stay with
 * their conversation (#5); a message just kept doesn't vanish under a read already under way (#12);
 * the thread reads well with a screen reader and keeps focus (#9); it stops reading while covered,
 * and says when a conversation is gone (#11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatScreen } from '../app/screens/chat.js';
import { createChatDrafts } from './chat-drafts.js';
import { ApiError } from './errors.js';
import { fakeStorage } from './test-helpers.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);

beforeEach(() => {
  document.body.innerHTML = '';
});

const ME = 'u1';
const at = (m) => `2026-10-21T09:${String(m).padStart(2, '0')}:00.000Z`;
const msg = (id, minute, over = {}) => ({ id, conversationId: 'd1', userId: 'u2', body: `Message ${id}`, editedAt: null, deletedAt: null, createdAt: at(minute), reactions: [], attachments: [], replyTo: null, ...over });

function chatCtx(over = {}) {
  const pages = over.messages ?? [msg('m1', 1), msg('m2', 2, { userId: ME })];
  return {
    params: { conversationId: over.conversationId ?? 'd1' },
    me: { id: ME, name: 'Mariam' },
    apiBase: 'http://localhost:4000/api/v1',
    storage: over.storage ?? fakeStorage(),
    chatDrafts: over.chatDrafts,
    isOnline: () => true,
    chatPollMs: over.chatPollMs ?? 60000,
    navigate: vi.fn(),
    afterMutation: vi.fn(),
    requestSync: over.requestSync ?? vi.fn(async () => {}),
    write: over.write ?? vi.fn(async (kind, p) => ({ queued: false, data: { ...msg('srv-1', 30, { userId: ME, body: p.body }), clientId: p.clientId } })),
    api: {
      projects: { list: vi.fn(async () => ({ data: [] })) },
      directory: vi.fn(async () => ({ data: [{ id: 'u2', firstName: 'Omar', lastName: 'Ahmed', username: 'omar' }] })),
      chat: {
        conversations: vi.fn(async () => ({ data: [] })),
        messages: over.read ?? vi.fn(async () => ({ data: pages })),
        older: vi.fn(async () => []),
        markRead: over.markRead ?? vi.fn(async () => {}),
        markDelivered: vi.fn(async () => {}),
        setPrefs: vi.fn(async () => ({})),
        upload: vi.fn(async () => ({})),
      },
    },
  };
}

async function openChat(ctx) {
  const root = ChatScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const typeIn = (root, text) => {
  const box = root.querySelector('textarea');
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return box;
};
const rowWith = (root, text) => [...root.querySelectorAll('[data-message-id]')].find((n) => n.textContent.includes(text));
const keptItem = (body, extra = {}) => ({
  id: `q-${body}`, kind: 'chat.send', userId: ME, payload: { conversationId: 'd1', body, clientId: `cid-${body}` }, idempotencyKey: `k-${body}`,
  queuedAt: Date.now(), attempts: 0, status: 'pending', lastError: null, ...extra,
});

describe('#5 what was typed, and messages that weren’t sent, stay with the conversation', () => {
  const drafts = () => createChatDrafts(fakeStorage(), ME);

  it('text being typed is still there after going Back and returning (another conversation has its own)', async () => {
    const chatDrafts = drafts();
    const first = await openChat(chatCtx({ chatDrafts }));
    typeIn(first, 'Half a thought');
    await settle();
    first.remove();
    const again = await openChat(chatCtx({ chatDrafts }));
    expect(again.querySelector('textarea').value).toBe('Half a thought');
    again.remove();
    const other = await openChat(chatCtx({ chatDrafts, conversationId: 'd2' }));
    expect(other.querySelector('textarea').value).toBe('');
  });

  it('sending it clears the kept text', async () => {
    const chatDrafts = drafts();
    const root = await openChat(chatCtx({ chatDrafts }));
    typeIn(root, 'Sent now');
    byText(root, 'button', 'Send').click();
    await settle();
    root.remove();
    expect((await openChat(chatCtx({ chatDrafts }))).querySelector('textarea').value).toBe('');
  });

  it('a message the server refused is still there, with why, Retry and Discard, after leaving and coming back', async () => {
    const chatDrafts = drafts();
    let refuse = true;
    const write = vi.fn(async (kind, p) => {
      if (refuse) throw new ApiError(403, 'You are not part of this conversation.', 'FORBIDDEN');
      return { queued: false, data: { ...msg('srv-9', 40, { userId: ME, body: p.body }), clientId: p.clientId } };
    });
    const root = await openChat(chatCtx({ chatDrafts, write }));
    typeIn(root, 'Hello?');
    byText(root, 'button', 'Send').click();
    await settle();
    root.remove();
    const back = await openChat(chatCtx({ chatDrafts, write }));
    const row = rowWith(back, 'Hello?');
    expect(row.textContent).toContain('Not sent — You are not part of this conversation.');
    refuse = false;
    byText(row, 'button', 'Retry').click();
    await settle();
    expect(write.mock.calls[1][1].clientId).toBe(write.mock.calls[0][1].clientId);
    back.remove();
    const later = await openChat(chatCtx({ chatDrafts, write }));
    expect(later.querySelectorAll('.msg.failed')).toHaveLength(0); // sent: not kept any more
  });

  it('Discard forgets a refused message for good', async () => {
    const chatDrafts = drafts();
    const write = vi.fn(async () => { throw new ApiError(403, 'No.', 'FORBIDDEN'); });
    const root = await openChat(chatCtx({ chatDrafts, write }));
    typeIn(root, 'Gone');
    byText(root, 'button', 'Send').click();
    await settle();
    byText(rowWith(root, 'Gone'), 'button', 'Discard').click();
    await settle();
    root.remove();
    expect(rowWith(await openChat(chatCtx({ chatDrafts, write })), 'Gone')).toBeUndefined();
  });

  it('a kept message the sync gave up on shows in its thread as not sent, with Retry and Discard', async () => {
    const storage = fakeStorage({ syncQueue: [keptItem('Later', { status: 'failed', attempts: 1, lastError: '403 — You are not part of this conversation.', lastStatus: 403 })] });
    const requestSync = vi.fn(async () => {});
    const root = await openChat(chatCtx({ storage, requestSync }));
    const row = rowWith(root, 'Later');
    expect(row.textContent).toContain('Not sent — You are not part of this conversation.');
    byText(row, 'button', 'Retry').click();
    await settle();
    expect(storage.data.syncQueue[0].status).toBe('pending');
    expect(requestSync).toHaveBeenCalled();
    storage.data.syncQueue = [keptItem('Later', { status: 'failed', lastError: '400 — Too long.', lastStatus: 400 })];
    await root.refresh();
    await settle();
    byText(rowWith(root, 'Later'), 'button', 'Discard').click();
    await settle();
    expect(storage.data.syncQueue).toEqual([]);
    expect(rowWith(root, 'Later')).toBeUndefined();
  });
});

describe('#12 a message just kept on this device doesn’t vanish when a read was already under way', () => {
  it('a read that started before the message was kept keeps showing it', async () => {
    const storage = fakeStorage({ syncQueue: [] });
    let release;
    let slow = false;
    const read = vi.fn(async () => {
      if (slow) await new Promise((r) => { release = r; });
      return { data: [msg('m1', 1)] }; // read before the message was kept: it isn't there
    });
    const write = vi.fn(async (kind, p, o) => {
      const item = { id: 'q7', kind, userId: ME, payload: p, idempotencyKey: o.idempotencyKey, queuedAt: Date.now(), attempts: 0, status: 'pending' };
      storage.data.syncQueue = [...storage.data.syncQueue, item];
      return { queued: true, item };
    });
    const root = await openChat(chatCtx({ storage, read, write }));
    slow = true;
    const reading = root.refresh();
    typeIn(root, 'Kept now');
    byText(root, 'button', 'Send').click();
    await settle();
    release();
    await reading;
    await settle();
    const row = rowWith(root, 'Kept now');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('not sent yet');
  });
});

describe('#9 the thread with a screen reader', () => {
  it('the first page of messages goes into the log while it says it is busy (not read out one by one)', async () => {
    let release;
    const read = vi.fn(() => new Promise((r) => { release = () => r({ data: [msg('m1', 1)] }); }));
    const root = ChatScreen(chatCtx({ read }));
    document.body.append(root);
    await settle();
    const log = root.querySelector('[role="log"]');
    expect(log.getAttribute('aria-busy')).toBe('true');
    release();
    await settle();
    expect(log.hasAttribute('aria-busy')).toBe(false);
    expect(rowWith(root, 'Message m1')).toBeTruthy();
  });

  it('your own message is one entry in the log: the one being sent becomes the sent one in place', async () => {
    let finish;
    const write = vi.fn((kind, p) => new Promise((r) => { finish = () => r({ queued: false, data: { ...msg('srv-1', 30, { userId: ME, body: p.body }), clientId: p.clientId } }); }));
    const root = await openChat(chatCtx({ write }));
    typeIn(root, 'On my way');
    byText(root, 'button', 'Send').click();
    await settle();
    const sending = rowWith(root, 'On my way');
    expect(sending.textContent).toContain('sending…');
    finish();
    await settle();
    const sent = rowWith(root, 'On my way');
    expect(sent).toBe(sending); // the same entry, not a second one
    expect(sent.dataset.messageId).toBe('srv-1');
    expect(sent.textContent).not.toContain('sending…');
    expect(root.querySelectorAll('[data-message-id]')).toHaveLength(3);
  });

  it('Retry keeps focus on the message (it isn’t dropped to the page)', async () => {
    const write = vi.fn(async () => { throw new ApiError(403, 'No.', 'FORBIDDEN'); });
    const root = await openChat(chatCtx({ write }));
    typeIn(root, 'Hello?');
    byText(root, 'button', 'Send').click();
    await settle();
    const retryBtn = byText(rowWith(root, 'Hello?'), 'button', 'Retry');
    retryBtn.focus();
    retryBtn.click();
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(rowWith(root, 'Hello?').contains(document.activeElement)).toBe(true);
  });
});

describe('#11 reading only when it is seen, and a conversation that is gone', () => {
  it('under the task panel (the page behind is inert) it stops reading and marking messages read', async () => {
    const markRead = vi.fn(async () => {});
    let pages = [msg('m1', 1)];
    const read = vi.fn(async () => ({ data: pages }));
    const shell = document.createElement('div');
    document.body.append(shell);
    const root = ChatScreen(chatCtx({ read, markRead, chatPollMs: 20 }));
    shell.append(root);
    await settle();
    const reads = read.mock.calls.length;
    const marks = markRead.mock.calls.length;
    shell.setAttribute('inert', '');
    pages = [msg('m1', 1), msg('m3', 3)];
    await new Promise((r) => setTimeout(r, 80));
    await settle();
    expect(read.mock.calls.length).toBe(reads);
    expect(markRead.mock.calls.length).toBe(marks);
    shell.removeAttribute('inert');
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(read.mock.calls.length).toBeGreaterThan(reads);
    expect(rowWith(root, 'Message m3')).toBeTruthy();
    root.remove();
  });

  it('a conversation that can’t be found says so in the web’s words, with no message box, and isn’t read again', async () => {
    const read = vi.fn(async () => { throw new ApiError(404, 'Conversation not found.', 'NOT_FOUND'); });
    const root = await openChat(chatCtx({ read, chatPollMs: 20 }));
    expect(root.textContent).toContain('This conversation couldn’t be found. It may have been removed.');
    expect(root.textContent).not.toContain('Could not load chat.');
    expect(root.querySelector('textarea')).toBeNull();
    await new Promise((r) => setTimeout(r, 70));
    expect(read).toHaveBeenCalledTimes(1);
    expect(byText(root, 'button', '← Back to Chat')).toBeTruthy();
    root.remove();
  });

  it('one you have no access to says so (the server’s words), with no message box, and isn’t read again', async () => {
    const read = vi.fn(async () => { throw new ApiError(403, 'You are not part of this conversation.', 'FORBIDDEN'); });
    const root = await openChat(chatCtx({ read, chatPollMs: 20 }));
    expect(root.textContent).toContain('You are not part of this conversation.');
    expect(root.querySelector('textarea')).toBeNull();
    await new Promise((r) => setTimeout(r, 70));
    expect(read).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it('a read that fails for a while (offline, the server busy) still tries again', async () => {
    let fail = true;
    const read = vi.fn(async () => { if (fail) throw new TypeError('Failed to fetch'); return { data: [msg('m1', 1)] }; });
    const root = await openChat(chatCtx({ read, chatPollMs: 20 }));
    expect(root.textContent).toContain('Could not load chat.');
    fail = false;
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(rowWith(root, 'Message m1')).toBeTruthy();
    root.remove();
  });
});
