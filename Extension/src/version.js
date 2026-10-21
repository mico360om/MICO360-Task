/**
 * The extension's version and the server's (GET /version), and whether to say a newer one is out.
 *
 * Every release gives the server, the web app and the extension the same version
 * (tools/release/release.mjs). The extension is installed from a zip ("Load unpacked"), which Chrome
 * never updates, so a server that is newer than the extension means a newer extension file exists:
 * the app says so, with a link to the web app's About page. An install from the Chrome Web Store
 * (Chrome adds `update_url` to its manifest) updates itself and is never told.
 */

/** 'v1.5.1' / '1.5' / '1.5.1-beta' → [1, 5, 1] (a missing part is 0, a suffix is ignored), or null. */
export function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** 1 when `a` is newer than `b`, -1 when older, 0 when the same; null when either can't be read. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

/** Installed from the Chrome Web Store: Chrome keeps it up to date itself. */
export function isStoreInstall(manifest) {
  return Boolean(manifest && manifest.update_url);
}

/**
 * `{ extension, server, storeInstall, updateAvailable }` for the installed `manifest` and the
 * server's version (null while it isn't known, e.g. offline with nothing saved).
 */
export function versionStatus({ manifest, server }) {
  const extension = (manifest && manifest.version) || '';
  const storeInstall = isStoreInstall(manifest);
  const known = typeof server === 'string' && server ? server : null;
  return { extension, server: known, storeInstall, updateAvailable: !storeInstall && compareVersions(known, extension) === 1 };
}

/** The web app's About page: the version running and what each release changed. */
export function aboutUrl(appBase) {
  return `${String(appBase || '').replace(/\/+$/, '')}/about`;
}
