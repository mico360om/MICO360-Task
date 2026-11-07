import { Suspense, useState, type MouseEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { PREVIEW_ONLY } from '../../api/portal';
import { useAuthStore } from '../../stores/auth-store';
import { BrandLogo } from '../ui/BrandLogo';
import { Button } from '../ui/Button';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { usePortalPreview, usePreviewOff } from './portal-context';
import { usePortalMe, usePortalNotices } from './portal-queries';
import { Loading, TOUCH } from './portal-ui';

/**
 * 1.23 The Client portal's own small frame, instead of the staff app's: the logo, who is signed in
 * (name and organisation), Change password and Sign out — no sidebar, chat, company picker, search,
 * MICO AI, reminders or realtime socket (the server refuses all of those to a client). 1.23.7: the
 * portal's own bell (its notices, read every minute), and in a Preview as client a banner saying so.
 *
 * On a phone the header is two short rows: the logo, the bell and Sign out; then who is signed in and
 * Change password. From 640px everything is on one row (who is signed in under it until 768px).
 */
export function PortalShell() {
  const me = usePortalMe().data?.me ?? null;
  const logout = useAuthStore((s) => s.logout);
  const preview = usePortalPreview();
  const off = usePreviewOff();
  const [changing, setChanging] = useState(false);
  const who = me ? [me.name, me.organisation].filter(Boolean).join(' · ') : '';
  // A preview is a dialog over an administrator's page: an #address would land there, so the link moves focus itself.
  const skip = preview
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        document.getElementById('portal-main')?.focus();
      }
    : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-ground" data-portal-shell>
      <a
        href="#portal-main"
        onClick={skip}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand"
      >
        Skip to the page
      </a>
      {preview ? (
        <div role="status" className="border-b border-warning/30 bg-warning-soft">
          <div className="mx-auto flex max-w-5xl items-start gap-2 px-4 py-2.5 text-sm sm:px-6">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-warning">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <p className="min-w-0 text-ink">
              <span className="font-semibold">{PREVIEW_ONLY}</span>{' '}
              <span>This is the portal as this client sees it: their buttons are shown, but switched off.</span>
            </p>
          </div>
        </div>
      ) : null}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:gap-x-3 sm:px-6">
          <Link to="/portal" aria-label="Your projects" className={`${TOUCH} flex flex-none items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}>
            <BrandLogo className="h-8 sm:h-9" alt="MICO360 Tasks" />
          </Link>
          <span className="hidden text-xs font-semibold uppercase tracking-wide text-ink-2 sm:inline">Client portal</span>
          {/* Under 768px this group's buttons take their places in the header's own rows (see above). */}
          <div className="ms-auto flex min-w-0 items-center gap-2 max-md:contents">
            {me ? (
              <div className="hidden min-w-0 max-w-[18rem] text-end leading-tight md:block" title={who}>
                <p className="truncate text-sm font-semibold text-ink">
                  <span className="sr-only">Signed in as </span>
                  <bdi>{me.name}</bdi>
                </p>
                {me.organisation ? (
                  <p className="truncate text-xs text-ink-2">
                    <bdi>{me.organisation}</bdi>
                  </p>
                ) : null}
              </div>
            ) : null}
            <NoticeBell className="max-md:ms-auto" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={`${TOUCH} max-sm:order-2 ${off.className}`}
              disabled={off.disabled}
              title={off.title}
              onClick={() => setChanging(true)}
            >
              Change password
            </Button>
            <Button type="button" variant="ghost" size="sm" className={`${TOUCH} ${off.className}`} disabled={off.disabled} title={off.title} onClick={() => logout('user')}>
              Sign out
            </Button>
          </div>
          {who ? (
            <p className="min-w-[10rem] flex-1 truncate text-xs text-ink-2 max-sm:order-1 sm:basis-full sm:pb-1 md:hidden" title={who}>
              Signed in as <bdi className="font-semibold text-ink">{me?.name}</bdi>
              {me?.organisation ? (
                <>
                  {' · '}
                  <bdi>{me.organisation}</bdi>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>

      <main id="portal-main" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-5 outline-none sm:px-6 sm:py-8">
        <Suspense fallback={<Loading what="the page" />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-ink-2 sm:px-6">
          <span>Client portal · MICO360 Tasks</span>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link to="/portal/settings" className={`${TOUCH} inline-flex items-center font-semibold text-brand underline-offset-2 hover:underline`}>
              Notification settings
            </Link>
            {/* The notice written for clients (the staff's privacy policy is about staff accounts); in a preview only its name. */}
            {preview ? (
              <span className={`${TOUCH} inline-flex items-center font-semibold`}>Privacy notice</span>
            ) : (
              <Link to="/privacy/client" className={`${TOUCH} inline-flex items-center font-semibold text-brand underline-offset-2 hover:underline`}>
                Privacy notice
              </Link>
            )}
          </div>
        </div>
      </footer>

      {changing && !preview ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}
    </div>
  );
}

/** "99+" past 99. */
const countWords = (n: number) => (n > 99 ? '99+' : String(n));

/** 1.23.7 The portal's bell: how many notices are unread, opening Notifications. */
function NoticeBell({ className = '' }: { className?: string }) {
  const unread = usePortalNotices().data?.unread ?? 0;
  const here = useLocation().pathname === '/portal/notifications';
  return (
    <Link
      to="/portal/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      aria-current={here ? 'page' : undefined}
      className={`${TOUCH} relative inline-flex min-w-11 flex-none items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
        here ? 'bg-brand/10 text-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread ? (
        <span aria-hidden="true" className="absolute end-0.5 top-0.5 min-w-[1.25rem] rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-surface">
          {countWords(unread)}
        </span>
      ) : null}
    </Link>
  );
}
