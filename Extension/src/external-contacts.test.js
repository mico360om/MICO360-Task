import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ext from './external-contacts.js';

describe('external contacts: the rules the task panel uses', () => {
  it('checks and cleans a contact: a name is needed, an email or phone must look like one', () => {
    expect(ext.checkExternalContact({ name: ' Ahmed Al Said ', company: ' Acme ', email: '' })).toEqual({
      ok: true,
      contact: { name: 'Ahmed Al Said', company: 'Acme', designation: null, email: null, phone: null, remarks: null },
    });
    expect(ext.checkExternalContact({ name: '', email: 'nope', phone: 'call me' })).toEqual({
      ok: false,
      problems: {
        name: 'Enter the contact’s name.',
        email: 'Enter a valid email address, like name@company.com.',
        phone: 'A phone number can only have digits, spaces, + and -.',
      },
    });
  });

  it('names a contact and its card line, and links to email and call', () => {
    expect(ext.externalContactLabel({ name: 'Ahmed Al Said', company: 'Acme' })).toBe('Ahmed Al Said (Acme)');
    expect(ext.externalContactsLine({ count: 3, name: 'Ahmed Al Said', company: 'Acme' })).toBe('External: Ahmed Al Said (Acme) and 2 more');
    expect(ext.externalContactsLine(null)).toBeNull();
    expect(ext.contactRoleLine({ company: 'Acme', designation: 'Site lead' })).toBe('Acme · Site lead');
    expect(ext.suggestionText({ name: 'Ahmed Al Said', company: 'Acme', designation: null })).toBe('Ahmed Al Said · Acme');
    expect(ext.phoneHref('+968 9912-3456')).toBe('tel:+96899123456');
    expect(ext.mailHref('ahmed@acme.com')).toBe('mailto:ahmed@acme.com');
    expect(ext.MAX_EXTERNAL_CONTACTS).toBe(20);
    expect(ext.EXTERNAL_CONTACT_WORDS.heading).toBe('External contacts');
  });
});

// The website owns these rules and words (Web Portal/frontend/src/lib/external-contacts.ts, shared
// with the Android app and the server). The copies can't be compared as text, so both run over the
// same inputs and this fails when they drift (skipped where the web app isn't checked out).
const WEB = resolve(__dirname, '../..', 'Web Portal/frontend/src/lib/external-contacts.ts');
const web = existsSync(WEB) ? await import(pathToFileURL(WEB).href) : null;

describe.skipIf(!web)('external contacts: src/external-contacts.js matches the web app (lib/external-contacts.ts)', () => {
  it('has the same words, limits and most contacts', () => {
    expect(ext.EXTERNAL_CONTACT_WORDS).toEqual(web.EXTERNAL_CONTACT_WORDS);
    expect(ext.EXTERNAL_CONTACT_LIMITS).toEqual(web.EXTERNAL_CONTACT_LIMITS);
    expect(ext.MAX_EXTERNAL_CONTACTS).toBe(web.MAX_EXTERNAL_CONTACTS);
  });

  const long = (n) => 'x'.repeat(n);
  const DRAFTS = [
    {}, { name: '' }, { name: '   ' }, { name: 'Ahmed' }, { name: ' سالم الهنائي ', company: ' ' }, { name: null, company: 'Acme' },
    { name: 'A', email: 'a@b.co' }, { name: 'A', email: 'a@b' }, { name: 'A', email: ' x y@z.com' }, { name: 'A', email: '' },
    { name: 'A', phone: '+968 9912-3456' }, { name: 'A', phone: '+ -' }, { name: 'A', phone: '(968) 1234' }, { name: 'A', phone: '٩٩١٢' },
    { name: long(120) }, { name: long(121), company: long(121), designation: long(121), email: `${long(190)}@b.co`, phone: '1'.repeat(41), remarks: long(1001) },
    { name: 'A', remarks: ' Line one\nLine two ' }, { name: 'A', designation: 'Site lead', company: 'Acme Oman', remarks: long(1000) },
  ];
  it('checks and cleans every contact the same way', () => {
    for (const d of DRAFTS) expect(ext.checkExternalContact(d), JSON.stringify(d)).toEqual(web.checkExternalContact(d));
  });

  const CONTACTS = [
    { name: 'Ahmed Al Said', company: 'Acme', designation: 'Site lead' }, { name: 'Sara', company: null, designation: null },
    { name: 'سالم', company: 'شركة', designation: undefined }, { name: 'Ali', company: '', designation: 'Engineer' },
  ];
  it('names contacts, card lines, suggestions and links the same way', () => {
    for (const c of CONTACTS) {
      expect(ext.externalContactLabel(c)).toBe(web.externalContactLabel(c));
      expect(ext.contactRoleLine(c)).toBe(web.contactRoleLine(c));
      expect(ext.suggestionText(c)).toBe(web.suggestionText(c));
    }
    for (const s of [null, undefined, { count: 0, name: 'A', company: null }, { count: 1, name: 'A', company: 'B' }, { count: 5, name: 'A', company: null }]) {
      expect(ext.externalContactsLine(s)).toBe(web.externalContactsLine(s));
    }
    for (const p of [null, undefined, '', '  ', '+968 9912-3456', '1234']) expect(ext.phoneHref(p)).toBe(web.phoneHref(p));
    for (const m of [null, undefined, '', ' a@b.co ']) expect(ext.mailHref(m)).toBe(web.mailHref(m));
  });
});
