import type { RefreshOutcome } from './api-client';

export interface SocketAuthDeps {
  /** Run (or join) the app's single-flight session refresh. */
  refresh: () => Promise<RefreshOutcome>;
  /** Ask the socket to connect again (its `auth` callback reads the current token). */
  reconnect: () => void;
  /** The refresh token was rejected — the session is over. */
  onSessionEnded?: () => void;
  /** Consecutive "refreshed but still rejected" rounds before giving up (default 3). */
  maxAuthRetries?: number;
  /** Delay before retrying after a transient refresh failure (default 5 s, doubling to 60 s). */
  baseDelayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

/**
 * Keeps a socket.io connection authenticated across token expiry (XP-05).
 *
 * The server rejects a handshake with an expired/revoked access token (`unauthorized`), and it
 * also CLOSES a live socket when the access token expires or the session is revoked
 * (`io server disconnect`). socket.io retries neither by itself. This handler refreshes the
 * session and reconnects; the socket's `auth` option must be a callback that reads the current
 * token so each attempt sends the fresh one. When the refresh token itself is rejected the session
 * is over (`onSessionEnded`). `onConnect()` reports whether this was a RE-connect so the caller can
 * refetch whatever it may have missed while disconnected.
 */
export function createSocketAuthHandler(deps: SocketAuthDeps) {
  const maxAuthRetries = deps.maxAuthRetries ?? 3;
  const baseDelay = deps.baseDelayMs ?? 5_000;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let authRetries = 0;
  let transientRetries = 0;
  let connectedBefore = false;
  let stopped = false;
  let busy = false;

  async function recover(): Promise<void> {
    if (stopped || busy) return;
    if (authRetries >= maxAuthRetries) return;
    busy = true;
    try {
      const outcome = await deps.refresh();
      if (stopped) return;
      if (outcome === 'ok') {
        authRetries += 1;
        transientRetries = 0;
        deps.reconnect();
      } else if (outcome === 'transient') {
        const delay = Math.min(60_000, baseDelay * 2 ** transientRetries);
        transientRetries += 1;
        schedule(() => {
          if (!stopped) deps.reconnect();
        }, delay);
      } else {
        stopped = true;
        deps.onSessionEnded?.();
      }
    } finally {
      busy = false;
    }
  }

  /** `connect_error` handler. While `active`, socket.io keeps retrying by itself — nothing to do. */
  async function onConnectError(_err: { message?: string } | undefined, socketActive: boolean): Promise<void> {
    if (socketActive) return;
    await recover();
  }

  /**
   * `disconnect` handler. Only a server-initiated close (token expired / session revoked) needs
   * us; transport drops are retried by socket.io, and our own `disconnect()` is intentional.
   */
  async function onDisconnect(reason: string): Promise<void> {
    if (reason !== 'io server disconnect') return;
    await recover();
  }

  /** Call on every `connect`. True when this is a reconnect (refetch missed data). */
  function onConnect(): boolean {
    authRetries = 0;
    transientRetries = 0;
    const isReconnect = connectedBefore;
    connectedBefore = true;
    return isReconnect;
  }

  return {
    onConnectError,
    onDisconnect,
    onConnect,
    /** Stop reacting (component unmounted / signed out). */
    stop: () => {
      stopped = true;
    },
  };
}

/** socket.io `auth` option that sends the CURRENT access token on every (re)connect attempt. */
export function currentTokenAuth(getToken: () => string | null): (cb: (data: object) => void) => void {
  return (cb) => cb({ token: getToken() });
}
