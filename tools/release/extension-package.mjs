// The Chrome extension's package, made the same way for the release folder (build-release.mjs) and
// for the web build (the footer's download, Web Portal/frontend/scripts/bundle-extension.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { zipDir } from './zip.mjs';

/** The extension's folders with code, pages and images (tests and test helpers are left out). */
export const EXTENSION_DIRS = ['app', 'background', 'icons', 'src'];

const isTestFile = (f) => /\.test\.js$|\/test-helpers\.js$/.test(f);

/**
 * Copy what the extension needs into `stage` (emptied first), check that every relative import,
 * every icon and the service worker are in it, and zip it to `zipFile`. Returns its version and
 * how many scripts it has.
 */
export function packageExtension(extensionDir, stage, zipFile) {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(path.join(extensionDir, 'manifest.json'), path.join(stage, 'manifest.json'));
  for (const dir of EXTENSION_DIRS) {
    fs.cpSync(path.join(extensionDir, dir), path.join(stage, dir), { recursive: true, filter: (s) => !isTestFile(s.replace(/\\/g, '/')) });
  }
  // Every relative import must resolve inside the package (tests and helpers are left out).
  const files = fs.readdirSync(stage, { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(stage, f), 'utf8');
    for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(path.join(stage, f)), m[1]);
      if (!fs.existsSync(target)) throw new Error(`${f} imports ${m[1]}, which is not in the package`);
    }
  }
  for (const icon of Object.values(manifest.icons)) {
    if (!fs.existsSync(path.join(stage, icon))) throw new Error(`Missing icon ${icon}`);
  }
  if (!fs.existsSync(path.join(stage, manifest.background.service_worker))) throw new Error('Missing service worker');
  fs.mkdirSync(path.dirname(zipFile), { recursive: true });
  zipDir(stage, zipFile);
  return { version: manifest.version, scripts: files.length };
}
