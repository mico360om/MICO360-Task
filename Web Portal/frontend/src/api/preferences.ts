import type { ApiClient } from '../lib/api-client';

/** A person's own date settings; null = the default (company time zone, weeks starting Sunday). */
export interface DatePreferences {
  timeZone: string | null;
  weekStart: 0 | 1 | 6 | null;
  /** "Show my projects only" (1.22, an administrator's own; off by default) — lib/useMyProjectsOnly.ts. */
  myProjectsOnly?: boolean;
  /** Rows: comfortable (default), compact (1.23.0) or detailed (1.23.8), anyone's own — lib/density.ts. */
  density?: 'comfortable' | 'compact' | 'detailed';
  /** 1.23.8: the side menu folded to its icons on a desktop screen (open by default) — lib/appearance.ts. */
  sidebarCollapsed?: boolean;
  /** 1.23.8: the board's column width for this person (normal by default) — lib/appearance.ts. */
  boardColumnWidth?: 'narrow' | 'normal' | 'wide';
}

/**
 * Changes to these settings go to the server one after the other (TanStack's mutation scope), so two
 * quick changes — a double click on "Compact rows", a week start and a density — arrive in order and
 * the last one is what the account keeps.
 */
export const PREFERENCES_SCOPE = { id: 'my-preferences' } as const;

export function preferencesApi(client: ApiClient) {
  return {
    get: () => client.get<{ data: DatePreferences }>('/users/me/preferences').then((r) => r.data),
    set: (patch: Partial<DatePreferences>) => client.put<{ data: DatePreferences }>('/users/me/preferences', patch).then((r) => r.data),
  };
}
