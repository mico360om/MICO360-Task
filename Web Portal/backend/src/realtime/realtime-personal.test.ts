import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as Client } from 'socket.io-client';
import { createRealtime } from './realtime';
import { signToken } from '../lib/tokens';

// 1.23.29 Private file links (design §7.4): a chat message with files goes to each connected socket signed
// for that socket's person (one copy each), in order with the room broadcasts around it.
const SECRET = 'realtime-personal-secret';

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));
}

async function setup() {
  const httpServer = createServer();
  const rt = createRealtime(httpServer, { accessSecret: SECRET });
  const port = await listen(httpServer);
  const connect = (sub: string, ver = 0) =>
    ioClient(`http://localhost:${port}`, { auth: { token: signToken({ sub, type: 'access', roles: [], ver }, SECRET, 60) }, transports: ['websocket'] });
  const ready = (c: Client) => new Promise<void>((resolve) => (c.connected ? resolve() : c.on('connect', () => resolve())));
  const join = (c: Client, projectId: string) => new Promise<void>((resolve) => { c.once('joined', () => resolve()); c.emit('join', { projectId }); });
  /** A round trip on each connection: anything sent before it has arrived by now. */
  const settle = (cs: Client[]) => Promise.all(cs.map((c) => join(c, 'p-settle')));
  const close = async (cs: Client[]) => {
    for (const c of cs) c.close();
    await rt.io.close();
    httpServer.close();
  };
  return { rt, connect, ready, join, settle, close };
}

describe('realtime: one copy per person (chat files)', () => {
  it('each socket in a project room gets the payload made for its own person and session version', async () => {
    const { rt, connect, join, settle, close } = await setup();
    const amal = connect('amal', 3);
    const amalPhone = connect('amal', 3);
    const basim = connect('basim', 0);
    const outsider = connect('carim', 0);
    await Promise.all([join(amal, 'p1'), join(amalPhone, 'p1'), join(basim, 'p1')]);
    const got: Record<string, unknown[]> = { amal: [], amalPhone: [], basim: [], outsider: [] };
    for (const [n, c] of [['amal', amal], ['amalPhone', amalPhone], ['basim', basim], ['outsider', outsider]] as const) c.on('chat:message', (p: unknown) => got[n]!.push(p));
    const built: string[] = [];
    rt.broadcastPersonal({ projectId: 'p1' }, 'chat:message', (viewer) => {
      built.push(`${viewer.id}@${viewer.ver}`);
      return { for: viewer.id, ver: viewer.ver };
    });
    await settle([amal, amalPhone, basim, outsider]);
    expect(got).toEqual({ amal: [{ for: 'amal', ver: 3 }], amalPhone: [{ for: 'amal', ver: 3 }], basim: [{ for: 'basim', ver: 0 }], outsider: [] });
    // Made once per person, not per tab.
    expect(built.sort()).toEqual(['amal@3', 'basim@0']);
    await close([amal, amalPhone, basim, outsider]);
  }, 15000);

  it('a direct chat reaches each participant on all their devices, once per socket', async () => {
    const { rt, connect, ready, settle, close } = await setup();
    const amal = connect('amal');
    const basim = connect('basim');
    const basimPhone = connect('basim');
    const carim = connect('carim');
    await Promise.all([amal, basim, basimPhone, carim].map(ready));
    const got: Record<string, string[]> = { amal: [], basim: [], basimPhone: [], carim: [] };
    for (const [n, c] of [['amal', amal], ['basim', basim], ['basimPhone', basimPhone], ['carim', carim]] as const) c.on('chat:message', (p: { for: string }) => got[n]!.push(p.for));
    rt.broadcastPersonal({ userIds: ['amal', 'basim', 'basim'] }, 'chat:message', (viewer) => ({ for: viewer.id }));
    await settle([amal, basim, basimPhone, carim]);
    expect(got).toEqual({ amal: ['amal'], basim: ['basim'], basimPhone: ['basim'], carim: [] });
    await close([amal, basim, basimPhone, carim]);
  }, 15000);

  it('keeps the order of events: a message, then a reaction broadcast right after it', async () => {
    const { rt, connect, join, settle, close } = await setup();
    const amal = connect('amal');
    await join(amal, 'p1');
    const order: string[] = [];
    amal.on('chat:message', () => order.push('message'));
    amal.on('chat:reaction', () => order.push('reaction'));
    rt.broadcastPersonal({ projectId: 'p1' }, 'chat:message', () => ({}));
    rt.broadcast('p1', 'chat:reaction', {});
    await settle([amal]);
    expect(order).toEqual(['message', 'reaction']);
    await close([amal]);
  }, 15000);
});
