import { describe, it, expect, vi } from 'vitest';
import { createMenu, onMenuClick, MENU_ID, MENU_CONTEXTS } from './context-menu.js';
import { openAppTab } from './open-app.js';
import { CAPTURE_KEY } from './quick-add.js';
import { fakeStorage } from './test-helpers.js';

const EXT = 'chrome-extension://abc/';

function fakeChrome({ openPopup, contexts = [] } = {}) {
  const session = fakeStorage();
  return {
    session,
    runtime: { getURL: (p) => `${EXT}${p}`, getContexts: vi.fn(async () => contexts) },
    contextMenus: { removeAll: vi.fn(async () => {}), create: vi.fn() },
    storage: { session },
    action: openPopup === undefined ? {} : { openPopup },
    windows: { create: vi.fn(async () => ({ id: 9 })), update: vi.fn(async () => {}) },
    tabs: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  };
}

describe('the right-click menu', () => {
  it('has one item, "Add to MICO360 Tasks", for a selection, a link or the page — made afresh on install and update', async () => {
    const chrome = fakeChrome();
    await createMenu(chrome);
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledBefore(chrome.contextMenus.create);
    expect(chrome.contextMenus.create.mock.calls[0][0]).toEqual({ id: MENU_ID, title: 'Add to MICO360 Tasks', contexts: ['selection', 'link', 'page'] });
    expect(MENU_CONTEXTS).toEqual(['selection', 'link', 'page']);
  });

  it('a click keeps what was clicked for the popup (session storage, memory only) and opens the popup', async () => {
    const openPopup = vi.fn(async () => {});
    const chrome = fakeChrome({ openPopup });
    const tab = { id: 4, windowId: 2, title: 'Spec', url: 'https://a.example/spec' };
    expect(await onMenuClick(chrome, { menuItemId: MENU_ID, selectionText: 'Check the pump', pageUrl: tab.url }, tab, { now: () => 1000 })).toBe('popup');
    expect(chrome.session.data[CAPTURE_KEY]).toEqual({ title: 'Check the pump', text: 'Check the pump', link: '', page: { title: 'Spec', url: tab.url }, at: 1000 });
    expect(openPopup).toHaveBeenCalledWith({ windowId: 2 });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('where Chrome can’t open the popup itself (before Chrome 127), it opens in a small window', async () => {
    for (const chrome of [fakeChrome(), fakeChrome({ openPopup: vi.fn(async () => { throw new Error('No active browser window'); }) })]) {
      expect(await onMenuClick(chrome, { menuItemId: MENU_ID, pageUrl: 'https://a.example/' }, { title: 'A' })).toBe('window');
      expect(chrome.windows.create).toHaveBeenCalledWith({ url: `${EXT}popup/popup.html?window=1`, type: 'popup', width: 440, height: 640, focused: true });
      expect(chrome.session.data[CAPTURE_KEY].title).toBe('A');
    }
  });

  it('ignores other menu items', async () => {
    const chrome = fakeChrome({ openPopup: vi.fn() });
    expect(await onMenuClick(chrome, { menuItemId: 'something-else' }, {})).toBe(false);
    expect(chrome.session.data).toEqual({});
  });
});

describe('openAppTab', () => {
  it('focuses the open app tab (found without the "tabs" permission) at the given screen', async () => {
    const chrome = fakeChrome({ contexts: [{ documentUrl: `${EXT}app/app.html#/`, tabId: 7, windowId: 3 }] });
    await openAppTab(chrome, '#/task/t1');
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true, url: `${EXT}app/app.html#/task/t1` });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('opens a new tab when none is open (or the lookup fails)', async () => {
    const chrome = fakeChrome();
    await openAppTab(chrome);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${EXT}app/app.html` });
    const broken = fakeChrome();
    broken.runtime.getContexts = async () => { throw new Error('gone'); };
    await openAppTab(broken, '#/settings');
    expect(broken.tabs.create).toHaveBeenCalledWith({ url: `${EXT}app/app.html#/settings` });
  });
});
