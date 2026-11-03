import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { Button, buttonClass } from '../components/ui/Button';
import { apiClient } from '../api/client';
import {
  notificationsApi,
  NOTIFICATIONS_KEY,
  NOTIFICATION_COUNTS_KEY,
  NOTIFICATION_PAGES_KEY,
  UNREAD_COUNT_KEY,
  type ApiNotification,
  type NotificationPage,
} from '../api/notifications';
import { useOpenNotification } from '../lib/notification-links';
import { FirstStepsActions, useNoProjectsYet } from '../components/FirstSteps';
import { NotificationRow } from '../components/notifications/NotificationRow';
import {
  NOTIFICATION_KINDS,
  INBOX_FILTER_PREF,
  chunks,
  emptyInbox,
  groupByDay,
  newestCreatedAt,
  parseInboxFilter,
  serializeInboxFilter,
  toggleKind,
  unreadInView,
  type InboxCounts,
  type InboxFilter,
} from '../lib/notification-inbox';
import { useDeferredRemoval } from '../lib/useDeferredRemoval';
import { useDateSettings } from '../lib/useDatePrefs';
import { useMediaQuery } from '../lib/useMediaQuery';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { useAuthStore } from '../stores/auth-store';
import { TOUCH_TALL } from '../lib/touch';

const BellIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/** Older ones are asked for 50 at a time. */
const PAGE_SIZE = 50;

const isCounts = (v: unknown): v is InboxCounts => !!v && typeof v === 'object' && typeof (v as InboxCounts).unread === 'number' && !!(v as InboxCounts).kinds;

const segment = (active: boolean) =>
  `rounded-lg px-3 py-1 text-sm font-medium transition-colors ${TOUCH_TALL} ${active ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`;
const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${TOUCH_TALL} ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;

/**
 * Every notification (1.22): All / Unread tabs and type chips (remembered per person in this
 * browser), grouped by day, each with its kind's icon and its project; Mark read / Mark unread and
 * Remove (with a few seconds' Undo) on each or on several at once; older ones 50 at a time as the
 * list scrolls ("Show older" as well). Shares its cache with the bell, so read state always agrees.
 */
