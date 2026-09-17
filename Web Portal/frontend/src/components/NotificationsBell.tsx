import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { notificationsApi } from '../api/notifications';

/** Header notifications bell: unread badge + dropdown list + mark-all-read (T6.3). */
export function NotificationsBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    queryKey: ['notif-unread'],
    queryFn: () => notificationsApi(apiClient).unreadCount(),
    refetchInterval: 30000,
  });
  const listQ = useQuery({
    queryKey: ['notif-list'],
    queryFn: () => notificationsApi(apiClient).list(),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notif-unread'] });
    queryClient.invalidateQueries({ queryKey: ['notif-list'] });
  };
  const markAll = useMutation({ mutationFn: () => notificationsApi(apiClient).markAllRead(), onSuccess: invalidate });
  const markOne = useMutation({ mutationFn: (id: string) => notificationsApi(apiClient).markRead(id), onSuccess: invalidate });

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
            <button onClick={() => markAll.mutate()} className="text-xs font-medium text-brand hover:underline">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-ink-2">{listQ.isLoading ? 'Loading…' : 'You’re all caught up.'}</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className={`border-b border-line px-3 py-2 last:border-0 ${n.readAt ? 'opacity-60' : ''}`}>
                  <button onClick={() => markOne.mutate(n.id)} className="w-full text-left">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    {n.body ? <p className="text-xs text-ink-2">{n.body}</p> : null}
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
