// @vitest-environment jsdom
/**
 * Stage 7 review fixes — the side panel’s new-task form: one kept form per window (and none left
 * after sign-out), “Recently added” following the queue, reading its projects again, one offline
 * bar, and saying when the side panel couldn’t open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuickAddForm } from '../popup/quick-add-form.js';
import { openSidePanel } from './side-panel.js';
import { clearUserData, startSession } from './session.js';
import { RECENT_KEY } from './quick-add.js';
import { fakeStorage } from './test-helpers.js';

const TZ = 'Asia/Muscat';
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function show(node) {
  document.body.append(node);
  await settle();
  return node;
}

// ---- The side panel's form --------------------------------------------------------------------------

/** A chrome.storage stand-in whose own onChanged hears its writes (as chrome.storage.local.onChanged does). */
function storageWithEvents(init = {}) {
  const s = fakeStorage(init);
  const listeners = [];
  const fire = (changes) => { for (const l of listeners) l(changes); };
  return {
    data: s.data,
    get: s.get,
    async set(obj) {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { oldValue: s.data[k], newValue: v }]));
      await s.set(obj);
      fire(changes);
    },
    async remove(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      const changes = Object.fromEntries(ks.filter((k) => k in s.data).map((k) => [k, { oldValue: s.data[k] }]));
      await s.remove(keys);
      fire(changes);
    },
    onChanged: { addListener: (fn) => listeners.push(fn), removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } },
  };
}

const PROJ = [{ id: 'p1', name: 'Ops', code: 'OPS', status: 'ACTIVE' }];
function formCtx(over = {}) {
  let n = 0;
  return {
    me: { id: 'me', name: 'Mariam' },
    timeZone: TZ,
    appBase: 'https://task.mico360.com',
    local: fakeStorage(),
    session: fakeStorage(),
    isOnline: () => true,
    api: {
      projects: {
        list: vi.fn(async () => ({ data: PROJ })),
        columns: vi.fn(async () => ({ data: [{ id: 'c1', name: 'To do', category: 'TODO', position: 0, enabled: true }] })),
        members: vi.fn(async () => ({ data: [] })),
      },
      ai: { parseTask: vi.fn() },
      attachments: { upload: vi.fn() },
    },
    newKey: () => `key-${(n += 1)}`,
    send: vi.fn(async (kind, payload) => ({ queued: false, data: { id: 't9', key: 'OPS-12', title: payload.title, projectId: payload.projectId } })),
    currentPage: vi.fn(async () => null),
    capture: null,
    openApp: vi.fn(),
    close: vi.fn(),
    inPanel: true,
    ...over,
  };
}
const type = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };

describe('review fix #2: a side panel in each window keeps its own unsent form', () => {
  const key = (windowId) => `mico360.quickAdd.panelDraft:${windowId}`;

  it('typing in one window’s panel doesn’t replace what the other window’s panel kept', async () => {
    const session = fakeStorage();
    const one = await show(QuickAddForm(formCtx({ session, panelDraftKey: async () => key(1) })));
    type(one.querySelector('#qa-title'), 'From window one');
    await settle();
    one.remove();
    const two = await show(QuickAddForm(formCtx({ session, panelDraftKey: async () => key(2) })));
    type(two.querySelector('#qa-title'), 'From window two');
    await settle();
    two.remove();
    const again = await show(QuickAddForm(formCtx({ session, panelDraftKey: async () => key(1) })));
    expect(again.querySelector('#qa-title').value).toBe('From window one');
    expect(session.data[key(1)]).toMatchObject({ userId: 'me', fields: { title: 'From window one' } });
    expect(session.data[key(2)]).toMatchObject({ userId: 'me', fields: { title: 'From window two' } });
  });

  it('signing out, or someone else signing in, takes every window’s kept form', async () => {
    const kept = () => fakeStorage({ [key(1)]: { userId: 'u1', fields: { title: 'A' } }, [key(2)]: { userId: 'u1', fields: { title: 'B' } }, other: 1 });
    const session = kept();
    await clearUserData({ local: fakeStorage(), session });
    expect(Object.keys(session.data)).toEqual(['other']);
    const next = kept();
    await startSession({ local: fakeStorage({ cacheOwner: 'u1' }), session: next }, { accessToken: 'a', refreshToken: 'r', userId: 'u2', apiBase: 'https://task.mico360.com/api/v1' });
    expect(next.data[key(1)]).toBeUndefined();
    expect(next.data[key(2)]).toBeUndefined();
  });
});

