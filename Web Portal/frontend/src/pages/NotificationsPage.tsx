import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { apiClient } from '../api/client';
import { notificationsApi, NOTIFICATIONS_KEY } from '../api/notifications';
import { useOpenNotification } from '../lib/notification-links';

const BellIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/** All notifications. Shares the bell's cache; clicking one marks it read and opens its task. */
export function NotificationsPage() {
  const q = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: () => notificationsApi(apiClient).list() });
  const items = q.data ?? [];
  const { open, markAllRead } = useOpenNotification();
  const unread = items.some((n) => !n.readAt);

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Notifications"
        subtitle="Mentions, assignments and updates across your work."
        actions={
          unread ? (
            <button onClick={() => markAllRead()} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-brand hover:border-brand">
              Mark all read
            </button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-2">
        {q.isLoading ? (
          <p className="text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="text-danger">
            Couldn’t load notifications.{' '}
            <button onClick={() => void q.refetch()} className="font-semibold underline">
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <EmptyState icon={BellIcon} title="You’re all caught up" description="Mentions, assignments and task updates will appear here." />
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={`rounded-lg border border-line bg-surface p-3 text-start transition-colors hover:border-brand/40 hover:bg-brand/5 ${n.readAt ? '' : 'border-l-4 border-l-brand'}`}
            >
              <div dir="auto" className="text-sm font-medium text-ink">{n.title}</div>
              {n.body ? <div dir="auto" className="mt-0.5 text-xs text-ink-2">{n.body}</div> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
