/**
 * External contacts on a task: the people outside the company who are responsible for it (a
 * client's engineer, a supplier's site lead), kept apart from the people the task is assigned to.
 * Each task keeps its own copy of each contact (there is no shared address book). These are the
 * rules every part uses — the limits, how a contact is checked and cleaned, how it is named on a
 * card ("External: Ahmed Al Said (Acme) and 2 more") and how tasks are found by it. Shared
 * byte-for-byte by the website, the Android app and the server (copy tests fail on drift).
 */

/** The most characters each field can have. */
export const EXTERNAL_CONTACT_LIMITS = { name: 120, company: 120, designation: 120, email: 191, phone: 40, remarks: 1000 } as const;

/** The most external contacts one task can have. */
export const MAX_EXTERNAL_CONTACTS = 20;

export type ExternalContactField = keyof typeof EXTERNAL_CONTACT_LIMITS;

/** A contact's six fields, cleaned: trimmed, a blank optional field is null. */
export interface ExternalContactFields {
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  remarks: string | null;
}

/** A contact as typed in (any field may be missing). */
export type ExternalContactDraft = { [K in ExternalContactField]?: string | null };

export type ExternalContactCheck =
  | { ok: true; contact: ExternalContactFields }
  | { ok: false; problems: Partial<Record<ExternalContactField, string>> };

/** A task's contacts in short, for its card and list row (null when it has none). */
export interface ExternalContactSummary {
  /** How many contacts the task has. */
  count: number;
  /** The first contact's name and company. */
  name: string;
  company: string | null;
  /** Every contact's name, in order. */
  names: string[];
  /** Every company named, each once (the first spelling), in order. */
  companies: string[];
}

const FIELD_WORDS: Record<ExternalContactField, string> = {
  name: 'A name can',
  company: 'A company can',
  designation: 'A designation can',
  email: 'An email address can',
  phone: 'A phone number can',
  remarks: 'Remarks can',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-\s]+$/;

const clean = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
};

/** Check and clean a contact: the name is required, an email or phone number must look like one, and no field may be too long. */
export function checkExternalContact(draft: ExternalContactDraft): ExternalContactCheck {
  const contact = {
    name: clean(draft.name) ?? '',
    company: clean(draft.company),
    designation: clean(draft.designation),
    email: clean(draft.email),
    phone: clean(draft.phone),
    remarks: clean(draft.remarks),
  };
  const problems: Partial<Record<ExternalContactField, string>> = {};
  for (const field of Object.keys(EXTERNAL_CONTACT_LIMITS) as ExternalContactField[]) {
    const value = contact[field];
    if (value && value.length > EXTERNAL_CONTACT_LIMITS[field]) problems[field] = `${FIELD_WORDS[field]} have at most ${EXTERNAL_CONTACT_LIMITS[field]} characters.`;
  }
  if (!contact.name) problems.name = 'Enter the contact’s name.';
  if (contact.email && !problems.email && !EMAIL.test(contact.email)) problems.email = 'Enter a valid email address, like name@company.com.';
  if (contact.phone && !problems.phone && (!PHONE.test(contact.phone) || !/\d/.test(contact.phone))) problems.phone = 'A phone number can only have digits, spaces, + and -.';
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, contact };
}

/** "Ahmed Al Said (Acme)", or just the name when there is no company. */
export function externalContactLabel(contact: { name: string; company?: string | null }): string {
  return contact.company ? `${contact.name} (${contact.company})` : contact.name;
}

/** A company as compared: trimmed, single spaces, lower case. */
const companyKey = (company: string) => company.trim().replace(/\s+/g, ' ').toLowerCase();

/** A task's contacts (in order) in short, or null when it has none. */
export function summarizeExternalContacts(contacts: { name: string; company?: string | null }[]): ExternalContactSummary | null {
  const first = contacts[0];
  if (!first) return null;
  const companies: string[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (!c.company || seen.has(companyKey(c.company))) continue;
    seen.add(companyKey(c.company));
    companies.push(c.company);
  }
  return { count: contacts.length, name: first.name, company: first.company ?? null, names: contacts.map((c) => c.name), companies };
}

