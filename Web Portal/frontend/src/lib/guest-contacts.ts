/**
 * Guests on tasks (1.24): people outside the company — a client's engineer, a supplier's site lead — named
 * on a task for the record only. A guest never signs in, has no account, takes no licence, gets no email
 * or notice and is never shown to clients. Each company keeps one reusable guest list; a task links to
 * guests from its project's main company. These are the rules every part uses: the field limits and
 * checks, the duplicate rule (the same person typed twice), how a guest is named on a task, card and
 * filter, and the words. Shared byte-for-byte by the website and the server (a copy test fails on drift).
 */
import { checkExternalContact, EXTERNAL_CONTACT_LIMITS } from './external-contacts';

/** The most characters each field can have (a guest's own fields as today's external contacts; notes are admins'). */
export const GUEST_LIMITS = {
  name: EXTERNAL_CONTACT_LIMITS.name,
  company: EXTERNAL_CONTACT_LIMITS.company,
  designation: EXTERNAL_CONTACT_LIMITS.designation,
  email: EXTERNAL_CONTACT_LIMITS.email,
  phone: EXTERNAL_CONTACT_LIMITS.phone,
  /** The admin's notes on the guest (and details the conversion found on other copies). */
  notes: 2000,
  /** What this task needs from the guest (today's per-task "remarks"). */
  note: EXTERNAL_CONTACT_LIMITS.remarks,
} as const;

/** The most guests one task can have (as external contacts). */
export const MAX_TASK_GUESTS = 20;

/** A guest's own details, cleaned: trimmed, a blank optional field is null. */
export interface GuestFields {
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
}

export type GuestField = keyof GuestFields;
export type GuestDraft = { [K in GuestField]?: string | null };

export type GuestCheck = { ok: true; guest: GuestFields } | { ok: false; problems: Partial<Record<GuestField, string>> };

