import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { notificationsApi, NOTIFICATIONS_KEY, UNREAD_COUNT_KEY } from '../api/notifications';
import { notificationTarget, useOpenNotification } from '../lib/notification-links';

/**
 * Header notifications bell: unread badge + dropdown list + mark-all-read (T6.3). Clicking a
 * notification marks it read and opens what it's about (a task opens in the task drawer). The list
 * shares its cache with the Notifications page, so read state stays in sync.
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { open: openNotification, markAllRead } = useOpenNotification();

  // Dismiss on outside-click or Escape — same pattern as ProfileMenu.
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

  const countQ = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => notificationsApi(apiClient).unreadCount(),
    refetchInterval: 30000,
  });
  const listQ = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => notificationsApi(apiClient).list(),
    enabled: open,
  });

  const count = countQ.data ?? 0;
  const items = listQ.data ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications${count > 0 ? `, ${count} unread` : ''}`}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-ground hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7.5-2.5 7.5h17S18 15 18 8.5" />
          <path d="M10.3 20a2 2 0 0 0 3.4 0" />
        </svg>
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white ring-2 ring-surface">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-lift">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            <button onClick={() => markAllRead()} className="text-xs font-medium text-brand hover:underline">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {listQ.isError ? (
              <li role="alert" className="px-3 py-4 text-center text-sm text-danger">
                Couldn’t load notifications.{' '}
                <button onClick={() => void listQ.refetch()} className="font-semibold underline">
                  Retry
                </button>
              </li>
            ) : items.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-ink-2">{listQ.isLoading ? 'Loading…' : 'You’re all caught up.'}</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className={`border-b border-line px-3 py-2 last:border-0 ${n.readAt ? 'opacity-60' : ''}`}>
                  <button
                    onClick={() => {
                      openNotification(n);
                      if (notificationTarget(n)) setOpen(false);
                    }}
                    className="w-full text-start"
                  >
                    <p dir="auto" className="text-sm font-medium text-ink">{n.title}</p>
                    {n.body ? <p dir="auto" className="text-xs text-ink-2">{n.body}</p> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
