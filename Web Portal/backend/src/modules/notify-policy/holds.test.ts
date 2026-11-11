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
