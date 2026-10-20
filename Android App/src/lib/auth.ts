import type { ApiClient } from './api-client';
import type { Envelope, Session } from './types';

/** Auth API calls for the mobile app (login, passwordless OTP, forgot/reset). */
export function authApi(client: ApiClient) {
  return {
    login: (identifier: string, password: string) =>
      client.post<Envelope<Session>>('/auth/login', { identifier, password }).then((r) => r.data),

    /** Exchange a refresh token for a fresh session. */
    refresh: (refreshToken: string) =>
      client.post<Envelope<Session>>('/auth/refresh', { refreshToken }).then((r) => r.data),

    /**
     * A fingerprint sign-in key for this phone, asked for with the session's refresh token (checked,
     * not spent); kept behind the biometric-bound keystore. Its keyId cancels it later.
     */
    biometricCredential: (refreshToken: string) =>
      client
        .post<Envelope<{ refreshToken: string; keyId: string }>>('/auth/biometric-credential', { refreshToken })
        .then((r) => ({ key: r.data.refreshToken, keyId: r.data.keyId })),

    /** Cancel this phone's fingerprint key on the server (turned off, replaced, or its prompt cancelled). */
    revokeBiometricCredential: (refreshToken: string, keyId: string) =>
      client.post<Envelope<{ ok: true }>>('/auth/biometric-credential/revoke', { refreshToken, keyId }).then((r) => r.data),

    /** Sign in with the phone's fingerprint key: a new session; the key itself isn't spent. */
    biometricSignIn: (credential: string) =>
      client.post<Envelope<Session>>('/auth/biometric-sign-in', { credential }).then((r) => r.data),

    /** Server-side sign-out: revoke the refresh token so it can never mint a session again (MOB-01). */
    logout: (refreshToken: string) =>
      client.post<Envelope<{ ok: true }>>('/auth/logout', { refreshToken }).then((r) => r.data),

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
