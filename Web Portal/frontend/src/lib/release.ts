/**
 * The app's version and update time, as shown in every page's footer and on the About page. Both
 * come from the builds (the server's build at deployment, and this web app's own build), never from
 * the browser's clock.
 */

/** This page's own build: its version and build time, set by the build (vite.config.ts). */
export const RUNNING_BUILD = { version: __APP_VERSION__, builtAt: __APP_BUILT_AT__ };

/** "Oman Time" for the company's zone; another zone by its city: "Dubai time". */
export function zoneLabel(timeZone: string): string {
  if (timeZone === 'Asia/Muscat') return 'Oman Time';
  const city = timeZone.split('/').pop() ?? timeZone;
  return `${city.replace(/_/g, ' ')} time`;
}

/** "16/10/2026, 07:30 PM (Oman Time)": day/month/year, a 12-hour clock, in the company's zone. */
export function formatLastUpdated(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return '—';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === '24' ? '12' : parts.hour;
  return `${parts.day}/${parts.month}/${parts.year}, ${hour}:${parts.minute} ${(parts.dayPeriod ?? '').toUpperCase()} (${zoneLabel(timeZone)})`;
}

export interface WebBuild {
  version: string;
  builtAt: string;
}

/** Has a newer web app been deployed than the one this page is running? (Unknown → no.) */
export function isStaleBundle(running: WebBuild, deployed: WebBuild | null | undefined): boolean {
  if (!deployed?.builtAt) return false;
  return deployed.builtAt !== running.builtAt || deployed.version !== running.version;
}
