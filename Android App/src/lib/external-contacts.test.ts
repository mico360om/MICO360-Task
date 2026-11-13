import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_CONTACT_LIMITS,
  EXTERNAL_CONTACT_WORDS,
  MAX_EXTERNAL_CONTACTS,
  checkExternalContact,
  contactRoleLine,
  externalCompanyOptions,
  externalContactLabel,
  externalContactsLine,
  hasExternalCompany,
  mailHref,
  matchesExternalContact,
  phoneHref,
  suggestionText,
  summarizeExternalContacts,
} from './external-contacts';

describe('checking an external contact', () => {
  it('keeps the six fields, trimmed, and turns blanks into nothing', () => {
    expect(
      checkExternalContact({ name: '  Ahmed Al Said ', company: ' Acme ', designation: '', email: ' ahmed@acme.com ', phone: ' +968 9912 3456 ', remarks: '  Site lead\nCall before 10  ' }),
    ).toEqual({
      ok: true,
      contact: { name: 'Ahmed Al Said', company: 'Acme', designation: null, email: 'ahmed@acme.com', phone: '+968 9912 3456', remarks: 'Site lead\nCall before 10' },
    });
    expect(checkExternalContact({ name: 'Sara' })).toEqual({
      ok: true,
      contact: { name: 'Sara', company: null, designation: null, email: null, phone: null, remarks: null },
    });
  });

  it('needs a name', () => {
    expect(checkExternalContact({ name: '   ', company: 'Acme' })).toEqual({ ok: false, problems: { name: 'Enter the contact’s name.' } });
    expect(checkExternalContact({})).toEqual({ ok: false, problems: { name: 'Enter the contact’s name.' } });
  });

  it('checks an email address only when one is given', () => {
    expect(checkExternalContact({ name: 'A', email: 'not-an-email' })).toEqual({ ok: false, problems: { email: 'Enter a valid email address, like name@company.com.' } });
    expect(checkExternalContact({ name: 'A', email: 'a@b' })).toMatchObject({ ok: false });
    expect(checkExternalContact({ name: 'A', email: '' })).toMatchObject({ ok: true });
  });

  it('allows a phone number of digits, spaces, + and - only', () => {
    expect(checkExternalContact({ name: 'A', phone: '+968 9912-3456' })).toMatchObject({ ok: true });
    expect(checkExternalContact({ name: 'A', phone: 'call me' })).toEqual({ ok: false, problems: { phone: 'A phone number can only have digits, spaces, + and -.' } });
    expect(checkExternalContact({ name: 'A', phone: '+ -' })).toMatchObject({ ok: false });
  });

  it('says which fields are too long, all at once', () => {
    const long = (n: number) => 'x'.repeat(n);
    const result = checkExternalContact({
      name: long(EXTERNAL_CONTACT_LIMITS.name + 1),
      company: long(EXTERNAL_CONTACT_LIMITS.company + 1),
      remarks: long(EXTERNAL_CONTACT_LIMITS.remarks + 1),
    });
    expect(result).toEqual({
      ok: false,
      problems: {
        name: 'A name can have at most 120 characters.',
        company: 'A company can have at most 120 characters.',
        remarks: 'Remarks can have at most 1000 characters.',
      },
    });
    expect(checkExternalContact({ name: 'A', remarks: long(1000) })).toMatchObject({ ok: true });
  });

  it('allows up to 20 contacts on a task', () => {
    expect(MAX_EXTERNAL_CONTACTS).toBe(20);
  });
});

