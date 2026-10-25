/**
 * User Management's words for sign-ins and welcome emails: each person's last sign-in in the company
 * time zone, when a welcome email went, and the bulk send's question and answer.
 */

/** The server's limit for one bulk send (backend user-routes MAX_WELCOME_BATCH). */
export const MAX_WELCOME_BATCH = 200;

// Fixed English month names: some browsers' en-GB writes September as "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function zonedParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { year: get('year'), month: MONTHS[Number(get('month')) - 1] ?? '', day: String(Number(get('day'))), hour: get('hour').padStart(2, '0'), minute: get('minute') };
}

/** "24 Oct 2026, 09:12" in the company time zone, or "Never signed in". */
export function signInText(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return 'Never signed in';
  const p = zonedParts(iso, timeZone);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/** "Welcome email sent 24 Oct" (with the year when it isn't this year). */
export function welcomeSentText(iso: string, timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(iso, timeZone);
  const thisYear = zonedParts(now.toISOString(), timeZone).year;
  return `Welcome email sent ${p.day} ${p.month}${p.year === thisYear ? '' : ` ${p.year}`}`;
}

/** The bulk send asks first: "Send welcome emails to 12 people?" */
export function welcomeConfirmTitle(count: number): string {
  return count === 1 ? 'Send a welcome email to 1 person?' : `Send welcome emails to ${count} people?`;
}

/** …and then says how it went: "Sent 11. 1 not sent:" (the people not sent to follow, each with why). */
export function welcomeBatchSummary({ sent, notSent }: { sent: number; notSent: number }): string {
  return notSent > 0 ? `Sent ${sent}. ${notSent} not sent:` : `Sent ${sent}.`;
}

interface SignInPerson {
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  lastLoginAt?: string | null;
}

/** "Everyone who has never signed in": the active people with no sign-in (others can't get one). */
export function welcomeCandidates<T extends SignInPerson>(people: T[]): T[] {
  return people.filter((p) => !p.lastLoginAt && p.status === 'ACTIVE');
}

export type SignInSort = 'newest' | 'signin-latest' | 'signin-earliest';

/** The list's own order (newest accounts first), or by last sign-in. A new list; the given one is kept. */
export function sortBySignIn<T extends SignInPerson>(people: T[], sort: SignInSort): T[] {
  if (sort === 'newest') return [...people];
  const at = (p: T) => (p.lastLoginAt ? Date.parse(p.lastLoginAt) : null);
  return people
    .map((p, i) => ({ p, i, t: at(p) }))
    .sort((a, b) => {
      if (a.t === null || b.t === null) {
        if (a.t === b.t) return a.i - b.i;
        // Never signed in: last when the latest come first, first when the earliest do.
        return (a.t === null ? 1 : -1) * (sort === 'signin-latest' ? 1 : -1);
      }
      return sort === 'signin-latest' ? b.t - a.t || a.i - b.i : a.t - b.t || a.i - b.i;
    })
    .map((x) => x.p);
}
