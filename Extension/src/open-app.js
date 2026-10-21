import { findAppContext } from './notify.js';

/** The extension's full app page. */
export const APP_PATH = 'app/app.html';

/**
 * Show the full app in a tab: focus one already open (found through runtime.getContexts, so no
 * "tabs" permission is needed — EXT-07) or open a new one, at `hash` (e.g. '#/task/<id>').
 * Used by the background worker (a notification click) and the toolbar popup.
 */
export async function openAppTab(chromeApi, hash = '') {
  const base = chromeApi.runtime.getURL(APP_PATH);
  try {
    const contexts = await chromeApi.runtime.getContexts({ contextTypes: ['TAB'] });
    const found = findAppContext(contexts, base);
    if (found) {
      await chromeApi.tabs.update(found.tabId, { active: true, ...(hash ? { url: base + hash } : {}) });
      if (typeof found.windowId === 'number' && found.windowId >= 0) await chromeApi.windows?.update(found.windowId, { focused: true });
      return;
    }
  } catch {
    /* the tab closed meanwhile — just open a new one */
  }
  await chromeApi.tabs.create({ url: base + hash });
}
