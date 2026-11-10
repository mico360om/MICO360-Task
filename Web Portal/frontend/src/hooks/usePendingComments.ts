import { useCallback, useEffect, useRef, useState } from 'react';
import { matchedPending, type PendingComment } from '../lib/comment-feed';

/** How long a saved comment waits for its copy in the list before it is let go (deleted meanwhile). */
const SENT_KEPT_MS = 15_000;
let seq = 0;

/** Sends a comment's words; resolves with the saved comment's id when the server says it (else anything). */
export type SendComment = (body: string) => Promise<unknown>;

/**
 * Comments, newest first: my comments on their way. `send` shows the comment at once (the caller puts it at the top)
 * and sends it; a failure keeps it, with its words and why ("Not sent — Try again"). Each one goes once its saved copy
 * is in the list — by its saved id, or (when the live copy came first) by a comment of mine with its words that wasn't
 * there when it was sent — so it never shows twice.
 */
export function usePendingComments(list: { id: string; mine: boolean; body: string }[], fallback: string) {
  const [pending, setPending] = useState<PendingComment[]>([]);
  const listRef = useRef(list);
  listRef.current = list;

  const matched = matchedPending(pending, list);
  const matchedKey = [...matched].join('\n');
  useEffect(() => {
    if (!matchedKey) return;
    const gone = new Set(matchedKey.split('\n'));
    setPending((ps) => ps.filter((p) => !gone.has(p.key)));
  }, [matchedKey]);

  const sentKey = pending
    .filter((p) => p.status === 'sent')
    .map((p) => p.key)
    .join('\n');
  useEffect(() => {
    if (!sentKey) return;
    const sent = new Set(sentKey.split('\n'));
    const t = setTimeout(() => setPending((ps) => ps.filter((p) => !sent.has(p.key))), SENT_KEPT_MS);
    return () => clearTimeout(t);
  }, [sentKey]);

  const go = useCallback(
    async (key: string, body: string, sendIt: SendComment) => {
      try {
        const saved = await sendIt(body);
        const savedId = typeof saved === 'string' ? saved : undefined;
        setPending((ps) => ps.map((p) => (p.key === key ? { ...p, status: 'sent', savedId } : p)));
      } catch (err) {
        const error = err instanceof Error && err.message ? err.message : fallback;
        setPending((ps) => ps.map((p) => (p.key === key ? { ...p, status: 'failed', error } : p)));
      }
    },
    [fallback],
  );

  /** Show it now and send it. */
  const send = useCallback(
    (body: string, sendIt: SendComment) => {
      seq += 1;
      const key = `pending-${seq}`;
      setPending((ps) => [{ key, body, status: 'sending', before: new Set(listRef.current.map((c) => c.id)) }, ...ps]);
      void go(key, body, sendIt);
    },
    [go],
  );

  /** Send one that didn't go again. */
  const retry = useCallback(
    (key: string, sendIt: SendComment) => {
      const words = pending.find((p) => p.key === key)?.body;
      if (words == null) return;
      const before = new Set(listRef.current.map((c) => c.id));
      setPending((ps) => ps.map((p) => (p.key === key ? { ...p, status: 'sending', error: undefined, before } : p)));
      void go(key, words, sendIt);
    },
    [go, pending],
  );

  /** Let one that didn't go go (its words were taken back into the box). */
  const drop = useCallback((key: string) => setPending((ps) => ps.filter((p) => p.key !== key)), []);

  return { pending: pending.filter((p) => !matched.has(p.key)), send, retry, drop };
}
