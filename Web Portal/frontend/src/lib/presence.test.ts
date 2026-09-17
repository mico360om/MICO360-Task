import { describe, it, expect } from 'vitest';
import { presenceReducer, type PresenceEvent } from './presence';

const apply = (start: string[], events: PresenceEvent[]): string[] => {
  let s = new Set(start);
  for (const e of events) s = presenceReducer(s, e);
  return [...s].sort();
};

describe('presenceReducer', () => {
  it('replaces the whole set on a full state snapshot', () => {
    expect(apply(['x'], [{ type: 'state', userIds: ['a', 'b'] }])).toEqual(['a', 'b']);
  });

  it('adds a user coming online (idempotently)', () => {
    expect(apply(['a'], [{ type: 'online', userId: 'b' }, { type: 'online', userId: 'b' }])).toEqual(['a', 'b']);
  });

  it('removes a user going offline (no-op if absent)', () => {
    expect(apply(['a', 'b'], [{ type: 'offline', userId: 'b' }, { type: 'offline', userId: 'z' }])).toEqual(['a']);
  });

  it('does not mutate the previous set', () => {
    const prev = new Set(['a']);
    const next = presenceReducer(prev, { type: 'online', userId: 'b' });
    expect([...prev]).toEqual(['a']);
    expect(next).not.toBe(prev);
  });
});
