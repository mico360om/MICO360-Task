import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The web app manifest (public/manifest.webmanifest) makes the site installable. It is linked from staff
 * pages only (owner, 13 Nov — P2): a client's pages — the shared client page, its privacy notice and the
 * Client portal — never offer to install. index.html is the same file for every page, so the page links
 * it itself, and unlinks it on a client's page.
 */
export const MANIFEST_HREF = '/manifest.webmanifest';

const CLIENT_PAGES = [/^\/client(\/|$)/, /^\/privacy\/client\/?$/, /^\/portal(\/|$)/];

export function offersInstall(pathname: string): boolean {
  return !CLIENT_PAGES.some((re) => re.test(pathname));
}

/** The installed-app tags: older iPhones open a home-screen page in its own window only with the first. */
const META = ['apple-mobile-web-app-capable', 'mobile-web-app-capable'];

export function syncManifestLink(doc: Document, pathname: string): void {
  const head = doc.head;
  if (!head) return;
  const link = head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!offersInstall(pathname)) {
    link?.remove();
    for (const name of META) head.querySelector(`meta[name="${name}"]`)?.remove();
    return;
  }
  if (!link) {
    const el = doc.createElement('link');
    el.rel = 'manifest';
    el.href = MANIFEST_HREF;
    head.appendChild(el);
  }
  for (const name of META) {
    if (head.querySelector(`meta[name="${name}"]`)) continue;
    const el = doc.createElement('meta');
    el.name = name;
    el.content = 'yes';
    head.appendChild(el);
  }
}

/** Keeps the link right as the person moves between pages (App). */
export function useManifestLink(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    syncManifestLink(document, pathname);
  }, [pathname]);
}
