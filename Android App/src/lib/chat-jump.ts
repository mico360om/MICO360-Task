/**
 * Showing a message that may not be loaded yet (3b): a reply's quote, a search result. Older pages
 * are loaded to find it — one at a time, never while the thread is being read already (that would
 * cancel it), and not again once an older page couldn't be loaded (offline: say so, don't retry in
 * a loop and then claim the message is gone). Pure, so it is tested here.
 */
export type JumpStep = 'show' | 'wait' | 'load' | 'failed' | 'gone';

export function jumpStep(s: { found: boolean; fetching: boolean; nextPageError: boolean; hasNextPage: boolean; pagesTried: number; maxPages: number }): JumpStep {
  if (s.found) return 'show';
  if (s.fetching) return 'wait';
  if (s.nextPageError) return 'failed';
  if (s.hasNextPage && s.pagesTried < s.maxPages) return 'load';
  return 'gone';
}

/**
 * Tasks run one after another, in the order given (files sent into a conversation); one cancelled
 * while it waits its turn is skipped — a file discarded before its turn is never sent.
 */
export function createSerialRunner() {
  let chain: Promise<void> = Promise.resolve();
  const queued = new Map<string, number>();
  const cancelled = new Set<string>();
  return {
    run(key: string, task: () => Promise<void>): Promise<void> {
      cancelled.delete(key);
      queued.set(key, (queued.get(key) ?? 0) + 1);
      const step = async () => {
        const left = (queued.get(key) ?? 1) - 1;
        if (left > 0) queued.set(key, left);
        else queued.delete(key);
        if (cancelled.has(key)) return;
        await task();
      };
      chain = chain.then(step, step);
      return chain;
    },
    /** Don't run this key's waiting task (one already running finishes). */
    cancel(key: string): void {
      cancelled.add(key);
    },
    /** Is a task of this key waiting its turn? */
    waiting: (key: string): boolean => (queued.get(key) ?? 0) > 0,
  };
}
