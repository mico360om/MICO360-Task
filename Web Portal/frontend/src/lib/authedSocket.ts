import { io, type Socket } from 'socket.io-client';
import { refreshSession } from '../api/client';
import { useAuthStore } from '../stores/auth-store';
import { noteSocketTrouble } from './error-reporting';

/** Socket origin (the API origin, without the /api/v1 prefix). */
export const SOCKET_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

/** How many refresh-and-retry rounds an unauthorized handshake gets before we give up. */
const MAX_AUTH_RETRIES = 3;
/** A handshake rejected this soon after a successful refresh means the session itself was revoked. */
const REVOKED_WITHIN_MS = 30_000;
/** Server-initiated disconnects (token expiry / revocation) reconnected per minute before backing off. */
const MAX_SERVER_RECONNECTS_PER_MIN = 3;
/** 1.22.4: a live connection that can't connect for this long (while online) is told to the Error log. */
export const SOCKET_TROUBLE_AFTER_MS = 60_000;

/**
 * Companies: `companies:changed` — the server says the signed-in person's companies changed (added
 * to or taken out of one, a company archived or brought back). Every open socket hears it (the
 * bell's, chat's, a board's…), so the copies that arrive together are taken as one: the listeners
 * run once, this long after the last copy.
 */
const COMPANIES_CHANGED_SETTLE_MS = 200;
const companiesChangedListeners = new Set<() => void>();
let companiesChangedTimer: ReturnType<typeof setTimeout> | null = null;

function companiesChanged(): void {
  if (companiesChangedTimer) clearTimeout(companiesChangedTimer);
  companiesChangedTimer = setTimeout(() => {
    companiesChangedTimer = null;
    for (const listener of [...companiesChangedListeners]) listener();
  }, COMPANIES_CHANGED_SETTLE_MS);
}

/** Run `listener` when the signed-in person's companies change (see above). Returns an unsubscribe. */
export function onCompaniesChanged(listener: () => void): () => void {
  companiesChangedListeners.add(listener);
  return () => {
    companiesChangedListeners.delete(listener);
  };
}

/**
 * 1.24.5 — what a listener gets: the live connection, seen through its own handle. `on` adds a listener of
 * this handle's (taken away again by `close`); `emit('join' | 'leave', { projectId })` asks for a project's
 * room, which the connection joins once for every handle that wants it (in every tab) and leaves only when
 * none does; anything else is sent as it is.
 */
export interface LiveSocket {
  readonly connected: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- listeners take each event's own payload
  on(event: string, listener: (...args: any[]) => void): LiveSocket;
  emit(event: string, ...args: unknown[]): LiveSocket;
}

export interface AuthedSocketOptions {
  /**
   * Runs after every successful connection. `isReconnect` is true from the second connection on,
   * which is when callers should re-join rooms and refetch whatever they may have missed. A handle
   * opened while the connection is already up is told so at once (not a reconnect).
   */
  onConnect?: (socket: LiveSocket, isReconnect: boolean) => void;
  /** Runs whenever the connection drops (socket.io then reconnects by itself, or we do). */
  onDisconnect?: (reason: string) => void;
  /**
   * How to get a fresh access token after the server rejects the handshake. Defaults to the API
   * client's shared, cross-tab-safe `refreshSession` (so a socket never races the API client for
   * the single-use refresh token).
   */
  refresh?: () => Promise<boolean>;
}

