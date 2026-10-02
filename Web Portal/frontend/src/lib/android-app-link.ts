/**
 * Where the sign-in page's "Download for Android" button points. The server says (/config
 * androidAppUrl): an administrator's ANDROID_APP_URL, or the APK a self-contained install hosts at
 * /downloads/MICO360-Tasks.apk. Otherwise the public releases page.
 */
export const RELEASES_URL = 'https://github.com/mico360om/MICO360-Task/releases/latest';

export interface AndroidAppLink {
  href: string;
  /** True for a file on this server (download it); false for an external page (open it). */
  hosted: boolean;
}

export function androidAppLink(configured: string | null | undefined): AndroidAppLink {
  const url = (configured ?? '').trim();
  if (/^https:\/\//i.test(url)) return { href: url, hosted: false };
  if (url.startsWith('/') && !url.startsWith('//')) return { href: url, hosted: true };
  return { href: RELEASES_URL, hosted: false };
}
