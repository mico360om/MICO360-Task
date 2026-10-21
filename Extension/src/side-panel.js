/**
 * Chrome's side panel (Stage 7): a short version of the app beside the page you are on — Today,
 * My Tasks and Add a task, with a task's panel over them. It is the app page `app/panel.html` (the
 * app's own modules, session, offline copies and queue; app/app.js draws it in its panel layout).
 *
 * It opens from the toolbar popup's side-panel button, the app's, or a keyboard command with no key
 * chosen for you. The toolbar button itself still opens the popup (no setPanelBehavior).
 */

/** The side panel's page (manifest side_panel.default_path). */
export const PANEL_PATH = 'app/panel.html';

/** The keyboard command that opens it (manifest `commands`; no suggested key). */
export const PANEL_COMMAND = 'open-side-panel';

/** The screens the side panel shows itself; any other page opens in the full app page. */
const PANEL_ROUTES = new Set(['today', 'my-tasks', 'add', 'task']);

/** The lists that read themselves again every minute while the side panel is on screen. */
export const PANEL_LIVE_ROUTES = new Set(['today', 'my-tasks']);

/** Whether the side panel shows `routeName` itself (else it opens in the full app page). */
export function panelShows(routeName) {
  return PANEL_ROUTES.has(routeName);
}

/** Whether this Chrome can open the side panel from a button (chrome.sidePanel.open, Chrome 116+). */
export function canOpenSidePanel(chromeApi) {
  return !!(chromeApi && chromeApi.sidePanel && typeof chromeApi.sidePanel.open === 'function');
}

/** Said when Chrome didn't open the side panel (a policy, say, or the window went away). */
export const PANEL_FAILED_MESSAGE = 'Couldn’t open the side panel. Please try again.';

/**
 * Open the side panel in window `windowId` — or, while that isn't known yet, in this page's own
 * window (Chrome's "current window"). Chrome opens it only straight from a click or a key press, so
 * it is asked at once — nothing is awaited first. Resolves whether it opened; never throws.
 */
export function openSidePanel(chromeApi, windowId) {
  if (!canOpenSidePanel(chromeApi)) return Promise.resolve(false);
  const current = chromeApi.windows && chromeApi.windows.WINDOW_ID_CURRENT;
  const id = typeof windowId === 'number' ? windowId : current;
  if (typeof id !== 'number') return Promise.resolve(false);
  try {
    return Promise.resolve(chromeApi.sidePanel.open({ windowId: id })).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}
