import type { DateZones } from './due-date';
import { TIME_ZONES } from './time-zones';

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
  /** 0 = Sunday, 1 = Monday, 6 = Saturday; null = the default (Sunday). The calendar's first column. */
  weekStart: 0 | 1 | 6 | null;
}

// ── Settings → Calendar & dates (6a), as the website's DatePreferences ─────────

/** The first day of the week, in the website's order. */
export const WEEK_START_OPTIONS: { value: 0 | 1 | 6; label: string }[] = [
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

/** Your date settings with one choice changed (PUT /users/me/preferences changes only what it names). */
export function withDatePatch(prev: DatePreferences | null | undefined, patch: Partial<DatePreferences>): DatePreferences {
  return { timeZone: prev?.timeZone ?? null, weekStart: prev?.weekStart ?? null, ...patch };
}

/** What was saved, for TalkBack (a new time zone opens the screens again, so the change is said). */
export function datePrefsSavedText(before: DatePreferences | null | undefined, saved: DatePreferences): string {
  const parts = ['Saved.'];
  const week = (p: DatePreferences | null | undefined) => (p?.weekStart === 1 || p?.weekStart === 6 ? p.weekStart : 0);
  if (!before || week(before) !== week(saved)) parts.push(`Weeks start on ${WEEK_START_OPTIONS.find((o) => o.value === week(saved))!.label}.`);
  if (before && (before.timeZone ?? null) !== (saved.timeZone ?? null)) {
    parts.push(saved.timeZone ? `The calendar uses ${saved.timeZone}.` : 'The calendar uses the company time zone.');
  }
  return parts.join(' ');
}

/** Which zone the calendar uses, in the website's words. */
export function calendarZoneNote(own: string | null, company: string): string {
  return `${own ? `Your own: ${own}. ` : `Dates use the company time zone (${company}). `}Due dates without a time always stay on their day.`;
}

/** The time zone this phone is set to, when it says and it is a real zone (else null). */
export function deviceTimeZone(read: () => string | undefined = () => new Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  try {
    const tz = read();
    return isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** The zones this phone knows: the full list where its JavaScript can say, else the app's own list. */
export function supportedTimeZones(intl: { supportedValuesOf?: (key: string) => string[] } = Intl as never): string[] {
  let all: string[] | undefined;
  try {
    all = intl.supportedValuesOf?.('timeZone');
  } catch {
    all = undefined;
  }
  return (all?.length ? all : [...TIME_ZONES]).filter(isValidTimeZone);
}

/**
 * The zones to choose from, labelled as the website does ("America/New York"), with the company's
 * and this phone's marked; the one you chose is always there, even when the list doesn't have it.
 */
export function timeZoneChoices(opts: { zones: readonly string[]; company: string; own: string | null; device: string | null }): { value: string; label: string; hint?: string }[] {
  const all = [...new Set([...opts.zones, ...(opts.own ? [opts.own] : []), opts.company])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return all.map((z) => {
    const marks = [z === opts.company ? 'company' : null, z === opts.device ? 'this phone' : null].filter(Boolean);
    return { value: z, label: z.replace(/_/g, ' '), ...(marks.length ? { hint: marks.join(' · ') } : {}) };
  });
}
