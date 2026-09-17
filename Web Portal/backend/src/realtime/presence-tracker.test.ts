import { describe, it, expect } from 'vitest';
import { createPresenceTracker } from './presence-tracker';

describe('presence tracker', () => {
  it('marks a user online on their first socket only', () => {
    const t = createPresenceTracker();
    expect(t.connect('u1').nowOnline).toBe(true);
    expect(t.connect('u1').nowOnline).toBe(false); // second device — already online
    expect(t.online().sort()).toEqual(['u1']);
  });

  it('keeps a user online until their last socket disconnects', () => {
    const t = createPresenceTracker();
    t.connect('u1');
    t.connect('u1');
    expect(t.disconnect('u1').nowOffline).toBe(false); // still one socket left
    expect(t.online()).toEqual(['u1']);
    expect(t.disconnect('u1').nowOffline).toBe(true); // last socket gone
    expect(t.online()).toEqual([]);
  });

  it('tracks several users independently', () => {
    const t = createPresenceTracker();
    t.connect('u1');
    t.connect('u2');
    expect(t.online().sort()).toEqual(['u1', 'u2']);
    expect(t.disconnect('u1').nowOffline).toBe(true);
    expect(t.online()).toEqual(['u2']);
  });

  it('never goes negative on an unbalanced disconnect', () => {
    const t = createPresenceTracker();
    expect(t.disconnect('ghost').nowOffline).toBe(false);
    expect(t.online()).toEqual([]);
  });
});
