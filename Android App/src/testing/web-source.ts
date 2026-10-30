/**
 * Helpers for the drift tests: the website's files beside the app (`Web Portal/…` in the same
 * checkout) and the app's own files. Test-only — nothing in the app imports this folder.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';

/** The website's folder beside `Android App/` (absent when the app is checked out alone). */
export const PORTAL: string = resolve(__dirname, '../../../Web Portal');
const APP = resolve(__dirname, '../..');
const APP_SRC = resolve(APP, 'src');

export function webPath(rel: string): string {
  return resolve(PORTAL, rel);
}

/** True only when every one of the website files is there (drift tests skip themselves otherwise). */
export function hasWeb(...rels: string[]): boolean {
  return rels.every((rel) => existsSync(webPath(rel)));
}

export function readWeb(rel: string): string {
  return readFileSync(webPath(rel), 'utf8');
}

/**
 * Run a website TypeScript module and return its exports, without its dependencies: a relative
 * import named in `imports` (specifier → website path) is loaded the same way; any other import
 * comes back as an empty object.
 */
export function loadWebTs(rel: string, imports: Record<string, string> = {}): Record<string, unknown> {
  const { code } = transformSync(readWeb(rel), { loader: 'ts', format: 'cjs' });
  const mod = { exports: {} as Record<string, unknown> };
  const load = (spec: string) => (imports[spec] ? loadWebTs(imports[spec]!, imports) : {});
  new Function('module', 'exports', 'require', code)(mod, mod.exports, load);
  return mod.exports;
}

/** A path under `Android App/`. */
export function appPath(rel: string): string {
  return resolve(APP, rel);
}

/** The text of a file under `Android App/src` (`../App.tsx` reaches the app folder). */
export function appSource(rel: string): string {
  return readFileSync(resolve(APP_SRC, rel), 'utf8');
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Every app source file — `.ts`/`.tsx` under `src`, without tests and `src/testing` — as [path from src, text]. */
export function appSources(): Array<[rel: string, text: string]> {
  return walk(APP_SRC, [])
    .map((full) => relative(APP_SRC, full).split(sep).join('/'))
    .filter((rel) => !rel.startsWith('testing/'))
    .sort()
    .map((rel) => [rel, appSource(rel)]);
}

/** The SHA-256 of a file's bytes, as hex. */
export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
