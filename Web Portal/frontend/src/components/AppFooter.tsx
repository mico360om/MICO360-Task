import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { aboutApi, deployedWebBuild } from '../api/about';
import { configApi } from '../api/config';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { RUNNING_BUILD, formatLastUpdated, isStaleBundle } from '../lib/release';
import { androidAppLink, checkHostedApk } from '../lib/android-app-link';
import { EXTENSION_INSTALL_HINT, HOSTED_EXTENSION_PATH } from '../lib/app-downloads';

/** The footer's links: 28px tall for a mouse, 32px on a touch screen (WCAG 2.2 asks for 24px). */
const FOOTER_LINK = 'inline-flex min-h-[28px] items-center gap-1 font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-[2rem]';

/** How often an open page checks for a new deployment. */
const CHECK_EVERY_MS = 5 * 60 * 1000;
/** Coming back to the page checks again, if the last check is older than this. */
const FRESH_FOR_MS = 30 * 1000;

/**
 * Every signed-in page's footer: the deployed version and when it was last updated (the server's
 * build at deployment, in the company's time zone), with the way to the version history. When a
 * newer web app has been deployed since this page was loaded, it says so and offers to reload, so
 * nobody keeps working on — or reading the footer of — an old copy.
 */
export function AppFooter() {
  const timeZone = useCompanyTimeZone();
  const versionQ = useQuery({
    queryKey: ['app-version'],
    queryFn: () => aboutApi(apiClient).version(),
    staleTime: FRESH_FOR_MS,
    refetchInterval: CHECK_EVERY_MS,
    refetchOnWindowFocus: true,
  });
  const webQ = useQuery({
    queryKey: ['web-build'],
    queryFn: deployedWebBuild,
    staleTime: FRESH_FOR_MS,
    refetchInterval: CHECK_EVERY_MS,
    refetchOnWindowFocus: true,
  });
  const version = versionQ.data?.version ?? RUNNING_BUILD.version;
  const stale = isStaleBundle(RUNNING_BUILD, webQ.data);

  // The apps: the Android app (the APK this site hosts, or a page the administrator set) and the
  // Chrome extension every web build carries. A file the site doesn't have is left out rather than
  // offered as a link that fails; until the site answers, it is offered.
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const android = androidAppLink(configQ.data?.androidAppUrl);
  const apkQ = useQuery({ queryKey: ['android-apk', android.href], queryFn: () => checkHostedApk(android.href), enabled: android.hosted, staleTime: Infinity, refetchOnWindowFocus: false });
  const extensionQ = useQuery({ queryKey: ['hosted-download', HOSTED_EXTENSION_PATH], queryFn: () => checkHostedApk(HOSTED_EXTENSION_PATH), staleTime: Infinity, refetchOnWindowFocus: false });
  const showAndroid = !android.hosted || apkQ.data !== false;
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
        className="mx-auto flex w-[95%] flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-xs text-ink-2"
      >
        <p className="min-w-0">
          <span className="whitespace-nowrap">
            Version: <span className="font-semibold text-ink">v{version}</span>
          </span>
          <span aria-hidden="true" className="text-ink-3">{' | '}</span>
          <span className="whitespace-nowrap">
            Last Updated: {versionQ.data ? formatLastUpdated(versionQ.data.deployedAt, timeZone) : versionQ.isError ? 'not available' : '…'}
          </span>
        </p>
        {showAndroid || showExtension ? (
          <nav aria-label="Get the apps" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Get the apps:</span>
            {showAndroid ? (
              <a
                href={android.href}
                {...(android.hosted ? { download: '' } : { target: '_blank', rel: 'noopener noreferrer' })}
                title={android.hosted ? 'The MICO360 Tasks app for Android phones (an .apk file to install)' : 'The MICO360 Tasks app for Android phones'}
                className={FOOTER_LINK}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M7 9.5h10v7.5a1 1 0 0 1-1 1h-1v2.5a1.25 1.25 0 0 1-2.5 0V18h-1v2.5a1.25 1.25 0 0 1-2.5 0V18H8a1 1 0 0 1-1-1zM4.75 9.5A1.25 1.25 0 0 1 6 10.75v4.5a1.25 1.25 0 0 1-2.5 0v-4.5A1.25 1.25 0 0 1 4.75 9.5zm14.5 0a1.25 1.25 0 0 1 1.25 1.25v4.5a1.25 1.25 0 0 1-2.5 0v-4.5a1.25 1.25 0 0 1 1.25-1.25zM15.5 4.2l1-1.5a.3.3 0 0 0-.5-.33l-1.06 1.58A6.3 6.3 0 0 0 12 3.4a6.3 6.3 0 0 0-2.94.55L8 2.37a.3.3 0 1 0-.5.33l1 1.5A5 5 0 0 0 7 8.5h10a5 5 0 0 0-1.5-4.3zM10 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm4 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" /></svg>
                Android app
              </a>
            ) : null}
            {showExtension ? (
              <a
                href={HOSTED_EXTENSION_PATH}
                download=""
                title={EXTENSION_INSTALL_HINT}
                className={FOOTER_LINK}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5h8.2M8.97 13.75 4.85 6.6M15.03 13.75l-4.1 7.12" /></svg>
                Chrome extension
              </a>
            ) : null}
          </nav>
        ) : null}
        <Link to="/about" className={FOOTER_LINK}>
          About and version history
        </Link>
      </footer>
      {stale ? (
        <div role="status" className="fixed inset-x-0 bottom-3 z-[55] flex justify-center px-3">
          <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink shadow-lift">
            <span>A new version of MICO360 Tasks is available.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[36px] rounded-lg bg-brand-gradient px-3 text-sm font-semibold text-white"
            >
              Reload
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
