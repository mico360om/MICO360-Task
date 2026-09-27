import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient } from 'socket.io-client';
import { createRealtime } from './realtime';
import { signToken } from '../lib/tokens';

const SECRET = 'realtime-secret';

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));
}

describe('realtime', () => {
  it('broadcasts task events to clients in the project room', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 60);
    const client = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });

    const received = new Promise<{ taskId: string }>((resolve, reject) => {
      client.on('connect', () => client.emit('join', { projectId: 'p1' }));
      client.on('joined', () => rt.broadcast('p1', 'task:moved', { taskId: 't1', columnId: 'c2' }));
      client.on('task:moved', (payload: { taskId: string }) => resolve(payload));
      client.on('connect_error', reject);
    });

    const payload = await received;
    expect(payload.taskId).toBe('t1');

    client.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('sends the online presence snapshot to a newly-connected client', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 60);
    const client = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });

    const state = await new Promise<{ userIds: string[] }>((resolve, reject) => {
      client.on('presence:state', resolve);
      client.on('connect_error', reject);
    });
    expect(state.userIds).toContain('u1');
    expect(rt.onlineUserIds()).toContain('u1');

    client.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('denies joining a project room the user cannot view, but allows one they can', async () => {
    const httpServer = createServer();
    // Room authz: only p1 is viewable by this user.
    const rt = createRealtime(httpServer, { accessSecret: SECRET, canJoinProject: async (_u, _r, projectId) => projectId === 'p1' });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 60);
    const client = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });

    const denied = await new Promise<string>((resolve, reject) => {
      client.on('connect', () => client.emit('join', { projectId: 'p2' }));
      client.on('join:denied', (p: { projectId: string }) => resolve(`denied:${p.projectId}`));
      client.on('joined', (p: { projectId: string }) => resolve(`joined:${p.projectId}`));
      client.on('connect_error', reject);
    });
    expect(denied).toBe('denied:p2');

    const allowed = await new Promise<string>((resolve) => {
      client.on('joined', (p: { projectId: string }) => resolve(p.projectId));
      client.emit('join', { projectId: 'p1' });
    });
    expect(allowed).toBe('p1');

    client.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('disconnects every socket of a user whose sessions were revoked (SEC-07)', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 60);
    const other = signToken({ sub: 'u2', type: 'access', roles: [] }, SECRET, 60);
    const tabA = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    const tabB = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    const bystander = ioClient(`http://localhost:${port}`, { auth: { token: other }, transports: ['websocket'] });
    await Promise.all([tabA, tabB, bystander].map((c) => new Promise<void>((resolve) => c.on('connect', () => resolve()))));

    const reasons = Promise.all([tabA, tabB].map((c) => new Promise<string>((resolve) => c.on('disconnect', resolve))));
    rt.disconnectUser('u1');
    expect(await reasons).toEqual(['io server disconnect', 'io server disconnect']);
    expect(bystander.connected).toBe(true);

    bystander.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('takes a removed member out of the project room and tells their client (SEC-07)', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 60);
    const client = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    const received: string[] = [];
    client.on('task:moved', (p: { taskId: string }) => received.push(p.taskId));
    await new Promise<void>((resolve) => {
      client.on('connect', () => client.emit('join', { projectId: 'p1' }));
      client.on('joined', () => resolve());
    });

    const removed = new Promise<{ projectId: string }>((resolve) => client.on('project:removed', resolve));
    rt.leaveProject('u1', 'p1');
    expect(await removed).toEqual({ projectId: 'p1' });
    rt.broadcast('p1', 'task:moved', { taskId: 'after-removal' });
    // A round trip on the same connection proves the broadcast would have arrived by now.
    await new Promise<void>((resolve) => { client.on('joined', () => resolve()); client.emit('join', { projectId: 'p9' }); });
    expect(received).toEqual([]);

    client.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('delivers an audience broadcast once per socket across project and user rooms', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const connect = (sub: string) =>
      ioClient(`http://localhost:${port}`, { auth: { token: signToken({ sub, type: 'access', roles: [] }, SECRET, 60) }, transports: ['websocket'] });
    const member = connect('member'); // in the project room AND listed as an attendee
    const guest = connect('guest'); // standalone-style: reachable only through their user room
    const outsider = connect('outsider');
    const got: Record<string, number> = { member: 0, guest: 0, outsider: 0 };
    for (const [name, c] of [['member', member], ['guest', guest], ['outsider', outsider]] as const) c.on('meeting:notes', () => { got[name]! += 1; });
    await new Promise<void>((resolve) => {
      member.on('connect', () => member.emit('join', { projectId: 'p1' }));
      member.on('joined', () => resolve());
    });
    await Promise.all([guest, outsider].map((c) => new Promise<void>((resolve) => (c.connected ? resolve() : c.on('connect', () => resolve())))));

    rt.broadcastToAudience({ projectId: 'p1', userIds: ['member', 'guest', 'guest'] }, 'meeting:notes', { id: 'm1' });
    // Round trips on each connection prove anything sent would have arrived by now.
    await Promise.all([member, guest, outsider].map((c) => new Promise<void>((resolve) => { c.once('joined', () => resolve()); c.emit('join', { projectId: 'p9' }); })));
    expect(got).toEqual({ member: 1, guest: 1, outsider: 0 });

    for (const c of [member, guest, outsider]) c.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('lets a client leave a project room', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 60);
    const client = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    const received: string[] = [];
    client.on('task:moved', (p: { taskId: string }) => received.push(p.taskId));
    await new Promise<void>((resolve) => {
      client.on('connect', () => client.emit('join', { projectId: 'p1' }));
      client.on('joined', () => resolve());
    });
    const left = await new Promise<{ projectId: string }>((resolve) => { client.on('left', resolve); client.emit('leave', { projectId: 'p1' }); });
    expect(left).toEqual({ projectId: 'p1' });
    rt.broadcast('p1', 'task:moved', { taskId: 'after-leave' });
    await new Promise<void>((resolve) => { client.on('joined', () => resolve()); client.emit('join', { projectId: 'p9' }); });
    expect(received).toEqual([]);

    client.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('closes the connection when the access token expires (SEC-07)', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const token = signToken({ sub: 'u1', type: 'access', roles: [] }, SECRET, 1);
    const client = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    const expired = new Promise<boolean>((resolve) => client.on('auth:expired', () => resolve(true)));
    const reason = await new Promise<string>((resolve, reject) => {
      client.on('disconnect', resolve);
      client.on('connect_error', reject);
    });
    // A transport close (not "io server disconnect") so real clients reconnect with a fresh token.
    expect(reason).toBe('transport close');
    expect(await expired).toBe(true);

    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('refuses a token whose session was revoked, and uses the live roles otherwise', async () => {
    const httpServer = createServer();
    const seenRoles: string[][] = [];
    const rt = createRealtime(httpServer, {
      accessSecret: SECRET,
      checkSession: async (userId, ver) => (userId === 'u1' && ver === 2 ? { roles: ['EMPLOYEE'] } : null),
      canJoinProject: async (_u, roles) => { seenRoles.push(roles); return true; },
    });
    const port = await listen(httpServer);
    const stale = ioClient(`http://localhost:${port}`, { auth: { token: signToken({ sub: 'u1', type: 'access', roles: ['ADMIN'], ver: 1 }, SECRET, 60) }, transports: ['websocket'] });
    expect(await new Promise<string>((resolve) => { stale.on('connect_error', (e: Error) => resolve(e.message)); stale.on('connect', () => resolve('CONNECTED')); })).toBe('unauthorized');
    stale.close();

    // The token still claims ADMIN, but the live session says the user was demoted.
    const current = ioClient(`http://localhost:${port}`, { auth: { token: signToken({ sub: 'u1', type: 'access', roles: ['ADMIN'], ver: 2 }, SECRET, 60) }, transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      current.on('connect', () => current.emit('join', { projectId: 'p1' }));
      current.on('joined', () => resolve());
    });
    expect(seenRoles).toEqual([['EMPLOYEE']]);

    current.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);

  it('rejects a connection without a valid token', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET });
    const port = await listen(httpServer);
    const client = ioClient(`http://localhost:${port}`, { auth: { token: 'bad' }, transports: ['websocket'] });

    const rejected = new Promise<string>((resolve) => {
      client.on('connect_error', (err: Error) => resolve(err.message));
      client.on('connect', () => resolve('CONNECTED'));
    });

    expect(await rejected).toBe('unauthorized');

    client.close();
    await rt.io.close();
    httpServer.close();
  }, 15000);
});
