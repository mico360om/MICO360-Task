// @vitest-environment jsdom
/** The extension's and the server's versions in Settings. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsScreen } from '../app/screens/settings.js';
import { DEFAULTS } from './config.js';
import { ApiError } from './errors.js';
import { fakeStorage } from './test-helpers.js';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const about = (root) => [...root.querySelectorAll('.card')].find((c) => c.querySelector('.section-title')?.textContent === 'About');

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.chrome = { permissions: { request: vi.fn(async () => true) } };
});
afterEach(() => {
  delete globalThis.chrome;
});

function settingsCtx({ manifest = { version: '1.5.1' }, version } = {}) {
  return {
    storage: fakeStorage({ apiBase: DEFAULTS.apiBase, appBase: 'https://tasks.example.com', syncQueue: [] }),
    me: { id: 'u1', name: 'Me', email: 'me@example.com' },
    manifest,
    api: { version: version || (async () => ({ data: { version: '1.5.1', deployedAt: '2026-10-21T05:00:00Z' }, stale: false })) },
    signOut: vi.fn(async () => {}),
    requestSync: vi.fn(),
    afterMutation: vi.fn(),
  };
}

describe('Settings → About', () => {
  it('shows the extension’s and the server’s versions, and links to the web app’s About page', async () => {
    const root = SettingsScreen(settingsCtx());
    await settle();
    const card = about(root);
    expect(card.textContent).toContain('Extension version 1.5.1');
    expect(card.textContent).toContain('Server version 1.5.1');
    expect(card.textContent).not.toMatch(/newer version/i);
    const link = [...card.querySelectorAll('a')].find((a) => a.href === 'https://tasks.example.com/about');
    expect(link).toBeTruthy();
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
  });

  it('a zip install is told the website’s newer version and how to update when a new file comes — never that one exists', async () => {
    const ctx = settingsCtx({ version: async () => ({ data: { version: '1.6.0' }, stale: false }) });
    const root = SettingsScreen(ctx);
    await settle();
    const card = about(root);
    expect(card.textContent).toContain('Server version 1.6.0');
    // A website update (most releases) needs no new extension: nothing claims one is out.
    expect(card.textContent).not.toMatch(/newer version|is available/i);
    expect(card.textContent).toContain('The website runs version 1.6.0.');
    expect(card.textContent).toContain('your administrator');
    expect(card.textContent).toMatch(/unzip it over this extension’s folder/);
    expect(card.textContent).toContain('chrome://extensions');
  });

  it('a Chrome Web Store install is never told: Chrome updates it', async () => {
    const ctx = settingsCtx({ manifest: { version: '1.5.1', update_url: 'https://clients2.google.com/service/update2/crx' }, version: async () => ({ data: { version: '1.6.0' } }) });
    const root = SettingsScreen(ctx);
    await settle();
    expect(about(root).textContent).not.toMatch(/newer version/i);
    expect(about(root).textContent).toContain('Chrome keeps this extension up to date');
  });

  it('says when the server’s version is a saved one, or not known while offline', async () => {
    let root = SettingsScreen(settingsCtx({ version: async () => ({ data: { version: '1.5.1' }, stale: true }) }));
    await settle();
    expect(about(root).textContent).toContain('Server version 1.5.1 (saved — you appear to be offline)');
    root = SettingsScreen(settingsCtx({ version: async () => { throw new TypeError('Failed to fetch'); } }));
    await settle();
    expect(about(root).textContent).toContain('Server version not known — you appear to be offline');
    // A server that answers but can't say (one older than /version): not "offline".
    root = SettingsScreen(settingsCtx({ version: async () => { throw new ApiError(404, 'Not found'); } }));
    await settle();
    expect(about(root).textContent).toContain('Server version not known.');
    expect(about(root).textContent).not.toContain('offline');
  });
});
