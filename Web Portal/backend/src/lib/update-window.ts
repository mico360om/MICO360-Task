/**
 * 1.23.14 — is the server in an update restart? The live Error log recorded "The database couldn't be
 * reached (P1001)" as a red Server error at deploy restarts (several deploys that evening), although each
 * request was answered 503 and tried again as 1.23.1 designed. While the server is stopping (SIGTERM — a
 * deploy) or in its first minute after starting, a database blip is the update's: the Error log keeps it
 * as a calm "Update restart" row (error-log-service), never as an error, and it brings back no row marked
 * fixed. Outside that window a blip is a real error, as before.
 */
export const UPDATE_SETTLE_MS = 60_000;

export interface UpdateWindow {
  /** The server was told to stop: from now on, for good. */
  markStopping(): void;
  /** Stopping, or started less than a minute ago. */
  isOpen(): boolean;
}

export function createUpdateWindow(opts: { now?: () => number; startedAt?: number; settleMs?: number } = {}): UpdateWindow {
  const now = opts.now ?? (() => Date.now());
  const startedAt = opts.startedAt ?? now();
  const settleMs = opts.settleMs ?? UPDATE_SETTLE_MS;
  let stopping = false;
  return {
    markStopping() {
      stopping = true;
    },
    isOpen() {
      return stopping || now() - startedAt < settleMs;
    },
  };
}
