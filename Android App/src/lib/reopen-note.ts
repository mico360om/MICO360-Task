/**
 * A new time zone opens every screen again (so each date follows at once). Before it is saved the
 * phone says so — anything not saved on other screens is lost — and afterwards the reopened
 * Settings returns to Calendar & dates and says what was saved, from a note left for it here
 * (6a review). Pure TypeScript.
 */
import type { DateZones } from './due-date';

export interface ReopenNote {
  /** Where Settings returns to. */
  section: 'dates';
  /** What TalkBack says once the screens have reopened. */
  announce: string;
}

export function zoneChangeQuestion(tz: string | null): { title: string; message: string; confirm: string } {
  return {
    title: tz ? `Use ${tz} for the calendar?` : 'Use the company time zone for the calendar?',
    message: 'The app reloads its screens to show every date in the new time zone. Anything you haven’t saved on other screens is lost.',
    confirm: 'Change time zone',
  };
}

/** Will the screens open again (the zones they use change)? */
export function zonesDiffer(a: DateZones, b: DateZones): boolean {
  return a.company !== b.company || (a.own ?? null) !== (b.own ?? null);
}

/** One note for the reopened Settings, taken once; one nobody took soon is forgotten. */
export function createReopenNote({ now = Date.now, keepMs = 10_000 }: { now?: () => number; keepMs?: number } = {}) {
  let held: { note: ReopenNote; at: number } | null = null;
  return {
    leave(note: ReopenNote): void {
      held = { note, at: now() };
    },
    take(): ReopenNote | null {
      const h = held;
      held = null;
      return h && now() - h.at <= keepMs ? h.note : null;
    },
  };
}

/** The app's one note (left by the date settings' save, taken by the reopened Settings). */
export const reopenNote = createReopenNote();
