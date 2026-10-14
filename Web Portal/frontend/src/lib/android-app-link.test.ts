import { describe, it, expect, vi } from 'vitest';
import { androidAppLink, checkHostedApk, HOSTED_APK_PATH } from './android-app-link';

describe('androidAppLink', () => {
  it('points at the APK this site hosts, at the same address for every release', () => {
    for (const none of [null, undefined, '', '  ']) {
      expect(androidAppLink(none)).toEqual({ href: HOSTED_APK_PATH, hosted: true });
    }
    expect(HOSTED_APK_PATH).toBe('/downloads/MICO360-Tasks.apk');
  });

  it('uses the file the server names, or an https address an administrator configured', () => {
    expect(androidAppLink('/downloads/MICO360-Tasks.apk')).toEqual({ href: '/downloads/MICO360-Tasks.apk', hosted: true });
    expect(androidAppLink('https://play.google.com/store/apps/details?id=com.mico360.tasks')).toEqual({
      href: 'https://play.google.com/store/apps/details?id=com.mico360.tasks',
      hosted: false,
    });
  });

  it('never sends anyone to a code-hosting page, and ignores unsafe values', () => {
    for (const bad of ['javascript:alert(1)', 'http://insecure.example/app.apk', '//evil.example/app.apk']) {
      expect(androidAppLink(bad), bad).toEqual({ href: HOSTED_APK_PATH, hosted: true });
    }
    expect(androidAppLink('https://github.com/mico360om/MICO360-Task/releases/latest')).toEqual({ href: HOSTED_APK_PATH, hosted: true });
  });
});

describe('checkHostedApk', () => {
  it('is true when the site answers for the file', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await checkHostedApk(HOSTED_APK_PATH, fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(HOSTED_APK_PATH, expect.objectContaining({ method: 'HEAD' }));
  });

  it('is false when the site has no such file', async () => {
    expect(await checkHostedApk(HOSTED_APK_PATH, vi.fn(async () => new Response(null, { status: 404 })))).toBe(false);
  });

  it('gives the download the benefit of the doubt when the question cannot be asked', async () => {
    // Offline, or a server that refuses HEAD: the link stays; the click itself will tell.
    expect(await checkHostedApk(HOSTED_APK_PATH, vi.fn(async () => { throw new TypeError('Failed to fetch'); }))).toBe(true);
    expect(await checkHostedApk(HOSTED_APK_PATH, vi.fn(async () => new Response(null, { status: 405 })))).toBe(true);
  });
});
