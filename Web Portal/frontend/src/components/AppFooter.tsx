import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { aboutApi } from '../api/about';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { RUNNING_BUILD, formatLastUpdated } from '../lib/release';
import { checkHostedApk } from '../lib/android-app-link';
import { EXTENSION_INSTALL_HINT, HOSTED_EXTENSION_PATH } from '../lib/app-downloads';

/** The footer's links: 28px tall for a mouse, 44px on a touch screen (a finger's size). */
const FOOTER_LINK = 'inline-flex min-h-[28px] items-center gap-1 font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11';

/** How often an open page checks for a new deployment. */
const CHECK_EVERY_MS = 5 * 60 * 1000;
/** Coming back to the page checks again, if the last check is older than this. */
const FRESH_FOR_MS = 30 * 1000;

/**
 * Every signed-in page's footer: the deployed version and when it was last updated (the server's
 * build at deployment, in the company's time zone), with the way to the version history. A newer web
 * app deployed since this page was loaded is told by the update notice (UpdateToast, 13 Nov 2026).
 */
export function AppFooter({ frameClass = 'mx-auto w-[95%]' }: { frameClass?: string } = {}) {
  const timeZone = useCompanyTimeZone();
  const versionQ = useQuery({
    queryKey: ['app-version'],
    queryFn: () => aboutApi(apiClient).version(),
    staleTime: FRESH_FOR_MS,
    refetchInterval: CHECK_EVERY_MS,
    refetchOnWindowFocus: true,
  });
  const version = versionQ.data?.version ?? RUNNING_BUILD.version;

  // The apps: the Chrome extension every web build carries (left out when the site doesn't have the
  // file, rather than a link that fails; until the site answers, it is offered). The Android app moved
  // to the sign-in page's footer and About (owner, 13 Nov: Install App comes first).
  const extensionQ = useQuery({ queryKey: ['hosted-download', HOSTED_EXTENSION_PATH], queryFn: () => checkHostedApk(HOSTED_EXTENSION_PATH), staleTime: Infinity, refetchOnWindowFocus: false });
  const showExtension = extensionQ.data !== false;

  // Pages sized to the window (the chat) leave room for the footer: its height, as a CSS variable.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => root.style.setProperty('--app-footer-space', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-footer-space');
    };
  }, []);

  return (
    <>
      <footer
        ref={ref}
        className={`${frameClass} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-xs text-ink-2`}
      >
        <p className="min-w-0">
          <span className="whitespace-nowrap">
            Version: <span className="font-semibold text-ink">v{version}</span>
          </span>
          {/* On a phone the two go on two lines: no "|" left hanging at the end of the first. */}
          <span aria-hidden="true" className="text-ink-3 max-sm:hidden">{' | '}</span>
          <span className="whitespace-nowrap max-sm:block">
            Last Updated: {versionQ.data ? formatLastUpdated(versionQ.data.deployedAt, timeZone) : versionQ.isError ? 'not available' : '…'}
          </span>
        </p>
        {/* The links stay together: when the line is too short they move down as one group
            ("About and version history" used to drop alone to the start of a new line). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {showExtension ? (
            <nav aria-label="Get the apps" className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Get the apps:</span>
              <a
                href={HOSTED_EXTENSION_PATH}
                download=""
                title={EXTENSION_INSTALL_HINT}
                className={FOOTER_LINK}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5h8.2M8.97 13.75 4.85 6.6M15.03 13.75l-4.1 7.12" /></svg>
                Chrome extension
              </a>
            </nav>
          ) : null}
          <Link to="/about" className={FOOTER_LINK}>
            About and version history
          </Link>
        </div>
      </footer>
    </>
  );
}
