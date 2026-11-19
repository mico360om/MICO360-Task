import { shiftDayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';

/**
 * Employee Appreciation (1.24.0, owner 18 Nov 2026) — the rules that need no database: the themes, icons and
 * animations, the six built-in templates, the placeholders, the company-time-zone day and each record's status.
 * The website keeps its own copy of the theme, icon and animation names (lib/appreciation.ts); a drift test
 * holds the two together.
 */

export const APPRECIATION_THEMES = ['ruby', 'ocean', 'emerald', 'amber', 'violet', 'slate'] as const;
export type AppreciationTheme = (typeof APPRECIATION_THEMES)[number];
export const APPRECIATION_ICONS = ['star', 'team', 'trophy', 'bulb', 'heart', 'medal'] as const;
export type AppreciationIcon = (typeof APPRECIATION_ICONS)[number];
export const APPRECIATION_ANIMATIONS = ['none', 'confetti', 'shimmer'] as const;
export type AppreciationAnimation = (typeof APPRECIATION_ANIMATIONS)[number];

export const APPRECIATION_STATUSES = ['SCHEDULED', 'ACTIVE', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] as const;
export type AppreciationStatus = (typeof APPRECIATION_STATUSES)[number];

/** Limits on what people type. */
export const LIMITS = { name: 80, title: 120, message: 1000, recipients: 200, daysAhead: 366, note: 500, noteInNotice: 80 } as const;

export interface TemplateContent {
  name: string;
  title: string;
  message: string;
  theme: AppreciationTheme;
  icon: AppreciationIcon;
  animation: AppreciationAnimation;
}

/** The built-in templates (they are never changed: a change is saved as a copy). */
export const BUILT_IN_TEMPLATES: ReadonlyArray<TemplateContent & { key: string }> = [
  {
    key: 'outstanding',
    name: 'Outstanding Performance',
    title: 'Outstanding Performance',
    message: 'Congratulations {name}! Your outstanding performance has made a real difference at {company}. Thank you for setting the bar so high.',
    theme: 'ruby',
    icon: 'trophy',
    animation: 'confetti',
  },
  {
    key: 'teamwork',
    name: 'Great Teamwork',
    title: 'Great Teamwork',
    message: 'Thank you, {name}, for the great teamwork. The way you support your colleagues makes {company} a better place to work.',
    theme: 'ocean',
    icon: 'team',
    animation: 'shimmer',
  },
  {
    key: 'excellent',
    name: 'Excellent Work',
    title: 'Excellent Work',
    message: 'Excellent work, {name}! We noticed the care and quality you put in, and we are grateful for it.',
    theme: 'emerald',
    icon: 'star',
    animation: 'confetti',
  },
  {
    key: 'innovation',
    name: 'Innovation',
    title: 'Innovation Award',
    message: '{name}, your fresh ideas are moving {company} forward. Thank you for thinking differently.',
    theme: 'violet',
    icon: 'bulb',
    animation: 'shimmer',
  },
  {
    key: 'dedication',
    name: 'Dedication',
    title: 'Thank You for Your Dedication',
    message: 'Thank you, {name}, for your dedication and commitment. Your hard work does not go unnoticed.',
    theme: 'amber',
    icon: 'heart',
    animation: 'none',
  },
  {
    key: 'employee-of-the-day',
    name: 'Employee of the Day',
    title: 'Employee of the Day',
    message: 'Congratulations {name}, you are the {company} Employee of the Day for {date}!',
    theme: 'ruby',
    icon: 'medal',
    animation: 'confetti',
  },
  // Ten more (owner, 19 Nov): added once at start-up like the first six, after them in the list.
  {
    key: 'safety-champion',
    name: 'Safety Champion',
    title: 'Safety Champion',
    message: 'Thank you, {name}, for keeping safety first. Your care helps everyone at {company} go home safe.',
    theme: 'emerald',
    icon: 'medal',
    animation: 'shimmer',
  },
  {
    key: 'customer-hero',
    name: 'Customer Hero',
    title: 'Customer Hero',
    message: '{name}, our clients noticed! Thank you for the outstanding service you gave on behalf of {company}.',
    theme: 'ocean',
    icon: 'heart',
    animation: 'confetti',
  },
  {
    key: 'problem-solver',
    name: 'Problem Solver',
    title: 'Problem Solver',
    message: 'Thank you, {name}, for finding a way through a tough problem. Your solution made a real difference.',
    theme: 'violet',
    icon: 'bulb',
    animation: 'shimmer',
  },
  {
    key: 'above-and-beyond',
    name: 'Above and Beyond',
    title: 'Above and Beyond',
    message: '{name}, you went above and beyond. Thank you for the extra effort. {company} is proud of you.',
    theme: 'ruby',
    icon: 'star',
    animation: 'confetti',
  },
  {
    key: 'deadline-achiever',
    name: 'Deadline Achiever',
    title: 'Deadline Achiever',
    message: 'Well done, {name}! You delivered on time and kept the work on track. Thank you.',
    theme: 'amber',
    icon: 'trophy',
    animation: 'confetti',
  },
  {
    key: 'leadership',
    name: 'Leadership',
    title: 'Leadership Award',
    message: 'Thank you, {name}, for leading by example. Your guidance helps the whole team succeed.',
    theme: 'slate',
    icon: 'trophy',
    animation: 'shimmer',
  },
  {
    key: 'helping-hand',
    name: 'Helping Hand',
    title: 'Helping Hand',
    message: 'Thank you, {name}, for always being ready to help a colleague. It means a lot to all of us.',
    theme: 'ocean',
    icon: 'team',
    animation: 'none',
  },
  {
    key: 'quality-champion',
    name: 'Quality Champion',
    title: 'Quality Champion',
    message: '{name}, your attention to detail sets the standard at {company}. Thank you for getting it right.',
    theme: 'emerald',
    icon: 'star',
    animation: 'shimmer',
  },
  {
    key: 'project-milestone',
    name: 'Project Milestone',
    title: 'Project Milestone Reached',
    message: 'Congratulations, {name}, on reaching an important project milestone. Great work, and thank you!',
    theme: 'violet',
    icon: 'medal',
    animation: 'confetti',
  },
  {
    key: 'work-anniversary',
    name: 'Work Anniversary',
    title: 'Happy Work Anniversary',
    message: 'Happy work anniversary, {name}! Thank you for another year of great work with {company}.',
    theme: 'amber',
    icon: 'heart',
    animation: 'confetti',
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-18' → '18 Nov 2026' (the site's date words). */
export function dayWords(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}

/** Fill {name}, {company} and {date} (any other braces are left as typed). */
export function fillPlaceholders(text: string, v: { name: string; company: string; day: string }): string {
  return text.replace(/\{(name|company|date)\}/g, (_m, k: string) => (k === 'name' ? v.name : k === 'company' ? v.company : dayWords(v.day)));
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Is 'YYYY-MM-DD' a real calendar day? */
export function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const d = new Date(`${day}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** The day's window in the company time zone: from its 00:00 to the next day's 00:00 (active 00:00–23:59). */
export function dayWindow(day: string, timeZone: string): { startsAt: Date; endsAt: Date } {
  return { startsAt: zonedStartOfDay(day, timeZone), endsAt: zonedStartOfDay(shiftDayKey(day, 1), timeZone) };
}

/** Today in the company time zone. */
export const companyToday = (now: Date, timeZone: string): string => zonedDayKey(now, timeZone);

export interface StatusFacts {
  startsAt: Date;
  endsAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}

/** A record's status now: cancelled and accepted are kept; otherwise by the clock (never by the sweep). */
export function statusOf(r: StatusFacts, now: Date): AppreciationStatus {
  if (r.cancelledAt) return 'CANCELLED';
  if (r.acceptedAt) return 'ACCEPTED';
  if (now.getTime() < r.startsAt.getTime()) return 'SCHEDULED';
  if (now.getTime() < r.endsAt.getTime()) return 'ACTIVE';
  return 'EXPIRED';
}

/** Is it showing on the person's Dashboard now (its day, not cancelled; accepted too — the theme stays all day)? */
export const isLiveNow = (r: StatusFacts, now: Date): boolean =>
  !r.cancelledAt && now.getTime() >= r.startsAt.getTime() && now.getTime() < r.endsAt.getTime();

/** Who may manage appreciations: administrators (not in Manager View) and anyone with the Appreciation manager switch. */
export interface ManagerFacts {
  active: boolean;
  client: boolean;
  admin: boolean;
  managerView: boolean;
  appreciationManager: boolean;
}
export const canManageAppreciations = (p: ManagerFacts): boolean => p.active && !p.client && ((p.admin && !p.managerView) || p.appreciationManager);
/** Every company (null) for an administrator; the manager's own companies otherwise. */
export const scopeOfManager = (p: ManagerFacts & { companyIds: readonly string[] }): string[] | null => (p.admin && !p.managerView ? null : [...p.companyIds]);

export const APPRECIATION_WORDS = {
  notAllowed: 'Only administrators and Appreciation managers can manage appreciations.',
  notFound: 'That appreciation was not found.',
  started: 'This appreciation has already started, so it can’t be changed or cancelled.',
  cancelled: 'This appreciation was cancelled.',
  expired: 'This appreciation ended at midnight and can no longer be accepted.',
  notYet: 'This appreciation hasn’t started yet.',
  pastDay: 'Choose today or a later day.',
  tooFar: 'Choose a day within the next year.',
  noPeople: 'Choose at least one person.',
  personOut: 'You can only appreciate active staff in your own companies.',
  builtIn: 'Built-in templates can’t be changed. Save your changes as a copy.',
  templateGone: 'That template was not found.',
  noticeTitle: (title: string) => `You've been appreciated: ${title}`,
  noteTooLong: `A note can be at most ${LIMITS.note} characters.`,
} as const;

/**
 * 1.24.1: the optional note for the manager left with an accept — plain text, trimmed; control characters (C0
 * other than line breaks and tabs, DEL, C1), the bidi override/isolate marks that could reorder the sender's
 * notice, and zero-width spaces / BOM are dropped; empty means no note (null).
 */
export function cleanNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null;
  const t = note
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g, '')
    .trim();
  return t ? t : null;
}

const clip = (s: string, max: number): string => {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : s;
};

/**
 * The sender's bell notice: “<name> accepted your appreciation: “<first 80 characters>…”” (on one line). The name
 * is clipped to 60 characters so the title always fits the notifications table's 191.
 */
export function noteNoticeTitle(name: string, note: string): string {
  const flat = note.replace(/\s+/g, ' ').trim();
  return `${clip(name, 60)} accepted your appreciation: “${clip(flat, LIMITS.noteInNotice)}”`;
}
