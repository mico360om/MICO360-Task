/**
 * Where the sign-in page's "Download for Android" button points: the APK this site hosts at
 * /downloads/MICO360-Tasks.apk, the same address for every release (a new build replaces the
 * file; the link never changes). The server (/config androidAppUrl) may name the file itself, or
 * an https address an administrator configured (ANDROID_APP_URL, say a store page). The button
 * never sends anyone to a code-hosting page: it used to open the GitHub releases page when the
 * server named nothing, which asked the person for an account they do not have.
 */
export const HOSTED_APK_PATH = '/downloads/MICO360-Tasks.apk';

/** Code-hosting sites: a releases page there is not a download for the person at the sign-in page. */
const CODE_HOSTING = /^https:\/\/(www\.)?(github|gitlab|bitbucket)\.(com|org)\//i;

export interface AndroidAppLink {
  href: string;
  /** True for a file on this server (download it); false for an external page (open it). */
  hosted: boolean;
}

export function androidAppLink(configured: string | null | undefined): AndroidAppLink {
  const url = (configured ?? '').trim();
  if (/^https:\/\//i.test(url) && !CODE_HOSTING.test(url)) return { href: url, hosted: false };
  if (url.startsWith('/') && !url.startsWith('//')) return { href: url, hosted: true };
  return { href: HOSTED_APK_PATH, hosted: true };
}

/**
 * Whether the site has the hosted file, asked with a HEAD request: false when the site says it
 * has no such file (the button then says so, instead of being a link that fails). When the
 * question cannot be asked (offline, a server that refuses HEAD), the download gets the benefit
 * of the doubt: the click itself will tell.
 */
export async function checkHostedApk(href: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(href, { method: 'HEAD', cache: 'no-store' });
    return res.status !== 404 && res.status !== 410;
  } catch {
    return true;
  }
}