export interface AuthedSocket {
  socket: LiveSocket;
  /** This listener is done: its listeners go, and the connection closes when no one is left. */
  close: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see LiveSocket
type Listener = (...args: any[]) => void;

interface Handle {
  opts: AuthedSocketOptions;
  listeners: Map<string, Set<Listener>>;
  rooms: Set<string>;
  seenConnect: boolean;
  closed: boolean;
  facade: LiveSocket;
}

/** The connection's own events: never a listener's to add (they come through onConnect / onDisconnect). */
const OWN_EVENTS = new Set(['connect', 'connect_error', 'disconnect']);
const PRESENCE_EVENTS = ['presence:state', 'presence:online', 'presence:offline'] as const;

/**
 * Tabs share one connection (1.24.5): the tab holding the Web Lock `mico360-live:<person>` (the leader)
 * keeps the socket; the others (followers) hear its events over a BroadcastChannel of the same name and
 * tell it which project rooms they need. Messages:
 *  - follower → leader: `need` (its rooms; also "is anyone there?"), `bye` (it has no listeners left);
 *  - leader → all: `state` (connected or not, which connection, who is online), `ev` (an event), `beat`
 *    (the server's ping: the leader is alive), `leader` (a new leader: say what you need).
 * A visible follower that hears nothing for LEADER_SILENT_MS while online takes the lock over (a frozen
 * leader tab); the old leader steps down when it hears of the new one.
 */
export const LEADER_SILENT_MS = 60_000;
const SILENCE_CHECK_MS = 10_000;
/** A follower shown again (or back online) asks the leader; no answer this soon: it takes over (1.24.5 review). */
export const LEADER_ANSWER_MS = 3_000;

type TabMessage =
  | { t: 'need'; tab: string; rooms: string[] }
  | { t: 'bye'; tab: string }
  | { t: 'state'; from: string; connected: boolean; conn: string | null; presence: string[] | null }
  | { t: 'ev'; from: string; ev: string; args: unknown[] }
  | { t: 'beat'; from: string }
  | { t: 'leader'; from: string };

interface LockManagerLike {
  request(name: string, options: { signal?: AbortSignal; steal?: boolean }, callback: () => Promise<void>): Promise<unknown>;
}

interface Core {
  /** Whose connection (the signed-in person's id when it opened). */
  user: string;
  /** This tab's id for the other tabs. */
  tab: string;
  handles: Set<Handle>;
  /** solo: no tab sharing in this browser (or tests); leader: this tab holds the socket; follower: another tab does. */
  mode: 'solo' | 'leader' | 'follower';
  /** The socket (solo and leader). */
  socket: Socket | null;
  /** solo / leader: the events that have a socket listener (one each, handing them to the handles). */
  attached: Set<string>;
  /** solo / leader: the rooms the server has been asked for on this connection. */
  sent: Set<string>;
  /** leader: the rooms each follower tab needs. */
  followers: Map<string, Set<string>>;
  /** Which connection this tab's handles were last told of (null while down). */
  conn: string | null;
  /** Who is online, as this connection has heard it (null until the server says, on each connection). */
  presence: Set<string> | null;
  refresh: () => Promise<boolean>;
  channel: BroadcastChannel | null;
  locks: LockManagerLike | null;
  /** Ends this tab's hold of the lock (leader), or its wait for it (follower). */
  releaseLock: (() => void) | null;
  /** The lock request this tab leads by (a taken lock rejects it: the tab steps down). */
  lockToken: object | null;
  /** follower: the tab it follows (messages from any other are ignored); null until one speaks. */
  leaderTab: string | null;
  lastHeard: number;
  /** follower: when the leader last said the connection's state. */
  lastStateAt: number;
  /** follower: when it last asked the leader (need). */
  askedAt: number;
  shut: () => void;
}

/** This tab's live connection (1.24.5), while anyone listens. */
let core: Core | null = null;
let connCounter = 0;

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const roomOf = (args: unknown[]): string | null => {
  const id = (args[0] as { projectId?: unknown } | null | undefined)?.projectId;
  return typeof id === 'string' && id ? id : null;
};

/** Every room some handle of this tab wants. */
const localRooms = (c: Core): Set<string> => {
  const out = new Set<string>();
  for (const h of c.handles) if (!h.closed) for (const r of h.rooms) out.add(r);
  return out;
};

function post(c: Core, msg: TabMessage): void {
  try {
    c.channel?.postMessage(msg);
  } catch {
    // The other tabs are told next time.
  }
}

/** solo / leader: join the rooms someone needs and leave the ones nobody does (once connected: before, the connect does it). */
function syncRooms(c: Core): void {
  if (!c.socket || c.conn === null) return;
  const wanted = localRooms(c);
  for (const set of c.followers.values()) for (const r of set) wanted.add(r);
  for (const r of wanted) {
    if (c.sent.has(r)) continue;
    c.sent.add(r);
    c.socket.emit('join', { projectId: r });
  }
  for (const r of [...c.sent]) {
    if (wanted.has(r)) continue;
    c.sent.delete(r);
    c.socket.emit('leave', { projectId: r });
  }
}

/** A room change of this tab's handles: the socket's rooms (solo / leader), or the leader is told (follower). */
function roomsChanged(c: Core): void {
  if (c.mode === 'follower') post(c, { t: 'need', tab: c.tab, rooms: [...localRooms(c)] });
  else syncRooms(c);
}

/** Run a listener; one that throws never stops the others (it is still reported, as an uncaught error is). */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    try {
      (globalThis as { reportError?: (e: unknown) => void }).reportError?.(err);
    } catch {
      // Nothing more to do.
    }
  }
}

