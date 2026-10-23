// @vitest-environment jsdom
/**
 * Stage 5: chat stays current. The inbox as on the web (favorites, project channels, direct
 * messages, the archive; mute, favorite and archive from each row; a new direct message), and a
 * thread that reads itself again every few seconds while it is on screen — showing files, the
 * message a reply answers and reactions, loading older messages, and sending text, files and
 * pasted pictures. The server is told which direct messages reached this device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatScreen } from '../app/screens/chat.js';
import { ApiError } from './errors.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = 'u1';
const DIRECTORY = [
  { id: 'u1', firstName: 'Mariam', lastName: 'Al Hinai', username: 'mariam' },
  { id: 'u2', firstName: 'Omar', lastName: 'Ahmed', username: 'omar' },
  { id: 'u3', firstName: 'Aisha', lastName: 'Khan', username: 'aisha' },
];
const PROJECTS = [{ id: 'p1', name: 'Rig' }, { id: 'p2', name: 'Office' }];
const at = (m) => `2026-10-21T09:${String(m).padStart(2, '0')}:00.000Z`;
const msg = (id, minute, over = {}) => ({ id, conversationId: 'cv1', userId: 'u2', body: `Message ${id}`, editedAt: null, deletedAt: null, createdAt: at(minute), reactions: [], attachments: [], replyTo: null, ...over });

function inbox(over = {}) {
  return over.inbox ?? [
    { conversation: { id: 'ch1', kind: 'PROJECT', projectId: 'p1', createdAt: at(0) }, participants: [], unread: 2, lastMessage: msg('a', 5, { conversationId: 'ch1', body: 'Pump is fixed' }), prefs: { favorite: false, archived: false, muted: false } },
    { conversation: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: at(0) }, participants: [{ userId: 'u1', lastReadAt: null, lastDeliveredAt: null }, { userId: 'u2' }], unread: 1, lastMessage: msg('b', 7, { conversationId: 'd1', body: 'Call me' }), prefs: { favorite: false, archived: false, muted: true } },
    { conversation: { id: 'd2', kind: 'DIRECT', projectId: null, createdAt: at(0) }, participants: [{ userId: 'u1', lastReadAt: at(9) }, { userId: 'u3' }], unread: 0, lastMessage: msg('c', 3, { conversationId: 'd2', userId: 'u1', body: 'Thanks' }), prefs: { favorite: false, archived: true, muted: false } },
  ];
}

function chatCtx(over = {}) {
  let pages = over.messages ?? [msg('m1', 1), msg('m2', 2, { userId: 'u1' })];
  const ctx = {
    params: over.conversationId ? { conversationId: over.conversationId } : {},
    me: { id: ME, name: 'Mariam Al Hinai' },
    apiBase: 'http://localhost:4000/api/v1',
    isOnline: over.isOnline ?? (() => true),
    chatPollMs: over.chatPollMs ?? 60000,
    navigate: vi.fn(),
    afterMutation: vi.fn(),
    write: over.write ?? vi.fn(async (kind, p, opts) => ({ queued: false, data: { ...msg('srv-1', 30, { userId: ME, body: p.body, conversationId: p.conversationId }), clientId: opts && opts.idempotencyKey } })),
    api: {
      projects: { list: vi.fn(async () => ({ data: PROJECTS })) },
      directory: vi.fn(async () => ({ data: DIRECTORY })),
      chat: {
        conversations: over.conversations ?? vi.fn(async () => ({ data: inbox(over) })),
        openProjectChannel: over.openProjectChannel ?? vi.fn(async (pid) => ({ conversation: { id: `ch-${pid}`, kind: 'PROJECT', projectId: pid }, messages: [] })),
        messages: over.read ?? vi.fn(async () => ({ data: typeof pages === 'function' ? pages() : pages })),
        older: over.older ?? vi.fn(async () => []),
        markRead: vi.fn(async () => {}),
        markDelivered: vi.fn(async () => {}),
        startDirect: over.startDirect ?? vi.fn(async (userId) => ({ id: `dm-${userId}`, kind: 'DIRECT' })),
        setPrefs: over.setPrefs ?? vi.fn(async (id, patch) => ({ favorite: false, archived: false, muted: false, ...patch })),
        upload: over.upload ?? vi.fn(async (cid, file, { clientId, body }) => ({ ...msg('up-1', 31, { userId: ME, conversationId: cid, body: body || '' }), clientId, attachments: [{ id: 'a9', fileName: file.name, mimeType: file.type, sizeBytes: file.size, url: '/uploads/a9.png' }] })),
      },
    },
    setMessages: (next) => { pages = next; },
  };
  return ctx;
}

async function open(ctx) {
  const root = ChatScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}
const section = (root, title) => [...root.querySelectorAll('.chat-section')].find((s) => s.querySelector('.chat-section-toggle')?.textContent.includes(title));
const rowTitled = (root, title) => [...root.querySelectorAll('.chat-row')].find((r) => r.querySelector('.chat-row-title')?.textContent === title);

describe('the inbox', () => {
  it('favorites, project channels (every project), direct messages and the archive — closed until opened', async () => {
    const root = await open(chatCtx());
    expect(section(root, 'Project channels').textContent).toContain('Rig');
    expect(section(root, 'Project channels').textContent).toContain('Office'); // not opened yet: still listed
    const omar = rowTitled(root, 'Omar Ahmed');
    expect(section(root, 'Direct messages').contains(omar)).toBe(true);
    expect(omar.textContent).toContain('Call me');
    expect(byLabel(omar, 'Muted')).toBeTruthy();
    expect(byLabel(omar, '1 unread')).toBeTruthy();
    expect(rowTitled(root, 'Rig').textContent).toContain('Omar: Pump is fixed');
    const archived = section(root, 'Archived');
    const toggle = archived.querySelector('.chat-section-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rowTitled(root, 'Aisha Khan')).toBeUndefined();
    toggle.click();
    expect(section(root, 'Archived').querySelector('.chat-section-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitled(root, 'Aisha Khan').textContent).toContain('You: Thanks');
  });

  it('a row’s options: add to favorites (it moves to Favorites), saved on the server; a failure goes back and says so', async () => {
    const ctx = chatCtx();
    const root = await open(ctx);
    const more = byLabel(root, 'More options for Omar Ahmed');
    more.click();
    const items = [...root.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(items).toEqual(['Add to favorites', 'Unmute notifications', 'Archive']);
    byText(root, '[role="menuitem"]', 'Add to favorites').click();
    await settle();
    expect(ctx.api.chat.setPrefs).toHaveBeenCalledWith('d1', { favorite: true });
    expect(section(root, 'Favorites').contains(rowTitled(root, 'Omar Ahmed'))).toBe(true);

    ctx.api.chat.setPrefs.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    byLabel(root, 'More options for Omar Ahmed').click();
    byText(root, '[role="menuitem"]', 'Remove from favorites').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Couldn’t change that setting.');
    expect(section(root, 'Favorites').contains(rowTitled(root, 'Omar Ahmed'))).toBe(true);
  });

  it('muting a channel nobody has opened yet opens it first', async () => {
    const ctx = chatCtx();
    const root = await open(ctx);
    byLabel(root, 'More options for Office').click();
    byText(root, '[role="menuitem"]', 'Mute notifications').click();
    await settle();
    expect(ctx.api.chat.openProjectChannel).toHaveBeenCalledWith('p2');
    expect(ctx.api.chat.setPrefs).toHaveBeenCalledWith('ch-p2', { muted: true });
  });

  it('opening a channel; one you aren’t a member of says why', async () => {
    const ctx = chatCtx({ openProjectChannel: vi.fn(async () => { throw new ApiError(403, 'Forbidden', 'FORBIDDEN'); }) });
    const root = await open(ctx);
    rowTitled(root, 'Rig').querySelector('.chat-row-open').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('You can’t open #Rig because you aren’t a member of this project. Ask the project’s manager to add you to the team.');
    const ok = chatCtx();
    document.body.innerHTML = '';
    const root2 = await open(ok);
    rowTitled(root2, 'Rig').querySelector('.chat-row-open').click();
    await settle();
    expect(ok.navigate).toHaveBeenCalledWith('#/chat/ch-p1');
  });

  it('a new direct message: pick a teammate, the conversation opens; one that can’t start says so', async () => {
    const ctx = chatCtx();
    const root = await open(ctx);
    const start = byLabel(root, 'New direct message');
    expect(start.getAttribute('aria-expanded')).toBe('false');
    start.click();
    const pick = byLabel(root, 'Start a direct message');
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Message a teammate…', 'Omar Ahmed (@omar)', 'Aisha Khan (@aisha)']);
    expect(document.activeElement).toBe(pick);
    pick.value = 'u3';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ctx.api.chat.startDirect).toHaveBeenCalledWith('u3');
    expect(ctx.navigate).toHaveBeenCalledWith('#/chat/dm-u3');

    ctx.api.chat.startDirect.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    const again = byLabel(root, 'Start a direct message');
    again.value = 'u2';
    again.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Couldn’t start a conversation with Omar Ahmed.');
  });

  it('tells the server which direct messages reached this device — once each', async () => {
    const ctx = chatCtx();
    const root = await open(ctx);
    expect(ctx.api.chat.markDelivered.mock.calls).toEqual([['d1']]);
    await root.refresh();
    await settle();
    expect(ctx.api.chat.markDelivered).toHaveBeenCalledTimes(1);
  });

  it('reads itself again while on screen: a new message’s unread count shows without coming back', async () => {
    let n = 1;
    const conversations = vi.fn(async () => ({ data: inbox().map((s) => (s.conversation.id === 'd1' ? { ...s, unread: n } : s)) }));
    const ctx = chatCtx({ conversations, chatPollMs: 25 });
    const root = await open(ctx);
    expect(byLabel(rowTitled(root, 'Omar Ahmed'), '1 unread')).toBeTruthy();
    n = 4;
    await wait(80);
    await settle();
    expect(byLabel(rowTitled(root, 'Omar Ahmed'), '4 unread')).toBeTruthy();
    // Nothing new: nothing is drawn again (a screen reader keeps its place).
    const row = rowTitled(root, 'Omar Ahmed');
    await root.refresh();
    await settle();
    expect(rowTitled(root, 'Omar Ahmed')).toBe(row);
    const calls = conversations.mock.calls.length;
    root.remove(); // gone: it stops
    await wait(80);
    expect(conversations.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});

describe('a conversation', () => {
  it('its name, and Mute and Favorite for it', async () => {
    const ctx = chatCtx({ conversationId: 'd1' });
    const root = await open(ctx);
    expect(root.querySelector('.chat-title').textContent).toBe('Omar Ahmed');
    const mute = byLabel(root, 'Mute notifications');
    expect(mute.getAttribute('aria-pressed')).toBe('true'); // muted on the server
    mute.click();
    await settle();
    expect(ctx.api.chat.setPrefs).toHaveBeenCalledWith('d1', { muted: false });
    expect(byLabel(root, 'Mute notifications').getAttribute('aria-pressed')).toBe('false');
    byLabel(root, 'Favorite').click();
    await settle();
    expect(ctx.api.chat.setPrefs).toHaveBeenLastCalledWith('d1', { favorite: true });
    document.body.innerHTML = '';
    const channel = await open(chatCtx({ conversationId: 'ch1' }));
    expect(channel.querySelector('.chat-title').textContent).toBe('# Rig');
  });

  it('shows files (a picture, a document), the message a reply answers, and reactions with who reacted', async () => {
    const ctx = chatCtx({ conversationId: 'd1', messages: [
      msg('m1', 1, { body: 'Here is the gauge', attachments: [{ id: 'a1', fileName: 'gauge.png', mimeType: 'image/png', sizeBytes: 2048, url: '/uploads/a1.png' }], reactions: [{ emoji: '👍', userIds: ['u1', 'u2'] }] }),
      msg('m2', 2, { body: '', attachments: [{ id: 'a2', fileName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 2048, url: '/uploads/a2.pdf' }] }),
      msg('m3', 3, { userId: 'u1', body: 'Looks fine', replyTo: { id: 'm1', userId: 'u2', body: 'Here is the gauge', deleted: false } }),
      msg('m4', 4, { body: 'And this?', replyTo: { id: 'm0', userId: 'u1', body: '', deleted: true } }),
    ] });
    const root = await open(ctx);
    const picture = byLabel(root, 'Open gauge.png');
    expect(picture.tagName).toBe('A');
    expect(picture.getAttribute('href')).toBe('http://localhost:4000/uploads/a1.png');
    expect(picture.getAttribute('target')).toBe('_blank');
    expect(picture.querySelector('img').getAttribute('alt')).toBe('gauge.png');
    expect(byLabel(root, 'Download report.pdf (2 KB)').getAttribute('href')).toBe('http://localhost:4000/uploads/a2.pdf');
    const m2 = root.querySelector('[data-message-id="m2"]');
    expect(m2.querySelector('.txt')).toBeNull(); // only a file: no empty bubble
    expect(root.querySelector('[data-message-id="m3"] .chat-quote').textContent).toContain('Omar Ahmed');
    expect(root.querySelector('[data-message-id="m3"] .chat-quote').textContent).toContain('Here is the gauge');
    expect(root.querySelector('[data-message-id="m4"] .chat-quote').textContent).toContain('This message was deleted.');
    expect(byLabel(root, '👍 2: You and Omar Ahmed')).toBeTruthy();
    expect(root.querySelector('[role="log"]').getAttribute('aria-label')).toBe('Messages');
  });

  it('a file from anywhere but this server isn’t linked', async () => {
    const ctx = chatCtx({ conversationId: 'd1', messages: [msg('m1', 1, { attachments: [{ id: 'a1', fileName: 'x.png', mimeType: 'image/png', sizeBytes: 1, url: 'https://elsewhere.example/x.png' }] })] });
    const root = await open(ctx);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('a[href*="elsewhere"]')).toBeNull();
    expect(root.textContent).toContain('x.png');
  });

  it('older messages: “Load older messages” while there may be more, then “This is the beginning of the conversation.”', async () => {
    const full = Array.from({ length: 50 }, (_, i) => msg(`n${i}`, 10 + i));
    const ctx = chatCtx({ conversationId: 'd1', messages: full, older: vi.fn(async () => [msg('o1', 1), msg('o2', 2)]) });
    const root = await open(ctx);
    const kept = root.querySelector('[data-message-id="n0"]');
    byText(root, 'button', 'Load older messages').click();
    await settle();
    expect(ctx.api.chat.older).toHaveBeenCalledWith('d1', at(10));
    const ids = [...root.querySelectorAll('[data-message-id]')].map((n) => n.dataset.messageId);
    expect(ids.slice(0, 3)).toEqual(['o1', 'o2', 'n0']);
    expect(root.querySelector('[data-message-id="n0"]')).toBe(kept); // what was there stays (and keeps its place)
    expect(root.textContent).toContain('This is the beginning of the conversation.');
    expect(byText(root, 'button', 'Load older messages')).toBeUndefined();
  });

  it('older messages that can’t be read say so', async () => {
    const full = Array.from({ length: 50 }, (_, i) => msg(`n${i}`, 10 + i));
    const ctx = chatCtx({ conversationId: 'd1', messages: full, older: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const root = await open(ctx);
    byText(root, 'button', 'Load older messages').click();
    await settle();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Couldn’t load older messages.');
    expect(byText(root, 'button', 'Load older messages')).toBeTruthy();
  });

  it('reads itself again while on screen: someone’s new message appears; what is typed, focus and the messages already shown stay', async () => {
    const ctx = chatCtx({ conversationId: 'd1', chatPollMs: 25 });
    const root = await open(ctx);
    expect(ctx.api.chat.markRead).toHaveBeenCalledWith('d1');
    const first = root.querySelector('[data-message-id="m1"]');
    const box = root.querySelector('textarea');
    box.focus();
    box.value = 'Half a thought';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.setMessages([msg('m1', 1), msg('m2', 2, { userId: 'u1' }), msg('m3', 3, { body: 'Are you there?' })]);
    await wait(80);
    await settle();
    expect(root.querySelector('[data-message-id="m3"]').textContent).toContain('Are you there?');
    expect(root.querySelector('[data-message-id="m1"]')).toBe(first);
    expect(root.querySelector('textarea')).toBe(box);
    expect(box.value).toBe('Half a thought');
    expect(document.activeElement).toBe(box);
    expect(ctx.api.chat.markRead.mock.calls.length).toBeGreaterThanOrEqual(2); // read as it arrives
  });

  it('while the tab is hidden it waits, and reads itself as soon as you come back (the app asks)', async () => {
    const ctx = chatCtx({ conversationId: 'd1', chatPollMs: 25 });
    const root = await open(ctx);
    const reads = () => ctx.api.chat.messages.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const before = reads();
    await wait(80);
    expect(reads()).toBe(before);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await root.refresh();
    expect(reads()).toBe(before + 1);
    delete document.visibilityState;
  });

  it('couldn’t be read at first (offline, nothing saved): the next read shows it, without pressing Retry', async () => {
    let up = false;
    const read = vi.fn(async () => { if (!up) throw new TypeError('Failed to fetch'); return { data: [msg('m1', 1)] }; });
    const ctx = chatCtx({ conversationId: 'd1', read });
    const root = await open(ctx);
    expect(root.textContent).toContain('Could not load chat.');
    up = true;
    await root.refresh();
    await settle();
    expect(root.querySelector('[data-message-id="m1"]')).toBeTruthy();
    expect(root.textContent).not.toContain('Could not load chat.');

    document.body.innerHTML = '';
    let inboxUp = false;
    const conversations = vi.fn(async () => { if (!inboxUp) throw new TypeError('Failed to fetch'); return { data: inbox() }; });
    const list = await open(chatCtx({ conversations }));
    expect(list.textContent).toContain('Could not load chat.');
    inboxUp = true;
    await list.refresh();
    await settle();
    expect(rowTitled(list, 'Omar Ahmed')).toBeTruthy();
  });
});

describe('sending', () => {
  const type = (root, text) => {
    const box = root.querySelector('textarea');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return box;
  };
  const enter = (node, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra }));

  it('Enter sends (Shift+Enter is a new line); it carries one clientId and shows the server’s copy', async () => {
    const ctx = chatCtx({ conversationId: 'd1' });
    const root = await open(ctx);
    const box = type(root, 'On my way');
    enter(box, { shiftKey: true });
    expect(ctx.write).not.toHaveBeenCalled();
    enter(box);
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('chat.send', { conversationId: 'd1', body: 'On my way', clientId: expect.any(String) }, { idempotencyKey: expect.any(String) });
    expect(root.querySelector('[data-message-id="srv-1"]').textContent).toContain('On my way');
    expect(box.value).toBe('');
    expect(root.querySelectorAll('[data-message-id]')).toHaveLength(3); // no stand-in left behind
  });

  it('offline: kept on this device and said so; refused: says why, with Retry (the same message) and Discard', async () => {
    const queued = chatCtx({ conversationId: 'd1', write: vi.fn(async (k, p, o) => ({ queued: true, item: { id: 'q9', idempotencyKey: o.idempotencyKey } })) });
    const root = await open(queued);
    type(root, 'Later');
    byText(root, 'button', 'Send').click();
    await settle();
    expect(root.querySelector('[data-message-id="tmp-q9"]').textContent).toContain('saved on this device, not sent yet');

    document.body.innerHTML = '';
    const refused = chatCtx({ conversationId: 'd1', write: vi.fn(async () => { throw new ApiError(403, 'You are not part of this conversation.', 'FORBIDDEN'); }) });
    const r2 = await open(refused);
    type(r2, 'Hello?');
    byText(r2, 'button', 'Send').click();
    await settle();
    const failed = [...r2.querySelectorAll('[data-message-id]')].find((n) => n.textContent.includes('Hello?'));
    expect(failed.textContent).toContain('Not sent — You are not part of this conversation.');
    const [{ clientId }, { idempotencyKey: key }] = refused.write.mock.calls[0].slice(1);
    byText(failed, 'button', 'Retry').click();
    await settle();
    // The same message (its clientId), a new try (the server keeps its refusal of the last key).
    expect(refused.write.mock.calls[1][1].clientId).toBe(clientId);
    expect(refused.write.mock.calls[1][2].idempotencyKey).not.toBe(key);
    const again = [...r2.querySelectorAll('[data-message-id]')].find((n) => n.textContent.includes('Hello?'));
    byText(again, 'button', 'Discard').click();
    expect([...r2.querySelectorAll('[data-message-id]')].some((n) => n.textContent.includes('Hello?'))).toBe(false);
  });

  it('too long: says so, and keeps what was typed', async () => {
    const ctx = chatCtx({ conversationId: 'd1' });
    const root = await open(ctx);
    type(root, 'x'.repeat(4001));
    byText(root, 'button', 'Send').click();
    await settle();
    expect(ctx.write).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]').textContent).toBe(`Messages can be up to ${(4000).toLocaleString()} characters. This one has ${(4001).toLocaleString()}.`);
    expect(root.querySelector('textarea').value).toHaveLength(4001);
  });

  it('files: each goes as a message (the first with what was typed), with its own clientId', async () => {
    const ctx = chatCtx({ conversationId: 'd1' });
    const root = await open(ctx);
    type(root, 'The gauge');
    const input = byLabel(root, 'Attach files');
    const file = new File(['png'], 'gauge.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ctx.api.chat.upload).toHaveBeenCalledWith('d1', file, { clientId: expect.any(String), body: 'The gauge' });
    expect(byLabel(root, 'Open gauge.png')).toBeTruthy();
    expect(root.querySelector('textarea').value).toBe('');
  });

  it('a picture pasted into the box, or files dropped on it, are sent', async () => {
    const ctx = chatCtx({ conversationId: 'd1' });
    const root = await open(ctx);
    const box = root.querySelector('textarea');
    const shot = new File(['png'], 'image.png', { type: 'image/png', lastModified: Date.now() });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { files: [shot], items: [{ kind: 'file', type: 'image/png', getAsFile: () => shot }], types: ['Files'], getData: () => '' };
    box.dispatchEvent(paste);
    await settle();
    expect(paste.defaultPrevented).toBe(true);
    expect(ctx.api.chat.upload).toHaveBeenCalledTimes(1);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    const doc = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' });
    drop.dataTransfer = { types: ['Files'], files: [doc] };
    root.querySelector('.composer').dispatchEvent(drop);
    await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(ctx.api.chat.upload).toHaveBeenCalledTimes(2);
    expect(ctx.api.chat.upload.mock.calls[1][1]).toBe(doc);
  });

  it('a file that can’t be sent says why (the web’s words); offline, files wait for the connection', async () => {
    const ctx = chatCtx({ conversationId: 'd1' });
    const root = await open(ctx);
    const input = byLabel(root, 'Attach files');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'film.mp4', { type: 'video/mp4' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ctx.api.chat.upload).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]').textContent).toBe('“film.mp4” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.');

    document.body.innerHTML = '';
    const off = chatCtx({ conversationId: 'd1', isOnline: () => false });
    const r2 = await open(off);
    const input2 = byLabel(r2, 'Attach files');
    Object.defineProperty(input2, 'files', { configurable: true, value: [new File(['x'], 'gauge.png', { type: 'image/png' })] });
    input2.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(off.api.chat.upload).not.toHaveBeenCalled();
    expect(r2.querySelector('[role="alert"]').textContent).toBe('Files can’t be sent offline. Send them when you’re connected.');
  });

  it('an upload that fails stays, saying why, with Retry (the same clientId) and Discard', async () => {
    const upload = vi.fn(async () => { throw new ApiError(400, 'File is empty.', 'VALIDATION_ERROR'); });
    const ctx = chatCtx({ conversationId: 'd1', upload });
    const root = await open(ctx);
    const input = byLabel(root, 'Attach files');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'gauge.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const failed = [...root.querySelectorAll('[data-message-id]')].find((n) => n.textContent.includes('gauge.png'));
    expect(failed.textContent).toContain('Not sent — File is empty.');
    byText(failed, 'button', 'Retry').click();
    await settle();
    expect(upload.mock.calls[1][2].clientId).toBe(upload.mock.calls[0][2].clientId);
  });
});

describe('a message’s time', () => {
  it('a clock time today, “Yesterday …”, else the date — fixed, so it never goes out of date', async () => {
    const { messageTime } = await import('../app/chat/message.js');
    const now = new Date(2026, 9, 21, 15, 0);
    const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const today = new Date(2026, 9, 21, 9, 5);
    const yesterday = new Date(2026, 9, 20, 23, 50);
    const earlier = new Date(2026, 9, 2, 8, 0);
    expect(messageTime(today.toISOString(), now)).toBe(clock(today));
    expect(messageTime(yesterday.toISOString(), now)).toBe(`Yesterday ${clock(yesterday)}`);
    expect(messageTime(earlier.toISOString(), now)).toBe(`${earlier.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(earlier)}`);
    expect(messageTime('not a date', now)).toBe('');
  });
});
