/**
 * A person's own Calendar choices, remembered on the server so they follow them to any computer: the
 * split view (the calendar left, the chosen day's list right) or the full width, what the calendar shows
 * (tasks, meetings, work blocks, reminders), and — for whoever runs projects — the Team blocks.
 */
export interface CalendarPrefs {
  layout: 'split' | 'full';
  show: { tasks: boolean; meetings: boolean; blocks: boolean; reminders: boolean };
  team: boolean;
}

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = Object.freeze({
  layout: 'split',
  show: Object.freeze({ tasks: true, meetings: true, blocks: true, reminders: true }),
  team: false,
}) as CalendarPrefs;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Stored or sent JSON → whole, valid choices (unknown keys dropped, the defaults filling gaps). */
export function normalizeCalendarPrefs(input: unknown, base: CalendarPrefs = DEFAULT_CALENDAR_PREFS): CalendarPrefs {
  const raw = obj(input);
  const show = obj(raw.show);
  return {
    layout: raw.layout === 'full' || raw.layout === 'split' ? raw.layout : base.layout,
    show: {
      tasks: bool(show.tasks, base.show.tasks),
      meetings: bool(show.meetings, base.show.meetings),
      blocks: bool(show.blocks, base.show.blocks),
      reminders: bool(show.reminders, base.show.reminders),
    },
    team: bool(raw.team, base.team),
  };
}
