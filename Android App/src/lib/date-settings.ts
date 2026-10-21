import type { FetchStatus, QueryClient } from '@tanstack/react-query';
import type { DateZones } from './due-date';
import { TIME_ZONES } from './time-zones';

/** Where your date settings are kept in the app (the calendar's week start reads them). */
export const DATE_PREFERENCES_KEY = ['settings', 'date-preferences'];
/** Their offline copy (kept for a start without a connection). */
export const DATE_PREFERENCES_COPY = 'date-preferences';

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
 * Zones with two spellings: this phone's (the current IANA name) and the website's (the older name
 * the server's and browsers' lists still use). A zone saved on either is the same zone (6a review).
 */
const WEB_ZONE_NAME: Record<string, string> = {
  'Asia/Kolkata': 'Asia/Calcutta',
  'Asia/Ho_Chi_Minh': 'Asia/Saigon',
  'Asia/Kathmandu': 'Asia/Katmandu',
  'Asia/Yangon': 'Asia/Rangoon',
  'Europe/Kyiv': 'Europe/Kiev',
  'America/Argentina/Buenos_Aires': 'America/Buenos_Aires',
};
const PHONE_ZONE_NAME: Record<string, string> = Object.fromEntries(Object.entries(WEB_ZONE_NAME).map(([phone, web]) => [web, phone]));

/** A zone as the website spells it (what is offered and saved). */
export function webZoneName(tz: string): string {
  return WEB_ZONE_NAME[tz] ?? tz;
}

/** The zone in a spelling this phone knows (either one), or null when it knows neither. */
export function usableZone(tz: unknown, valid: (tz: unknown) => boolean = isValidTimeZone): string | null {
  if (typeof tz !== 'string' || !tz.trim()) return null;
  if (valid(tz)) return tz;
  const other = WEB_ZONE_NAME[tz] ?? PHONE_ZONE_NAME[tz];
  return other && valid(other) ? other : null;
}

/** Said in Settings when your saved zone (from the website) is one this phone doesn't know. */
export function unknownZoneNote(saved: string | null | undefined, company: string, valid: (tz: unknown) => boolean = isValidTimeZone): string | null {
  if (!saved || usableZone(saved, valid)) return null;
  return `Your time zone (${saved}) isn’t known to this phone, so the calendar here uses the company time zone (${company}).`;
}

/**
 * The zones after loading the server's settings and yours (null = that load failed: offline, a
 * Wi-Fi sign-in page). A failed load keeps what the phone had; a missing or unknown company zone
 * is Asia/Muscat, and an unknown own zone counts as none (the company's is used; Settings says so).
 * A zone is used in whichever spelling this phone knows.
 */
export function nextDateZones(prev: DateZones, loaded: { config: ServerConfig | null; prefs: DatePreferences | null }, valid: (tz: unknown) => boolean = isValidTimeZone): DateZones {
  const company = loaded.config ? (usableZone(loaded.config.timeZone, valid) ?? FALLBACK_TIME_ZONE) : prev.company;
  const own = loaded.prefs ? usableZone(loaded.prefs.timeZone, valid) : prev.own;
  return { company, own };
}

export interface DateSettingsLoad {
  qc: QueryClient;
  /** GET /config. */
  config: () => Promise<ServerConfig>;
  /** GET /users/me/preferences through its offline copy (the calendar's own read). */
  readPrefs: () => Promise<DatePreferences>;
  /** Keep the zones for the next start. */
  keepZones: (zones: DateZones) => Promise<void>;
  zones: { get: () => DateZones; set: (next: DateZones) => void };
  /** False once the load is no longer wanted (signed out meanwhile). */
  isActive?: () => boolean;
}

/**
 * Load the server's settings and yours (signed in, and each time the app comes back to the front):
 * the zones are set and kept, and your settings go where the calendar reads them, so it opens with
 * your week start at once instead of starting on Sunday and asking for its days twice (5a review).
 * Asked again every time — they may have changed on the website.
 */
export async function loadDateSettings(d: DateSettingsLoad): Promise<void> {
  const [config, prefs] = await Promise.all([
    d.config().catch(() => null),
    // Kept for the whole session: the calendar opened later still has them at once.
    d.qc.fetchQuery({ queryKey: DATE_PREFERENCES_KEY, queryFn: () => d.readPrefs(), staleTime: 0, gcTime: Infinity }).catch(() => null),
  ]);
  if ((d.isActive && !d.isActive()) || (!config && !prefs)) return;
  const next = nextDateZones(d.zones.get(), { config, prefs });
  d.zones.set(next);
  await d.keepZones(next).catch(() => {});
}

/** Does the calendar know how its weeks are laid out: your settings are here, or their load ended without them? */
export function weekStartKnown(q: { data: DatePreferences | null | undefined; fetchStatus: FetchStatus }): boolean {
  return q.data != null || q.fetchStatus !== 'fetching';
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

/**
 * What was saved, for TalkBack (a new time zone opens the screens again, so the change is said).
 * With nothing loaded before the save, both settings are said (6a review).
 */
export function datePrefsSavedText(before: DatePreferences | null | undefined, saved: DatePreferences): string {
  const parts = ['Saved.'];
  const week = (p: DatePreferences | null | undefined) => (p?.weekStart === 1 || p?.weekStart === 6 ? p.weekStart : 0);
  if (!before || week(before) !== week(saved)) parts.push(`Weeks start on ${WEEK_START_OPTIONS.find((o) => o.value === week(saved))!.label}.`);
  if (!before || (before.timeZone ?? null) !== (saved.timeZone ?? null)) {
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

/** A list worked out only when first asked for, then kept (checking each zone costs a formatter apiece). */
export function createZoneList(compute: () => string[]): () => string[] {
  let kept: string[] | null = null;
  return () => {
    if (!kept) kept = compute();
    return kept;
  };
}

/** This phone's zones, worked out once per app run (Settings opened again doesn't redo it — 6a review). */
export const phoneTimeZones = createZoneList(() => supportedTimeZones());

/**
 * The zones to choose from, in the website's spelling and labelled as it does ("America/New
 * York"), with the company's and this phone's marked; the one you chose and this phone's own are
 * always there, even when the list doesn't have them.
 */
export function timeZoneChoices(opts: { zones: readonly string[]; company: string; own: string | null; device: string | null }): { value: string; label: string; hint?: string }[] {
  const company = webZoneName(opts.company);
  const device = opts.device ? webZoneName(opts.device) : null;
  const all = [...new Set([...opts.zones, ...(opts.own ? [opts.own] : []), opts.company, ...(opts.device ? [opts.device] : [])].map(webZoneName))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return all.map((z) => {
    const marks = [z === company ? 'company' : null, z === device ? 'this phone' : null].filter(Boolean);
    return { value: z, label: z.replace(/_/g, ' '), ...(marks.length ? { hint: marks.join(' · ') } : {}) };
  });
}