/** Keep who is online (and hear that the person's companies changed), then hand the event to this tab's handles. */
function deliver(c: Core, event: string, args: unknown[]): void {
  if (event === 'companies:changed') companiesChanged();
  else if (event === 'presence:state') {
    const ids = (args[0] as { userIds?: unknown } | undefined)?.userIds;
    c.presence = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } else if (event === 'presence:online' || event === 'presence:offline') {
    const id = (args[0] as { userId?: unknown } | undefined)?.userId;
    if (c.presence && typeof id === 'string') {
      if (event === 'presence:online') c.presence.add(id);
      else c.presence.delete(id);
    }
  }
  for (const h of [...c.handles]) {
    if (h.closed) continue;
    for (const fn of [...(h.listeners.get(event) ?? [])]) safely(() => fn(...args));
  }
}

/** The connection is up (`conn` names it): every handle is told; a different one than before is a reconnect. */
function connectedAs(c: Core, conn: string): void {
  if (c.conn === conn) return;
  c.conn = conn;
  for (const h of [...c.handles]) {
    if (h.closed) continue;
    const isReconnect = h.seenConnect;
    h.seenConnect = true;
    safely(() => h.opts.onConnect?.(h.facade, isReconnect));
  }
}

function droppedWith(c: Core, reason: string): void {
  if (c.conn === null) return;
  c.conn = null;
  c.presence = null;
  for (const h of [...c.handles]) if (!h.closed) safely(() => h.opts.onDisconnect?.(reason));
}

/** solo / leader: one socket listener per event, handing it to this tab's handles. */
function attach(c: Core, event: string): void {
  if (!c.socket || c.attached.has(event)) return;
  c.attached.add(event);
  c.socket.on(event, (...args: unknown[]) => deliver(c, event, args));
}

