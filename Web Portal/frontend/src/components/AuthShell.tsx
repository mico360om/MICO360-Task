import type { ReactNode } from 'react';
import { BrandLogo } from './ui/BrandLogo';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** The submit button of the sign-in family of pages (the sign-in page's own look). */
export const AUTH_SUBMIT_CLASS =
  'mt-1 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-brand transition hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60';

/**
 * The forgot / reset password screens: the sign-in page's card, logo and spacing, so the three read as
 * one place (they used to be a bare form under a generic tick mark).
 */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground px-4 py-10 sm:px-10">
      <div className="w-full max-w-md">
        <div className="rounded-[1.75rem] border border-line bg-surface p-6 shadow-lift sm:p-9">
          <div className="mb-6 flex">
            <BrandLogo className="h-11" alt="MICO360 Tasks" />
          </div>
          <h1 className="font-display text-[1.7rem] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
