import { describe, it, expect, vi } from 'vitest';
import { PANEL_PATH, canOpenSidePanel, openSidePanel, panelShows, PANEL_LIVE_ROUTES, PANEL_COMMAND } from './side-panel.js';

// Stage 7: Chrome's side panel shows a short version of the app (Today, My Tasks, Add a task).
describe('the side panel (Stage 7)', () => {
  it('is the app page made for it, app/panel.html', () => {
    expect(PANEL_PATH).toBe('app/panel.html');
  });

  it('can be opened only where Chrome has the side panel', () => {
    expect(canOpenSidePanel(undefined)).toBe(false);
    expect(canOpenSidePanel({})).toBe(false);
    expect(canOpenSidePanel({ sidePanel: {} })).toBe(false);
    expect(canOpenSidePanel({ sidePanel: { open: () => {} } })).toBe(true);
  });

  it('asks Chrome at once, in the same click (Chrome opens it only for a click or a key press), and says whether it opened', async () => {
    const open = vi.fn(async () => {});
    const opening = openSidePanel({ sidePanel: { open } }, 7);
    expect(open).toHaveBeenCalledWith({ windowId: 7 }); // before anything is awaited
    await expect(opening).resolves.toBe(true);
  });

  it('never throws: refused, missing, or no window known — it just says it did not open', async () => {
    const refused = { sidePanel: { open: vi.fn(async () => { throw new Error('`sidePanel.open()` may only be called in response to a user gesture.'); }) } };
    await expect(openSidePanel(refused, 7)).resolves.toBe(false);
    const throwsAtOnce = { sidePanel: { open: () => { throw new Error('No window with id: 7.'); } } };
    await expect(openSidePanel(throwsAtOnce, 7)).resolves.toBe(false);
    await expect(openSidePanel({}, 7)).resolves.toBe(false);
    const open = vi.fn(async () => {});
    await expect(openSidePanel({ sidePanel: { open } }, null)).resolves.toBe(false);
    await expect(openSidePanel({ sidePanel: { open } }, undefined)).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('shows Today, My Tasks, Add a task and a task’s panel; any other page opens in the full app page', () => {
    for (const name of ['today', 'my-tasks', 'add', 'task']) expect(panelShows(name), name).toBe(true);
    for (const name of ['dashboard', 'projects', 'board', 'meeting', 'meetings', 'calendar', 'chat', 'chat-thread', 'notifications', 'settings', 'reports', 'search', null, undefined]) {
      expect(panelShows(name), String(name)).toBe(false);
    }
  });

  it('its two lists read themselves again every minute while it is on screen (it stays open beside your work)', () => {
    expect([...PANEL_LIVE_ROUTES].sort()).toEqual(['my-tasks', 'today']);
  });

  it('has a keyboard command of its own, with no key chosen for you (set one at chrome://extensions/shortcuts)', () => {
    expect(PANEL_COMMAND).toBe('open-side-panel');
  });
});
