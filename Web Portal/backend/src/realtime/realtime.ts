import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken } from '../lib/tokens';
import { createPresenceTracker } from './presence-tracker';
import type { CorsOriginMatcher } from '../lib/cors-origins';
import { isClientRoles } from '../modules/clients/client-kind';

export interface RealtimeOptions {
  accessSecret: string;
  corsOrigin?: string | string[] | boolean | CorsOriginMatcher;
  /**
   * Object-level room authorization: may this user join a project's room? When omitted every
   * authenticated socket may join any project (the pre-authz behaviour, kept for tests).
   */
  canJoinProject?: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** Fired when a user connects or disconnects — persist their last-active time for presence. */
  onPresence?: (userId: string) => void;
  /**
   * Live session check at handshake, like the HTTP auth guard: resolve the user's CURRENT roles,
   * or null to refuse the socket (stale token version, suspended or deleted user). When omitted
   * the token's own roles are trusted until it expires.
   */
  checkSession?: (userId: string, tokenVersion: number) => Promise<{ roles: string[] } | null>;
  /**
   * companies: the person's active companies and whether they are an administrator. Each socket joins
   * `company:<id>` for those companies (and `admins` for an administrator); someone coming online or
   * going offline is announced to those rooms only, and the online list a newcomer gets holds only the
   * people who share a company with them (everyone for an administrator). When omitted presence goes
   * to everyone, as before companies.
   */
  companiesOf?: (userId: string, roles: string[]) => Promise<{ companyIds: string[]; admin: boolean }>;
}

/** setTimeout can't wait longer than this (~24.8 days); longer-lived tokens are re-checked then. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const userRoom = (userId: string) => `user:${userId}`;
const projectRoom = (projectId: string) => `project:${projectId}`;
const PROJECT_ROOM = 'project:';
/** companies: everyone in one company, and every administrator. */
const companyRoom = (companyId: string) => `company:${companyId}`;
const ADMINS_ROOM = 'admins';

/** companies: whose presence a person may see — their companies; an administrator everyone. */
interface PresenceScope {
  companyIds: Set<string>;
  admin: boolean;
}
/** The rooms a person's sockets sit in (their companies, and `admins` for an administrator). */
const scopeRooms = (s: PresenceScope) => [...[...s.companyIds].map(companyRoom), ...(s.admin ? [ADMINS_ROOM] : [])];
/** Who is told that this person came online or went offline: their companies' people and every administrator. */
const presenceAudience = (s: PresenceScope) => [...[...s.companyIds].map(companyRoom), ADMINS_ROOM];

/**
 * Sets up Socket.IO on the given HTTP server (M4). Clients authenticate with a JWT
 * in the handshake, join per-project rooms, and receive broadcast task events.
 * A socket lives no longer than its access token: when the token expires the connection is
 * closed, and the client reconnects with a fresh one (which re-runs every check).
 */
