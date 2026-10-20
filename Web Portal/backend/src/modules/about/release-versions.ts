import { compareVersions } from './changelog';

/**
 * What is out of step with a release. The server, web app, extension and Windows installer carry the
 * release version. The Android app has a version of its own: a release that changes only the website
 * keeps it (tools/release/release.mjs --web-only), so phones aren't asked to download the same app;
 * its files must agree with each other and never be ahead of the release.
 */
export function releaseDrift(version: string, found: Record<string, string | undefined>, android: Record<string, string | undefined>): string[] {
  const drift = Object.entries(found)
    .filter(([, v]) => v !== version)
    .map(([file, v]) => `${file}: ${v ?? 'missing'}`);
  const entries = Object.entries(android);
  const missing = entries.filter(([, v]) => !v);
  if (missing.length) return [...drift, ...missing.map(([file]) => `${file}: missing`)];
  const [, appVersion] = entries[0] ?? [];
  if (!appVersion) return drift;
  drift.push(...entries.slice(1).filter(([, v]) => v !== appVersion).map(([file, v]) => `${file}: ${v} (the Android files say ${appVersion})`));
  if (compareVersions(appVersion, version) > 0) drift.push(`${entries[0]![0]}: ${appVersion} is newer than the release`);
  return drift;
}
