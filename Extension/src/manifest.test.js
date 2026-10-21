import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';

// What Chrome is told about the extension (Manifest V3), and what the package ships.
const ext = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(ext, 'manifest.json'), 'utf8'));

/** Every packaged file (as tools/release/build-release.mjs copies them), relative to the extension. */
function packagedText() {
  const out = [];
  for (const dir of ['app', 'background', 'src']) {
    for (const f of readdirSync(resolve(ext, dir), { recursive: true }).map(String)) {
      if (/\.(js|html|css)$/.test(f) && !/\.test\.js$|test-helpers\.js$/.test(f)) out.push(readFileSync(resolve(ext, dir, f), 'utf8'));
    }
  }
  return out.join('\n');
}

describe('manifest.json', () => {
  it('needs Chrome 116 or later (runtime.getContexts finds the open app tab without the "tabs" permission)', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('116');
  });

  it('asks only for the permissions it uses, keeping unlimitedStorage (installed copies have it; without it a full store could refuse the sign-in token)', () => {
    expect([...manifest.permissions].sort()).toEqual(['alarms', 'notifications', 'storage', 'unlimitedStorage']);
    expect(manifest.host_permissions).toEqual(['https://task.mico360.com/*']);
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
  'src/quick-add.js': 'the quick-capture popup (next stage) builds its new task with it',
};

describe('packaged code', () => {
  it('every module is used by the app page or the background worker', () => {
    const seen = new Set();
    const visit = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const text = readFileSync(resolve(ext, rel), 'utf8');
      for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        visit(relative(ext, resolve(dirname(resolve(ext, rel)), m[1])).replace(/\\/g, '/'));
      }
    };
    visit('app/app.js');
    visit(manifest.background.service_worker);
    const modules = ['app', 'background', 'src'].flatMap((dir) => readdirSync(resolve(ext, dir), { recursive: true }).map((f) => `${dir}/${String(f).replace(/\\/g, '/')}`))
      .filter((f) => f.endsWith('.js') && !/\.test\.js$|\/test-helpers\.js$/.test(f));
    expect(modules.filter((f) => !seen.has(f) && !NOT_YET_USED[f])).toEqual([]);
    expect(Object.keys(NOT_YET_USED).filter((f) => seen.has(f))).toEqual([]); // used now: take it off the list
  });
});
