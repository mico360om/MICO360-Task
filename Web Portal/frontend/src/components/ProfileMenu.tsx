import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { assetUrl } from '../api/client';
import { useAuthStore } from '../stores/auth-store';

/** Header account button + dropdown menu: identity, profile, settings and log out. */
export function ProfileMenu() {
  const { user, isAdmin, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();
  const admin = isAdmin();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const avatar = (size: string) =>
    user?.avatarUrl ? (
      <img src={assetUrl(user.avatarUrl)} alt="" className={`${size} rounded-full border border-line object-cover`} />
    ) : (
      <span className={`${size} grid place-items-center rounded-full bg-brand-gradient text-xs font-bold text-white`}>{initials}</span>
    );

  const itemClass = 'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink transition-colors hover:bg-ground';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-1 transition-colors hover:bg-ground sm:pr-2"
      >
        {avatar('h-8 w-8')}
        <span className="hidden text-sm font-medium text-ink xl:inline">{user?.username}</span>
        <svg className="hidden text-ink-2 xl:block" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lift animate-scale-in">
          <div className="flex items-center gap-2.5 border-b border-line px-3 py-3">
            {avatar('h-10 w-10')}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user?.username}</p>
              <p className="truncate text-xs text-ink-2">{user?.email}</p>
              <span className="mt-0.5 inline-block rounded bg-ground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-2">
                {admin ? 'Administrator' : 'Employee'}
              </span>
            </div>
          </div>
          <div className="p-1.5">
            <Link to="/profile" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" />
              </svg>
              Your profile
            </Link>
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.8 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-1.1 2.7v.1a1.6 1.6 0 0 0 1.1 1.5z" />
              </svg>
              Settings
            </Link>
          </div>
          <div className="border-t border-line p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); logout(); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Log out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
