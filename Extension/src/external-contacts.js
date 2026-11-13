/**
 * External contacts on a task: the people outside the company who are responsible for it, kept
 * apart from the people it is assigned to (each task keeps its own copy of each contact). A
 * plain-JavaScript copy of the web app's rules and words (Web Portal/frontend/src/lib/
 * external-contacts.ts, shared with the Android app and the server); src/external-contacts.test.js
 * runs both over the same inputs, so they can't drift apart. Pure (no DOM, no chrome APIs).
 */

/** The most characters each field can have. */
export const EXTERNAL_CONTACT_LIMITS = Object.freeze({ name: 120, company: 120, designation: 120, email: 191, phone: 40, remarks: 1000 });

/** The most external contacts one task can have. */
export const MAX_EXTERNAL_CONTACTS = 20;

/** The six fields, in the order the form shows them. */
export const EXTERNAL_CONTACT_FIELDS = Object.freeze(['name', 'company', 'designation', 'email', 'phone', 'remarks']);

const FIELD_WORDS = {
  name: 'A name can',
  company: 'A company can',
  designation: 'A designation can',
  email: 'An email address can',
  phone: 'A phone number can',
  remarks: 'Remarks can',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-\s]+$/;

const clean = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
};

/**
 * Check and clean a contact: the name is required, an email or phone number must look like one, and
 * no field may be too long. `{ ok: true, contact }` (trimmed, a blank optional field null) or
 * `{ ok: false, problems: { field: words } }`.
 */
export function checkExternalContact(draft) {
  const d = draft || {};
  const contact = {
    name: clean(d.name) ?? '',
    company: clean(d.company),
    designation: clean(d.designation),
    email: clean(d.email),
    phone: clean(d.phone),
    remarks: clean(d.remarks),
  };
  const problems = {};
  for (const field of Object.keys(EXTERNAL_CONTACT_LIMITS)) {
    const value = contact[field];
    if (value && value.length > EXTERNAL_CONTACT_LIMITS[field]) problems[field] = `${FIELD_WORDS[field]} have at most ${EXTERNAL_CONTACT_LIMITS[field]} characters.`;
  }
  if (!contact.name) problems.name = 'Enter the contact’s name.';
  if (contact.email && !problems.email && !EMAIL.test(contact.email)) problems.email = 'Enter a valid email address, like name@company.com.';
  if (contact.phone && !problems.phone && (!PHONE.test(contact.phone) || !/\d/.test(contact.phone))) problems.phone = 'A phone number can only have digits, spaces, + and -.';
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, contact };
}

/** "Ahmed Al Said (Acme)", or just the name when there is no company. */
export function externalContactLabel(contact) {
  return contact.company ? `${contact.name} (${contact.company})` : contact.name;
}

/** The card line: "External: Ahmed Al Said (Acme)", "… and 2 more"; null when there are none. */
export function externalContactsLine(summary) {
  if (!summary || summary.count < 1) return null;
  const more = summary.count > 1 ? ` and ${summary.count - 1} more` : '';
  return `External: ${externalContactLabel(summary)}${more}`;
}

/** A link that calls the number ("tel:+96899123456"), or null when there is none. */
export function phoneHref(phone) {
  const digits = (phone ?? '').replace(/[\s-]/g, '');
  return digits ? `tel:${digits}` : null;
}

/** A link that writes an email, or null when there is no address. */
export function mailHref(email) {
  const address = (email ?? '').trim();
  return address ? `mailto:${address}` : null;
}

/** "Acme · Site lead": a contact's company and designation, whichever are given ('' for neither). */
export function contactRoleLine(contact) {
  return [contact.company, contact.designation].filter(Boolean).join(' · ');
}

/** An earlier contact as a suggestion reads: "Ahmed Al Said · Acme · Site lead". */
export function suggestionText(contact) {
  return [contact.name, contactRoleLine(contact)].filter(Boolean).join(' · ');
}

/** The words every app uses for external contacts (the website's). */
export const EXTERNAL_CONTACT_WORDS = Object.freeze({
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
  labels: Object.freeze({ name: 'Name', company: 'Company', designation: 'Designation', email: 'Email', phone: 'Phone', remarks: 'Remarks' }),
  required: 'required',
  filter: 'External company',
  anyCompany: 'Any company',
  addFailed: 'Couldn’t add the contact.',
  saveFailed: 'Couldn’t save the contact.',
  removeFailed: 'Couldn’t remove the contact.',
});
