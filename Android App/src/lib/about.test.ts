import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RELEASE_SECTIONS,
  appVersionText,
  lastUpdatedText,
  releaseBadges,
  releaseDay,
  releaseHeadingLabel,
  releaseSections,
  technicalDetails,
  uptimeText,
  zoneLabel,
  type ReleaseEntry,
} from './about';

const release = (over: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version: '1.7.0',
  date: '2026-10-21',
  sections: { features: ['A footer'], improvements: [], fixes: ['A fix'], security: ['A security fix'] },
  ...over,
});

describe('About: versions and when the website was last updated', () => {
  it('writes days as the website does', () => {
    expect(releaseDay('2026-10-16')).toBe('16 October 2026');
    expect(releaseDay('2026-01-05')).toBe('5 January 2026');
    expect(releaseDay('soon')).toBe('soon');
  });

  it('“Last updated” is day/month/year and a 12-hour clock in the company’s zone', () => {
    expect(lastUpdatedText('2026-10-16T15:30:00.000Z', 'Asia/Muscat')).toBe('16/10/2026, 07:30 PM (Oman Time)');
    expect(lastUpdatedText('2026-10-16T20:05:00.000Z', 'Asia/Muscat')).toBe('17/10/2026, 12:05 AM (Oman Time)');
    expect(lastUpdatedText('2026-10-16T08:00:00.000Z', 'Asia/Muscat')).toBe('16/10/2026, 12:00 PM (Oman Time)');
    expect(lastUpdatedText('2026-10-16T08:00:00.000Z', 'Asia/Dubai')).toBe('16/10/2026, 12:00 PM (Dubai time)');
    expect(lastUpdatedText('', 'Asia/Muscat')).toBe('—');
    expect(lastUpdatedText('not a date', 'Asia/Muscat')).toBe('—');
  });

  it('names a zone: Oman Time for the company’s, else its city', () => {
    expect(zoneLabel('Asia/Muscat')).toBe('Oman Time');
    expect(zoneLabel('America/New_York')).toBe('New York time');
  });

  it('says this app’s version and build, and how long the server has been running', () => {
    expect(appVersionText({ version: '1.6.0', build: 16 })).toBe('v1.6.0 (build 16)');
    expect([uptimeText(59), uptimeText(3600 + 120), uptimeText(2 * 86400 + 5 * 3600)]).toEqual(['0m', '1h 2m', '2d 5h']);
  });

  it('gives administrators the technical details the website shows them', () => {
    const tz = 'Asia/Muscat';
    expect(
      technicalDetails({ version: '1.7.0', deployedAt: '2026-10-21T11:20:00.000Z', commit: '39ecc18', source: 'build', environment: 'production', nodeVersion: 'v22.12.0', uptimeSeconds: 7260 }, tz),
    ).toEqual([
      ['Server', 'v1.7.0, built 21/10/2026, 03:20 PM (Oman Time)'],
      ['Code revision', '39ecc18'],
      ['Environment', 'production'],
      ['Node.js', 'v22.12.0'],
      ['Running for', '2h 1m'],
    ]);
    expect(technicalDetails({ version: '1.7.0', deployedAt: '2026-10-21T11:20:00.000Z', source: 'development' }, tz)).toEqual([
      ['Server', 'v1.7.0, built 21/10/2026, 03:20 PM (Oman Time) (running from source: no build information)'],
      ['Code revision', 'not recorded'],
    ]);
  });
});

describe('About: the version history', () => {
  it('shows the sections with something in them, in the website’s order; security fixes to administrators only', () => {
    expect(RELEASE_SECTIONS.map((s) => s.title)).toEqual(['New features', 'Improvements', 'Security', 'Bug fixes']);
    expect(releaseSections(release(), true)).toEqual([
      { title: 'New features', items: ['A footer'] },
      { title: 'Security', items: ['A security fix'] },
      { title: 'Bug fixes', items: ['A fix'] },
    ]);
    expect(releaseSections(release(), false).map((s) => s.title)).toEqual(['New features', 'Bug fixes']);
    // Older answers can leave a section out.
    expect(releaseSections(release({ sections: { features: ['x'] } as never }), false)).toEqual([{ title: 'New features', items: ['x'] }]);
  });

  it('marks the website’s version and this app’s', () => {
    expect(releaseBadges(release(), { serverVersion: '1.7.0', appVersion: '1.6.0' })).toEqual(['Current']);
    expect(releaseBadges(release({ version: '1.6.0' }), { serverVersion: '1.7.0', appVersion: '1.6.0' })).toEqual(['This app']);
    expect(releaseBadges(release(), { serverVersion: '1.7.0', appVersion: '1.7.0' })).toEqual(['Current', 'This app']);
    expect(releaseBadges(release(), { serverVersion: null, appVersion: '1.6.0' })).toEqual([]);
  });

  it('reads a release’s heading to TalkBack with its day and marks', () => {
    expect(releaseHeadingLabel(release(), ['Current'])).toBe('Version 1.7.0, 21 October 2026, current');
    expect(releaseHeadingLabel(release({ version: '1.6.0', date: '2026-10-20' }), [])).toBe('Version 1.6.0, 20 October 2026');
  });
});

/**
 * The website's About page (Web Portal/frontend/src/pages/AboutPage.tsx) and its date rule
 * (lib/release.ts): the app says the same. Skipped when the website's code isn't next to the app.
 */
const webSrc = resolve(__dirname, '../../../Web Portal/frontend/src');
describe.skipIf(!existsSync(resolve(webSrc, 'pages/AboutPage.tsx')))('the same as the website’s About page', () => {
  it('the section titles, the months and the words', () => {
    const page = readFileSync(resolve(webSrc, 'pages/AboutPage.tsx'), 'utf8');
    for (const s of RELEASE_SECTIONS) expect(page).toContain(`{ key: '${s.key}', title: '${s.title}'${s.adminOnly ? ', adminOnly: true' : ''} }`);
    expect(page).toContain("const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];");
    for (const words of ['Includes security updates.', 'No release notes yet.', 'Version history', 'Code revision', "'not recorded'", ' (running from source: no build information)', 'Running for']) {
      expect(page).toContain(words);
    }
  });

  it('“Last updated” in the same words for the same moment', async () => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0';
    (globalThis as Record<string, unknown>).__APP_BUILT_AT__ = '';
    const web = (await import(/* @vite-ignore */ resolve(webSrc, 'lib/release.ts'))) as { formatLastUpdated: (iso: string, tz: string) => string; zoneLabel: (tz: string) => string };
    for (const tz of ['Asia/Muscat', 'Asia/Dubai', 'Europe/London', 'America/New_York']) {
      expect(zoneLabel(tz)).toBe(web.zoneLabel(tz));
      for (const iso of ['2026-10-16T15:30:00.000Z', '2026-10-16T20:05:00.000Z', '2026-01-01T00:00:00.000Z', '2026-03-29T01:30:00.000Z', '', 'nope']) {
        expect(lastUpdatedText(iso, tz), `${iso} ${tz}`).toBe(web.formatLastUpdated(iso, tz));
      }
    }
  });
});
