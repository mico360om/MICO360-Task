import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { aboutApi, deployedWebBuild } from '../api/about';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { RUNNING_BUILD, formatLastUpdated, isStaleBundle } from '../lib/release';

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
        <Link to="/about" className="font-medium text-brand hover:underline">
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
