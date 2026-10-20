import type { DateZones } from './due-date';

/** The company's time zone when the server doesn't say (and the app's default). */
const FALLBACK_TIME_ZONE = 'Asia/Muscat';

/** Where the phone keeps the last zones it loaded, for the next start (and when offline). */
export const DATE_ZONES_KEY = 'mico360.dateZones';

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
 * The zones after loading the server's settings and yours (null = that load failed: offline, a
 * Wi-Fi sign-in page). A failed load keeps what the phone had; a missing or unknown company zone
 * is Asia/Muscat, and an unknown own zone counts as none (the company's is used).
 */
export function nextDateZones(prev: DateZones, loaded: { config: ServerConfig | null; prefs: DatePreferences | null }): DateZones {
  const company = loaded.config ? (isValidTimeZone(loaded.config.timeZone) ? loaded.config.timeZone : FALLBACK_TIME_ZONE) : prev.company;
  const own = loaded.prefs ? (isValidTimeZone(loaded.prefs.timeZone) ? loaded.prefs.timeZone : null) : prev.own;
  return { company, own };
}

/** The zones saved by an earlier start, or null when there are none (or they are unusable). */
export function parseDateZones(raw: string | null): DateZones | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { company, own } = v as { company?: unknown; own?: unknown };
  if (!isValidTimeZone(company)) return null;
  return { company, own: isValidTimeZone(own) ? own : null };
}

/** The server's public settings (GET /config) the app uses. */
export interface ServerConfig {
  timeZone?: string;
  emailEnabled?: boolean;
  /** Where the Android app can be downloaded (the site's /downloads page by default). */
  androidAppUrl?: string | null;
  /** The version inside the app file the site offers (null: none); absent from older servers. */
  androidAppVersion?: string | null;
}

/** Your own date settings (GET /users/me/preferences), shared with the website. */
export interface DatePreferences {
  timeZone: string | null;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday; null = the company's. Used by the calendar (later). */
  weekStart: 0 | 1 | 6 | null;
}
