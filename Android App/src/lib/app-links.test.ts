import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getStateFromPath } from '@react-navigation/core';
import manifest from '../../app.json';
import { LINKING_PREFIXES, linkingConfig, normalizeLinkPath, withoutLinkTitles } from '../navigation/linking';
import { WEBSITE_ONLY_PAGES } from './website';

/**
 * Android App Links (6b): which of the website's addresses a phone with the app opens in the app.
 * Android hands a link to the app when one of these filters names its path and the website's
 * /.well-known/assetlinks.json names the app's signing key. Everything the app opens must lead
 * somewhere in it, and nothing the website keeps (its admin pages, the download) may be claimed —
 * "Open on the website" would come straight back.
 */
type Data = { scheme: string; host: string; path?: string; pathPrefix?: string; pathPattern?: string };
type Filter = { action: string; autoVerify?: boolean; data: Data[]; category: string[] };
const filters = manifest.expo.android.intentFilters as Filter[];
const webLinks = filters.filter((f) => f.data.some((d) => d.scheme === 'https'));

/** Does Android give this filter the path? (path: exact; pathPrefix: starts with.) */
const claims = (d: Data, path: string) => (d.path !== undefined && d.path === path) || (d.pathPrefix !== undefined && path.startsWith(d.pathPrefix));
const claimed = (path: string) => webLinks.some((f) => f.data.some((d) => claims(d, path)));
const cfg = linkingConfig as unknown as Parameters<typeof getStateFromPath>[1];
const opens = (pathAndQuery: string) => withoutLinkTitles(getStateFromPath(normalizeLinkPath(pathAndQuery), cfg));

describe('the website addresses the app opens (App Links)', () => {
  it('are verified links to the app’s own website, as the navigator reads them', () => {
    for (const f of webLinks) {
      expect(f.autoVerify).toBe(true);
      expect(f.action).toBe('VIEW');
      expect(f.category).toEqual(expect.arrayContaining(['BROWSABLE', 'DEFAULT']));
      for (const d of f.data) {
        expect(d).toMatchObject({ scheme: 'https', host: 'task.mico360.com' });
        expect(d.pathPattern).toBeUndefined();
        expect(LINKING_PREFIXES).toContain(`${d.scheme}://${d.host}`);
      }
    }
  });

  it('cover the website’s tasks, projects, meetings, chat and the pages the app has', () => {
    for (const path of [
      '/reset', '/dashboard', '/my-tasks', '/board', '/projects', '/projects/p1', '/calendar', '/meetings', '/meetings/m1', '/my-action-items',
      '/chat', '/activity', '/notifications', '/settings', '/profile', '/about', '/reports', '/admin/users',
    ]) {
      expect(claimed(path), path).toBe(true);
    }
  });

  it('every address claimed opens a screen of the app', () => {
    const paths = webLinks.flatMap((f) => f.data.map((d) => d.path ?? `${d.pathPrefix}x1`));
    for (const path of paths) {
      const query = path === '/reset' ? '?token=abc' : '';
      expect(opens(`${path}${query}`), path).toBeDefined();
      // A task link on that page (?task=) opens the task.
      if (path !== '/reset') expect(opens(`${path}?task=t1`)?.routes[0]?.name, path).toBe('TaskDetail');
    }
  });

  it('never claims what the website keeps: its admin pages, the app download, sign-in, the legal pages, the site itself', () => {
    for (const page of WEBSITE_ONLY_PAGES) expect(claimed(page.path), page.path).toBe(false);
    for (const path of ['/', '/login', '/forgot', '/privacy', '/terms', '/downloads/MICO360-Tasks.apk', '/api/v1/health', '/uploads/a.png', '/admin', '/admin/', '/projectsx']) {
      expect(claimed(path), path).toBe(false);
    }
  });
});

describe('Digital Asset Links: the website names the app’s signing key', () => {
  const file = resolve(__dirname, '../../../Web Portal/frontend/public/.well-known/assetlinks.json');
  /** The release key since 17 Oct 2026 (Android App/apk/release.keystore, alias mico360). */
  const RELEASE_KEY = '7F:77:C9:86:48:2B:25:66:6A:EF:43:69:15:C3:0A:A4:2A:7E:C4:9D:78:E8:F3:63:4E:48:05:FF:C3:71:F7:DE';

  it.skipIf(!existsSync(file))('lists the key the app is signed with now, or no link is verified', () => {
    const links = JSON.parse(readFileSync(file, 'utf8')) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    const app = links.find((l) => l.target.package_name === manifest.expo.android.package);
    expect(app?.target.sha256_cert_fingerprints).toContain(RELEASE_KEY);
  });
});
