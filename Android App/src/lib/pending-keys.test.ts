import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { createPendingKeys, inviteTry, minutesTry, tryName } from './pending-keys';

const counter = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe('the key of a try that got no answer', () => {
  it('is kept for the same try until a definite answer — also after its sheet was closed and opened again', () => {
    const keys = createPendingKeys(counter());
    const send = minutesTry('m1', ['a@x.co', 'b@x.co']);
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
    expect(minutesTry('m1', ['b@x.co', 'a@x.co'])).toBe(minutesTry('m1', ['a@x.co', 'b@x.co']));
    expect(minutesTry('m1', ['a@x.co'])).not.toBe(minutesTry('m1', ['a@x.co', 'b@x.co']));
    expect(minutesTry('m1', ['a@x.co'])).not.toBe(minutesTry('m2', ['a@x.co']));
    expect(inviteTry('m1', { onlyNew: true }, ['b@x.co', 'a@x.co'])).toBe(inviteTry('m1', { onlyNew: true }, ['a@x.co', 'b@x.co']));
    expect(inviteTry('m1', { onlyNew: true }, ['a@x.co'])).not.toBe(inviteTry('m1', { resend: true }, ['a@x.co']));
  });
});
