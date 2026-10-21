import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';

// What Chrome is told about the extension (Manifest V3), and what the package ships.
const ext = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(ext, 'manifest.json'), 'utf8'));
/** The folders with code and pages (tools/release/build-release.mjs packages them, with icons/). */
const CODE_DIRS = ['app', 'background', 'popup', 'src'];

/** Every packaged file (as tools/release/build-release.mjs copies them), relative to the extension. */
function packagedText() {
  const out = [];
  for (const dir of CODE_DIRS) {
    for (const f of readdirSync(resolve(ext, dir), { recursive: true }).map(String)) {
      if (/\.(js|html|css)$/.test(f) && !/\.test\.js$|test-helpers\.js$/.test(f)) out.push(readFileSync(resolve(ext, dir, f), 'utf8'));
    }
  }
  return out.join('\n');
}

/** The extension's pages: the toolbar popup and the full app (opened in a tab, src/open-app.js). */
const PAGES = [manifest.action.default_popup, 'app/app.html'];

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
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'alarms', 'contextMenus', 'notifications', 'storage', 'unlimitedStorage']);
    expect(manifest.host_permissions).toEqual(['https://task.mico360.com/*']);
  });

  it('quick capture adds no install warning: the right-click menu (contextMenus) and the page you are on (activeTab) need none, so an update isn’t held for approval', () => {
    const BEFORE = ['alarms', 'notifications', 'storage', 'unlimitedStorage']; // 1.6.0
    const NO_WARNING = new Set(['activeTab', 'alarms', 'contextMenus', 'storage', 'unlimitedStorage']);
    const added = manifest.permissions.filter((p) => !BEFORE.includes(p));
    expect(added.sort()).toEqual(['activeTab', 'contextMenus']);
    expect(added.filter((p) => !NO_WARNING.has(p))).toEqual([]);
    // No content script, and no access to pages beyond the one you open the popup on.
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('scripting');
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
const NOT_YET_USED = {};

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
    const script = resolve(ext, '../tools/release/build-release.mjs');
    if (!existsSync(script)) return; // the extension on its own, without the release tools
    const m = /for \(const dir of (\[[^\]]+\])\)/.exec(readFileSync(script, 'utf8'));
    const packaged = JSON.parse(m[1].replace(/'/g, '"'));
    expect([...new Set(files.map((f) => f.split('/')[0]))].filter((d) => !packaged.includes(d))).toEqual([]);
  });
});
