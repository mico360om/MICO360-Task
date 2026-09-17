import type { ApiClient } from './api-client';
import type { Envelope, Session } from './types';

/** Auth API calls for the mobile app (login, passwordless OTP, forgot/reset). */
export function authApi(client: ApiClient) {
  return {
    login: (identifier: string, password: string) =>
      client.post<Envelope<Session>>('/auth/login', { identifier, password }).then((r) => r.data),

    /** Exchange a stored refresh token for a fresh session (used by biometric login). */
    refresh: (refreshToken: string) =>
      client.post<Envelope<Session>>('/auth/refresh', { refreshToken }).then((r) => r.data),

    requestOtp: (identifier: string) =>
      client.post<Envelope<{ sent: true }>>('/auth/otp/request', { identifier }).then((r) => r.data),
    verifyOtp: (identifier: string, code: string) =>
      client.post<Envelope<Session>>('/auth/otp/verify', { identifier, code }).then((r) => r.data),

    forgotPassword: (identifier: string) =>
      client.post<Envelope<{ sent: true }>>('/auth/password/forgot', { identifier }).then((r) => r.data),
    resetPassword: (token: string, password: string) =>
      client.post<Envelope<{ reset: true }>>('/auth/password/reset', { token, password }).then((r) => r.data),
  };
}
