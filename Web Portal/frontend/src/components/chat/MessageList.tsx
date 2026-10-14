import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ShownMessage, TimelineItem } from '../../lib/chat-model';
import { ArrowDownIcon } from './icons';

/** Within this distance of the bottom the thread follows new messages automatically. */
const NEAR_BOTTOM_PX = 120;
/** Scrolling this close to the top loads the next page of older messages. */
const LOAD_OLDER_PX = 48;
/** Further than this from the bottom, offer a way back to the newest message. */
const FAR_FROM_BOTTOM_PX = 600;
/** Pages of history a jump to an old message may load before giving up. */
const MAX_JUMP_PAGES = 40;

type MessageEntry = Extract<TimelineItem, { type: 'message' }>;

export interface MessageListProps {
  conversationId: string;
  messages: ShownMessage[];
  timeline: TimelineItem[];
  myId: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: boolean;
  onLoadOlder: () => void;
  /** A message to bring into view (from search, or a reply's quote). */
  jumpTo: string | null;
  onJumped: (found: boolean) => void;
  renderMessage: (entry: MessageEntry) => ReactNode;
  empty: ReactNode;
}

/** The timeline cut into days, so each day's date can stay pinned at the top while its messages scroll. */
function byDay(timeline: TimelineItem[]) {
  const days: Array<{ key: string; label: string; items: TimelineItem[] }> = [];
  for (const item of timeline) {
    if (item.type === 'day') days.push({ key: item.key, label: item.label, items: [] });
    else days[days.length - 1]?.items.push(item);
  }
  return days;
}

const selectorFor = (id: string) => `[data-message-id="${id.replace(/["\\]/g, '\\$&')}"]`;

/**
 * The conversation's messages, scrolling on their own. It follows new messages while you are at the
 * bottom; when you have scrolled up to read, it stays put and counts what arrived instead. Older
 * messages load as you reach the top, without moving what you are reading.
 */
