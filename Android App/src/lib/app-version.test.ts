import { describe, it, expect } from 'vitest';
import { appDownloadUrl, compareVersions, updateAvailable, showUpdateBanner, releaseName, versionHeaders, offeredAppVersion } from './app-version';

describe('offeredAppVersion — what the "new version" notice compares with', () => {
  it('the version inside the app file the site offers, not the website’s own version', () => {
    expect(offeredAppVersion({ androidAppVersion: '1.3.3' }, '1.3.6')).toBe('1.3.3');
  });
  it('no app file on the site (or unreadable): nothing to offer, so no notice', () => {
    expect(offeredAppVersion({ androidAppVersion: null }, '1.3.6')).toBeNull();
  });
  it('a server from before this rule says nothing about the file: its own version, as before', () => {
    expect(offeredAppVersion({}, '1.2.0')).toBe('1.2.0');
    expect(offeredAppVersion(undefined, '1.2.0')).toBe('1.2.0');
  });
  it('a website-only release no longer shows the notice on an up-to-date app', () => {
    expect(showUpdateBanner('1.3.3', offeredAppVersion({ androidAppVersion: '1.3.3' }, '1.3.6'), null)).toBe(false);
    expect(showUpdateBanner('1.3.3', offeredAppVersion({ androidAppVersion: '1.3.4' }, '1.3.6'), null)).toBe(true);
  });
});

describe('app version', () => {
  it('compares versions number by number', () => {
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('an update is available only when the server is newer', () => {
    expect(updateAvailable('1.2.0', null)).toBe(false);
    expect(updateAvailable('1.2.0', '1.2.0')).toBe(false);
    expect(updateAvailable('1.2.1', '1.2.0')).toBe(false);
    expect(updateAvailable('1.2.0', '1.2.1')).toBe(true);
    expect(updateAvailable('1.2.0', 'development')).toBe(false); // a dev server has no version
  });

  it('the banner can be put away for that version (a server-only release has no new app), and comes back for a newer one', () => {
    expect(showUpdateBanner('1.2.0', '1.2.1', null)).toBe(true);
    expect(showUpdateBanner('1.2.0', '1.2.1', '1.2.1')).toBe(false);
    expect(showUpdateBanner('1.2.0', '1.2.2', '1.2.1')).toBe(true);
    expect(showUpdateBanner('1.2.1', '1.2.1', null)).toBe(false);
  });

  it('names the release for crash reports and the request headers', () => {
    expect(releaseName({ version: '1.2.1', build: 10 })).toBe('mico360-tasks@1.2.1+10');
    expect(versionHeaders({ version: '1.2.1', build: 10 })).toEqual({ 'X-App-Version': '1.2.1', 'X-App-Build': '10' });
  });
});

describe('appDownloadUrl — where the notice’s Download goes', () => {
  const base = 'https://task.mico360.com/api/v1';

  it('a full address from the server is used as it is', () => {
    expect(appDownloadUrl(base, 'https://play.google.com/store/apps/details?id=com.mico360.tasks')).toBe(
      'https://play.google.com/store/apps/details?id=com.mico360.tasks',
    );
  });

  it('a site path (older servers) is opened on the server the app is connected to', () => {
    expect(appDownloadUrl(base, '/downloads/MICO360-Tasks.apk')).toBe('https://task.mico360.com/downloads/MICO360-Tasks.apk');
    expect(appDownloadUrl('http://192.168.1.20:4000/api/v1', 'downloads/MICO360-Tasks.apk')).toBe('http://192.168.1.20:4000/downloads/MICO360-Tasks.apk');
  });

  it('no address (the site hosts the app itself) means the site’s own download', () => {
    expect(appDownloadUrl(base, null)).toBe('https://task.mico360.com/downloads/MICO360-Tasks.apk');
    expect(appDownloadUrl(base, undefined)).toBe('https://task.mico360.com/downloads/MICO360-Tasks.apk');
    expect(appDownloadUrl(base, '  ')).toBe('https://task.mico360.com/downloads/MICO360-Tasks.apk');
  });

  it('only a web address is opened: any other kind (intent:, file:, market:…) means the site’s own download', () => {
    for (const url of [
      'intent://scan/#Intent;component=com.example/.Evil;end',
      'file:///sdcard/Download/evil.apk',
      'content://com.example.provider/evil.apk',
      'market://details?id=com.example',
      'javascript:alert(1)',
    ]) {
      expect(appDownloadUrl(base, url)).toBe('https://task.mico360.com/downloads/MICO360-Tasks.apk');
    }
    expect(appDownloadUrl(base, 'HTTPS://example.com/app.apk')).toBe('HTTPS://example.com/app.apk');
    expect(appDownloadUrl(base, 'http://192.168.1.20:4000/app.apk')).toBe('http://192.168.1.20:4000/app.apk');
  });
});