describe('naming external contacts', () => {
  it('names a contact with their company', () => {
    expect(externalContactLabel({ name: 'Ahmed Al Said', company: 'Acme' })).toBe('Ahmed Al Said (Acme)');
    expect(externalContactLabel({ name: 'Ahmed Al Said', company: null })).toBe('Ahmed Al Said');
  });

  it('sums up a task’s contacts for its card: the first, how many, every name and company', () => {
    expect(summarizeExternalContacts([])).toBeNull();
    expect(
      summarizeExternalContacts([
        { name: 'Ahmed Al Said', company: 'Acme' },
        { name: 'Sara Nasser', company: 'PDO' },
        { name: 'Ali', company: 'acme' },
      ]),
    ).toEqual({ count: 3, name: 'Ahmed Al Said', company: 'Acme', names: ['Ahmed Al Said', 'Sara Nasser', 'Ali'], companies: ['Acme', 'PDO'] });
  });

  it('writes the card line, with how many more there are', () => {
    expect(externalContactsLine(null)).toBeNull();
    expect(externalContactsLine({ count: 1, name: 'Ahmed Al Said', company: 'Acme' })).toBe('External: Ahmed Al Said (Acme)');
    expect(externalContactsLine({ count: 2, name: 'Ahmed Al Said', company: null })).toBe('External: Ahmed Al Said and 1 more');
    expect(externalContactsLine({ count: 4, name: 'Ahmed Al Said', company: 'Acme' })).toBe('External: Ahmed Al Said (Acme) and 3 more');
  });

  it('makes call and email links', () => {
    expect(phoneHref('+968 9912-3456')).toBe('tel:+96899123456');
    expect(phoneHref('')).toBeNull();
    expect(mailHref('ahmed@acme.com')).toBe('mailto:ahmed@acme.com');
    expect(mailHref(null)).toBeNull();
  });
});

describe('finding tasks by their external contacts', () => {
  const summary = summarizeExternalContacts([
    { name: 'Ahmed Al Said', company: 'Acme Oman' },
    { name: 'Sara Nasser', company: null },
  ]);

  it('matches a contact’s name or company, ignoring case', () => {
    expect(matchesExternalContact(summary, 'sara')).toBe(true);
    expect(matchesExternalContact(summary, 'acme')).toBe(true);
    expect(matchesExternalContact(summary, 'pdo')).toBe(false);
    expect(matchesExternalContact(null, 'sara')).toBe(false);
  });

  it('filters by company, ignoring case and extra spaces', () => {
    expect(hasExternalCompany(summary, 'acme  oman')).toBe(true);
    expect(hasExternalCompany(summary, 'Acme')).toBe(false);
    expect(hasExternalCompany(null, 'Acme')).toBe(false);
  });

  it('lists the companies to filter by, A to Z, each once', () => {
    expect(
      externalCompanyOptions([
        { externalSummary: summarizeExternalContacts([{ name: 'A', company: 'PDO' }, { name: 'B', company: 'acme' }]) },
        { externalSummary: null },
        {},
        { externalSummary: summarizeExternalContacts([{ name: 'C', company: 'Acme' }]) },
      ]),
    ).toEqual(['acme', 'PDO']);
  });
});

describe('the words every app uses for external contacts', () => {
  it('names the section, its buttons, its fields and the company filter', () => {
    expect(EXTERNAL_CONTACT_WORDS).toMatchObject({
      heading: 'External contacts',
      none: 'No external contacts yet.',
      add: 'Add a contact',
      confirmRemove: 'Remove this contact?',
      full: 'This task has 20 external contacts, the most it can have.',
      filter: 'External company',
      anyCompany: 'Any company',
    });
    expect(Object.keys(EXTERNAL_CONTACT_WORDS.labels)).toEqual(['name', 'company', 'designation', 'email', 'phone', 'remarks']);
  });

  it('writes a contact’s company and designation as one line, and a suggestion with both', () => {
    expect(contactRoleLine({ company: 'Acme', designation: 'Site lead' })).toBe('Acme · Site lead');
    expect(contactRoleLine({ company: null, designation: 'Site lead' })).toBe('Site lead');
    expect(contactRoleLine({ company: null, designation: null })).toBe('');
    expect(suggestionText({ name: 'Ahmed Al Said', company: 'Acme', designation: 'Site lead' })).toBe('Ahmed Al Said · Acme · Site lead');
    expect(suggestionText({ name: 'Sara', company: null, designation: null })).toBe('Sara');
  });
});
