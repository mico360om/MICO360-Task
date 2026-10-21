// @vitest-environment jsdom
/**
 * Stage 5 review fixes: Settings → Notifications saves the morning-email time once it has been
 * typed, and its saves go one at a time (the latest wins).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsScreen } from '../app/screens/settings.js';
import { fakeStorage } from './test-helpers.js';
import { DEFAULTS } from './config.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const card = (root, title) => [...root.querySelectorAll('.card')].find((c) => c.querySelector('.section-title')?.textContent === title);

beforeEach(() => {
  document.body.innerHTML = '';
});

function settingsCtx(over = {}) {
  let prefs = { muted: [], reminderLeadMinutes: 60, dailyEmails: { pending: true, completed: true, time: '06:00' } };
  return {
    storage: fakeStorage({ apiBase: DEFAULTS.apiBase, appBase: 'https://tasks.example.com', syncQueue: [] }),
    me: { id: 'u1', name: 'Me', email: 'me@example.com' },
    manifest: { version: '1.6.0' },
    isOnline: () => true,
    api: {
      version: async () => ({ data: { version: '1.6.0' }, stale: false }),
      config: vi.fn(async () => ({ timeZone: 'Asia/Muscat', emailEnabled: true })),
      notifications: {
        preferences: over.read ?? vi.fn(async () => ({ data: prefs, stale: false })),
        setPreferences: over.save ?? vi.fn(async (body) => {
          prefs = { ...prefs, ...body, ...(body.dailyEmails ? { dailyEmails: { ...prefs.dailyEmails, ...body.dailyEmails } } : {}) };
          return prefs;
        }),
      },
    },
    signOut: vi.fn(async () => {}),
    requestSync: vi.fn(),
    afterMutation: vi.fn(),
  };
}

async function openSettings(ctx) {
  const root = SettingsScreen(ctx);
  document.body.append(root);
  await settle();
  return root;
}

describe('#1 the morning-email time is saved once it has been typed, as on the web', () => {
  const timeOf = (root) => card(root, 'Notifications').querySelector('input[type="time"]');
  const change = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('typing it (Chrome reports each part as a change) saves nothing until the field is left, then the whole time', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '');      // the hours being typed
    change(time, '00:00'); // a part typed: Chrome already has a full value
    change(time, '09:45');
    await settle();
    expect(ctx.api.notifications.setPreferences).not.toHaveBeenCalled();
    expect(timeOf(root)).toBe(time); // the field isn't drawn again while it is being typed in
    expect(document.activeElement).toBe(time);
    expect(card(root, 'Notifications').querySelector('[role="alert"]')).toBeNull();
    time.blur();
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledTimes(1);
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledWith({ dailyEmails: { pending: true, completed: true, time: '09:45' } });
  });

  it('Enter saves it too, once', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '07:15');
    time.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledWith({ dailyEmails: { pending: true, completed: true, time: '07:15' } });
    time.blur();
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledTimes(1); // the same time isn't saved again
  });

  it('left half-typed: says how to write it and puts the saved time back', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '');
    time.blur();
    await settle();
    expect(ctx.api.notifications.setPreferences).not.toHaveBeenCalled();
    expect(card(root, 'Notifications').querySelector('[role="alert"]').textContent).toBe('Choose a time, for example 06:00.');
    expect(timeOf(root).value).toBe('06:00');
  });

  it('leaving the field with Tab keeps focus where Tab took it', async () => {
    const ctx = settingsCtx();
    const root = await openSettings(ctx);
    const time = timeOf(root);
    time.focus();
    change(time, '08:00');
    const next = byLabel(card(root, 'Notifications'), 'Desktop alerts');
    next.focus(); // what Tab does: the time loses focus, the next control gets it
    await settle();
    expect(ctx.api.notifications.setPreferences).toHaveBeenCalledTimes(1);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Desktop alerts');
  });
});

describe('#10 preference saves go one at a time, the latest last', () => {
  it('quick changes reach the server in the order made, never two at once, and the screen shows the server’s last answer', async () => {
    let inFlight = 0;
    let most = 0;
    const order = [];
    let prefs = { muted: [], reminderLeadMinutes: 60, dailyEmails: { pending: true, completed: true, time: '06:00' } };
    const save = vi.fn(async (body) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      order.push(body.reminderLeadMinutes);
      // The first answer is the slowest: sent at once, it would land last and win.
      await new Promise((r) => setTimeout(r, order.length === 1 ? 30 : 1));
      prefs = { ...prefs, ...body };
      inFlight -= 1;
      return prefs;
    });
    const ctx = settingsCtx({ save, read: vi.fn(async () => ({ data: prefs, stale: false })) });
    const root = await openSettings(ctx);
    const lead = () => byLabel(card(root, 'Notifications'), 'Reminder timing');
    for (const v of ['0', '240', '1440']) {
      lead().value = v;
      lead().dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 80));
    await settle();
    expect(most).toBe(1);
    expect(order).toEqual([0, 240, 1440]);
    expect(lead().value).toBe('1440');
  });

  it('when one fails, the preferences are read again so the screen shows what the server has', async () => {
    let n = 0;
    const server = { muted: [], reminderLeadMinutes: 240, dailyEmails: { pending: true, completed: true, time: '06:00' } };
    const save = vi.fn(async () => { n += 1; throw new TypeError('Failed to fetch'); });
    const read = vi.fn(async () => ({ data: n ? server : { ...server, reminderLeadMinutes: 60 }, stale: false }));
    const ctx = settingsCtx({ save, read });
    const root = await openSettings(ctx);
    const lead = byLabel(card(root, 'Notifications'), 'Reminder timing');
    lead.value = '1440';
    lead.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(byLabel(card(root, 'Notifications'), 'Reminder timing').value).toBe('240');
    expect(card(root, 'Notifications').querySelector('[role="alert"]').textContent).toBe('Couldn’t save that change. Please try again.');
  });
});

// ---- chat ----------------------------------------------------------------------------------

const ME = 'u1';
const at = (m) => `2026-10-21T09:${String(m).padStart(2, '0')}:00.000Z`;
const msg = (id, minute, over = {}) => ({ id, conversationId: 'd1', userId: 'u2', body: `Message ${id}`, editedAt: null, deletedAt: null, createdAt: at(minute), reactions: [], attachments: [], replyTo: null, ...over });
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);

function chatCtx(over = {}) {
  let pages = over.messages ?? [msg('m1', 1), msg('m2', 2, { userId: ME })];
  return {
    params: { conversationId: over.conversationId ?? 'd1' },
    me: { id: ME, name: 'Mariam' },
    apiBase: 'http://localhost:4000/api/v1',
    storage: over.storage ?? fakeStorage(),
    chatDrafts: over.chatDrafts,
    isOnline: over.isOnline ?? (() => true),
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
        messages: over.read ?? vi.fn(async () => ({ data: typeof pages === 'function' ? pages() : pages })),
        older: vi.fn(async () => []),
        markRead: over.markRead ?? vi.fn(async () => {}),
        markDelivered: vi.fn(async () => {}),
        setPrefs: vi.fn(async () => ({})),
        upload: over.upload ?? vi.fn(async (cid, file, { clientId }) => ({ ...msg('up-1', 31, { userId: ME, body: '' }), clientId, attachments: [{ id: 'a9', fileName: file.name, mimeType: file.type, sizeBytes: file.size, url: '/uploads/a9.png' }] })),
      },
    },
    setMessages: (next) => { pages = next; },
  };
}

async function openChat(ctx) {
  const { ChatScreen } = await import('../app/screens/chat.js');
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
const attachFile = (root, file) => {
  const input = root.querySelector('[aria-label="Attach files"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const keptItem = (body, extra = {}) => ({
  id: `q-${body}`, kind: 'chat.send', userId: ME, payload: { conversationId: 'd1', body, clientId: `cid-${body}` }, idempotencyKey: `k-${body}`,
  queuedAt: Date.now(), attempts: 0, status: 'pending', lastError: null, ...extra,
});

describe('#4 Retry after the server refused a message sends it again with a new key (the same message)', () => {
  it('the clientId stays; the Idempotency-Key is new, so the server doesn’t just give back its refusal', async () => {
    const { ApiError } = await import('./errors.js');
    const write = vi.fn(async () => { throw new ApiError(403, 'You are not part of this conversation.', 'FORBIDDEN'); });
    const ctx = chatCtx({ write });
    const root = await openChat(ctx);
    typeIn(root, 'Hello?');
    byText(root, 'button', 'Send').click();
    await settle();
    const failed = [...root.querySelectorAll('[data-message-id]')].find((n) => n.textContent.includes('Hello?'));
    byText(failed, 'button', 'Retry').click();
    await settle();
    const [first, second] = write.mock.calls;
    expect(first[1].clientId).toEqual(expect.any(String));
    expect(second[1].clientId).toBe(first[1].clientId);
    expect(second[2].idempotencyKey).not.toBe(first[2].idempotencyKey);
  });
});

describe('#2 a file never goes ahead of a message kept on this device', () => {
  const file = () => new File(['png'], 'gauge.png', { type: 'image/png' });

  it('the kept messages are sent first (a sync), then the file', async () => {
    const storage = fakeStorage({ syncQueue: [keptItem('A')] });
    const requestSync = vi.fn(async () => { storage.data.syncQueue = []; });
    const ctx = chatCtx({ storage, requestSync });
    const root = await openChat(ctx);
    attachFile(root, file());
    await settle();
    expect(requestSync).toHaveBeenCalled();
    expect(ctx.api.chat.upload).toHaveBeenCalledTimes(1);
    expect(requestSync.mock.invocationCallOrder[0]).toBeLessThan(ctx.api.chat.upload.mock.invocationCallOrder[0]);
  });

  it('while one is still waiting, the file isn’t sent: it says why, with Retry', async () => {
    const storage = fakeStorage({ syncQueue: [keptItem('A')] });
    const ctx = chatCtx({ storage });
    const root = await openChat(ctx);
    attachFile(root, file());
    await settle();
    expect(ctx.api.chat.upload).not.toHaveBeenCalled();
    const row = [...root.querySelectorAll('[data-message-id]')].find((n) => n.textContent.includes('gauge.png'));
    expect(row.textContent).toContain('Not sent — An earlier message is still waiting to be sent. Try again once it has gone.');
    storage.data.syncQueue = [];
    byText(row, 'button', 'Retry').click();
    await settle();
    expect(ctx.api.chat.upload).toHaveBeenCalledTimes(1);
  });

  it('a message kept in another conversation doesn’t hold the file up', async () => {
    const storage = fakeStorage({ syncQueue: [{ ...keptItem('A'), payload: { conversationId: 'other', body: 'A' } }] });
    const ctx = chatCtx({ storage });
    const root = await openChat(ctx);
    attachFile(root, file());
    await settle();
    expect(ctx.api.chat.upload).toHaveBeenCalledTimes(1);
  });
});
