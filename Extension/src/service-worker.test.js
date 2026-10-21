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
  contextMenus: { removeAll: vi.fn(async () => {}), create: vi.fn(), onClicked: event('menuClicked') },
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
