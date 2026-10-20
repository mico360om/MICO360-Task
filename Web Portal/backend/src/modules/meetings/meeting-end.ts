/** A meeting without an end time lasts this long (as the app shows it). */
export const MEETING_DEFAULT_LENGTH_MS = 60 * 60 * 1000;

/** Has the meeting ended by `now`? Its end time, else an hour after it starts. */
export function meetingHasEnded(m: { startAt: Date; endAt: Date | null }, now: Date): boolean {
  const end = m.endAt ? m.endAt.getTime() : m.startAt.getTime() + MEETING_DEFAULT_LENGTH_MS;
  return end <= now.getTime();
}

/**
 * The status to show: a scheduled or started meeting that is over is Completed (the sweep stores
 * that every few minutes; this says so in between). Every other status is shown as it is.
 */
export function shownMeetingStatus<S extends string>(m: { status: S; startAt: Date; endAt: Date | null }, now: Date): S | 'COMPLETED' {
  return (m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS') && meetingHasEnded(m, now) ? 'COMPLETED' : m.status;
}
