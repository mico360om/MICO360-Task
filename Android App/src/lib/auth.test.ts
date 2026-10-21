import { describe, it, expect, vi } from 'vitest';
import { authApi, roleLabel, SIGN_IN_LIMITS } from './auth';
import type { ApiClient } from './api-client';

function stubClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const make = (data: unknown) => (path: string, body?: unknown) => {
    calls.push({ method: 'POST', path, body });
    return Promise.resolve({ data });
  };
  const session = { user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' };
  const client = {
    post: vi.fn((path: string, body?: unknown) => {
      calls.push({ method: 'POST', path, body });
      if (path.endsWith('/otp/request') || path.endsWith('/password/forgot')) return Promise.resolve({ data: { sent: true } });
      if (path.endsWith('/password/reset')) return Promise.resolve({ data: { reset: true } });
      return Promise.resolve({ data: session });
    }),
    get: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as unknown as ApiClient;
  void make;
  return { client, calls, session };
}

describe('authApi', () => {
  it('login posts identifier + password and returns the session', async () => {
    const { client, calls, session } = stubClient();
    const res = await authApi(client).login('ada', 'Password1!');
    expect(res).toEqual(session);
    expect(calls[0]).toEqual({ method: 'POST', path: '/auth/login', body: { identifier: 'ada', password: 'Password1!' } });
  });

  it('requestOtp / verifyOtp hit the OTP endpoints', async () => {
    const { client, calls } = stubClient();
    await authApi(client).requestOtp('ada@x');
    await authApi(client).verifyOtp('ada@x', '123456');
    expect(calls.map((c) => c.path)).toEqual(['/auth/otp/request', '/auth/otp/verify']);
    expect(calls[1]!.body).toEqual({ identifier: 'ada@x', code: '123456' });
  });

  it('a fingerprint key is asked for with the session’s refresh token, and comes with its id', async () => {
    const { client } = stubClient();
    const post = client.post as ReturnType<typeof vi.fn>;
    post.mockResolvedValueOnce({ data: { refreshToken: 'bio-key', keyId: 'k1' } });
    await expect(authApi(client).biometricCredential('rt-9')).resolves.toEqual({ key: 'bio-key', keyId: 'k1' });
    expect(post).toHaveBeenCalledWith('/auth/biometric-credential', { refreshToken: 'rt-9' });
  });

  it('a fingerprint key is cancelled on the server by its id, with the session’s refresh token', async () => {
    const { client, calls } = stubClient();
    await authApi(client).revokeBiometricCredential('rt-9', 'k1');
    expect(calls[0]).toEqual({ method: 'POST', path: '/auth/biometric-credential/revoke', body: { refreshToken: 'rt-9', keyId: 'k1' } });
  });

  it('logout posts the refresh token to /auth/logout so the server revokes it', async () => {
    const { client, calls } = stubClient();
    await authApi(client).logout('rt-9');
    expect(calls[0]).toEqual({ method: 'POST', path: '/auth/logout', body: { refreshToken: 'rt-9' } });
  });

  it('forgot/reset password hit the reset endpoints', async () => {
    const { client, calls } = stubClient();
    const sent = await authApi(client).forgotPassword('ada@x');
    expect(sent).toEqual({ sent: true });
    const reset = await authApi(client).resetPassword('tok', 'NewPass123');
    expect(reset).toEqual({ reset: true });
    expect(calls.map((c) => c.path)).toEqual(['/auth/password/forgot', '/auth/password/reset']);
  });
});

describe('SIGN_IN_LIMITS — the sign-in fields stop where the server does', () => {
  it('matches the server’s limits (auth-routes: identifier 191, password 200)', () => {
    expect(SIGN_IN_LIMITS.identifier).toBe(191);
    expect(SIGN_IN_LIMITS.password).toBe(200);
  });
  it('leaves room for any real server address', () => {
    expect('https://task.mico360.com'.length).toBeLessThan(SIGN_IN_LIMITS.serverAddress);
    expect(SIGN_IN_LIMITS.serverAddress).toBeGreaterThanOrEqual(255);
  });
});

describe('roleLabel — Profile shows role names, not codes', () => {
  it('names the two account roles as the website does', () => {
    expect(roleLabel('ADMIN')).toBe('Administrator');
    expect(roleLabel('EMPLOYEE')).toBe('Employee');
  });
  it('turns any other code into plain words', () => {
    expect(roleLabel('PROJECT_MANAGER')).toBe('Project manager');
    expect(roleLabel('guest')).toBe('Guest');
  });
});
