import type { ApiClient } from '../lib/api-client';

/** A person's own date settings; null = the default (company time zone, weeks starting Sunday). */
export interface DatePreferences {
  timeZone: string | null;
  weekStart: 0 | 1 | 6 | null;
  /** "Show my projects only" (1.22, an administrator's own; off by default) — lib/useMyProjectsOnly.ts. */
  myProjectsOnly?: boolean;
  /** Compact / comfortable rows (1.23.0, anyone's own; comfortable by default) — lib/density.ts. */
  density?: 'comfortable' | 'compact';
}

export function preferencesApi(client: ApiClient) {
  return {
    get: () => client.get<{ data: DatePreferences }>('/users/me/preferences').then((r) => r.data),
    set: (patch: Partial<DatePreferences>) => client.put<{ data: DatePreferences }>('/users/me/preferences', patch).then((r) => r.data),
  };
}
