import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken } from '../lib/tokens';
import { createPresenceTracker } from './presence-tracker';
import type { CorsOriginMatcher } from '../lib/cors-origins';

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
}

/** setTimeout can't wait longer than this (~24.8 days); longer-lived tokens are re-checked then. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const userRoom = (userId: string) => `user:${userId}`;
const projectRoom = (projectId: string) => `project:${projectId}`;

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
    if (!opts.checkSession) return next();
    const ver = typeof claims.ver === 'number' ? claims.ver : 0;
    opts.checkSession(userId, ver).then(
      (session) => {
        if (!session) return next(new Error('unauthorized'));
        socket.data.roles = session.roles;
        next();
      },
      () => next(new Error('unauthorized')),
    );
  });

  // Online presence — reference-counted across a user's tabs/devices.
  const presence = createPresenceTracker();

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

    // Presence: tell the newcomer who's online, and announce them to everyone if newly online.
    if (userId) {
      const { nowOnline } = presence.connect(userId);
      socket.emit('presence:state', { userIds: presence.online() });
      if (nowOnline) io.emit('presence:online', { userId });
      opts.onPresence?.(userId); // mark active on every connection (new tab/device)
    }

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
      if (!userId) return;
      const { nowOffline } = presence.disconnect(userId);
      opts.onPresence?.(userId); // record last-active at the moment they drop a connection
      if (nowOffline) io.emit('presence:offline', { userId });
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

  return { io, broadcast, broadcastToUser, broadcastToAudience, disconnectUser, leaveProject, onlineUserIds: () => presence.online() };
}

export type Realtime = ReturnType<typeof createRealtime>;
