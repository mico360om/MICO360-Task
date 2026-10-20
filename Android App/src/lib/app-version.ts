/** This build of the app: its version (as on the website's About page) and Android build number. */
export interface AppInfo {
  version: string;
  build: number;
}

/** -1, 0 or 1, comparing dotted version numbers number by number ("1.2" equals "1.2.0"). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Is a newer version out? The app and the website share one version number, so a server on a
 * newer release means a newer app. A server without a release number (development) never is.
 */
export function updateAvailable(app: string, server: string | null | undefined): boolean {
  if (!server || !/^\d+(\.\d+)*$/.test(server)) return false;
  return compareVersions(app, server) < 0;
}

/** The offered version whose "new version" banner was put away (kept on the phone). */
export const UPDATE_DISMISSED_KEY = 'mico360.updateDismissed';

/**
 * The app version the site's download offers: the version inside that app file (the server reads
 * it), so a release that changes only the website never shows the notice. Null: no file to offer.
 * A server from before this rule doesn't say, and its own version stands in, as it used to.
 */
export function offeredAppVersion(config: { androidAppVersion?: string | null } | null | undefined, serverVersion: string | null): string | null {
  if (config && 'androidAppVersion' in config) return config.androidAppVersion ?? null;
  return serverVersion;
}

/**
 * Show the "new version" banner? Only while the offered app is newer and that version's banner hasn't
 * been put away.
 */
export function showUpdateBanner(app: string, offered: string | null | undefined, dismissed: string | null): boolean {
  return updateAvailable(app, offered) && dismissed !== offered;
}

/** The release name crash reports carry. */
export function releaseName({ version, build }: AppInfo): string {
  return `mico360-tasks@${version}+${build}`;
}

/** Sent with every request, so the server can tell which app version is talking to it. */
export function versionHeaders({ version, build }: AppInfo): Record<string, string> {
  return { 'X-App-Version': version, 'X-App-Build': String(build) };
}
