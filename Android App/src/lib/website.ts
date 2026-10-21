/**
 * "Open on the website" (6b): the website's admin pages the app doesn't have — AI Management,
 * System Settings and Audit Logs — open in the browser, on the website of the server the app is
 * connected to. Only these pages, only on that server's own address, and only over https (or plain
 * http to an office-network server, the rule every request follows). Pure TypeScript.
 *
 * The app's own App Links never claim these paths (app.json), so the browser opens them and never
 * hands them back to the app.
 */
import { isAllowedUrl, sitePageUrl } from './server-address';

export interface WebsitePage {
  key: 'ai' | 'settings' | 'audit';
  /** The website's name for it (its Admin menu). */
  label: string;
  /** Its address on the website. */
  path: string;
  icon: string;
}

export const WEBSITE_ONLY_PAGES: readonly WebsitePage[] = [
  { key: 'ai', label: 'AI Management', path: '/admin/ai', icon: '🤖' },
  { key: 'settings', label: 'System Settings', path: '/admin/settings', icon: '🎛' },
  { key: 'audit', label: 'Audit Logs', path: '/admin/audit', icon: '📜' },
];

/** The full address of one of those pages on this server's website, or null for anything else. */
export function websitePageUrl(apiBase: string, path: string): string | null {
  if (!WEBSITE_ONLY_PAGES.some((p) => p.path === path)) return null;
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
