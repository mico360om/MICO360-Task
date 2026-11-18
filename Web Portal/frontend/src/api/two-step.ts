import type { ApiClient } from '../lib/api-client';

/** 1.24 two-step sign-in for administrators: its state, for Settings → Security and the red banner. */
export interface TwoStepStatus {
  on: boolean;
  /** Why it is off: ADMIN_TWO_STEP=off on the server, or no email at all. */
  reason: null | 'switched-off' | 'email-not-set-up';
  trustedBrowsers: number;
  /** Until when this browser skips the code (ISO), or null. */
  thisBrowserTrustedUntil: string | null;
}

export const TWO_STEP_KEY = ['two-step'] as const;

/** Under /auth: the browser's trusted-browser cookie (httpOnly) goes with them. */
export function twoStepApi(client: ApiClient) {
  return {
    status: () => client.get<{ data: TwoStepStatus }>('/auth/two-step', { credentials: 'include' }).then((r) => r.data),
    forgetAll: () => client.post<{ data: { forgotten: number } }>('/auth/two-step/forget', undefined, { credentials: 'include' }).then((r) => r.data),
  };
}
