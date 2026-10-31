import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createCompanyBranding } from '../../src/modules/companies/company-branding';
import { createCompanyTime } from '../../src/modules/companies/company-time';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';

// Companies (MC1 Task 15, lead amendment): each company's week start and working days and hours —
// no company has its own time zone. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const siteHours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const branding = createCompanyBranding({
  prisma,
  site: { companyName: 'MICO360', timeZone: 'Asia/Muscat', senderName: null },
  settings: { companyWeekStart: async () => 0, workingHours: async () => ({ ...siteHours, days: [...siteHours.days] }) },
  readImage: async () => null,
  apiBaseUrl: 'https://api.test',
  ttlMs: 0,
});
const time = createCompanyTime(branding, prisma);
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('company time', () => {
  it('every company inheriting the site: the same answers as before', async () => {
    for (const target of [{ projectId: w.projects.PA }, { projectId: w.projects.PB }, { companyId: w.companies.A }, { meetingId: w.meetings.MN_B }, { viewer: w.as.cat }, {}]) {
      expect(await time.hoursFor(target)).toEqual(siteHours);
    }
    for (const viewer of [w.as.ana, w.as.cat, w.as.admin, w.as.gus]) expect(await time.weekStartOfScope(viewer, null)).toBe(0);
  });

  it('free times for a meeting without a project use its company’s hours', async () => {
    await prisma.company.update({ where: { id: w.companies.B }, data: { workingHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '14:00' } } });
    try {
      expect((await time.hoursFor({ companyId: w.companies.B })).start).toBe('10:00');
      expect((await time.hoursFor({ meetingId: w.meetings.MN_B })).start).toBe('10:00');
      expect((await time.hoursFor({ companyId: w.companies.A })).start).toBe(siteHours.start);
      expect((await time.hoursFor({ projectId: w.projects.PB })).days).toEqual([1, 2, 3, 4, 5]);
      expect((await time.hoursFor({ projectId: w.projects.PAB })).start).toBe(siteHours.start); // main company A
    } finally {
      await prisma.company.update({ where: { id: w.companies.B }, data: { workingHours: Prisma.DbNull } });
    }
  });

  it('scope: the picked company, else the primary one, else the site', async () => {
    await prisma.company.update({ where: { id: w.companies.B }, data: { weekStart: 1 } });
    try {
      expect(await time.weekStartOfScope(w.as.cat, w.companies.A)).toBe(0);
      expect(await time.weekStartOfScope(w.as.cat, null)).toBe(1); // primary B
      expect(await time.weekStartOfScope(w.as.admin, null)).toBe(0);
      expect(await time.calendarOf(w.people.cat)).toEqual({ weekStart: 1, workingDays: siteHours.days });
      expect(await time.calendarOf(w.people.ana)).toEqual({ weekStart: 0, workingDays: siteHours.days });
      expect(await time.calendars()).toEqual(expect.arrayContaining([{ weekStart: 0, workingDays: siteHours.days }, { weekStart: 1, workingDays: siteHours.days }]));
    } finally {
      await prisma.company.update({ where: { id: w.companies.B }, data: { weekStart: null } });
    }
  });
});