/** The card line: "External: Ahmed Al Said (Acme)", "… and 2 more"; null when there are none. */
export function externalContactsLine(summary: Pick<ExternalContactSummary, 'count' | 'name' | 'company'> | null | undefined): string | null {
  if (!summary || summary.count < 1) return null;
  const more = summary.count > 1 ? ` and ${summary.count - 1} more` : '';
  return `External: ${externalContactLabel(summary)}${more}`;
}

/** A link that calls the number ("tel:+96899123456"), or null when there is none. */
export function phoneHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[\s-]/g, '');
  return digits ? `tel:${digits}` : null;
}

/** A link that writes an email, or null when there is no address. */
export function mailHref(email: string | null | undefined): string | null {
  const address = (email ?? '').trim();
  return address ? `mailto:${address}` : null;
}

/** Does a search word match one of the task's contacts — a name or a company (case aside)? */
export function matchesExternalContact(summary: Pick<ExternalContactSummary, 'names' | 'companies'> | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!summary || !q) return false;
  return [...summary.names, ...summary.companies].some((text) => text.toLowerCase().includes(q));
}

/** Does the task have a contact from this company (case and extra spaces aside)? */
export function hasExternalCompany(summary: Pick<ExternalContactSummary, 'companies'> | null | undefined, company: string): boolean {
  if (!summary) return false;
  const key = companyKey(company);
  return summary.companies.some((c) => companyKey(c) === key);
}

/** The companies named on these tasks' contacts, each once (the first spelling), A to Z — the choices of the company filter. */
export function externalCompanyOptions(tasks: { externalSummary?: Pick<ExternalContactSummary, 'companies'> | null }[]): string[] {
  const byKey = new Map<string, string>();
  for (const t of tasks) for (const c of t.externalSummary?.companies ?? []) if (!byKey.has(companyKey(c))) byKey.set(companyKey(c), c);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** "Acme · Site lead": a contact's company and designation, whichever are given ('' for neither). */
export function contactRoleLine(contact: { company?: string | null; designation?: string | null }): string {
  return [contact.company, contact.designation].filter((v): v is string => Boolean(v)).join(' · ');
}

/** An earlier contact as a suggestion reads: "Ahmed Al Said · Acme · Site lead". */
export function suggestionText(contact: { name: string; company?: string | null; designation?: string | null }): string {
  return [contact.name, contactRoleLine(contact)].filter(Boolean).join(' · ');
}

/** The words every app uses for external contacts (the website's; the Android app and the extension copy them). */
export const EXTERNAL_CONTACT_WORDS = {
  heading: 'External contacts',
  hint: 'People outside the company who are responsible for this task. They are kept apart from the people it is assigned to, and are never emailed.',
  none: 'No external contacts yet.',
  add: 'Add a contact',
  addTitle: 'Add an external contact',
  editTitle: 'Edit the external contact',
  save: 'Save',
  cancel: 'Cancel',
  edit: 'Edit',
  remove: 'Remove',
  confirmRemove: 'Remove this contact?',
  keep: 'Keep',
  full: `This task has ${MAX_EXTERNAL_CONTACTS} external contacts, the most it can have.`,
  suggestions: 'Earlier contacts on this project',
  suggestionHint: 'Pick one to copy their details.',
  labels: { name: 'Name', company: 'Company', designation: 'Designation', email: 'Email', phone: 'Phone', remarks: 'Remarks' },
  required: 'required',
  filter: 'External company',
  anyCompany: 'Any company',
  addFailed: 'Couldn’t add the contact.',
  saveFailed: 'Couldn’t save the contact.',
  removeFailed: 'Couldn’t remove the contact.',
} as const;