/** Open the socket (solo, or as the tabs' leader) and wire it up. */
function openSocket(c: Core): void {
  const socket = io(SOCKET_URL, {
    auth: (cb: (data: object) => void) => cb({ token: useAuthStore.getState().accessToken ?? '' }),
  });
  c.socket = socket;
  c.attached = new Set();
  c.sent = new Set();
  const leading = c.mode === 'leader';
  let authRetries = 0;
  let refreshing = false;
  let lastRefreshAt = 0;
  let serverDisconnects: number[] = [];
  let failingSince: number | null = null;
  let conn: string | null = null;
  const isMine = () => core === c && c.socket === socket;
  const tellState = () => post(c, { t: 'state', from: c.tab, connected: !!conn, conn, presence: c.presence ? [...c.presence] : null });

  socket.on('connect', () => {
    if (!isMine()) return;
    authRetries = 0;
    failingSince = null;
    // A new connection: the server holds none of the rooms, and says again who is online.
    c.sent.clear();
    c.presence = null;
    conn = `${c.tab}:${++connCounter}`;
    connectedAs(c, conn);
    syncRooms(c);
    if (leading) tellState();
  });

  socket.on('connect_error', (err: Error) => {
    if (!isMine()) return;
    if (!/unauthori[sz]ed/i.test(err?.message ?? '')) {
      // Network trouble: socket.io retries itself. Still failing after a minute: blocked on the way?
      const now = Date.now();
      if (failingSince === null) failingSince = now;
      else if (now - failingSince > SOCKET_TROUBLE_AFTER_MS) noteSocketTrouble();
      return;
    }
    if (refreshing) return;
    if (lastRefreshAt && Date.now() - lastRefreshAt < REVOKED_WITHIN_MS) {
      c.shut();
      useAuthStore.getState().logout('expired');
      return;
    }
    if (authRetries >= MAX_AUTH_RETRIES) return;
    authRetries += 1;
    refreshing = true;
    void refresh()
      .then((ok) => {
        if (!ok) return;
        lastRefreshAt = Date.now();
        if (isMine() && !socket.connected) socket.connect();
      })
      .catch(() => {})
      .finally(() => {
        refreshing = false;
      });
  });
  const refresh = c.refresh;

  socket.on('disconnect', (reason: string) => {
    if (!isMine()) return;
    c.sent.clear();
    conn = null;
    droppedWith(c, reason);
    if (leading) tellState();
    if (reason !== 'io server disconnect') return;
    const now = Date.now();
    serverDisconnects = serverDisconnects.filter((t) => now - t < 60_000);
    if (serverDisconnects.length >= MAX_SERVER_RECONNECTS_PER_MIN) return;
    serverDisconnects.push(now);
    socket.connect();
  });

  if (leading && typeof socket.onAny === 'function') {
    // Every event goes to this tab's handles and to the other tabs.
    socket.onAny((event: string, ...args: unknown[]) => {
      if (!isMine()) return;
      post(c, { t: 'ev', from: c.tab, ev: event, args });
      deliver(c, event, args);
    });
    c.attached = new Set(['*']);
    // The server's ping (every 25 s): the leader is alive, whatever its timers.
    try {
      socket.io?.on?.('ping', () => {
        if (isMine()) post(c, { t: 'beat', from: c.tab });
      });
    } catch {
      // Without it, events and states still say the leader is there.
    }
  } else {
    // Who is online: kept here, so a listener that comes after the connect is told too. The person's companies.
    for (const ev of [...PRESENCE_EVENTS, 'companies:changed']) attach(c, ev);
    for (const h of c.handles) for (const ev of h.listeners.keys()) attach(c, ev);
  }
}

/** This tab became the leader: open the socket, and ask the other tabs what they need. */
function lead(c: Core): void {
  if (core !== c || c.mode === 'leader') return;
  c.mode = 'leader';
  c.followers = new Map();
  if (c.conn) droppedWith(c, 'transport close');
  openSocket(c);
  post(c, { t: 'leader', from: c.tab });
}

/** Wait for the lock (or take it from a silent leader): holding it, this tab leads until it lets go. */
function seekLock(c: Core, steal = false): void {
  const locks = c.locks;
  if (!locks) return;
  c.releaseLock?.();
  const stop = steal ? null : new AbortController();
  let let_go: (() => void) | null = null;
  const held = new Promise<void>((resolve) => {
    let_go = resolve;
  });
  c.releaseLock = () => {
    stop?.abort();
    let_go?.();
  };
  const name = `mico360-live:${c.user}`;
  const token = {};
  try {
    void locks
      .request(name, steal ? { steal: true } : { signal: stop!.signal }, async () => {
        if (core !== c) return;
        c.lockToken = token;
        lead(c);
        await held;
      })
      .catch(() => {
        // Taken over by another tab while this one led by it: step down (a wait that was stopped is nothing).
        if (core === c && c.mode === 'leader' && c.lockToken === token) stepDown(c);
      });
  } catch {
    // No lock after all: this tab keeps its own connection.
    c.mode = 'solo';
    openSocket(c);
  }
}

/** Another tab leads now: close this tab's socket and follow it. */
function stepDown(c: Core): void {
  if (c.mode !== 'leader') return;
  const s = c.socket;
  c.socket = null;
  c.mode = 'follower';
  c.sent = new Set();
  c.followers = new Map();
  try {
    s?.disconnect();
  } catch {
    // It is no longer this tab's.
  }
  c.lockToken = null;
  c.leaderTab = null;
  droppedWith(c, 'transport close');
  c.lastHeard = Date.now();
  post(c, { t: 'need', tab: c.tab, rooms: [...localRooms(c)] });
  seekLock(c);
}

