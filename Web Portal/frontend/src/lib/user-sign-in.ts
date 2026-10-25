/**
 * User Management's words for sign-ins and welcome emails: each person's last sign-in in the company
 * time zone, when a welcome email went, and the bulk send's question and answer.
 */

/** The server's limit for one bulk send (backend user-routes MAX_WELCOME_BATCH). */
export const MAX_WELCOME_BATCH = 100;

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

/** Both confirmations say what using the link does (setting the password ends every other sign-in). */
export const SIGN_OUT_NOTE = 'Using the link signs them out of MICO360 Tasks on their other devices (the app and the extension too).';

/** One person's send asks first: "Send a welcome email to Sara K (sara@x.co)?" */
export function welcomeOneConfirmTitle(name: string, email: string): string {
  return `Send a welcome email to ${name} (${email})?`;
}

/** Who a bulk send goes to: up to 10 names, then "and 2 more" (people filtered off the page included). */
export function namesText(names: string[], max = 10): string {
  const rest = names.length - max;
  return rest > 0 ? `${names.slice(0, max).join(', ')} and ${rest} more` : names.join(', ');
}

/** "3 people were sent one in the last 7 days and are left out." */
export function leftOutText(count: number): string {
  return count === 1 ? '1 person was sent one in the last 7 days and is left out.' : `${count} people were sent one in the last 7 days and are left out.`;
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
  welcomeSentAt?: string | null;
}

/** A welcome link works this long, so someone sent one more recently may still be using it. */
const LINK_DAYS_MS = 7 * 24 * 3600 * 1000;

/**
 * "Everyone who has never signed in": the active people with no sign-in (others can't get one), less
 * anyone sent a welcome email in the last 7 days (their link may still be in use); `leftOut` counts those.
 */
export function welcomeCandidates<T extends SignInPerson>(people: T[], now: Date = new Date()): { pick: T[]; leftOut: number } {
  const never = people.filter((p) => !p.lastLoginAt && p.status === 'ACTIVE');
  const recent = (p: T) => !!p.welcomeSentAt && now.getTime() - Date.parse(p.welcomeSentAt) < LINK_DAYS_MS;
  return { pick: never.filter((p) => !recent(p)), leftOut: never.filter(recent).length };
}

/** Why a row's "Send welcome email" can't be used (shown as its tooltip), or null. A locked account can. */
export function welcomeBlockedReason(person: { id: string; status: SignInPerson['status']; email: string; locked?: boolean }, meId: string | undefined): string | null {
  if (person.id === meId) return 'You can’t send yourself a welcome email';
  if (person.status === 'INACTIVE') return 'This account is inactive, so it can’t get a welcome email';
  if (person.status === 'SUSPENDED') return 'This account is suspended, so it can’t get a welcome email';
  if (!person.email.trim()) return 'This account has no email address';
  return null;
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
