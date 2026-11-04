import { Suspense, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';
import { BrandLogo } from '../ui/BrandLogo';
import { Button } from '../ui/Button';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { usePortalMe } from './portal-queries';
import { Loading, TOUCH } from './portal-ui';

/**
 * 1.23 The Client portal's own small frame, instead of the staff app's: the logo, who is signed in
 * (name and organisation), Change password and Sign out — no sidebar, bell, chat, company picker,
 * search, MICO AI, reminders or realtime socket (the server refuses all of those to a client).
 */
export function PortalShell() {
  const me = usePortalMe().data?.me ?? null;
  const logout = useAuthStore((s) => s.logout);
  const [changing, setChanging] = useState(false);
  const who = me ? [me.name, me.organisation].filter(Boolean).join(' · ') : '';

  return (
    <div className="flex min-h-screen flex-col bg-ground" data-portal-shell>
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand"
      >
        Skip to the page
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
          <Link to="/portal" aria-label="Your projects" className={`${TOUCH} flex flex-none items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}>
            <BrandLogo className="h-8 sm:h-9" alt="MICO360 Tasks" />
          </Link>
          <span className="hidden text-xs font-semibold uppercase tracking-wide text-ink-2 sm:inline">Client portal</span>
          <div className="ms-auto flex min-w-0 items-center gap-2">
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
            <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => setChanging(true)}>
              Change password
            </Button>
            <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => logout('user')}>
              Sign out
            </Button>
          </div>
          {who ? (
            <p className="basis-full truncate pb-1 text-xs text-ink-2 md:hidden" title={who}>
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
          {/* The notice written for clients (the staff's privacy policy is about staff accounts). */}
          <Link to="/privacy/client" className={`${TOUCH} inline-flex items-center font-semibold text-brand underline-offset-2 hover:underline`}>
            Privacy notice
          </Link>
        </div>
      </footer>

      {changing ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}
    </div>
  );
}
