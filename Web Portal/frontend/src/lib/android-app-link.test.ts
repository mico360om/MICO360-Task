import { describe, it, expect } from 'vitest';
import { androidAppLink, RELEASES_URL } from './android-app-link';

describe('androidAppLink', () => {
  it('uses the link the server gives: an external page or a file it hosts', () => {
    expect(androidAppLink('https://play.google.com/store/apps/details?id=com.mico360.tasks')).toEqual({
      href: 'https://play.google.com/store/apps/details?id=com.mico360.tasks',
      hosted: false,
    });
    expect(androidAppLink('/downloads/MICO360-Tasks.apk')).toEqual({ href: '/downloads/MICO360-Tasks.apk', hosted: true });
  });

  it('falls back to the public releases page', () => {
    for (const none of [null, undefined, '', '  ']) expect(androidAppLink(none)).toEqual({ href: RELEASES_URL, hosted: false });
  });

  it('ignores unsafe values', () => {
    for (const bad of ['javascript:alert(1)', 'http://insecure.example/app.apk', '//evil.example/app.apk']) {
      expect(androidAppLink(bad).href, bad).toBe(RELEASES_URL);
    }
  });
});
