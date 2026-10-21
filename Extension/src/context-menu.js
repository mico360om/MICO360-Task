/**
 * The right-click menu's "Add to MICO360 Tasks", for a selection, a link or the page (the
 * `contextMenus` permission; no install warning). A click keeps what was clicked in session storage
 * (memory only) and opens the toolbar popup, which puts it into its New task form. No content script
 * is involved: Chrome hands the selection, link and page to the worker itself.
 */
import { captureFromContext, CAPTURE_KEY } from './quick-add.js';

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
 * popup from code only from version 127; before that the form opens in a small window.
 */
export async function onMenuClick(chromeApi, info, tab, { now = Date.now } = {}) {
  if (!info || info.menuItemId !== MENU_ID) return false;
  await chromeApi.storage.session.set({ [CAPTURE_KEY]: { ...captureFromContext(info, tab), at: now() } });
  try {
    if (typeof chromeApi.action?.openPopup !== 'function') throw new Error('openPopup needs Chrome 127');
    await chromeApi.action.openPopup(tab && typeof tab.windowId === 'number' ? { windowId: tab.windowId } : {});
    return 'popup';
  } catch {
    await chromeApi.windows.create({ url: chromeApi.runtime.getURL(`${POPUP_PATH}?window=1`), type: 'popup', width: 440, height: 640, focused: true });
    return 'window';
  }
}
