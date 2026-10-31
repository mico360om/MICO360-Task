import { describe, it, expect } from 'vitest';
import { createCompanyTime, usableHoursTarget } from './company-time';
import type { CompanyBrand, CompanyBranding } from './company-branding';

/**
 * Companies (MC1 Task 15, lead amendment: no per-company time zone): each company's week start and
 * working days and hours, resolved from what something belongs to, else the site's.
 */
const SITE = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const BETA = { days: [1, 2, 3, 4, 5], start: '10:00', end: '14:00' };
const brand = (companyId: string | null, over: Partial<CompanyBrand> = {}): CompanyBrand => ({
  companyId,
  name: 'MICO360',
  named: false,
  ownName: companyId,
  logoUrl: null,
  logoSize: null,
  timeZone: 'Asia/Muscat',
  weekStart: 0,
  workingHours: SITE,
  senderName: null,
  ...over,
});
const B = brand('B', { weekStart: 1, workingHours: BETA });
const A = brand('A');
const SITE_BRAND = brand(null);

function fakeBranding(): CompanyBranding & { calls: string[] } {
  const calls: string[] = [];
  const of = (id: string | null) => (id === 'B' ? B : id === 'A' ? A : SITE_BRAND);
  return {
    calls,
    siteBrand: async () => (calls.push('site'), SITE_BRAND),
    forCompany: async (id) => (calls.push(`company:${id}`), of(id)),
    forProject: async (id) => (calls.push(`project:${id}`), id === 'PB' ? B : A),
    forMeeting: async (id) => (calls.push(`meeting:${id}`), id === 'MN_B' ? B : A),
    forPerson: async (id) => (calls.push(`person:${id}`), id === 'cat' ? B : SITE_BRAND),
    forScope: async (viewer, pick) => (calls.push(`scope:${viewer.id}:${pick}`), pick ? of(pick) : viewer.id === 'cat' ? B : SITE_BRAND),
    emailOptions: () => ({ brand: {} }),
    pdfLogo: async () => null,
    pdf: async () => ({ companyName: null, logo: null }),
    clientPage: () => null,
  };
}

const cat = { id: 'cat', roles: ['EMPLOYEE'] };
const admin = { id: 'admin', roles: ['ADMIN'] };

describe('usableHoursTarget: an asker’s hints, only the ones they may use', () => {
  const can = {
    seeProject: async (_v: unknown, id: string) => id === 'PA',
    companyIds: async (userId: string) => (userId === 'cat' ? ['A', 'B'] : ['A']),
    openMeeting: async (_v: unknown, id: string) => id === 'MA',
  };
  it('keeps a project they see, a company of theirs and a meeting they open; drops the rest', async () => {
    const ana = { id: 'ana', roles: ['EMPLOYEE'] };
    expect(await usableHoursTarget({ projectId: 'PA', companyId: 'A', meetingId: 'MA', viewer: ana }, can)).toEqual({ projectId: 'PA', companyId: 'A', meetingId: 'MA', viewer: ana });
    expect(await usableHoursTarget({ projectId: 'PB', companyId: 'B', meetingId: 'MB', viewer: ana }, can)).toEqual({ projectId: null, companyId: null, meetingId: null, viewer: ana });
  });
  it('an administrator may name any company', async () => {
    expect((await usableHoursTarget({ projectId: null, companyId: 'C', meetingId: null, viewer: admin }, can)).companyId).toBe('C');
  });
});

describe('company time', () => {
  it('working hours: the project’s main company, else the named company, else the meeting’s, else the reader’s scope, else the site', async () => {
    const b = fakeBranding();
    const time = createCompanyTime(b);
    expect(await time.hoursFor({ projectId: 'PB', companyId: 'A', viewer: cat })).toEqual(BETA);
    expect(await time.hoursFor({ companyId: 'B' })).toEqual(BETA);
    expect(await time.hoursFor({ companyId: 'A' })).toEqual(SITE);
    expect(await time.hoursFor({ meetingId: 'MN_B' })).toEqual(BETA);
    expect(await time.hoursFor({ viewer: cat, pick: null })).toEqual(BETA);
    expect(await time.hoursFor({ viewer: cat, pick: 'A' })).toEqual(SITE);
    expect(await time.hoursFor({})).toEqual(SITE);
    expect(b.calls).toEqual(['project:PB', 'company:B', 'company:A', 'meeting:MN_B', 'scope:cat:null', 'scope:cat:A', 'site']);
  });

  it('week start of a list: the picked company, else the primary one, else the site', async () => {
    const time = createCompanyTime(fakeBranding());
    expect(await time.weekStartOfScope(cat, 'A')).toBe(0);
    expect(await time.weekStartOfScope(cat, null)).toBe(1);
    expect(await time.weekStartOfScope(admin, null)).toBe(0);
  });

  it('a person’s calendar (the weekly summary’s day): their primary company’s week start and working days', async () => {
    const time = createCompanyTime(fakeBranding());
    expect(await time.calendarOf('cat')).toEqual({ weekStart: 1, workingDays: [1, 2, 3, 4, 5] });
    expect(await time.calendarOf('ana')).toEqual({ weekStart: 0, workingDays: [0, 1, 2, 3, 4] });
  });

  it('every calendar in use: the site’s and each active company’s, once each', async () => {
    const prisma = { company: { findMany: async () => [{ id: 'A' }, { id: 'B' }] } };
    const time = createCompanyTime(fakeBranding(), prisma as never);
    expect(await time.calendars()).toEqual([
      { weekStart: 0, workingDays: [0, 1, 2, 3, 4] },
      { weekStart: 1, workingDays: [1, 2, 3, 4, 5] },
    ]);
    expect(await createCompanyTime(fakeBranding()).calendars()).toEqual([{ weekStart: 0, workingDays: [0, 1, 2, 3, 4] }]);
  });
});
