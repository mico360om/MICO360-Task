import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken } from '../lib/tokens';
import { createPresenceTracker } from './presence-tracker';

export interface RealtimeOptions {
  accessSecret: string;
  corsOrigin?: string | string[] | boolean;
  /**
   * Object-level room authorization: may this user join a project's room? When omitted every
   * authenticated socket may join any project (the pre-authz behaviour, kept for tests).
   */
  canJoinProject?: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** Fired when a user connects or disconnects — persist their last-active time for presence. */
  onPresence?: (userId: string) => void;
}

/**
 * Sets up Socket.IO on the given HTTP server (M4). Clients authenticate with a JWT
 * in the handshake, join per-project rooms, and receive broadcast task events.
 */
export function createRealtime(httpServer: HttpServer, opts: RealtimeOptions) {
  const io = new Server(httpServer, { cors: { origin: opts.corsOrigin ?? true } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    try {
      const claims = verifyToken(token, opts.accessSecret);
      if (!claims.sub || claims.type !== 'access') return next(new Error('unauthorized'));
      socket.data.userId = claims.sub;
      socket.data.roles = Array.isArray(claims.roles) ? claims.roles : [];
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  // Online presence — reference-counted across a user's tabs/devices.
  const presence = createPresenceTracker();

  io.on('connection', (socket) => {
    // Every socket joins a room for its own user id, so DM/chat events can reach the user
    // across their devices without a per-conversation subscription.
    const userId = socket.data.userId as string | undefined;
    if (userId) void socket.join(`user:${userId}`);

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
      void socket.join(`project:${projectId}`);
      socket.emit('joined', { projectId });
    });

    socket.on('disconnect', () => {
      if (!userId) return;
      const { nowOffline } = presence.disconnect(userId);
      opts.onPresence?.(userId); // record last-active at the moment they drop a connection
      if (nowOffline) io.emit('presence:offline', { userId });
    });
  });

  /** Broadcast an event to everyone viewing a project (e.g. task moved/updated, channel messages). */
  function broadcast(projectId: string, event: string, payload: unknown): void {
    io.to(`project:${projectId}`).emit(event, payload);
  }

  /** Broadcast an event to a single user across their connected sockets (e.g. their DMs). */
  function broadcastToUser(userId: string, event: string, payload: unknown): void {
    io.to(`user:${userId}`).emit(event, payload);
  }

  return { io, broadcast, broadcastToUser, onlineUserIds: () => presence.online() };
}

export type Realtime = ReturnType<typeof createRealtime>;
