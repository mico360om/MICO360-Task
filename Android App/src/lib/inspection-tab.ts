import { dueText, lateText, upcomingText } from './inspection-schedule';
import { INSPECTION_LIMITS } from './inspection-rules';
import type { DueCheck, Person } from './inspection-types';
import type { WaitingInspection } from './inspection-outbox';

/**
 * A project's Inspections tab, as the website's (`ProjectInspectionsTab.tsx`, `ScheduledInspections.tsx`):
 * the due checks grouped late / today / upcoming, who inspects, the banner for inspections still on
 * this phone, the first-run invitation and Start's checks — and the words.
 */

/** The open checks, as the website groups them: late ones, then today's, then the rest (made ahead of their day). */
export function dueCheckGroups(checks: DueCheck[], today: string): { late: DueCheck[]; today: DueCheck[]; upcoming: DueCheck[] } {
  return {
    late: checks.filter((c) => c.state === 'LATE'),
    today: checks.filter((c) => c.state !== 'LATE' && c.dueDate === today),
    upcoming: checks.filter((c) => c.state !== 'LATE' && c.dueDate !== today),
  };
}

/** When a check is: "3 days late" (danger), "Due today" (strong), "Tomorrow" / "Wed 4 Nov" (plain). */
export function dueCheckWhen(c: DueCheck, today: string): { tone: 'danger' | 'strong' | 'plain'; text: string } {
  if (c.state === 'LATE') return { tone: 'danger', text: lateText(c.daysLate) };
  if (c.dueDate === today) return { tone: 'strong', text: dueText(c.dueDate, today) };
  return { tone: 'plain', text: upcomingText(c.dueDate, today) };
}

const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Who does the checks: "Ann Lee" / "Ann Lee +2" on screen, every name for TalkBack. */
export function inspectorsText(people: Person[]): { text: string; label: string } {
  if (!people.length) return { text: INSPECTIONS_TAB_WORDS.noInspector, label: INSPECTIONS_TAB_WORDS.noInspector };
  return { text: people.length === 1 ? people[0]!.name : `${people[0]!.name} +${people.length - 1}`, label: `Inspectors: ${listNames(people.map((p) => p.name))}` };
}

/** "1 inspection has changes saved on this phone, waiting to be sent: Rig check." (null: none). */
export function waitingBannerText(w: WaitingInspection[]): string | null {
  if (!w.length) return null;
  return `${w.length === 1 ? '1 inspection has' : `${w.length} inspections have`} changes saved on this phone, waiting to be sent: ${w.map((x) => x.title).join(', ')}.`;
}

/**
 * A project that has never had an inspection, nor a form to start one from: one invitation instead
 * of empty boxes. Only once every list has loaded (`undefined`: not yet, or it failed).
 */
export function isFirstRun(o: { inspections: unknown[] | undefined; forms: unknown[] | undefined; checks: unknown[] | undefined; schedules: unknown[] | undefined; waiting: number }): boolean {
  const empty = (x: unknown[] | undefined) => Array.isArray(x) && x.length === 0;
  return empty(o.inspections) && empty(o.forms) && empty(o.checks) && empty(o.schedules) && o.waiting === 0;
}

/** What is wrong with a Start (null: it can go). */
export function startCheck(formId: string, place: string): string | null {
  if (!formId) return INSPECTIONS_TAB_WORDS.pickForm;
  if (place.trim().length > INSPECTION_LIMITS.placeMax) return `A place can have at most ${INSPECTION_LIMITS.placeMax} characters.`;
  return null;
}

/** The tab's words, the website's ("even if the app closes" for its page reload). */
export const INSPECTIONS_TAB_WORDS = {
  intro: 'Checklists carried out on this project, with their reports.',
  manageForms: 'Manage forms',
  start: 'Start an inspection',
  emptyTitle: 'No inspections on this project yet',
  /** The first-run text: this, then `emptyCanCreate` or `emptyAsk`. */
  emptyBase: 'Inspections are checklists done on site — Pass / Fail items, readings and signatures — that end in a report. They start from a form',
  emptyCanCreate: ': make the first one, then start an inspection here or schedule regular checks.',
  emptyAsk: '. Ask an administrator or whoever runs a project to make one.',
  makeForm: 'Make an inspection form',
  loadFailed: 'Couldn’t load the inspections.',
  retry: 'Retry',
  inProgress: 'In progress',
  noneInProgress: 'None in progress.',
  finished: 'Finished',
  noneFinished: 'No finished inspections yet.',
  doneLate: 'Done late · {n} {days}',
  visibleToClient: 'Visible to client',
  dueChecks: 'Due checks',
  checksLoadFailed: 'Couldn’t load the due checks.',
  noChecks: 'No checks are due. Scheduled checks appear here on their day.',
  late: 'Late',
  dueToday: 'Due today',
  upcoming: 'Upcoming',
  doingIt: '{name} is doing it',
  formDeleted: 'Form deleted — this check can still be done.',
  continue: 'Continue',
  continueLabel: 'Continue {title}',
  startOne: 'Start',
  startLabel: 'Start {title}',
  showingFirst: 'Showing the first {n} of {total}.',
  noInspector: 'No inspector',
  startTitle: 'Start an inspection',
  startIntro: 'You become its inspector. It keeps working without signal, even if the app closes, once you’ve opened it here.',
  form: 'Form',
  loadingForms: 'Loading forms…',
  formsFailed: 'Couldn’t load the forms.',
  noForms: 'No inspection forms yet.',
  makeAForm: 'Make a form',
  askForForm: 'Ask an administrator or whoever runs a project to make one.',
  forTask: 'For the task {key} {title}',
  forATask: 'For a task (optional)',
  noTask: 'No task',
  taskHint: 'The task shows the inspection, and finishing it offers to mark the task done.',
  place: 'Place (optional)',
  placePlaceholder: 'e.g. Rig 3, north deck',
  pickForm: 'Pick a form.',
  startFailed: 'Couldn’t start it. Check your connection and try again.',
  cancel: 'Cancel',
} as const;
