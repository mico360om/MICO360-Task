/** Plain words for System Settings → Backups. */

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** "30 Oct 2026, 02:01" in the company time zone. */
export function copyWhen(iso: string, timeZone: string): string {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formats.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

export function scheduleText(nightly: { enabled: boolean; hour: number; timeZone: string }): string {
  if (!nightly.enabled) return 'Nightly copies are turned off on this server. You can still make one with Back up now.';
  const at = `${String(nightly.hour).padStart(2, '0')}:00`;
  return `Every night at ${at} (${nightly.timeZone} time) the server copies the whole database and every uploaded file. It keeps the last 7 nights, one copy a week for the 4 weeks before, and the 3 newest copies made with Back up now.`;
}

/** What to say when Google sends the administrator back (?drive=…). */
export function driveResultNote(result: string | null): { ok: boolean; text: string } | null {
  if (result === 'connected') return { ok: true, text: 'Google Drive is connected. Each new copy will also go there.' };
  if (result === 'denied') return { ok: false, text: 'Google Drive wasn’t connected: access wasn’t allowed on Google’s page.' };
  if (result === 'failed') return { ok: false, text: 'Google Drive couldn’t be connected. Please try again.' };
  return null;
}
