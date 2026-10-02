import type { ApiClient } from '../lib/api-client';

export interface AppConfig {
  /** Company IANA time zone — the single source of truth for date/time display. */
  timeZone: string;
  productName: string;
  companyName: string;
  /** Server clock at the time of the response (ISO) — used to anchor the client clock. */
  serverTime: string;
  /** False when outbound email isn't configured — email sign-in codes and reset emails can't be sent. */
  emailEnabled?: boolean;
  /** Configured "Download for Android" link, or null (see lib/android-app-link). */
  androidAppUrl?: string | null;
}

export function configApi(client: ApiClient) {
  return {
    get: () => client.get<{ data: AppConfig }>('/config').then((r) => r.data),
  };
}