export function MessageList({
  conversationId, messages, timeline, myId, loading, error, onRetry, hasOlder, loadingOlder, olderError, onLoadOlder, jumpTo, onJumped, renderMessage, empty,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [farFromBottom, setFarFromBottom] = useState(false);
  const prevConvRef = useRef<string | undefined>(undefined);
  const prevLastIdRef = useRef<string | undefined>(undefined);
  const restoreRef = useRef<{ height: number; top: number; firstId: string | undefined } | null>(null);
  const days = useMemo(() => byDay(timeline), [timeline]);
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const firstId = messages[0]?.id;

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setUnseen(0);
    setFarFromBottom(false);
  };

  // Keep the reader's place when a page of older messages is inserted above.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const restore = restoreRef.current;
    if (!el || !restore || firstId === restore.firstId) return;
    el.scrollTop = el.scrollHeight - restore.height + restore.top;
    restoreRef.current = null;
  }, [firstId]);

  // Keyed on the newest message's id (not the count, which stops changing once pages are full).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const convChanged = prevConvRef.current !== conversationId;
    const prevLast = prevLastIdRef.current;
    prevConvRef.current = conversationId;
    prevLastIdRef.current = lastId;
    if (!el || !lastId) return;
    if (convChanged || prevLast === undefined) {
      // First view: start at the first unread message if there is one, else at the newest.
      scrollToBottom();
      const unread = el.querySelector<HTMLElement>('[data-unread-line]');
      if (unread && !jumpTo) {
        unread.scrollIntoView?.({ block: 'start' });
        nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      }
      return;
    }
    if (prevLast === lastId) return;
    if (nearBottomRef.current || last?.userId === myId) {
      scrollToBottom();
      return;
    }
    const idx = messages.findIndex((m) => m.id === prevLast);
    const added = (idx >= 0 ? messages.slice(idx + 1) : [last!]).filter((m) => m.userId !== myId).length;
    if (added > 0) setUnseen((n) => n + added);
    // Only the newest message changing (and nothing else) runs this.
  }, [lastId, conversationId]);

  function loadOlder() {
    if (!hasOlder || loadingOlder) return;
    const el = scrollRef.current;
    restoreRef.current = { height: el?.scrollHeight ?? 0, top: el?.scrollTop ?? 0, firstId };
    onLoadOlder();
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = fromBottom <= NEAR_BOTTOM_PX;
    if (nearBottomRef.current && unseen > 0) setUnseen(0);
    setFarFromBottom(fromBottom > FAR_FROM_BOTTOM_PX);
    if (el.scrollTop <= LOAD_OLDER_PX && el.scrollHeight > el.clientHeight) loadOlder();
  }

  // Bring a message into view: it may be in history not loaded yet, so load older pages until it is.
  const jumpPages = useRef(0);
  useEffect(() => {
    jumpPages.current = 0;
  }, [jumpTo]);
  useEffect(() => {
    if (!jumpTo || loading) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(selectorFor(jumpTo));
    if (el) {
      el.scrollIntoView?.({ block: 'center' });
      nearBottomRef.current = false;
      onJumped(true);
      return;
    }
    if (loadingOlder) return;
    if (hasOlder && jumpPages.current < MAX_JUMP_PAGES) {
      jumpPages.current += 1;
      onLoadOlder();
      return;
    }
    onJumped(false);
    // Re-checked as pages arrive.
  }, [jumpTo, messages, loading, loadingOlder, hasOlder]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Messages"
        aria-busy={loading || loadingOlder || undefined}
        tabIndex={0}
        className="flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30 sm:px-4"
      >
        {loading ? (
          <div className="flex flex-col gap-4 py-4" aria-label="Loading messages">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`flex gap-2.5 ${i % 2 ? 'flex-row-reverse' : ''}`}>
                {i % 2 ? null : <span className="skeleton h-8 w-8 flex-none rounded-full" />}
                <span className={`skeleton h-10 rounded-2xl ${i % 2 ? 'w-40' : 'w-56'}`} />
              </div>
            ))}
          </div>
        ) : error && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p role="alert" className="text-sm font-semibold text-danger">Couldn’t load messages.</p>
            <button type="button" onClick={onRetry} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand hover:border-brand">Retry</button>
          </div>
        ) : messages.length === 0 ? (
          empty
        ) : (
          <>
            {hasOlder ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
                >
                  {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
                </button>
              </div>
            ) : (
              <p className="py-3 text-center text-[11px] text-ink-2">This is the beginning of the conversation.</p>
            )}
            {olderError ? <p role="alert" className="mb-2 text-center text-xs text-danger">Couldn’t load older messages.</p> : null}
            {days.map((day) => (
              <div key={day.key}>
                <div role="separator" aria-label={day.label} className="sticky top-1 z-[5] my-2 flex justify-center">
                  <span className="rounded-full border border-line bg-surface/95 px-3 py-0.5 text-[11px] font-semibold text-ink-2 shadow-soft backdrop-blur">{day.label}</span>
                </div>
                {day.items.map((item) =>
                  item.type === 'unread' ? (
                    <div key={item.key} data-unread-line role="separator" aria-label="Unread messages" className="my-3 flex items-center gap-2 px-1">
                      <span className="h-px flex-1 bg-brand/50" />
                      <span className="text-[11px] font-bold uppercase tracking-wide text-brand">Unread</span>
                      <span className="h-px flex-1 bg-brand/50" />
                    </div>
                  ) : item.type === 'message' ? (
                    <div key={item.key}>{renderMessage(item)}</div>
                  ) : null,
                )}
              </div>
            ))}
          </>
        )}
      </div>
      {unseen > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-white shadow-lift"
        >
          <ArrowDownIcon size={14} /> {unseen} new message{unseen === 1 ? '' : 's'}
        </button>
      ) : farFromBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to latest"
          title="Jump to latest"
          className="absolute bottom-3 end-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-lift hover:text-brand"
        >
          <ArrowDownIcon size={16} />
        </button>
      ) : null}
    </div>
  );
}