describe('review fix #3: the kept form’s “Recently added” follows the queue', () => {
  const recent = { [RECENT_KEY]: { userId: 'me', items: [{ queuedKey: 'k1', title: 'Saved offline', projectId: 'p1', at: 1 }] } };
  const item = (status) => ({ id: 'q1', kind: 'task.create', payload: {}, userId: 'me', idempotencyKey: 'k1', status, attempts: 0 });

  it('“Waiting to sync” becomes “Synced” once the queue has synced it — without opening the form again', async () => {
    const local = storageWithEvents({ ...recent, syncQueue: [item('pending')] });
    const root = await show(QuickAddForm(formCtx({ local })));
    expect(root.querySelector('.qa-recent').textContent).toContain('Waiting to sync');
    await local.set({ syncQueue: [] });
    await settle();
    expect(root.querySelector('.qa-recent').textContent).toContain('Synced to Ops');
    expect(root.querySelector('.qa-recent').textContent).not.toContain('Waiting to sync');
  });

  it('…or “Couldn’t sync — see Settings → Sync” when the sync gave up on it', async () => {
    const local = storageWithEvents({ ...recent, syncQueue: [item('pending')] });
    const root = await show(QuickAddForm(formCtx({ local })));
    await local.set({ syncQueue: [item('failed')] });
    await settle();
    expect(root.querySelector('.qa-recent').textContent).toContain('Couldn’t sync — see Settings → Sync');
  });

  it('reading again (the Add tab shown again) brings a project made since; a read that fails keeps what is there, quietly', async () => {
    const ctx = formCtx();
    const root = await show(QuickAddForm(ctx));
    ctx.api.projects.list.mockResolvedValueOnce({ data: [...PROJ, { id: 'p2', name: 'Pipeline', code: 'PIP', status: 'ACTIVE' }] });
    root.refresh();
    await settle();
    expect([...root.querySelector('#qa-project').options].map((o) => o.textContent)).toEqual(['Ops · OPS', 'Pipeline · PIP']);
    expect(root.querySelector('#qa-project').value).toBe('p1');
    ctx.api.projects.list.mockRejectedValueOnce(new Error('offline'));
    root.refresh();
    await settle();
    expect(root.querySelectorAll('#qa-project option')).toHaveLength(2);
    expect(root.querySelector('.qa-banner')).toBeNull();
  });
});

describe('review fix #9: one offline bar in the side panel', () => {
  it('in the side panel the form has no offline bar of its own (the panel’s bar says it)', async () => {
    const root = await show(QuickAddForm(formCtx({ isOnline: () => false })));
    const bar = root.querySelector('.qa-offbar');
    expect(!!bar && !bar.classList.contains('hidden')).toBe(false);
  });

  it('the toolbar popup still has its own', async () => {
    const root = await show(QuickAddForm(formCtx({ isOnline: () => false, inPanel: false })));
    expect(root.querySelector('.qa-offbar').classList.contains('hidden')).toBe(false);
  });
});

// ---- #8 opening the side panel ----------------------------------------------------------------------

describe('review fix #8: the side panel buttons never fail silently', () => {
  it('the window isn’t known yet: it opens in this window (Chrome’s “current window”, still inside the click)', async () => {
    const open = vi.fn(async () => {});
    const chromeApi = { sidePanel: { open }, windows: { WINDOW_ID_CURRENT: -2 } };
    await expect(openSidePanel(chromeApi, undefined)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith({ windowId: -2 });
  });

  it('the popup says so when Chrome doesn’t open it', async () => {
    const root = await show(QuickAddForm(formCtx({ inPanel: false, openPanel: vi.fn(async () => false), shortcut: async () => '' })));
    root.querySelector('.qa-head [aria-label="Open the side panel"]').click();
    await settle();
    expect(root.querySelector('.qa-banner').textContent).toContain('Couldn’t open the side panel');
  });
});
