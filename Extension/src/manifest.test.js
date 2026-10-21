import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';

// What Chrome is told about the extension (Manifest V3), and what the package ships.
const ext = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(ext, 'manifest.json'), 'utf8'));
/** The folders with code and pages (tools/release/extension-package.mjs packages them, with icons/). */
const CODE_DIRS = ['app', 'background', 'popup', 'src'];

/** Every packaged file (as tools/release/extension-package.mjs copies them), relative to the extension. */
function packagedText() {
  const out = [];
  for (const dir of CODE_DIRS) {
    for (const f of readdirSync(resolve(ext, dir), { recursive: true }).map(String)) {
      if (/\.(js|html|css)$/.test(f) && !/\.test\.js$|test-helpers\.js$/.test(f)) out.push(readFileSync(resolve(ext, dir, f), 'utf8'));
    }
  }
  return out.join('\n');
}

/** The extension's pages: the toolbar popup, the full app (opened in a tab, src/open-app.js) and the side panel. */
const PAGES = [manifest.action.default_popup, 'app/app.html', manifest.side_panel && manifest.side_panel.default_path].filter(Boolean);

/** Every file the pages and the background worker load, following scripts, styles and imports. */
function reachable() {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (!existsSync(resolve(ext, rel))) return;
    const text = readFileSync(resolve(ext, rel), 'utf8');
    const refs = rel.endsWith('.html')
      ? [...text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
      : rel.endsWith('.js') ? [...text.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]) : [];
    for (const r of refs) visit(relative(ext, resolve(dirname(resolve(ext, rel)), r)).replace(/\\/g, '/'));
  };
  for (const page of PAGES) visit(page);
  visit(manifest.background.service_worker);
  return seen;
}

describe('manifest.json', () => {
  it('needs Chrome 116 or later (runtime.getContexts finds the open app tab without the "tabs" permission)', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('116');
  });

  it('asks only for the permissions it uses, keeping unlimitedStorage (installed copies have it; without it a full store could refuse the sign-in token)', () => {
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'alarms', 'contextMenus', 'notifications', 'sidePanel', 'storage', 'unlimitedStorage']);
    expect(manifest.host_permissions).toEqual(['https://task.mico360.com/*']);
  });

  it('quick capture adds no install warning: the right-click menu (contextMenus) and the page you are on (activeTab) need none, so an update isn’t held for approval', () => {
    const BEFORE = ['alarms', 'notifications', 'storage', 'unlimitedStorage']; // 1.6.0
    const NO_WARNING = new Set(['activeTab', 'alarms', 'contextMenus', 'storage', 'unlimitedStorage']);
    const added = manifest.permissions.filter((p) => !BEFORE.includes(p) && p !== 'sidePanel'); // Stage 7's, below
    expect(added.sort()).toEqual(['activeTab', 'contextMenus']);
    expect(added.filter((p) => !NO_WARNING.has(p))).toEqual([]);
    // No content script, and no access to pages beyond the one you open the popup on.
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('scripting');
  });

  it('Stage 6: “mico” in the address bar is a manifest key, not a permission — no install warning, no new access', () => {
    expect(manifest.omnibox).toEqual({ keyword: 'mico' });
    expect(manifest.permissions).not.toContain('search');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.host_permissions).toEqual(['https://task.mico360.com/*']);
  });

  it('Stage 7: the side panel is the app page made for it, and its permission shows no install warning (Chrome’s own list is compared by tools/extension-e2e/sidepanel.mjs)', () => {
    expect(manifest.side_panel).toEqual({ default_path: 'app/panel.html' });
    expect(existsSync(resolve(ext, manifest.side_panel.default_path))).toBe(true);
    expect(manifest.permissions).toContain('sidePanel');
    // chrome.sidePanel is there from Chrome 114, and sidePanel.open() (a button that opens it) from 116.
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
    // The toolbar button still opens the popup; no host access or other permission comes with it.
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    expect(manifest.host_permissions).toEqual(['https://task.mico360.com/*']);
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('Stage 7: a keyboard command opens the side panel, with no key chosen for you (none is free everywhere; set one at chrome://extensions/shortcuts)', () => {
    expect(manifest.commands['open-side-panel']).toEqual({ description: 'Open the side panel' });
    expect(Object.values(manifest.commands).filter((c) => c.suggested_key)).toHaveLength(1); // only the popup's Ctrl+Shift+K
  });

  it('the toolbar button opens the quick-capture popup, and a keyboard shortcut opens it too', () => {
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    expect(existsSync(resolve(ext, manifest.action.default_popup))).toBe(true);
    const open = manifest.commands && manifest.commands._execute_action;
    expect(open).toBeTruthy();
    expect(open.suggested_key).toEqual({ default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' });
  });

  it('every icon it names is in the package', () => {
    const icons = { ...manifest.icons, ...manifest.action.default_icon };
    for (const file of Object.values(icons)) expect(existsSync(resolve(ext, file)), file).toBe(true);
  });

  it('ships no image nothing uses', () => {
    const named = new Set([...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]);
    const code = packagedText();
    const unused = readdirSync(resolve(ext, 'icons')).filter((f) => !named.has(`icons/${f}`) && !code.includes(f));
    expect(unused).toEqual([]);
  });
});

/** Packaged modules nothing imports yet, and why they stay. */
const NOT_YET_USED = {
  'app/screens/today.js': 'Stage 7: the side panel’s Today — the panel layout of app/app.js shows it in the next step',
};

describe('packaged code', () => {
  it('every module is used by a page (the popup, the app) or the background worker', () => {
    const seen = reachable();
    const modules = CODE_DIRS.flatMap((dir) => readdirSync(resolve(ext, dir), { recursive: true }).map((f) => `${dir}/${String(f).replace(/\\/g, '/')}`))
      .filter((f) => f.endsWith('.js') && !/\.test\.js$|\/test-helpers\.js$/.test(f));
    expect(modules.filter((f) => !seen.has(f) && !NOT_YET_USED[f])).toEqual([]);
    expect(Object.keys(NOT_YET_USED).filter((f) => seen.has(f))).toEqual([]); // used now: take it off the list
  });

  it('every script, style and module the pages load exists, in a folder the release package copies', () => {
    const files = [...reachable()];
    expect(files).toContain('popup/popup.js');
    expect(files).toContain('popup/popup.css');
    expect(files).toContain('app/app.css');
    expect(files.filter((f) => !existsSync(resolve(ext, f)))).toEqual([]);
    const script = resolve(ext, '../tools/release/extension-package.mjs');
    if (!existsSync(script)) return; // the extension on its own, without the release tools
    const m = /export const EXTENSION_DIRS = (\[[^\]]+\])/.exec(readFileSync(script, 'utf8'));
    const packaged = JSON.parse(m[1].replace(/'/g, '"'));
    expect([...new Set(files.map((f) => f.split('/')[0]))].filter((d) => !packaged.includes(d))).toEqual([]);
  });
});
