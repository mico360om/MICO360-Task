/**
 * "Open on the website" (6b): the website's pages the app doesn't have — AI Management, System
 * Settings and Audit Logs, and (until the app has its own screen) Templates — open in the browser,
 * on the website of the server the app is connected to. Only these pages, only on that server's
 * own address, and only over https (or plain http to an office-network server, the rule every
 * request follows). Pure TypeScript. Timeline, Workload, Management and MICO AI are the app's own
 * screens since Stage 3.
 *
 * The app's own App Links never claim these paths (app.json), so the browser opens them and never
 * hands them back to the app.
 */
import { isAllowedUrl, sitePageUrl } from './server-address';

// The menu's rows for these pages (names and drawn icons) are in navigation/drawer-menu.

/** Every website page the app opens in the browser: Search and the menu offer these, and nothing else. */
export const WEBSITE_LINK_PATHS = ['/admin/ai', '/admin/settings', '/admin/audit', '/templates'] as const;

/** The full address of one of those pages on this server's website, or null for anything else. */
export function websitePageUrl(apiBase: string, path: string): string | null {
  if (!(WEBSITE_LINK_PATHS as readonly string[]).includes(path)) return null;
  let base: URL;
  try {
    base = new URL(apiBase);
  } catch {
    return null;
  }
  if (base.username || base.password) return null;
  const url = sitePageUrl(apiBase, path);
  if (!isAllowedUrl(url)) return null;
  try {
    return new URL(url).origin === base.origin ? url : null;
  } catch {
    return null;
  }
}

/** What TalkBack says for a link that leaves the app. */
export const websiteLinkLabel = (label: string): string => `${label}, opens on the website`;

/** What to say when no browser opened it: the address, to type in. */
export function websiteOpenFailed(url: string): { title: string; message: string } {
  return { title: 'Couldn’t open the website', message: `Open this address in your browser:\n${url}` };
}