/** follower: ask the leader for the connection's state; no answer within LEADER_ANSWER_MS: take over. */
function askLeader(c: Core): void {
  if (core !== c || c.mode !== 'follower') return;
  const at = Date.now();
  c.askedAt = at;
  post(c, { t: 'need', tab: c.tab, rooms: [...localRooms(c)] });
  setTimeout(() => {
    if (core !== c || c.mode !== 'follower' || c.lastStateAt >= at) return;
    c.lastHeard = Date.now();
    seekLock(c, true);
  }, LEADER_ANSWER_MS);
}

function onTabMessage(c: Core, msg: TabMessage): void {
  if (core !== c || !msg || typeof msg !== 'object') return;
  if (c.mode === 'leader') {
    if (msg.t === 'need') {
      c.followers.set(msg.tab, new Set(Array.isArray(msg.rooms) ? msg.rooms.filter((r) => typeof r === 'string') : []));
      syncRooms(c);
      const conn = c.socket?.connected ? c.conn : null;
      post(c, { t: 'state', from: c.tab, connected: !!conn, conn, presence: c.presence ? [...c.presence] : null });
    } else if (msg.t === 'bye') {
      c.followers.delete(msg.tab);
      syncRooms(c);
    } else if (msg.t === 'leader' && msg.from !== c.tab) {
      stepDown(c);
      c.leaderTab = msg.from;
    }
    return;
  }
  if (c.mode !== 'follower') return;
  if (msg.t === 'need' || msg.t === 'bye') return;
  // One leader at a time: a new one says so ('leader'); anything from another tab is a stale second copy.
  if (msg.t === 'leader') c.leaderTab = msg.from;
  else if (c.leaderTab === null) c.leaderTab = msg.from;
  else if (msg.from !== c.leaderTab) return;
  c.lastHeard = Date.now();
  if (msg.t === 'leader') {
    post(c, { t: 'need', tab: c.tab, rooms: [...localRooms(c)] });
  } else if (msg.t === 'state') {
    c.lastStateAt = Date.now();
    if (msg.connected && msg.conn) {
      const fresh = c.conn !== msg.conn;
      if (fresh && Array.isArray(msg.presence)) c.presence = new Set(msg.presence);
      connectedAs(c, msg.conn);
      // Who is online, for this tab's listeners (a new connection says it again by itself).
      if (fresh && c.presence) deliver(c, 'presence:state', [{ userIds: [...c.presence] }]);
    } else droppedWith(c, 'transport close');
  } else {
    // The leader is there but this tab thinks the connection is down (it missed a state): ask again.
    if (c.conn === null && Date.now() - c.askedAt > LEADER_ANSWER_MS) {
      c.askedAt = Date.now();
      post(c, { t: 'need', tab: c.tab, rooms: [...localRooms(c)] });
    }
    if (msg.t === 'ev' && typeof msg.ev === 'string') deliver(c, msg.ev, Array.isArray(msg.args) ? msg.args : []);
  }
}

function browserLocks(): LockManagerLike | null {
  try {
    const locks = (globalThis.navigator as Navigator & { locks?: LockManagerLike } | undefined)?.locks;
    return locks && typeof locks.request === 'function' && typeof BroadcastChannel === 'function' ? locks : null;
  } catch {
    return null;
  }
}

