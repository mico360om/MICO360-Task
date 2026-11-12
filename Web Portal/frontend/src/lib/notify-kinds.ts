import type { PolicyKind } from '../api/notification-settings';
import { shiftDay, weekdayOf, zonedClock, zonedInstant } from './working-days';

/** How each kind of notice is named in Settings and in System Settings → Notification & Scheduling. */
export const KIND_WORDS: Record<PolicyKind, { label: string; desc: string }> = {
  assigned: { label: 'Assigned to me', desc: 'A task or checklist item is given to you' },
  dueSoon: { label: 'Approaching deadlines', desc: 'Before a task is due, by its reminder schedule' },
  reminders: { label: 'My reminders', desc: 'Reminders you set on tasks, or that whoever runs the project set for you' },
  overdue: { label: 'Overdue tasks', desc: 'A task of yours is late, every few working days' },
  escalation: { label: 'Escalations (projects I run)', desc: 'A task in a project you run is overdue or Blocked' },
  escalationAdmin: { label: 'Escalations to admins', desc: 'A task still overdue (or an approval still waiting) after the second step' },
  approvals: { label: 'Approvals and client sign-off', desc: 'A task waits for your approval, yours is approved or sent back, a client signs off' },
  approvalWaiting: { label: 'Approvals waiting too long', desc: 'A task has waited several working days for your approval' },
  inactivity: { label: 'Tasks with no activity', desc: 'A started task has had no comment, change or tick for several working days' },
  mentions: { label: '@mentions', desc: 'Someone mentions you in a comment or a chat' },
  comments: { label: 'Comments', desc: 'New comments and replies on tasks you’re on' },
  status: { label: 'Task moved', desc: 'One of your tasks moves column or project' },
  projectAdded: { label: 'Added to a project', desc: 'Someone puts you on a project’s team or makes you its owner' },
  meetings: { label: 'Meeting reminders', desc: 'Before each meeting you organize or are invited to' },
  training: { label: 'Training', desc: 'Courses assigned to you, due dates, certificates expiring and answers to your questions' },
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun–Thu" (or "Sun, Tue, Thu") for working days. */
export function workingDaysText(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return 'no working days';
  const run = sorted.length > 1 && sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return run ? `${SHORT_DAYS[sorted[0]!]}–${SHORT_DAYS[sorted.at(-1)!]}` : sorted.map((d) => SHORT_DAYS[d]).join(', ');
}

/** The Pause choices, each until an instant in the person's own time zone: an hour, the rest of today, until the week starts again. */
export function pauseChoices(now: Date, zone: string, weekStart: 0 | 1 | 6): { key: string; label: string; until: string }[] {
  const { day } = zonedClock(now, zone);
  const tomorrow = zonedInstant(shiftDay(day, 1), '00:00', zone);
  let next = shiftDay(day, 1);
  while (weekdayOf(next) !== weekStart) next = shiftDay(next, 1);
  return [
    { key: 'hour', label: '1 hour', until: new Date(now.getTime() + 60 * 60_000).toISOString() },
    { key: 'today', label: 'Rest of today', until: tomorrow.toISOString() },
    { key: 'week', label: `Until ${WEEKDAYS[weekStart]}`, until: zonedInstant(next, '00:00', zone).toISOString() },
  ];
}

/** "Sun 15 Nov, 08:00" — an instant in a time zone, the site's way. */
export function momentText(iso: string, zone: string): string {
  const { day, minutes } = zonedClock(new Date(iso), zone);
  const d = new Date(`${day}T12:00:00Z`);
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
