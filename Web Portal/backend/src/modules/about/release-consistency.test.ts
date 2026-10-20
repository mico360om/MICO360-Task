import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { changelogProblems, parseChangelog } from './changelog';
import { releaseDrift } from './release-versions';

/**
 * One release version: the server, the web app, the Chrome extension and the Windows installer carry
 * the same Major.Minor.Patch, and CHANGELOG.md describes it. The Android app keeps its own version
 * through a website-only release (release.mjs --web-only), never ahead of the release (see
 * release-versions). tools/release/release.mjs sets them; this test fails if any drifts.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown> & { version?: string };

describe('release versions', () => {
  const version = json('package.json').version!;

  it('is one Major.Minor.Patch version everywhere', () => {
    const lock = json('package-lock.json') as { version: string; packages: Record<string, { version?: string }> };
    const backendLock = json('Web Portal/backend/package-lock.json') as { version: string; packages: Record<string, { version?: string }> };
    const androidLock = json('Android App/package-lock.json') as { version: string; packages: Record<string, { version?: string }> };
    const app = json('Android App/app.json') as { expo: { version: string; android: { versionCode: number } } };
    const found: Record<string, string | undefined> = {
      'Web Portal/backend/package.json': json('Web Portal/backend/package.json').version,
      'Web Portal/frontend/package.json': json('Web Portal/frontend/package.json').version,
      'Extension/package.json': json('Extension/package.json').version,
      'Extension/manifest.json': json('Extension/manifest.json').version,
      'package-lock.json': lock.version,
      'package-lock.json (root)': lock.packages['']?.version,
      'package-lock.json (backend)': lock.packages['Web Portal/backend']?.version,
      'package-lock.json (frontend)': lock.packages['Web Portal/frontend']?.version,
      'package-lock.json (extension)': lock.packages.Extension?.version,
      'Web Portal/backend/package-lock.json': backendLock.version,
      'Web Portal/backend/package-lock.json (root)': backendLock.packages['']?.version,
      'tools/release/windows/Shared/ServerCore.cs': /public const string Version = "([^"]+)"/.exec(read('tools/release/windows/Shared/ServerCore.cs'))?.[1],
      'tools/release/windows/app.manifest': /assemblyIdentity version="([^"]+)\.0"/.exec(read('tools/release/windows/app.manifest'))?.[1],
    };
    const android: Record<string, string | undefined> = {
      'Android App/app.json (expo.version)': app.expo.version,
      'Android App/package.json': json('Android App/package.json').version,
      'Android App/package-lock.json': androidLock.version,
      'Android App/package-lock.json (root)': androidLock.packages['']?.version,
    };
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(releaseDrift(version, found, android), `everything should be ${version} (the Android app ${version} or earlier)`).toEqual([]);
    expect(Number.isInteger(app.expo.android.versionCode) && app.expo.android.versionCode > 0).toBe(true);
  });

  it('is described in CHANGELOG.md, which is well formed', () => {
    const md = read('CHANGELOG.md');
    expect(changelogProblems(md)).toEqual([]);
    expect(parseChangelog(md).releases[0]?.version).toBe(version);
  });
});
