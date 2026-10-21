import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('asks only for the permissions it uses — not unlimitedStorage (the offline copies are capped)', () => {
    expect([...manifest.permissions].sort()).toEqual(['alarms', 'notifications', 'storage']);
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