export function NotificationsPage({ undoMs = 5000 }: { undoMs?: number }) {
  const qc = useQueryClient();
  const api = notificationsApi(apiClient);
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const { timeZone } = useDateSettings();
  const wide = useMediaQuery('(min-width: 40em)', true);
  const noProjectsYet = useNoProjectsYet();
  const { open } = useOpenNotification();

  const [filter, setFilterState] = useState<InboxFilter>(() => parseInboxFilter(readUserValue(myId, INBOX_FILTER_PREF)));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const setFilter = (next: InboxFilter) => {
    setFilterState(next);
    writeUserValue(myId, INBOX_FILTER_PREF, serializeInboxFilter(next));
    setSelected(new Set());
  };

  const countsQ = useQuery({ queryKey: NOTIFICATION_COUNTS_KEY, queryFn: () => api.counts() });
  const counts = isCounts(countsQ.data) ? countsQ.data : undefined;
  const listQ = useInfiniteQuery({
    queryKey: [...NOTIFICATION_PAGES_KEY, filter.tab, filter.kinds.join(',')],
    queryFn: ({ pageParam }) => api.page({ limit: PAGE_SIZE, unread: filter.tab === 'unread', kinds: filter.kinds, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listQ;

  /** The bell, the page's lists and counts, and the badge, read again. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
  };
  const removal = useDeferredRemoval({
    delayMs: undoMs,
    commit: async (ids) => {
      try {
        if (ids.length === 1) await api.remove(ids[0]!);
        else for (const part of chunks(ids)) await api.bulk(part, 'remove');
      } finally {
        refresh();
      }
    },
    onFailed: (ids) => setProblem(ids.length === 1 ? 'Couldn’t remove the notification. Please try again.' : `Couldn’t remove ${ids.length} notifications. Please try again.`),
  });

  // Each one once (a reworded direct-message notice can move up a page while older ones load).
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (listQ.data?.pages ?? []).flatMap((p) => (Array.isArray(p.data) ? p.data : [])).filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  }, [listQ.data]);
  const visible = useMemo(() => rows.filter((n) => !removal.hidden.has(n.id)), [rows, removal.hidden]);
  const groups = useMemo(() => groupByDay(visible, timeZone), [visible, timeZone]);
  const hasRows = visible.length > 0;

  // Older ones load as the end of the list comes into view ("Show older" does the same by hand).
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || !hasRows || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, hasRows, isFetchingNextPage, fetchNextPage]);

  // Read state changes at once on the page and in the bell; the server's answer follows.
  function patchRead(ids: ReadonlySet<string>, readAt: string | null) {
    const set = (n: ApiNotification) => (ids.has(n.id) ? { ...n, readAt } : n);
    qc.setQueriesData<InfiniteData<NotificationPage>>({ queryKey: NOTIFICATION_PAGES_KEY }, (d) =>
      d ? { ...d, pages: d.pages.map((p) => ({ ...p, data: Array.isArray(p.data) ? p.data.map(set) : p.data })) } : d,
    );
    qc.setQueryData<ApiNotification[]>(NOTIFICATIONS_KEY, (list) => (Array.isArray(list) ? list.map(set) : list));
  }
  async function setRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    setProblem(null);
    patchRead(new Set(ids), read ? new Date().toISOString() : null);
    try {
      if (ids.length === 1) await (read ? api.markRead(ids[0]!) : api.markUnread(ids[0]!));
      else for (const part of chunks(ids)) await api.bulk(part, read ? 'read' : 'unread');
    } catch {
      setProblem(read ? 'Couldn’t mark them read. Please try again.' : 'Couldn’t mark them unread. Please try again.');
    } finally {
      refresh();
    }
  }
  function removeIds(ids: string[]) {
    if (ids.length === 0) return;
    setProblem(null);
    removal.remove(ids, ids.length === 1 ? 'Removed' : `Removed ${ids.length} notifications`);
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
  }
  // "Mark all read" reads what the tab and chips show — up to the newest shown, so one that arrives meanwhile stays unread.
  const markAll = useMutation({ mutationFn: () => api.markAllRead(newestCreatedAt(visible), filter.kinds), onSettled: refresh });

  const selectedIds = visible.filter((n) => selected.has(n.id)).map((n) => n.id);
  const allSelected = hasRows && selectedIds.length === visible.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkRead = (read: boolean) => {
    void setRead(selectedIds, read);
    setSelected(new Set());
  };
  const showBoxes = wide || selecting;
  const unreadShown = unreadInView(counts, filter.kinds);
  const plain = filter.tab === 'all' && filter.kinds.length === 0;
  const nothingAtAll = plain && listQ.isSuccess && !hasRows && !hasNextPage;
  const empty = emptyInbox(filter);

  return (
    // A readable width on a wide screen, centred (as Activity and About): across 1,600px a
    // notification's time sat a whole screen away from its words.
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Workspace"
        title="Notifications"
        subtitle="Mentions, assignments and updates across your work."
        actions={
          <>
            {unreadShown ? (
              <Button variant="secondary" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending} className={TOUCH_TALL}>
                Mark all read
              </Button>
            ) : null}
            <Link to="/settings#notifications" className={buttonClass('ghost', 'sm', TOUCH_TALL)}>
              Notification settings
            </Link>
          </>
        }
      />

      {/* Nothing at all yet: no tabs or chips over an empty page. */}
      {nothingAtAll ? null : (
        <div className="mb-4 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Show" className="inline-flex gap-0.5 rounded-xl border border-line bg-surface p-0.5">
              <button type="button" aria-pressed={filter.tab === 'all'} onClick={() => setFilter({ ...filter, tab: 'all' })} className={segment(filter.tab === 'all')}>
                All
              </button>
              <button type="button" aria-pressed={filter.tab === 'unread'} onClick={() => setFilter({ ...filter, tab: 'unread' })} className={segment(filter.tab === 'unread')}>
                {unreadShown === null ? 'Unread' : `Unread (${unreadShown})`}
              </button>
            </div>
            {/* Phones: the tick boxes come with "Select" (a wide screen always shows them). */}
            {!wide && hasRows ? (
              <Button
                variant="ghost"
                size="sm"
                className={TOUCH_TALL}
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting((on) => !on);
                  setSelected(new Set());
                }}
              >
                {selecting ? 'Done' : 'Select'}
              </Button>
            ) : null}
          </div>
          <div role="group" aria-label="Types" className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={filter.kinds.length === 0} onClick={() => setFilter({ ...filter, kinds: [] })} className={chip(filter.kinds.length === 0)}>
              All types
            </button>
            {NOTIFICATION_KINDS.map((k) => {
              const on = filter.kinds.includes(k.key);
              const n = counts?.kinds[k.key] ?? 0;
              return (
                <button
                  key={k.key}
                  type="button"
                  aria-pressed={on}
                  aria-label={n > 0 ? `${k.label}, ${n} unread` : k.label}
                  onClick={() => setFilter({ ...filter, kinds: toggleKind(filter.kinds, k.key) })}
                  className={chip(on)}
                >
                  <span>{k.label}</span>
                  {n > 0 ? (
                    <span aria-hidden="true" className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums ${on ? 'bg-white/25 text-white' : 'bg-brand/10 text-brand'}`}>
                      {n > 99 ? '99+' : n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}

      {listQ.isLoading ? (
        // Rows where the notifications will be, a screenful of them: the footer waits below the
        // fold instead of being shoved off it when the list arrives.
        <div role="status" aria-label="Loading notifications" className="flex h-[100dvh] flex-col gap-2 overflow-hidden">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} data-skeleton-row className="skeleton h-16 flex-none rounded-lg" />
          ))}
        </div>
      ) : listQ.isError && !listQ.data ? (
        <LoadError what="notifications" onRetry={() => void listQ.refetch()} />
      ) : !hasRows && !hasNextPage ? (
        plain ? (
          noProjectsYet ? (
            // A company's first day: nothing can have happened yet, so point to the first steps.
            <EmptyState
              icon={BellIcon}
              title="No notifications yet"
              description="You’ll be told here when someone assigns you a task, mentions you or updates your work. It all starts with a project."
              action={<FirstStepsActions />}
            />
          ) : (
            <EmptyState icon={BellIcon} title={empty.title} description={empty.description} />
          )
        ) : (
          <EmptyState
            icon={BellIcon}
            title={empty.title}
            description={empty.description}
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter(empty.clear === 'kinds' ? { ...filter, kinds: [] } : { ...filter, tab: 'all' })}>
                {empty.clear === 'kinds' ? 'Show all types' : 'Show all notifications'}
              </Button>
            }
          />
        )
      ) : (
        <>
          {showBoxes && hasRows ? (
            <label className="mb-2 inline-flex min-h-8 cursor-pointer items-center gap-2 px-1 text-xs font-medium text-ink-2 [@media(pointer:coarse)]:min-h-11">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((n) => n.id)))}
                className="h-4 w-4 cursor-pointer accent-brand"
              />
              Select all shown
            </label>
          ) : null}
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <section key={g.key} aria-labelledby={`notif-day-${g.key}`}>
                <h2 id={`notif-day-${g.key}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
                  {g.label}
                </h2>
                <ul className="flex flex-col gap-2">
                  {g.rows.map((n) => (
                    <NotificationRow
                      key={n.id}
                      n={n}
                      timeZone={timeZone}
                      selectable={showBoxes}
                      selected={selected.has(n.id)}
                      onToggleSelect={() => toggleOne(n.id)}
                      onOpen={() => open(n)}
                      onToggleRead={() => void setRead([n.id], !n.readAt)}
                      onRemove={() => removeIds([n.id])}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {selectedIds.length > 0 ? (
            <div role="region" aria-label="Selected notifications" className="sticky bottom-3 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-lift">
              <span className="text-sm font-medium text-ink">{`${selectedIds.length} selected`}</span>
              <div className="ms-auto flex flex-wrap items-center gap-1.5">
                <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={() => bulkRead(true)}>
                  Mark read
                </Button>
                <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={() => bulkRead(false)}>
                  Mark unread
                </Button>
                <Button variant="secondary" size="sm" className={`text-danger ${TOUCH_TALL}`} onClick={() => removeIds(selectedIds)}>
                  Remove
                </Button>
                <Button variant="ghost" size="sm" className={TOUCH_TALL} aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                  ✕
                </Button>
              </div>
            </div>
          ) : null}

          {hasNextPage ? (
            <div ref={sentinel} className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" className={TOUCH_TALL} loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                Show older
              </Button>
            </div>
          ) : hasRows ? (
            <p className="mt-4 text-center text-xs text-ink-3">That’s everything</p>
          ) : null}
          {listQ.isFetchNextPageError ? <LoadError className="mt-3" what="older notifications" onRetry={() => void fetchNextPage()} /> : null}
        </>
      )}

      {removal.pending ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div role="status" aria-labelledby="notif-toast-text" className="pointer-events-auto flex max-w-lg items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink shadow-lift">
            <span id="notif-toast-text">{removal.pending.label}</span>
            <span aria-hidden="true" className="text-ink-3">·</span>
            <button type="button" onClick={removal.undo} className={`rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand/10 ${TOUCH_TALL}`}>
              Undo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
