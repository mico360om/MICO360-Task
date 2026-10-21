import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import {
  agendaTry,
  attendeeTry,
  contentVersion,
  createPendingKeys,
  inviteTry,
  KEPT_KEY_LIFE_MS,
  minutesTry,
  sendKept,
  settleRemovedAgenda,
  settleRemovedAttendee,
  settleShownAgenda,
  settleShownAttendees,
  tryName,
} from './pending-keys';

const MEETING = { id: 'm1', title: 'Weekly sync', startAt: '2026-10-21T09:00:00.000Z', endAt: '2026-10-21T10:00:00.000Z', location: 'Room 2', onlineLink: null, status: 'DRAFT', updatedAt: 'first' };

const counter = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe('the key of a try that got no answer', () => {
  it('is kept for the same try until a definite answer — also after its sheet was closed and opened again', () => {
    const keys = createPendingKeys(counter());
    const send = minutesTry('m1', ['a@x.co', 'b@x.co'], 'v1');
    const first = keys.keyFor(send);
    keys.settle(send, new NetworkError('slow', { timedOut: true }));
    // The sheet is closed and opened again (nothing on it is kept): Send uses the same key.
    expect(keys.keyFor(send)).toBe(first);
    keys.settle(send, new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Still sending'));
    expect(keys.keyFor(send)).toBe(first);
    // The answer came: the next send is a new one.
    keys.settle(send);
    expect(keys.keyFor(send)).not.toBe(first);
  });

  it('is renewed after a refusal, which the server keeps under its key', () => {
    const keys = createPendingKeys(counter());
    const add = tryName('attendee', 'm1', { userId: 'u2', role: 'REQUIRED' });
    const first = keys.keyFor(add);
    keys.settle(add, new ApiError(403, 'FORBIDDEN', 'No'));
    expect(keys.keyFor(add)).not.toBe(first);
  });

  it('is another try’s key when what is sent differs — the server matches the key, not what is sent', () => {
    const keys = createPendingKeys(counter());
    const a = tryName('agenda', 'm1', { title: 'Budget', ownerId: null, expectedMinutes: 10 });
    const b = tryName('agenda', 'm1', { title: 'Budget 2027', ownerId: null, expectedMinutes: 10 });
    const ka = keys.keyFor(a);
    keys.settle(a, new NetworkError('offline'));
    expect(keys.keyFor(b)).not.toBe(ka);
    expect(keys.keyFor(a)).toBe(ka);
  });

  it('names a send by who it goes to, in any order, and an invitation by its choice too', () => {
    expect(minutesTry('m1', ['b@x.co', 'a@x.co'], 'v1')).toBe(minutesTry('m1', ['a@x.co', 'b@x.co'], 'v1'));
    expect(minutesTry('m1', ['a@x.co'], 'v1')).not.toBe(minutesTry('m1', ['a@x.co', 'b@x.co'], 'v1'));
    expect(minutesTry('m1', ['a@x.co'], 'v1')).not.toBe(minutesTry('m2', ['a@x.co'], 'v1'));
    expect(inviteTry(MEETING, { onlyNew: true }, ['b@x.co', 'a@x.co'])).toBe(inviteTry(MEETING, { onlyNew: true }, ['a@x.co', 'b@x.co']));
    expect(inviteTry(MEETING, { onlyNew: true }, ['a@x.co'])).not.toBe(inviteTry(MEETING, { resend: true }, ['a@x.co']));
  });

  // Review fix 1: the server hands back the first try's reply for a day, whatever was sent since.
  it('names the minutes email by what the minutes say: corrected minutes are a new send, not the first one’s reply', () => {
    const before = contentVersion('2026-10-21T09:00:00.000Z', null, 'Hello');
    const fixed = contentVersion('2026-10-21T10:30:00.000Z', null, 'Hello');
    expect(minutesTry('m1', ['a@x.co'], before)).not.toBe(minutesTry('m1', ['a@x.co'], fixed));
    expect(contentVersion(null, '2026-10-21T09:00:00.000Z', 'Hello')).not.toBe(contentVersion(null, '2026-10-21T09:00:00.000Z', 'Hello!'));
    expect(contentVersion(null, null, 'Same')).toBe(contentVersion(null, null, 'Same'));
  });

  it('names invitations by when and where the meeting is: a moved meeting’s invitations are a new send', () => {
    const moved = { ...MEETING, startAt: '2026-10-28T09:00:00.000Z' };
    expect(inviteTry(MEETING, {}, ['a@x.co'])).not.toBe(inviteTry(moved, {}, ['a@x.co']));
    expect(inviteTry(MEETING, {}, ['a@x.co'])).not.toBe(inviteTry({ ...MEETING, location: 'Room 4' }, {}, ['a@x.co']));
    // Scheduling a draft as it is sent changes nothing it is named by (the retry keeps its key).
    const scheduled = { ...MEETING, status: 'SCHEDULED', updatedAt: 'later' };
    expect(inviteTry(MEETING, {}, ['a@x.co'])).toBe(inviteTry(scheduled, {}, ['a@x.co']));
  });
});

describe('a kept key has a short life, and goes once the result shows (review fix 1)', () => {
  it('is a new key once the kept one is older than its life — a later, deliberate try is a new one', () => {
    let now = 1_000_000;
    const keys = createPendingKeys({ gen: counter(), now: () => now });
    const what = tryName('duplicate', 'm1');
    const first = keys.keyFor(what);
    keys.settle(what, new NetworkError('slow', { timedOut: true }));
    now += KEPT_KEY_LIFE_MS - 1;
    expect(keys.keyFor(what)).toBe(first);
    keys.settle(what, new NetworkError('slow', { timedOut: true }));
    // The life counts from the last try: a retry just now keeps it a while longer.
    now += KEPT_KEY_LIFE_MS - 1;
    expect(keys.keyFor(what)).toBe(first);
    keys.settle(what, new NetworkError('slow', { timedOut: true }));
    now += KEPT_KEY_LIFE_MS + 1;
    expect(keys.keyFor(what)).not.toBe(first);
    expect(KEPT_KEY_LIFE_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(KEPT_KEY_LIFE_MS).toBeLessThanOrEqual(15 * 60_000);
  });

  it('goes when the people list shows the person added (the timed-out add was saved), so removing and adding them again is new', () => {
    const keys = createPendingKeys(counter());
    const sara = attendeeTry('m1', { userId: 'u-sara', role: 'REQUIRED' });
    const guest = attendeeTry('m1', { externalName: 'Ola', externalEmail: 'Ola@Guest.com', role: 'OPTIONAL' });
    const other = attendeeTry('m2', { userId: 'u-sara', role: 'REQUIRED' });
    const [k1, k2, k3] = [keys.keyFor(sara), keys.keyFor(guest), keys.keyFor(other)];
    for (const w of [sara, guest, other]) keys.settle(w, new NetworkError('slow', { timedOut: true }));
    settleShownAttendees(keys, 'm1', [
      { userId: 'u-sara', externalEmail: null },
      { userId: null, externalEmail: 'ola@guest.com' },
    ]);
    expect(keys.keyFor(sara)).not.toBe(k1);
    expect(keys.keyFor(guest)).not.toBe(k2);
    // Another meeting's try is left alone.
    expect(keys.keyFor(other)).toBe(k3);
  });

  it('goes when that person is removed: adding them again later is a new add, not the first one’s stored reply', () => {
    const keys = createPendingKeys(counter());
    const sara = attendeeTry('m1', { userId: 'u-sara', role: 'REQUIRED' });
    const ali = attendeeTry('m1', { userId: 'u-ali', role: 'REQUIRED' });
    const [ks, ka] = [keys.keyFor(sara), keys.keyFor(ali)];
    keys.settle(sara, new NetworkError('slow', { timedOut: true }));
    keys.settle(ali, new NetworkError('slow', { timedOut: true }));
    settleRemovedAttendee(keys, 'm1', { userId: 'u-sara', externalEmail: null });
    expect(keys.keyFor(sara)).not.toBe(ks);
    expect(keys.keyFor(ali)).toBe(ka);
  });

  it('agenda: goes when the agenda shows the item, or the item is deleted — re-adding it is never a ghost row', () => {
    const keys = createPendingKeys(counter());
    const budget = agendaTry('m1', { title: 'Budget', ownerId: 'u1', expectedMinutes: 10 });
    const risks = agendaTry('m1', { title: 'Risks', ownerId: null, expectedMinutes: null });
    const [kb, kr] = [keys.keyFor(budget), keys.keyFor(risks)];
    keys.settle(budget, new NetworkError('slow', { timedOut: true }));
    keys.settle(risks, new NetworkError('slow', { timedOut: true }));
    settleShownAgenda(keys, 'm1', [{ title: 'Budget', ownerId: 'u1', expectedMinutes: 10 }]);
    expect(keys.keyFor(budget)).not.toBe(kb);
    expect(keys.keyFor(risks)).toBe(kr);
    settleRemovedAgenda(keys, 'm1', { title: 'Risks', ownerId: null, expectedMinutes: null });
    expect(keys.keyFor(risks)).not.toBe(kr);
  });
});

describe('sendKept — the key is settled by the write itself', () => {
  it('keeps the key after no answer, and lets it go after an answer — even when nobody is listening any more', async () => {
    const keys = createPendingKeys(counter());
    const seen: string[] = [];
    const what = tryName('duplicate', 'm1');
    await sendKept(keys, what, async (k) => {
      seen.push(k);
      throw new NetworkError('slow', { timedOut: true });
    }).catch(() => undefined);
    await sendKept(keys, what, async (k) => {
      seen.push(k);
      return 'copy';
    });
    await sendKept(keys, what, async (k) => {
      seen.push(k);
      throw new ApiError(403, 'FORBIDDEN', 'No');
    }).catch(() => undefined);
    await sendKept(keys, what, async (k) => void seen.push(k));
    // The retry after the time-out reused the key; after the answer, and after the refusal, new ones.
    expect(seen).toEqual(['k1', 'k1', 'k2', 'k3']);
  });
});
