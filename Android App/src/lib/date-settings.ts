/** The company's time zone when the server doesn't say (and the app's default). */
const FALLBACK_TIME_ZONE = 'Asia/Muscat';

/** A real IANA time zone name this device can use. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The time zone the app shows dates in, as the web portal does: your own (Settings → Date and
 * time on the website), else the company's (the server's /config), else Asia/Muscat.
 */
export function resolveTimeZone({ company, own }: { company?: string | null; own?: string | null }): string {
  if (isValidTimeZone(own)) return own;
  if (isValidTimeZone(company)) return company;
  return FALLBACK_TIME_ZONE;
}

/** The server's public settings (GET /config) the app uses. */
export interface ServerConfig {
  timeZone?: string;
  emailEnabled?: boolean;
  /** Where the Android app can be downloaded (the site's /downloads page by default). */
  androidAppUrl?: string | null;
}

/** Your own date settings (GET /users/me/preferences), shared with the website. */
export interface DatePreferences {
  timeZone: string | null;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday; null = the company's. Used by the calendar (later). */
  weekStart: 0 | 1 | 6 | null;
}
