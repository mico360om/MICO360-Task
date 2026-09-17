import { describe, it, expect } from 'vitest';
import { createSessionStore } from './session-store';
import { createMemoryStore } from './storage';
import type { Session } from './types';

const session: Session = {
  user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
  accessToken: 'at-123',
  refreshToken: 'rt-456',
};

describe('SessionStore', () => {
  it('starts empty and reports unauthenticated', async () => {
    const s = createSessionStore({ store: createMemoryStore() });
    expect(await s.load()).toBeNull();
    expect(s.isAuthenticated()).toBe(false);
    expect(s.getToken()).toBeNull();
  });

  it('persists a session and exposes token + admin flag', async () => {
    const store = createMemoryStore();
    const s = createSessionStore({ store });
    await s.setSession(session);
    expect(s.isAuthenticated()).toBe(true);
    expect(s.getToken()).toBe('at-123');
    expect(s.isAdmin()).toBe(true);
    expect(await store.getItem('mico360.session')).toContain('at-123'); // written to storage
  });

  it('rehydrates a persisted session on load', async () => {
    const store = createMemoryStore({ 'mico360.session': JSON.stringify(session) });
    const s = createSessionStore({ store });
    const loaded = await s.load();
    expect(loaded?.accessToken).toBe('at-123');
    expect(s.isAuthenticated()).toBe(true);
  });

  it('logout clears memory + storage and notifies subscribers', async () => {
    const store = createMemoryStore();
    const s = createSessionStore({ store });
    let notified = 0;
    s.subscribe(() => { notified++; });
    await s.setSession(session);
    await s.logout();
    expect(s.isAuthenticated()).toBe(false);
    expect(await store.getItem('mico360.session')).toBeNull();
    expect(notified).toBeGreaterThanOrEqual(2); // setSession + logout
  });

  it('survives a corrupt stored value', async () => {
    const store = createMemoryStore({ 'mico360.session': 'not json' });
    const s = createSessionStore({ store });
    expect(await s.load()).toBeNull();
  });
});
