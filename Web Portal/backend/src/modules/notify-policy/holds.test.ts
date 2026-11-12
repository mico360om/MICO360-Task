import { describe, expect, it, vi } from 'vitest';
import { bundledPush, createHoldRelease, createMemoryHoldStore } from './holds';
import type { HeldNotice } from '../notifications/notification-service';

const MORNING = new Date('2026-11-16T04:00:00Z');
const held = (over: Partial<HeldNotice> = {}): HeldNotice => ({
  userId: 'u1',
  notificationId: 'n1',
  channel: 'PUSH',
  type: 'TASK_OVERDUE',
  title: 'A task is 1 working day overdue',
  body: 'MICO-1 · Pour slab',
  entityType: 'task',
  entityId: 't1',
  releaseAt: MORNING,
  expiresAt: null,
  ...over,
});

const setup = (pending = false) => {
  const store = createMemoryHoldStore();
  const push = { sendToUser: vi.fn(async () => 1) };
  const sendBundleEmail = vi.fn(async () => {});
  const release = createHoldRelease({ store, push, sendBundleEmail, dailyEmailPending: async () => pending });
  return { store, push, sendBundleEmail, release };
};

describe('held notices go out at the morning, one message each way', () => {
  it('nothing goes before its time', async () => {
    const { store, push, release } = setup();
    await store.add(held());
    await release.run(new Date('2026-11-16T03:59:00Z'));
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('one held push goes as it was (its tap opens that notice)', async () => {
    const { store, push, release } = setup();
    await store.add(held());
    await release.run(MORNING);
    expect(push.sendToUser).toHaveBeenCalledWith('u1', { title: 'A task is 1 working day overdue', body: 'MICO-1 · Pour slab', entityType: 'task', entityId: 't1', notificationId: 'n1' });
  });

  it('many held pushes go as ONE push; running again sends nothing more', async () => {
    const { store, push, release } = setup();
    for (let i = 1; i <= 5; i++) await store.add(held({ notificationId: `n${i}`, title: `Notice ${i}` }));
    await store.add(held({ userId: 'u2' }));
    await release.run(MORNING);
    await release.run(new Date(MORNING.getTime() + 60_000));
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
    expect(push.sendToUser).toHaveBeenCalledWith('u1', { title: '5 notices while you were away', body: 'Notice 1 · Notice 2 · Notice 3 …', entityType: null, entityId: null, notificationId: null });
    expect(store.rows.every((r) => r.outcome === 'SENT')).toBe(true);
  });

  it('a held meeting reminder past its meeting’s start is dropped', async () => {
    const { store, push, release } = setup();
    await store.add(held({ type: 'MEETING_REMINDER', expiresAt: new Date('2026-11-16T03:00:00Z') }));
    expect(await release.run(MORNING)).toEqual({ pushes: 0, emails: 0, dropped: 1 });
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('held emails wait for the daily email when it still goes today', async () => {
    const { store, sendBundleEmail, release } = setup(true);
    await store.add(held({ channel: 'EMAIL' }));
    await release.run(MORNING);
    expect(sendBundleEmail).not.toHaveBeenCalled();
    expect(await store.openEmails('u1')).toHaveLength(1);
  });

  it('…otherwise they go as ONE email', async () => {
    const { store, sendBundleEmail, release } = setup(false);
    await store.add(held({ channel: 'EMAIL', title: 'A' }));
    await store.add(held({ channel: 'EMAIL', title: 'B' }));
    await release.run(MORNING);
    expect(sendBundleEmail).toHaveBeenCalledTimes(1);
    expect((sendBundleEmail.mock.calls[0] as unknown as [string, { title: string }[]])[1].map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('the bundled push words', () => {
    const row = (over: Partial<HeldNotice>) => ({ ...held(over), id: 'h', createdAt: MORNING });
    expect(bundledPush([row({ title: 'X' }), row({ title: 'Y' })])).toMatchObject({ title: '2 notices while you were away', body: 'X · Y' });
  });
});

describe('review M7/M8: the daily email takes held emails due by the morning', () => {
  it('takes only those due by then; nobody else sends them; let go when the email didn’t go', async () => {
    const { store, sendBundleEmail, release } = setup(false);
    await store.add(held({ channel: 'EMAIL', title: 'night' }));
    await store.add(held({ channel: 'EMAIL', title: 'after a long pause', releaseAt: new Date('2026-11-20T04:00:00Z') }));
    const taken = await store.takeEmails('u1', new Date(MORNING.getTime() + 12 * 3600_000), MORNING);
    expect(taken.map((t) => t.title)).toEqual(['night']);
    await release.run(MORNING);
    expect(sendBundleEmail).not.toHaveBeenCalled();
    await store.release(taken.map((t) => t.id));
    expect((await store.openEmails('u1')).map((t) => t.title)).toEqual(['night', 'after a long pause']);
  });
});

// Release B (coordinator's call, 12 Nov): a crash between taking held notices (for the daily email, or a release
// run's claim) and finishing them left them taken for good — never sent. A take older than its 15-minute lease is let
// go by the next run (then sent as usual) and logged once.
describe('stale taken holds', () => {
  it('a hold taken more than 15 minutes ago and never finished is let go by the next run, sent, and logged once', async () => {
    const store = createMemoryHoldStore();
    const push = { sendToUser: vi.fn(async () => 1) };
    const warn = vi.fn();
    const release = createHoldRelease({ store, push, sendBundleEmail: vi.fn(async () => {}), dailyEmailPending: async () => false, logger: { error: vi.fn(), warn } });
    await store.add(held({ notificationId: 'n1' }));
    await store.add(held({ notificationId: 'n2', channel: 'EMAIL' }));
    // Taken at 08:00 (a push claim and the daily email's take), then the server died.
    await store.claimDue('u1', 'PUSH', MORNING);
    await store.takeEmails('u1', MORNING, MORNING);
    expect(store.rows.every((r) => r.doneAt)).toBe(true);
    // Ten minutes later: still within the lease — left alone.
    await release.run(new Date(MORNING.getTime() + 10 * 60_000));
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    // Sixteen minutes later: let go and sent; the log says so once.
    await release.run(new Date(MORNING.getTime() + 16 * 60_000));
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('held notices taken but never finished were let go again', { count: 2 });
    await release.run(new Date(MORNING.getTime() + 40 * 60_000));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(store.rows.map((r) => r.outcome)).toEqual(['SENT', 'SENT']);
  });

  it('finished holds (sent, folded, dropped) are never let go', async () => {
    const store = createMemoryHoldStore();
    await store.add(held({ notificationId: 'n1' }));
    await store.add(held({ notificationId: 'n2' }));
    await store.add(held({ notificationId: 'n3' }));
    const ids = store.rows.map((r) => r.id);
    await store.finish([ids[0]!], 'SENT', MORNING);
    await store.finish([ids[1]!], 'FOLDED', MORNING);
    await store.finish([ids[2]!], 'DROPPED', MORNING);
    expect(await store.reclaimStale(new Date(MORNING.getTime() + 60 * 60_000))).toBe(0);
  });
});
