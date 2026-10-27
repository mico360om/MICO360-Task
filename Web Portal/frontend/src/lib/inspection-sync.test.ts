import { describe, it, expect, vi, afterEach } from 'vitest';
import { inspectionOutbox } from './inspection-sync';
import { useAuthStore } from '../stores/auth-store';

const session = { user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the inspection outbox and signing out', () => {
  it('signing out on purpose forgets what was held only in the page for that person; an expired session keeps it to send later', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const forget = vi.spyOn(inspectionOutbox, 'forgetUnsaved');
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout('expired');
    expect(forget).not.toHaveBeenCalled();
    useAuthStore.getState().setSession(session);
    useAuthStore.getState().logout('user');
    expect(forget).toHaveBeenCalledWith('u1');
  });
});
