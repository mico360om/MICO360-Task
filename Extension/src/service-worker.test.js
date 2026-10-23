import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { fakeStorage } from './test-helpers.js';
import { MENU_ID } from './context-menu.js';
import { CAPTURE_KEY } from './quick-add.js';
import { NOTIFICATION_ID } from './notify.js';

// The background worker, loaded against a stand-in for Chrome's APIs (signed out, so it calls no
// server): which listeners it registers, and what they do.
const listeners = {};
const event = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
/** The address bar waits until typing stops before it asks (Stage 6 review fix #10). */
const typingStops = async () => {
  await new Promise((r) => setTimeout(r, 220));
  await settle();
};
const chrome = {
  storage: { local: fakeStorage(), session: fakeStorage() },
  runtime: {
    id: 'ext',
    getURL: (p) => `chrome-extension://ext/${p}`,
    getContexts: vi.fn(async () => []),
    onInstalled: event('installed'),
    onStartup: event('startup'),
    onMessage: event('message'),
  },
  action: { onClicked: event('actionClicked'), setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), openPopup: vi.fn(async () => {}) },
  alarms: { get: vi.fn(async () => ({ name: 'poll' })), create: vi.fn(), onAlarm: event('alarm') },
  notifications: { onClicked: event('notificationClicked'), clear: vi.fn(), create: vi.fn() },
  omnibox: { onInputStarted: event('omniStarted'), onInputChanged: event('omniChanged'), onInputEntered: event('omniEntered'), setDefaultSuggestion: vi.fn() },
  contextMenus: { removeAll: vi.fn(async () => {}), create: vi.fn(), onClicked: event('menuClicked') },
  commands: { onCommand: event('command') },
  sidePanel: { open: vi.fn(async () => {}), setPanelBehavior: vi.fn(async () => {}) },
  tabs: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  windows: { create: vi.fn(async () => ({})), update: vi.fn(async () => {}) },
};

beforeAll(async () => {
  globalThis.chrome = chrome;
  await import('../background/service-worker.js');
});
afterAll(() => {
  delete globalThis.chrome;
});

describe('background worker', () => {
  it('leaves the toolbar button to the popup: it no longer opens the app tab itself', () => {
    expect(listeners.actionClicked).toBeUndefined();
  });

  it('makes the right-click menu when installed or updated', async () => {
    expect(listeners.installed).toHaveLength(1);
    listeners.installed[0]({ reason: 'update', previousVersion: '1.6.0' });
    await settle();
    expect(chrome.contextMenus.create.mock.calls[0][0]).toEqual({ id: MENU_ID, title: 'Add to MICO360 Tasks', contexts: ['selection', 'link', 'page'] });
  });

  it('a click on "Add to MICO360 Tasks" keeps what was clicked and opens the popup', async () => {
    listeners.menuClicked[0]({ menuItemId: MENU_ID, selectionText: 'Call the vendor', pageUrl: 'https://a.example/' }, { windowId: 3, title: 'A', url: 'https://a.example/' });
    await settle();
    expect(chrome.storage.session.data[CAPTURE_KEY]).toMatchObject({ title: 'Call the vendor', page: { title: 'A', url: 'https://a.example/' } });
    expect(chrome.action.openPopup).toHaveBeenCalledWith({ windowId: 3 });
  });

  it('a desktop notification still opens the app at Notifications', async () => {
    listeners.notificationClicked[0](NOTIFICATION_ID);
    await settle();
    expect(chrome.notifications.clear).toHaveBeenCalledWith(NOTIFICATION_ID);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://ext/app/app.html#/notifications' });
  });
});

describe('background worker: a session that ended (review fix #6)', () => {
  it('a poll with nobody signed in takes the last desktop alert off the screen', async () => {
    chrome.notifications.clear.mockClear();
    listeners.alarm[0]({ name: 'poll' });
    await settle();
    expect(chrome.notifications.clear).toHaveBeenCalledWith(NOTIFICATION_ID);
  });
});

describe('background worker: “mico” in the address bar (Stage 6)', () => {
  it('listens to the address bar', () => {
    expect(listeners.omniChanged).toHaveLength(1);
    expect(listeners.omniEntered).toHaveLength(1);
  });

  it('signed out: suggests nothing, and says to sign in', async () => {
    const suggest = vi.fn();
    listeners.omniChanged[0]('rig', suggest);
    await typingStops();
    expect(suggest).toHaveBeenCalledWith([]);
    expect(chrome.omnibox.setDefaultSuggestion).toHaveBeenLastCalledWith({ description: 'Sign in to MICO360 Tasks to search it from here' });
  });

  it('review fix #10: waits until typing stops (~150 ms) — one answer for the words last typed, not one per key', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const last = vi.fn();
    listeners.omniChanged[0]('r', first);
    listeners.omniChanged[0]('ri', second);
    listeners.omniChanged[0]('rig', last);
    await settle();
    expect(last).not.toHaveBeenCalled(); // not yet: still typing
    await typingStops();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
  });

  it('review fix #10: Enter opens it where Chrome says — this tab, a new tab, or a new tab behind', async () => {
    chrome.tabs.create.mockClear();
    chrome.tabs.update.mockClear();
    listeners.omniEntered[0]('rig valves', 'currentTab');
    await settle();
    expect(chrome.tabs.update).toHaveBeenCalledWith({ url: 'chrome-extension://ext/app/app.html#/search?q=rig%20valves' });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    listeners.omniEntered[0]('task:t1', 'newForegroundTab');
    await settle();
    expect(chrome.tabs.create).toHaveBeenLastCalledWith({ url: 'chrome-extension://ext/app/app.html#/task/t1', active: true });
    listeners.omniEntered[0]('task:t1', 'newBackgroundTab');
    await settle();
    expect(chrome.tabs.create).toHaveBeenLastCalledWith({ url: 'chrome-extension://ext/app/app.html#/task/t1', active: false });
  });
});

describe('background worker: the side panel (Stage 7)', () => {
  it('its keyboard command opens the side panel in the window it was pressed in — at once, as Chrome needs', () => {
    expect(listeners.command).toHaveLength(1);
    chrome.sidePanel.open.mockClear();
    listeners.command[0]('open-side-panel', { id: 9, windowId: 4 });
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 }); // nothing awaited first
  });

  it('other commands, and a press with no window, open nothing', () => {
    chrome.sidePanel.open.mockClear();
    listeners.command[0]('something-else', { id: 9, windowId: 4 });
    listeners.command[0]('open-side-panel', undefined);
    expect(chrome.sidePanel.open).not.toHaveBeenCalled();
  });

  it('leaves the toolbar button to the popup (it never sets the side panel to open on a toolbar click)', () => {
    expect(chrome.sidePanel.setPanelBehavior).not.toHaveBeenCalled();
  });
});
