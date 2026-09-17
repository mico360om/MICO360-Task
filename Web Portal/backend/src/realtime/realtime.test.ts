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