export function createRealtime(httpServer: HttpServer, opts: RealtimeOptions) {
  const io = new Server(httpServer, { cors: { origin: opts.corsOrigin ?? true } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    let claims;
    try {
      claims = verifyToken(token, opts.accessSecret);
    } catch {
      return next(new Error('unauthorized'));
    }
    if (!claims.sub || claims.type !== 'access') return next(new Error('unauthorized'));
    const userId = claims.sub;
    socket.data.userId = userId;
    socket.data.roles = Array.isArray(claims.roles) ? claims.roles : [];
    socket.data.expiresAt = typeof claims.exp === 'number' ? claims.exp * 1000 : null;
    // 1.23: client accounts have no live connection (the Client portal doesn't use one).
    if (isClientRoles(socket.data.roles as string[])) return next(new Error('unauthorized'));
    if (!opts.checkSession) return next();
    const ver = typeof claims.ver === 'number' ? claims.ver : 0;
    opts.checkSession(userId, ver).then(
      (session) => {
        if (!session || isClientRoles(session.roles)) return next(new Error('unauthorized'));
        socket.data.roles = session.roles;
        next();
      },
      () => next(new Error('unauthorized')),
    );
  });

  // Online presence — reference-counted across a user's tabs/devices.
  const presence = createPresenceTracker();
  // companies: each online person's companies, read when they connect and on refreshAccess.
  const scopes = new Map<string, PresenceScope>();
  const shareCompany = (a: PresenceScope, b: PresenceScope) => [...b.companyIds].some((id) => a.companyIds.has(id));
  /** The online people this person may see: those sharing a company with them (admins: everyone). */
  function onlineFor(userId: string): string[] {
    const online = presence.online();
    const me = scopes.get(userId);
    if (!opts.companiesOf || !me || me.admin) return online;
    return online.filter((id) => {
      const other = scopes.get(id);
      return id === userId || (!!other && shareCompany(me, other));
    });
  }
  async function scopeOf(userId: string, roles: string[]): Promise<PresenceScope> {
    try {
      const s = await opts.companiesOf!(userId, roles);
      return { companyIds: new Set(s.companyIds), admin: s.admin };
    } catch {
      return { companyIds: new Set(), admin: false }; // fail closed: seen by administrators only
    }
  }
  /** May this person still be in a project's room (the join rule, re-asked)? */
  async function mayStayIn(userId: string, roles: string[], projectId: string): Promise<boolean> {
    if (!opts.canJoinProject) return true;
    try {
      return await opts.canJoinProject(userId, roles, projectId);
    } catch {
      return false;
    }
  }

  io.on('connection', (socket) => {
    // Every socket joins a room for its own user id, so DM/chat events can reach the user
    // across their devices without a per-conversation subscription.
    const userId = socket.data.userId as string | undefined;
    if (userId) void socket.join(userRoom(userId));

    // Close the connection when the access token behind it expires. Closing the transport (rather
    // than a server "disconnect") lets clients reconnect on their own with a refreshed token.
    let expiryTimer: NodeJS.Timeout | undefined;
    const expiresAt = socket.data.expiresAt as number | null;
    if (expiresAt) {
      expiryTimer = setTimeout(() => {
        socket.emit('auth:expired');
        socket.conn.close();
      }, Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - Date.now())));
      expiryTimer.unref?.();
    }

    // Presence: tell the newcomer who's online, and announce them if newly online — companies: to
    // their companies' people and administrators only, once the socket sits in its company rooms.
    let counted = false;
    async function announce(id: string): Promise<void> {
      let scope: PresenceScope | null = null;
      if (opts.companiesOf) {
        scope = await scopeOf(id, (socket.data.roles as string[] | undefined) ?? []);
        if (socket.disconnected) return;
        scopes.set(id, scope);
        void socket.join(scopeRooms(scope));
      }
      counted = true;
      const { nowOnline } = presence.connect(id);
      socket.emit('presence:state', { userIds: onlineFor(id) });
      if (nowOnline) (scope ? io.to(presenceAudience(scope)) : io).emit('presence:online', { userId: id });
      opts.onPresence?.(id); // mark active on every connection (new tab/device)
    }
    if (userId) void announce(userId);

    socket.on('join', async (msg: { projectId?: string }) => {
      const projectId = msg?.projectId;
      if (!projectId) return;
      // Object-level authz: only members (or admins) may subscribe to a project's live events.
      if (opts.canJoinProject && userId) {
        const roles = (socket.data.roles as string[] | undefined) ?? [];
        let allowed = false;
        try {
          allowed = await opts.canJoinProject(userId, roles, projectId);
        } catch {
          allowed = false;
        }
        if (!allowed) {
          socket.emit('join:denied', { projectId });
          return;
        }
      }
      void socket.join(projectRoom(projectId));
      socket.emit('joined', { projectId });
    });

    // Stop receiving a project's events (navigating away from its board or channel).
    socket.on('leave', (msg: { projectId?: string }) => {
      const projectId = msg?.projectId;
      if (!projectId) return;
      void socket.leave(projectRoom(projectId));
      socket.emit('left', { projectId });
    });

    socket.on('disconnect', () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      if (!userId || !counted) return;
      const { nowOffline } = presence.disconnect(userId);
      opts.onPresence?.(userId); // record last-active at the moment they drop a connection
      if (!nowOffline) return;
      const scope = scopes.get(userId);
      scopes.delete(userId);
      (scope ? io.to(presenceAudience(scope)) : io).emit('presence:offline', { userId });
    });
  });

  /** Broadcast an event to everyone viewing a project (e.g. task moved/updated, channel messages). */
  function broadcast(projectId: string, event: string, payload: unknown): void {
    io.to(projectRoom(projectId)).emit(event, payload);
  }

  /** Broadcast an event to a single user across their connected sockets (e.g. their DMs). */
  function broadcastToUser(userId: string, event: string, payload: unknown): void {
    io.to(userRoom(userId)).emit(event, payload);
  }

  /**
   * Broadcast to a project's room and/or specific users (e.g. a meeting's organizer + attendees).
   * Socket.IO emits once per socket across the union of rooms, so a user who is both in the
   * project room and listed individually still gets the event once.
   */
  function broadcastToAudience(audience: { projectId?: string | null; userIds?: string[] }, event: string, payload: unknown): void {
    const rooms = [
      ...(audience.projectId ? [projectRoom(audience.projectId)] : []),
      ...[...new Set(audience.userIds ?? [])].map(userRoom),
    ];
    if (rooms.length > 0) io.to(rooms).emit(event, payload);
  }

  /**
   * End every live connection of a user whose sessions were revoked (suspended, deleted, role or
   * password change). A server-side disconnect is final: clients don't auto-reconnect.
   */
  function disconnectUser(userId: string): void {
    io.to(userRoom(userId)).emit('session:ended');
    io.in(userRoom(userId)).disconnectSockets(true);
  }

  /** Take a user who was removed from a project out of its room on all their devices. */
  function leaveProject(userId: string, projectId: string): void {
    io.in(userRoom(userId)).socketsLeave(projectRoom(projectId));
    io.to(userRoom(userId)).emit('project:removed', { projectId });
  }

  /**
   * companies: these people's companies changed (added to or taken out of a company, a company
   * archived or brought back). Their sockets move to their company rooms now; presence follows (the
   * people they no longer share a company with see them go offline, the new ones see them online,
   * and they get a fresh online list); each socket leaves the project rooms it may no longer be in
   * (with `project:removed`); and their apps hear `companies:changed` to read their companies again.
   */
  async function refreshAccess(userIds: string[]): Promise<void> {
    for (const userId of [...new Set(userIds)]) {
      const sockets = await io.in(userRoom(userId)).fetchSockets();
      if (sockets.length === 0) continue;
      const roles = (sockets[0]!.data.roles as string[] | undefined) ?? [];
      if (opts.companiesOf) {
        const before = scopes.get(userId) ?? { companyIds: new Set<string>(), admin: false };
        const next = await scopeOf(userId, roles);
        const wanted = new Set(scopeRooms(next));
        for (const s of sockets) {
          for (const room of [...s.rooms]) if ((room.startsWith('company:') || room === ADMINS_ROOM) && !wanted.has(room)) s.leave(room);
          s.join([...wanted]);
        }
        if (scopes.has(userId)) {
          scopes.set(userId, next);
          const lost = [...before.companyIds].filter((id) => !next.companyIds.has(id)).map(companyRoom);
          const gained = [...next.companyIds].filter((id) => !before.companyIds.has(id)).map(companyRoom);
          if (lost.length) io.to(lost).except([...presenceAudience(next), userRoom(userId)]).emit('presence:offline', { userId });
          if (gained.length) io.to(gained).except([...presenceAudience(before), userRoom(userId)]).emit('presence:online', { userId });
          io.to(userRoom(userId)).emit('presence:state', { userIds: onlineFor(userId) });
        }
      }
      for (const s of sockets) {
        for (const room of [...s.rooms]) {
          if (!room.startsWith(PROJECT_ROOM)) continue;
          const projectId = room.slice(PROJECT_ROOM.length);
          if (await mayStayIn(userId, roles, projectId)) continue;
          s.leave(room);
          s.emit('project:removed', { projectId });
        }
      }
      io.to(userRoom(userId)).emit('companies:changed', {});
    }
  }

  /** companies: a project's companies changed — whoever may no longer see it leaves its room (`project:removed`). */
  async function refreshProjectAudience(projectId: string): Promise<void> {
    for (const s of await io.in(projectRoom(projectId)).fetchSockets()) {
      const userId = s.data.userId as string | undefined;
      if (userId && (await mayStayIn(userId, (s.data.roles as string[] | undefined) ?? [], projectId))) continue;
      s.leave(projectRoom(projectId));
      s.emit('project:removed', { projectId });
    }
  }

  return { io, broadcast, broadcastToUser, broadcastToAudience, disconnectUser, leaveProject, refreshAccess, refreshProjectAudience, onlineUserIds: () => presence.online() };
}

export type Realtime = ReturnType<typeof createRealtime>;
