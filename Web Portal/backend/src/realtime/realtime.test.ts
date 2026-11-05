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

  // 1.23: a client account has no live connection (the Client portal doesn't use one).
  it('refuses a client account, by its token and by its live roles', async () => {
    const httpServer = createServer();
    const rt = createRealtime(httpServer, { accessSecret: SECRET, checkSession: async (userId) => (userId === 'c2' ? { roles: ['CLIENT'] } : { roles: ['EMPLOYEE'] }) });
    const port = await listen(httpServer);
    const tryWith = (sub: string, roles: string[]) =>
      new Promise<string>((resolve) => {
        const c = ioClient(`http://localhost:${port}`, { auth: { token: signToken({ sub, type: 'access', roles, ver: 0 }, SECRET, 60) }, transports: ['websocket'] });
        c.on('connect_error', (e: Error) => { c.close(); resolve(e.message); });
        c.on('connect', () => { c.close(); resolve('CONNECTED'); });
      });
    expect(await tryWith('c2', ['EMPLOYEE'])).toBe('unauthorized'); // the live roles say client
    expect(await tryWith('u9', ['EMPLOYEE'])).toBe('CONNECTED');
    await rt.io.close();
    httpServer.close();
    const plain = createServer();
    const rt2 = createRealtime(plain, { accessSecret: SECRET });
    const port2 = await listen(plain);
    const c = ioClient(`http://localhost:${port2}`, { auth: { token: signToken({ sub: 'c1', type: 'access', roles: ['CLIENT'], ver: 0 }, SECRET, 60) }, transports: ['websocket'] });
    expect(await new Promise<string>((resolve) => { c.on('connect_error', (e: Error) => resolve(e.message)); c.on('connect', () => resolve('CONNECTED')); })).toBe('unauthorized');
    c.close();
    await rt2.io.close();
    plain.close();
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

describe('realtime and companies', () => {
  type Client = ReturnType<typeof ioClient>;
  type Seen = { event: string; payload: unknown };

  async function setup() {
    const httpServer = createServer();
    // ana: Alpha; cat: Alpha + Beta; ben: Beta; admin: no company (an administrator).
    const companies: Record<string, string[]> = { ana: ['A'], cat: ['A', 'B'], ben: ['B'], admin: [] };
    const canJoin = new Map<string, boolean>();
    const rt = createRealtime(httpServer, {
      accessSecret: SECRET,
      companiesOf: async (userId, roles) => ({ companyIds: [...(companies[userId] ?? [])], admin: roles.includes('ADMIN') }),
      canJoinProject: async (userId, _roles, projectId) => canJoin.get(`${userId}:${projectId}`) ?? true,
    });
    const port = await listen(httpServer);
    const clients: Client[] = [];
    const logs = new Map<Client, Seen[]>();
    /** Connects and resolves once the server has set the socket up (its presence snapshot arrived). */
    async function connect1(sub: string): Promise<Client> {
      const token = signToken({ sub, type: 'access', roles: sub === 'admin' ? ['ADMIN'] : [] }, SECRET, 60);
      const c = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
      const log: Seen[] = [];
      logs.set(c, log);
      clients.push(c);
      c.onAny((event: string, payload: unknown) => log.push({ event, payload }));
      await new Promise<void>((resolve, reject) => {
        c.on('presence:state', () => resolve());
        c.on('connect_error', reject);
      });
      return c;
    }
    const seen = (c: Client, event: string) => logs.get(c)!.filter((e) => e.event === event).map((e) => e.payload);
    async function nextEvent(c: Client, event: string, match: (p: unknown) => boolean = () => true): Promise<unknown> {
      for (let i = 0; i < 150; i++) {
        const found = seen(c, event).find(match);
        if (found !== undefined) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no ${event}`);
    }
    /** A round trip on the connection proves anything sent before it has arrived. */
    const roundTrip = (c: Client) => new Promise<void>((resolve) => { c.once('joined', () => resolve()); c.emit('join', { projectId: 'p-ping' }); });
    const join = (c: Client, projectId: string) => new Promise<void>((resolve) => { c.once('joined', () => resolve()); c.emit('join', { projectId }); });
    async function close() {
      for (const c of clients) c.close();
      await rt.io.close();
      httpServer.close();
    }
    return { rt, companies, canJoin, connect1, seen, nextEvent, roundTrip, join, close };
  }

  it('presence goes only to people who share a company, and to admins', async () => {
    const t = await setup();
    const ana = await t.connect1('ana');
    const cat = await t.connect1('cat');
    const adm = await t.connect1('admin');
    expect(([...((t.seen(adm, 'presence:state')[0] as { userIds: string[] }).userIds)]).sort()).toEqual(['admin', 'ana', 'cat']); // an admin sees everyone
    const ben = await t.connect1('ben');
    expect(((t.seen(ben, 'presence:state')[0] as { userIds: string[] }).userIds).sort()).toEqual(['ben', 'cat']); // not ana, nor the company-less admin
    const isBen = (p: unknown) => (p as { userId: string }).userId === 'ben';
    expect(await t.nextEvent(cat, 'presence:online', isBen)).toEqual({ userId: 'ben' });
    expect(await t.nextEvent(adm, 'presence:online', isBen)).toEqual({ userId: 'ben' });
    ben.close();
    expect(await t.nextEvent(cat, 'presence:offline', isBen)).toEqual({ userId: 'ben' });
    await t.roundTrip(ana);
    expect(t.seen(ana, 'presence:online').filter(isBen)).toEqual([]);
    expect(t.seen(ana, 'presence:offline').filter(isBen)).toEqual([]);
    await t.close();
  }, 15000);

  it('refreshAccess takes cat out of PB’s room and says project:removed', async () => {
    const t = await setup();
    const cat = await t.connect1('cat');
    const ben = await t.connect1('ben');
    await t.join(cat, 'PB');
    t.canJoin.set('cat:PB', false);
    t.companies.cat = ['A']; // cat leaves Beta
    await t.rt.refreshAccess(['cat']);
    expect(await t.nextEvent(cat, 'project:removed')).toEqual({ projectId: 'PB' });
    expect(await t.nextEvent(cat, 'companies:changed')).toEqual({});
    // Beta's people no longer see her online, and she no longer sees them.
    expect(await t.nextEvent(ben, 'presence:offline', (p) => (p as { userId: string }).userId === 'cat')).toEqual({ userId: 'cat' });
    expect(((t.seen(cat, 'presence:state').at(-1) as { userIds: string[] }).userIds).sort()).toEqual(['cat']);
    t.rt.broadcast('PB', 'task:updated', {});
    await t.roundTrip(cat);
    expect(t.seen(cat, 'task:updated')).toEqual([]);
    // Her later comings and goings reach Alpha's people only.
    const ana = await t.connect1('ana');
    cat.close();
    expect(await t.nextEvent(ana, 'presence:offline', (p) => (p as { userId: string }).userId === 'cat')).toEqual({ userId: 'cat' });
    await t.roundTrip(ben);
    expect(t.seen(ben, 'presence:offline').filter((p) => (p as { userId: string }).userId === 'cat')).toHaveLength(1); // only the one from the refresh
    await t.close();
  }, 15000);

  it('a project that leaves a company drops that company’s people from its room', async () => {
    const t = await setup();
    const ben = await t.connect1('ben');
    const ana = await t.connect1('ana');
    await t.join(ben, 'PAB');
    await t.join(ana, 'PAB');
    t.canJoin.set('ben:PAB', false);
    await t.rt.refreshProjectAudience('PAB');
    expect(await t.nextEvent(ben, 'project:removed')).toEqual({ projectId: 'PAB' });
    t.rt.broadcast('PAB', 'task:updated', { taskId: 't1' });
    expect(await t.nextEvent(ana, 'task:updated')).toEqual({ taskId: 't1' });
    await t.roundTrip(ben);
    expect(t.seen(ben, 'task:updated')).toEqual([]);
    expect(t.seen(ana, 'project:removed')).toEqual([]);
    await t.close();
  }, 15000);

  it('ana can’t join PB', async () => {
    const t = await setup();
    t.canJoin.set('ana:PB', false);
    const ana = await t.connect1('ana');
    ana.emit('join', { projectId: 'PB' });
    expect(await t.nextEvent(ana, 'join:denied')).toEqual({ projectId: 'PB' });
    await t.close();
  }, 15000);
});