function openCore(user: string, refresh: () => Promise<boolean>): Core {
  const locks = browserLocks();
  let channel: BroadcastChannel | null = null;
  if (locks) {
    try {
      channel = new BroadcastChannel(`mico360-live:${user}`);
    } catch {
      channel = null;
    }
  }
  let silenceTimer: ReturnType<typeof setInterval> | null = null;
  const stateNow = (): TabMessage => {
    const conn = c.socket?.connected ? c.conn : null;
    return { t: 'state', from: c.tab, connected: !!conn, conn, presence: c.presence ? [...c.presence] : null };
  };
  const onHide = () => {
    // Going away (or into the back/forward cache): a leader says the connection is down for the others now
    // (the lock goes with the page), a follower gives up its rooms.
    if (c.mode === 'leader') post(c, { t: 'state', from: c.tab, connected: false, conn: null, presence: null });
    else if (c.mode === 'follower') post(c, { t: 'bye', tab: c.tab });
  };
  const onShow = (e: Event) => {
    if (!(e as PageTransitionEvent).persisted) return;
    // Back from the back/forward cache: a leader says how the connection is; a follower asks for its rooms again.
    if (c.mode === 'leader') post(c, stateNow());
    else if (c.mode === 'follower') askLeader(c);
  };
  const onShown = () => {
    // Shown again, or back online: is the leader there? (A frozen or suspended one doesn't answer.)
    if (document.visibilityState !== 'hidden' && navigator.onLine !== false) askLeader(c);
  };
  const listen = (on: boolean) => {
    try {
      const fn = on ? 'addEventListener' : 'removeEventListener';
      window[fn]('pagehide', onHide);
      window[fn]('pageshow', onShow);
      window[fn]('online', onShown);
      document[fn]('visibilitychange', onShown);
    } catch {
      // No window.
    }
  };
  let unsubscribe: (() => void) | null = null;
  const c: Core = {
    user,
    tab: randomId(),
    handles: new Set(),
    mode: locks && channel ? 'follower' : 'solo',
    socket: null,
    attached: new Set(),
    sent: new Set(),
    followers: new Map(),
    conn: null,
    presence: null,
    refresh,
    channel,
    locks: locks && channel ? locks : null,
    releaseLock: null,
    lockToken: null,
    leaderTab: null,
    lastHeard: Date.now(),
    lastStateAt: 0,
    askedAt: 0,
    shut: () => {
      if (core === c) core = null;
      if (c.mode === 'leader') post(c, { t: 'state', from: c.tab, connected: false, conn: null, presence: null });
      else if (c.mode === 'follower') post(c, { t: 'bye', tab: c.tab });
      const s = c.socket;
      c.socket = null;
      try {
        s?.disconnect();
      } catch {
        // Closed already.
      }
      c.releaseLock?.();
      c.releaseLock = null;
      if (silenceTimer) clearInterval(silenceTimer);
      unsubscribe?.();
      if (c.channel) listen(false);
      try {
        channel?.close();
      } catch {
        // Closed already.
      }
    },
  };
  // 1.24.5 review (hardening): the connection is this person's; another person signed in here closes it.
  try {
    unsubscribe = useAuthStore.subscribe((state) => {
      const id = state.user?.id;
      if (id && id !== user) c.shut();
    });
  } catch {
    unsubscribe = null;
  }
  if (c.mode === 'solo') {
    openSocket(c);
    return c;
  }
  channel!.onmessage = (e: MessageEvent) => onTabMessage(c, e.data as TabMessage);
  listen(true);
  // Is a leader there? It answers with the connection's state.
  c.askedAt = Date.now();
  post(c, { t: 'need', tab: c.tab, rooms: [] });
  seekLock(c);
  // A visible follower that hears nothing from the leader for long (a frozen tab) takes over.
  silenceTimer = setInterval(() => {
    try {
      if (core !== c || c.mode !== 'follower') return;
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (Date.now() - c.lastHeard < LEADER_SILENT_MS) return;
      c.lastHeard = Date.now();
      seekLock(c, true);
    } catch {
      // Checked again next time.
    }
  }, SILENCE_CHECK_MS);
  return c;
}

/**
 * Open a listener on the live connection (socket.io), which always authenticates with the *current*
 * access token.
 *
 * - 1.24.5: ONE connection for the whole browser, not one per listener per tab. On long-polling (a host
 *   whose proxy doesn't pass WebSockets) each connection holds one of the browser's ~6 connections to the
 *   site, and with one per listener (the chat badge, the bell's reminders, the board…) in every open tab,
 *   the page's other requests waited tens of seconds for a free one. Each listener has its own handle,
 *   listeners and rooms; the tab's connection opens with the first and closes with the last; and where the
 *   browser has Web Locks and BroadcastChannel, one tab (the leader) holds the socket for all tabs.
 * - `auth` is a callback, so every (re)connect handshake reads the token from the auth store
 *   instead of the one captured when the component mounted.
 * - When the server rejects the handshake as unauthorized (e.g. the 15-minute access token expired
 *   while the laptop slept), socket.io stops retrying on its own; we refresh the session and
 *   reconnect. If even a freshly refreshed token is refused, the session was revoked and the user
 *   is signed out.
 * - The server also closes live sockets whose token expired or whose session was revoked, and
 *   socket.io never reconnects after a server-side close; we reconnect (rate limited), and the
 *   handshake above sorts out whether the session is still valid.
 * - Transport errors are left to socket.io's own reconnection.
 */
