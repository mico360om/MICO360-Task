import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { Button, buttonClass } from '../components/ui/Button';
import { apiClient } from '../api/client';
import { ApiError } from '../lib/api-client';
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
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';
import { DensityButton } from '../components/DensityButton';

const BellIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/** Older ones are asked for 50 at a time. */
const PAGE_SIZE = 50;

const isCounts = (v: unknown): v is InboxCounts => !!v && typeof v === 'object' && typeof (v as InboxCounts).unread === 'number' && !!(v as InboxCounts).kinds;

const segment = (active: boolean) =>
  `rounded-lg px-3 py-1 text-sm font-medium transition-colors ${TOUCH_SQUARE} ${active ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`;
const chip = (active: boolean) =>
  `inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${TOUCH_TALL} ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;

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
  // Changes build on the latest choice (two quick clicks both count); what the person chose is
  // remembered for them in this browser.
  const chosen = useRef(false);
  const setFilter = (change: (f: InboxFilter) => InboxFilter) => {
    chosen.current = true;
    setFilterState(change);
  };
  useEffect(() => {
    if (chosen.current) writeUserValue(myId, INBOX_FILTER_PREF, serializeInboxFilter(filter));
  }, [myId, filter]);
  // Another tab or chips: the ticks go (they were on rows that may not be shown any more). The same
  // tab or chip clicked again keeps them.
  const view = `${filter.tab}|${filter.kinds.join(',')}`;
  useEffect(() => setSelected(new Set()), [view]);

  const countsQ = useQuery({ queryKey: NOTIFICATION_COUNTS_KEY, queryFn: () => api.counts() });
  const counts = isCounts(countsQ.data) ? countsQ.data : undefined;
  const listQ = useInfiniteQuery({
    queryKey: [...NOTIFICATION_PAGES_KEY, filter.tab, filter.kinds.join(',')],
    queryFn: ({ pageParam }) => api.page({ limit: PAGE_SIZE, unread: filter.tab === 'unread', kinds: filter.kinds, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = listQ;

  /**
   * After the page's own changes: the counts, the badge and the bell's list are read again — not the
   * loaded pages (ten of them after a long scroll), which were changed in place. A row marked read on
   * the Unread tab stays, quieter, until the list is next read (another tab, a new notification).
   */
  const refreshCounts = () => {
    void qc.invalidateQueries({ queryKey: NOTIFICATION_COUNTS_KEY });
    void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY, exact: true });
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
  };
  /** Everything, the loaded pages too (after "Mark all read"). */
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
  };
  const removal = useDeferredRemoval({
    delayMs: undoMs,
    // The ids that could not be removed come back; one already gone (removed in another tab) is done.
    // Sent as the page goes (a reload, another address): kept alive so the browser still sends it.
    commit: async (ids, { leaving }) => {
      const failed: string[] = [];
      const opts = leaving ? { keepalive: true } : undefined;
      if (ids.length === 1) {
        await api.remove(ids[0]!, opts).catch((err: unknown) => {
          if (!(err instanceof ApiError && err.status === 404)) failed.push(ids[0]!);
        });
      } else {
        for (const part of chunks(ids)) await api.bulk(part, 'remove', opts).catch(() => failed.push(...part));
      }
      refreshCounts();
      return failed;
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
  // After a failed page they wait for "Show older" or Retry: asking by itself again would go on forever.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || !hasRows || isFetchNextPageError || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, hasRows, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // Where the keyboard goes when the control it was on goes away (a removed row, the selection bar,
  // the Undo toast): the row now at that place, or the one brought back. Used on the next draw only.
  const focusPlan = useRef<{ index: number } | { id: string } | null>(null);
  useEffect(() => {
    const plan = focusPlan.current;
    if (!plan) return;
    focusPlan.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    const target = 'id' in plan ? visible.find((n) => n.id === plan.id) : visible[Math.min(plan.index, visible.length - 1)];
    if (target) document.querySelector<HTMLElement>(`[data-notification-id="${CSS.escape(target.id)}"] [data-open]`)?.focus();
  });

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
    // A list being read again right now (a new notification came) would answer with the old state:
    // stop it, and read it again once this change is saved.
    const reading = qc.isFetching({ queryKey: NOTIFICATION_PAGES_KEY }) > 0;
    if (reading) await qc.cancelQueries({ queryKey: NOTIFICATION_PAGES_KEY });
    patchRead(new Set(ids), read ? new Date().toISOString() : null);
    try {
      if (ids.length === 1) await (read ? api.markRead(ids[0]!) : api.markUnread(ids[0]!));
      else for (const part of chunks(ids)) await api.bulk(part, read ? 'read' : 'unread');
    } catch {
      setProblem(read ? 'Couldn’t mark them read. Please try again.' : 'Couldn’t mark them unread. Please try again.');
      // Show the server's state again (the change was shown before it was saved).
      void qc.invalidateQueries({ queryKey: NOTIFICATION_PAGES_KEY });
    } finally {
      if (reading) void qc.invalidateQueries({ queryKey: NOTIFICATION_PAGES_KEY });
      refreshCounts();
    }
  }
  const indexOf = (id: string | undefined) => Math.max(0, visible.findIndex((n) => n.id === id));
  function removeIds(ids: string[]) {
    if (ids.length === 0) return;
    setProblem(null);
    focusPlan.current = { index: indexOf(ids[0]) };
    removal.remove(ids, ids.length === 1 ? 'Removed' : `Removed ${ids.length} notifications`);
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
  }
  function undoRemove() {
    focusPlan.current = removal.pending ? { id: removal.pending.ids[0]! } : null;
    removal.undo();
  }
  // "Mark all read" reads what the tab and chips show — up to the newest shown, so one that arrives meanwhile stays unread.
  const markAll = useMutation({
    mutationFn: () => api.markAllRead(newestCreatedAt(visible), filter.kinds),
    onMutate: () => setProblem(null),
    onError: () => setProblem('Couldn’t mark them read. Please try again.'),
    onSettled: refreshAll,
  });

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
    focusPlan.current = { index: indexOf(selectedIds[0]) };
    void setRead(selectedIds, read);
    setSelected(new Set());
  };
  const clearSelection = () => {
    focusPlan.current = { index: indexOf(selectedIds[0]) };
    setSelected(new Set());
  };
  const showBoxes = wide || selecting;
  const unreadShown = unreadInView(counts, filter.kinds);
  const plain = filter.tab === 'all' && filter.kinds.length === 0;
  const nothingAtAll = plain && listQ.isSuccess && !hasRows && !hasNextPage;
  const empty = emptyInbox(filter);

  return (
    // 1.23.4 (owner, 6 Nov: "Increase the width of page"): the full content width, like My Tasks
    // and the other list pages; the time and actions stay at each row's end, as in a mail inbox.
    <div className={selectedIds.length > 0 ? 'pb-28 sm:pb-20' : undefined}>
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
            <div role="group" aria-label="Show notifications" className="inline-flex gap-0.5 rounded-xl border border-line bg-surface p-0.5">
              <button type="button" aria-pressed={filter.tab === 'all'} onClick={() => setFilter((f) => ({ ...f, tab: 'all' }))} className={segment(filter.tab === 'all')}>
                All
              </button>
              <button type="button" aria-pressed={filter.tab === 'unread'} onClick={() => setFilter((f) => ({ ...f, tab: 'unread' }))} className={segment(filter.tab === 'unread')}>
                {unreadShown === null ? 'Unread' : `Unread (${unreadShown})`}
              </button>
            </div>
            {/* 1.23.0: Compact rows (from 768px with a mouse; Settings otherwise). */}
            <DensityButton className="ms-auto" size="sm" />
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
          {/* One line that scrolls sideways on a phone (six 44px chips wrapped to four lines there); wrapped from sm up. */}
          <div role="group" aria-label="Types" className="-my-1 flex gap-1.5 overflow-x-auto py-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            <button type="button" aria-pressed={filter.kinds.length === 0} onClick={() => setFilter((f) => ({ ...f, kinds: [] }))} className={chip(filter.kinds.length === 0)}>
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
                  onClick={() => setFilter((f) => ({ ...f, kinds: toggleKind(f.kinds, k.key) }))}
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
              <Button variant="secondary" size="sm" onClick={() => setFilter((f) => (empty.clear === 'kinds' ? { ...f, kinds: [] } : { ...f, tab: 'all' }))}>
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
                <ul className="flex flex-col gap-2 compact:gap-1">
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

          {/* Fixed at the bottom of the window, as My Tasks' bar (`sticky` can't stick inside the
              shell's overflow-x-hidden main), so the ticks can be acted on from anywhere in the list. */}
          {selectedIds.length > 0 ? (
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
              <div role="region" aria-label="Selected notifications" className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2 shadow-lift backdrop-blur">
                <span className="me-auto text-sm font-medium text-ink">{`${selectedIds.length} selected`}</span>
                {/* Beside the count on a phone (the actions wrap below); last on a wider screen. */}
                <Button variant="ghost" size="sm" className={`sm:order-last ${TOUCH_SQUARE}`} aria-label="Clear selection" onClick={clearSelection}>
                  ✕
                </Button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={() => bulkRead(true)}>
                    Mark read
                  </Button>
                  <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={() => bulkRead(false)}>
                    Mark unread
                  </Button>
                  <Button variant="secondary" size="sm" className={`text-danger ${TOUCH_TALL}`} onClick={() => removeIds(selectedIds)}>
                    Remove
                  </Button>
                </div>
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

      {/* "Removed · Undo": the live region is always there (one added with its words is read out
          unreliably); its time waits while it is pointed at or has the keyboard. Above the
          selection bar while that shows. */}
      <div className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 ${selectedIds.length > 0 ? 'bottom-28 sm:bottom-20' : 'bottom-6'}`}>
        <div
          role="status"
          aria-labelledby={removal.pending ? 'notif-toast-text' : undefined}
          onMouseEnter={() => removal.hold('pointer')}
          onMouseLeave={() => removal.release('pointer')}
          onFocus={() => removal.hold('focus')}
          onBlur={() => removal.release('focus')}
          className={removal.pending ? 'pointer-events-auto flex max-w-lg items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink shadow-lift' : ''}
        >
          {removal.pending ? (
            <>
              <span id="notif-toast-text">{removal.pending.label}</span>
              <span aria-hidden="true" className="text-ink-3">·</span>
              <button type="button" onClick={undoRemove} className={`rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand/10 ${TOUCH_SQUARE}`}>
                Undo
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
