import type { ReactNode } from 'react';
import { Logo } from './ui/Logo';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Centered, branded card used by the forgot/reset password screens. */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-6 py-12">
      <div className="w-full max-w-sm">
        <Logo size={44} className="mb-6" />
        <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