export function openAuthedSocket(opts: AuthedSocketOptions = {}): AuthedSocket {
  const user = useAuthStore.getState().user?.id ?? '';
  // Another person's connection (signed out and in as someone else): theirs closes.
  if (core && core.user !== user) core.shut();
  const c = core ?? (core = openCore(user, opts.refresh ?? refreshSession));
  const handle: Handle = { opts, listeners: new Map(), rooms: new Set(), seenConnect: false, closed: false, facade: null as unknown as LiveSocket };
  const facade: LiveSocket = {
    get connected() {
      if (handle.closed) return false;
      return c.mode === 'follower' ? c.conn !== null : Boolean(c.socket?.connected);
    },
    on(event, listener) {
      if (handle.closed || OWN_EVENTS.has(event)) return facade;
      let set = handle.listeners.get(event);
      if (!set) handle.listeners.set(event, (set = new Set()));
      set.add(listener);
      if (c.mode === 'solo' || (c.mode === 'leader' && !c.attached.has('*'))) attach(c, event);
      // Who is online was said at connect: a listener that comes later is told what this connection knows.
      if (event === 'presence:state' && c.presence) {
        const snapshot = { userIds: [...c.presence] };
        queueMicrotask(() => {
          if (!handle.closed && handle.listeners.get(event)?.has(listener)) listener(snapshot);
        });
      }
      return facade;
    },
    emit(event, ...args) {
      if (handle.closed) return facade;
      const room = event === 'join' || event === 'leave' ? roomOf(args) : null;
      if (room) {
        const had = handle.rooms.has(room);
        if (event === 'join') handle.rooms.add(room);
        else handle.rooms.delete(room);
        // A join of a room the server doesn't hold on this connection goes again (a re-join after a reconnect).
        if (had !== (event === 'join') || (event === 'join' && c.mode !== 'follower' && !c.sent.has(room))) roomsChanged(c);
      } else if (c.socket) c.socket.emit(event, ...args);
      return facade;
    },
  };
  handle.facade = facade;
  c.handles.add(handle);
  // Opened while the connection is already up: told so, once the caller has added its listeners.
  if (c.conn !== null && (c.mode === 'follower' || c.socket?.connected)) {
    const conn = c.conn;
    queueMicrotask(() => {
      if (handle.closed || handle.seenConnect || c.conn !== conn) return;
      handle.seenConnect = true;
      opts.onConnect?.(facade, false);
    });
  }

  return {
    socket: facade,
    close: () => {
      if (handle.closed) return;
      handle.closed = true;
      c.handles.delete(handle);
      const had = handle.rooms.size > 0;
      handle.rooms.clear();
      handle.listeners.clear();
      if (c.handles.size === 0) {
        c.shut();
        return;
      }
      if (had) roomsChanged(c);
    },
  };
}

/** Tests: forget this tab's connection (each test's socket.io stand-in is its own). */
export function resetLiveConnectionForTests(): void {
  const c = core;
  core = null;
  try {
    c?.shut();
  } catch {
    // Gone already.
  }
}
// The test setup forgets it after every test (test/setup.ts).
if (import.meta.env.MODE === 'test') (globalThis as { __resetLiveConnection?: () => void }).__resetLiveConnection = resetLiveConnectionForTests;

/**
 * 1.24.5: the live connection is in every room some listener joined (the chat badge joins all of the person's
 * projects), so a listener of some projects' changes checks whose change it is: true for an event that names
 * a project (`projectId`) not among `mine`. An event that names none is everyone's.
 */
export function isOtherProjects(payload: unknown, mine: readonly string[]): boolean {
  const id = payload && typeof payload === 'object' ? (payload as { projectId?: unknown }).projectId : undefined;
  return typeof id === 'string' && !mine.includes(id);
}
