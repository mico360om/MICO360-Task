import { describe, it, expect, vi } from 'vitest';
import { authApi } from './auth';
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

  it('forgot/reset password hit the reset endpoints', async () => {
    const { client, calls } = stubClient();
    const sent = await authApi(client).forgotPassword('ada@x');
    expect(sent).toEqual({ sent: true });
    const reset = await authApi(client).resetPassword('tok', 'NewPass123');
    expect(reset).toEqual({ reset: true });
    expect(calls.map((c) => c.path)).toEqual(['/auth/password/forgot', '/auth/password/reset']);
  });
});
