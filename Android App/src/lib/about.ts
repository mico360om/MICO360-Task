/**
 * About on the phone (6b), as the website's About page: the website's version and when it was last
 * updated, this app's own version and build, and the version history with each release's new
 * features, improvements and bug fixes (administrators also see its security fixes, and the
 * technical details of what is deployed). The server decides who sees the security lines. Pure
 * TypeScript.
 */
import { toWallClock } from './meeting-form';
import type { AppInfo } from './app-version';

/** GET /version: the website's release (administrators also get the technical details). */
export interface DeployedVersion {
  version: string;
  /** When the running server was built at deployment (ISO). */
  deployedAt: string;
  commit?: string | null;
  source?: 'build' | 'development';
  nodeVersion?: string;
  uptimeSeconds?: number;
  environment?: string;
}

export interface ReleaseSections {
  features?: string[];
  improvements?: string[];
  fixes?: string[];
  /** Administrators only. */
  security?: string[];
}

/** One release of GET /releases. */
export interface ReleaseEntry {
  version: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  sections: ReleaseSections;
  /** For everyone but administrators: whether it had security fixes (listed to administrators only). */
  securityUpdates?: boolean;
}

/** The website's sections, in its order. */
export const RELEASE_SECTIONS: readonly { key: keyof ReleaseSections; title: string; adminOnly?: boolean }[] = [
  { key: 'features', title: 'New features' },
  { key: 'improvements', title: 'Improvements' },
  { key: 'security', title: 'Security', adminOnly: true },
  { key: 'fixes', title: 'Bug fixes' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-10-16' → '16 October 2026'. */
export function releaseDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : date;
}

/** "Oman Time" for the company's zone; another zone by its city: "Dubai time". */
export function zoneLabel(timeZone: string): string {
  if (timeZone === 'Asia/Muscat') return 'Oman Time';
  const city = timeZone.split('/').pop() ?? timeZone;
  return `${city.replace(/_/g, ' ')} time`;
}

/** "16/10/2026, 07:30 PM (Oman Time)": day/month/year and a 12-hour clock in the zone ('—' for no date). */
export function lastUpdatedText(iso: string, timeZone: string): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return '—';
  const wall = toWallClock(iso, timeZone);
  if (!wall) return '—';
  const [y, mo, d] = wall.day.split('-');
  const [h, mi] = wall.time.split(':').map(Number) as [number, number];
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${d}/${mo}/${y}, ${String(hour12).padStart(2, '0')}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} (${zoneLabel(timeZone)})`;
}

/** "v1.6.0 (build 16)". */
export const appVersionText = (app: AppInfo): string => `v${app.version} (build ${app.build})`;

/** How long the server has been running: "2d 5h", "1h 2m", "4m". */
export function uptimeText(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The technical details an administrator sees, as label and value. */
export function technicalDetails(v: DeployedVersion, timeZone: string): [string, string][] {
  const rows: [string, string][] = [
    ['Server', `v${v.version}, built ${lastUpdatedText(v.deployedAt, timeZone)}${v.source === 'development' ? ' (running from source: no build information)' : ''}`],
    ['Code revision', v.commit ?? 'not recorded'],
  ];
  if (v.environment) rows.push(['Environment', v.environment]);
  if (v.nodeVersion) rows.push(['Node.js', v.nodeVersion]);
  if (typeof v.uptimeSeconds === 'number') rows.push(['Running for', uptimeText(v.uptimeSeconds)]);
  return rows;
}

/** A release's sections with something in them; Security for administrators only. */
export function releaseSections(r: ReleaseEntry, isAdmin: boolean): { title: string; items: string[] }[] {
  return RELEASE_SECTIONS.filter((s) => !s.adminOnly || isAdmin)
    .map((s) => ({ title: s.title, items: Array.isArray(r.sections?.[s.key]) ? r.sections[s.key]! : [] }))
    .filter((s) => s.items.length > 0);
}

/** "Current" on the website's version, "This app" on the version this phone runs. */
export function releaseBadges(r: ReleaseEntry, { serverVersion, appVersion }: { serverVersion: string | null | undefined; appVersion: string }): string[] {
  return [r.version === serverVersion ? 'Current' : null, r.version === appVersion ? 'This app' : null].filter((b): b is string => !!b);
}

/** What TalkBack reads for a release's heading. */
export function releaseHeadingLabel(r: ReleaseEntry, badges: string[]): string {
  return [`Version ${r.version}`, releaseDay(r.date), ...badges.map((b) => b.toLowerCase())].join(', ');
}
