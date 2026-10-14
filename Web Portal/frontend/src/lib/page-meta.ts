import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const PRODUCT_NAME = 'MICO360 Tasks';

export interface PageMeta {
  /** The page's own name ('' for an unknown address: the tab then shows the product name). */
  title: string;
  /** Whether a search engine may list this page. Only the public pages; everything else is private. */
  indexable: boolean;
}

// One entry per route in App.tsx. The server sends the same noindex rule as an X-Robots-Tag
// header (backend web-app.ts `robotsTagFor`, deploy/nginx); keep the public list in step.
const PAGES: [pattern: RegExp, title: string, indexable?: boolean][] = [
  [/^\/login$/, 'Sign in', true],
  [/^\/privacy$/, 'Privacy policy', true],
  [/^\/terms$/, 'Terms of use', true],
  [/^\/forgot$/, 'Forgot password'],
  [/^\/reset$/, 'Reset password'],
  [/^\/dashboard$/, 'Dashboard'],
  [/^\/board$/, 'Kanban Board'],
  [/^\/projects$/, 'Projects'],
  [/^\/projects\/[^/]+$/, 'Project'],
  [/^\/my-tasks$/, 'My Tasks'],
  [/^\/calendar$/, 'Calendar'],
  [/^\/meetings$/, 'Meetings'],
  [/^\/meetings\/[^/]+$/, 'Meeting'],
  [/^\/my-action-items$/, 'My Action Items'],
  [/^\/chat$/, 'Chat'],
  [/^\/activity$/, 'Activity'],
  [/^\/notifications$/, 'Notifications'],
  [/^\/settings$/, 'Settings'],
  [/^\/profile$/, 'Your profile'],
  [/^\/reports$/, 'Reports'],
  [/^\/admin\/settings$/, 'System Settings'],
  [/^\/admin\/ai$/, 'AI Management'],
  [/^\/admin\/audit$/, 'Audit Logs'],
  [/^\/admin\/users$/, 'User Management'],
];

/** The title and search-engine rule for an address (a trailing slash is ignored). */
export function pageMetaFor(pathname: string): PageMeta {
  const path = pathname.replace(/\/+$/, '') || '/';
  const hit = PAGES.find(([pattern]) => pattern.test(path));
  return hit ? { title: hit[1], indexable: hit[2] === true } : { title: '', indexable: false };
}

/**
 * Set the browser tab title ("Page · MICO360 Tasks", with a specific name first when the page has
 * one) and the robots meta tag: private pages are marked `noindex, nofollow`, public ones are not.
 */
export function applyPageMeta(pathname: string, name?: string | null): void {
  const meta = pageMetaFor(pathname);
  document.title = [name?.trim(), meta.title, PRODUCT_NAME].filter(Boolean).join(' · ');
  let tag = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (meta.indexable) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = 'robots';
    document.head.appendChild(tag);
  }
  tag.content = 'noindex, nofollow';
}

/** Keeps the tab title and robots tag in step with the current page. Call once, inside the router. */
export function usePageMeta(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    applyPageMeta(pathname);
  }, [pathname]);
}

/** For pages that know a more specific name (a project, a meeting): shows it first in the tab title. */
export function usePageName(name: string | null | undefined): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (name) applyPageMeta(pathname, name);
  }, [pathname, name]);
}
