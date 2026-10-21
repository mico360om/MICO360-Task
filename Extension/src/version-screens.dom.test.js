// @vitest-environment jsdom
/** The extension's and the server's versions in Settings, and the shell's "newer version" notice. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsScreen } from '../app/screens/settings.js';
import { updateNotice } from '../app/components.js';
import { versionStatus } from './version.js';
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

  it('a zip install is told when the server is newer, how to update, and the card comes first', async () => {
    const ctx = settingsCtx({ version: async () => ({ data: { version: '1.6.0' }, stale: false }) });
    const root = SettingsScreen(ctx);
    await settle();
    const card = about(root);
    expect(root.querySelector('.card')).toBe(card);
    expect(card.textContent).toContain('Server version 1.6.0');
    expect(card.textContent).toContain('A newer version, 1.6.0, is available');
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

describe('the shell’s update notice', () => {
  it('names both versions, links to the steps and to what’s new, and can be dismissed', () => {
    const onDismiss = vi.fn();
    const node = updateNotice({ status: versionStatus({ manifest: { version: '1.5.1' }, server: '1.6.0' }), aboutHref: 'https://tasks.example.com/about', onDismiss });
    document.body.append(node);
    expect(node.getAttribute('role')).toBe('status');
    expect(node.textContent).toContain('A newer version of MICO360 Tasks, 1.6.0, is available (this extension is 1.5.1).');
    const links = [...node.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([['How to update', '#/settings'], ['What’s new ↗', 'https://tasks.example.com/about']]);
    node.querySelector('button').click();
    expect(onDismiss).toHaveBeenCalled();
    expect(node.querySelector('button').getAttribute('aria-label')).toBe('Dismiss the update notice');
  });

  it('is nothing when there is no newer version', () => {
    expect(updateNotice({ status: versionStatus({ manifest: { version: '1.5.1' }, server: '1.5.1' }), aboutHref: '#', onDismiss() {} })).toBeNull();
  });
});
