/**
 * The right-click menu's "Add to MICO360 Tasks", for a selection, a link or the page (the
 * `contextMenus` permission; no install warning). A click keeps what was clicked in session storage
 * (memory only) and opens the toolbar popup, which puts it into its New task form. No content script
 * is involved: Chrome hands the selection, link and page to the worker itself.
 */
import { captureFromContext, CAPTURE_KEY, QUICK_ADD_WINDOW_KEY } from './quick-add.js';

export const MENU_ID = 'mico360-add-task';
export const MENU_CONTEXTS = ['selection', 'link', 'page'];
export const POPUP_PATH = 'popup/popup.html';

/** Make the menu item. Chrome keeps it across restarts; it is made again on install and update. */
export async function createMenu(chromeApi) {
  try {
    await chromeApi.contextMenus.removeAll(); // an update would otherwise find the id taken
  } catch {
    /* nothing to remove */
  }
  // The callback reads lastError, so a refusal is never logged as "Unchecked runtime.lastError".
  chromeApi.contextMenus.create({ id: MENU_ID, title: 'Add to MICO360 Tasks', contexts: MENU_CONTEXTS }, () => void chromeApi.runtime.lastError);
}

/**
 * Handle a click on the menu (`info`, `tab` from contextMenus.onClicked). Resolves 'popup' or
 * 'window' — how the form was opened — or false for another item. Chrome opens an extension's
 * popup from code only from version 127; before that the form opens in a small window (one: a
 * second click focuses it, and the form there takes the new capture).
 */
export async function onMenuClick(chromeApi, info, tab, { now = Date.now } = {}) {
  if (!info || info.menuItemId !== MENU_ID) return false;
  // Started, not awaited, before asking for the popup: Chrome may open one only straight from the
  // click (its user gesture). The write is sent first, so the popup finds it when it starts.
  let kept;
  try {
    kept = Promise.resolve(chromeApi.storage.session.set({ [CAPTURE_KEY]: { ...captureFromContext(info, tab), at: now() } }));
  } catch (e) {
    kept = Promise.reject(e);
  }
  kept = kept.catch(() => { /* not kept: the form opens empty */ });
  let how = 'popup';
  try {
    if (typeof chromeApi.action?.openPopup !== 'function') throw new Error('openPopup needs Chrome 127');
    await chromeApi.action.openPopup(tab && typeof tab.windowId === 'number' ? { windowId: tab.windowId } : {});
  } catch {
    how = 'window';
  }
  await kept;
  if (how === 'window') await openFormWindow(chromeApi);
  return how;
}

/** Focus the form's window when it is still open; otherwise open it (and keep its id). */
async function openFormWindow(chromeApi) {
  const session = chromeApi.storage.session;
  let id = null;
  try {
    id = ((await session.get(QUICK_ADD_WINDOW_KEY)) || {})[QUICK_ADD_WINDOW_KEY];
  } catch {
    id = null;
  }
  if (typeof id === 'number') {
    try {
      await chromeApi.windows.update(id, { focused: true });
      return;
    } catch {
      /* closed since: open another */
    }
  }
  const win = await chromeApi.windows.create({ url: chromeApi.runtime.getURL(`${POPUP_PATH}?window=1`), type: 'popup', width: 440, height: 640, focused: true });
  if (win && typeof win.id === 'number') {
    try {
      await session.set({ [QUICK_ADD_WINDOW_KEY]: win.id });
    } catch {
      /* best effort: the next click opens another */
    }
  }
}
