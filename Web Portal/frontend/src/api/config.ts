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
  /** The company's week start (0 Sunday, 1 Monday, 6 Saturday): everyone's until they choose their own. */
  weekStart?: 0 | 1 | 6;
  /** The weekly management summary is on for the company (an administrator can turn it off for everyone). */
  weeklySummaryEnabled?: boolean;
}

export function configApi(client: ApiClient) {
  return {
    get: () => client.get<{ data: AppConfig }>('/config').then((r) => r.data),
  };
}
