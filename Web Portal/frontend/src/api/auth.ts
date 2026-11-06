import type { ApiClient } from '../lib/api-client';

export function authApi(client: ApiClient) {
  return {
    forgotPassword: (identifier: string) =>
      client.post<{ data: { sent: true } }>('/auth/password/forgot', { identifier }).then((r) => r.data),
    resetPassword: (token: string, password: string) =>
      client.post<{ data: { reset: true } }>('/auth/password/reset', { token, password }).then((r) => r.data),
    /** Onboarding: what a set-password link is (live, expired, used), asked before a password is typed. */
    linkStatus: (token: string) => client.post<{ data: LinkStatus }>('/auth/password/link-status', { token }).then((r) => r.data),
  };
}

/** Onboarding: a set-password link's state, and the company to ask for a new one. */
export interface LinkStatus {
  kind: 'welcome' | 'reset' | null;
  state: 'live' | 'expired' | 'used' | 'unknown';
  company: string | null;
}

/** Onboarding: the emailed-code step of a sign-in (the password was right). Never the code. */
export interface SignInChallenge {
  /** Sent back with the code (or to ask for another). Kept in memory only. */
  token: string;
  kind: 'VERIFY_EMAIL';
  /** "a•••@oxy.com" */
  sentTo: string;
  /** False when signing in again reused the open step: the code already sent still works. */
  codeSent: boolean;
  resendAt: string;
  expiresAt: string;
}

export interface ChallengeResend {
  codeSent: boolean;
  resendAt: string;
  expiresAt: string;
  retryAfterSeconds?: number;
}