/** A guest as a list shows it. */
export interface GuestLike {
  id?: string;
  name: string;
  company?: string | null;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Check and clean a guest's details: the name is required, an email or phone number must look like one, nothing too long. */
export function checkGuest(draft: GuestDraft): GuestCheck {
  const check = checkExternalContact({ name: draft.name, company: draft.company, designation: draft.designation, email: draft.email, phone: draft.phone });
  if (!check.ok) {
    const { remarks: _remarks, ...problems } = check.problems;
    if (problems.name === 'Enter the contact’s name.') problems.name = 'Enter the guest’s name.';
    return { ok: false, problems };
  }
  const { name, company, designation, email, phone } = check.contact;
  return { ok: true, guest: { name, company, designation, email, phone } };
}

/** Clean a per-task note: trimmed, blank is null; null when too long is reported by `noteProblem`. */
export function cleanNote(note: string | null | undefined): string | null {
  const text = typeof note === 'string' ? note.trim() : '';
  return text === '' ? null : text;
}

/** What is wrong with a per-task note, or null. */
export function noteProblem(note: string | null | undefined): string | null {
  const text = cleanNote(note);
  return text && text.length > GUEST_LIMITS.note ? `A note can have at most ${GUEST_LIMITS.note} characters.` : null;
}

/**
 * A name or company as compared: no accents or Arabic marks, no tatweel, lower case, no spaces at all
 * ("Al Harthy", "al-harthy " and "ALHARTHY" differ only by the hyphen; "Al Harthy" and "AlHarthy" are one).
 */
export function guestTextKey(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** An email as compared: trimmed, lower case ('' for none). */
export const guestEmailKey = (email: string | null | undefined): string => (email ?? '').trim().toLowerCase();

/** A phone number as compared: its digits only ('' for none). */
export const guestPhoneKey = (phone: string | null | undefined): string => (phone ?? '').replace(/\D/g, '');

const hasDetails = (g: GuestLike) => Boolean(guestEmailKey(g.email) || guestPhoneKey(g.phone) || guestTextKey(g.company));

/**
 * Are these the same person? Always the same name (case, spaces and accents aside), and then the same
 * email, or the same phone digits, or the same company — or neither has any of those (two entries that
 * can't be told apart). A shared inbox or switchboard never fuses two different names.
 */
export function isSameGuest(a: GuestLike, b: GuestLike): boolean {
  const name = guestTextKey(a.name);
  if (!name || name !== guestTextKey(b.name)) return false;
  const email = guestEmailKey(a.email);
  if (email && email === guestEmailKey(b.email)) return true;
  const phone = guestPhoneKey(a.phone);
  if (phone && phone === guestPhoneKey(b.phone)) return true;
  const company = guestTextKey(a.company);
  if (company && company === guestTextKey(b.company)) return true;
  return !hasDetails(a) && !hasDetails(b);
}

/**
 * The New guest form's check against the company's list: `same` are the same person by the rule above
 * ("Ahmed Al Harthy (OXY) is already on the list — use him?"); `similar` share only the name.
 */
export function guestMatches<T extends GuestLike>(draft: GuestLike, list: T[]): { same: T[]; similar: T[] } {
  const name = guestTextKey(draft.name);
  if (!name) return { same: [], similar: [] };
  const same: T[] = [];
  const similar: T[] = [];
  for (const g of list) {
    if (guestTextKey(g.name) !== name) continue;
    (isSameGuest(draft, g) ? same : similar).push(g);
  }
  return { same, similar };
}

/** How full a guest's details are (company, designation, email, phone given) — the conversion keeps the fullest. */
export function guestFullness(g: GuestLike): number {
  return [g.company, g.designation, g.email, g.phone].filter((v) => typeof v === 'string' && v.trim() !== '').length;
}

/** "Ahmed Al Harthy (OXY)", or just the name when there is no company. */
export function guestLabel(g: { name: string; company?: string | null }): string {
  return g.company ? `${g.name} (${g.company})` : g.name;
}

/** "Ahmed Al Harthy · OXY · Site engineer": the name, company and designation that are given. */
export function guestLine(g: GuestLike): string {
  return [g.name, g.company, g.designation].filter((v): v is string => Boolean(v)).join(' · ');
}

/** The card line: "Guest: Ahmed (OXY)", "Guest: Ahmed (OXY) and 2 more"; null when there are none. */
export function guestsCardLine(guests: { name: string; company?: string | null }[] | null | undefined): string | null {
  const first = guests?.[0];
  if (!first) return null;
  const more = guests!.length > 1 ? ` and ${guests!.length - 1} more` : '';
  return `Guest: ${guestLabel(first)}${more}`;
}

/** "with guest Ahmed (OXY)", "with guests Ahmed (OXY) and Sara" — the daily email's words; '' for none. */
export function withGuestsText(guests: { name: string; company?: string | null }[] | null | undefined): string {
  const labels = (guests ?? []).map(guestLabel);
  if (labels.length === 0) return '';
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `with guest${labels.length > 1 ? 's' : ''} ${list}`;
}

/** Does the task have this guest (by id)? */
export function hasGuest(guests: { id: string }[] | null | undefined, guestId: string): boolean {
  return (guests ?? []).some((g) => g.id === guestId);
}

/** Does the task have a guest from this company (case, spaces and accents aside)? */
export function hasGuestCompany(guests: { company?: string | null }[] | null | undefined, company: string): boolean {
  const key = guestTextKey(company);
  return key !== '' && (guests ?? []).some((g) => guestTextKey(g.company) === key);
}

/** The guests on these tasks, each once (by id), A to Z — the Guest filter's choices. */
export function guestOptions<G extends { id: string; name: string; company?: string | null }>(tasks: { guests?: G[] | null }[]): G[] {
  const byId = new Map<string, G>();
  for (const t of tasks) for (const g of t.guests ?? []) if (!byId.has(g.id)) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => guestLabel(a).localeCompare(guestLabel(b), 'en', { sensitivity: 'base' }));
}

/** The companies named on these tasks' guests, each once (the first spelling), A to Z — the Guest company filter's choices. */
export function guestCompanyOptions(tasks: { guests?: { company?: string | null }[] | null }[]): string[] {
  const byKey = new Map<string, string>();
  for (const t of tasks) for (const g of t.guests ?? []) if (g.company && !byKey.has(guestTextKey(g.company))) byKey.set(guestTextKey(g.company), g.company);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** The words every part of the website uses for guests (the server's refusals use the same). */
export const GUEST_WORDS = {
  heading: 'Guests',
  one: 'Guest',
  badge: 'Guest',
  hint: 'People outside the company named on this task for the record. They can’t sign in, see the task or get emails.',
  internal: 'Internal user',
  guest: 'Guest',
  modeLabel: 'Assign',
  search: 'Search guests by name, company, email or phone',
  none: 'No guests yet.',
  noMatch: 'No guest on the list matches.',
  newGuest: 'New guest',
  addNew: '+ New guest',
  useExisting: (label: string) => `${label} is already on the list — use them?`,
  useThem: 'Use them',
  addAnyway: 'No, add a new guest',
  similar: 'Guests with the same name are on the list:',
  needsTeam: 'Add at least one person from your team to look after this task.',
  lastTeamMember: 'This task has guests, so it needs at least one person from your team. Add someone else first.',
  responsibleLine: 'added as the person responsible for the guests',
  retired: 'Retired',
  copy: 'Copy',
  copied: 'Copied',
  remove: 'Remove guest',
  note: 'Note for this task',
  filter: 'Guest',
  filterCompany: 'Guest company',
  anyGuest: 'Any guest',
  anyCompany: 'Any company',
  full: `This task has ${MAX_TASK_GUESTS} guests, the most it can have.`,
  wrongCompany: 'This guest is on another company’s list.',
  adminTitle: 'Guest contacts',
  adminHint: 'Your company’s list of guests — people outside the company named on tasks for the record. They never sign in or get emails.',
  inUse: 'This guest is on tasks (some may be in the Recycle Bin), so they can’t be removed. Retire them instead.',
  labels: { name: 'Name', company: 'Company', designation: 'Designation', email: 'Email', phone: 'Phone', notes: 'Notes' },
} as const;
