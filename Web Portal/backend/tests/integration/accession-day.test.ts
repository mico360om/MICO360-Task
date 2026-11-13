import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ACCESSION_DAY_KEY, ACCESSION_DAY_NAME, createAccessionDayStep } from '../../src/modules/notify-policy/accession-day';
import { OMAN_STARTER_HOLIDAYS } from '../../src/modules/notify-policy/oman-holidays';

// Requires a running MySQL or MariaDB (TEST_DATABASE_URL) with migrations applied.
// Owner decision (13 Nov 2026): Accession Day (11 January) is one of Oman's holidays. New companies get it
// with the starter list; an existing site gets it once, at start-up — never twice, never where the year
// already has a day off on 11 January, and never again after an administrator deleted it.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const tag = randomBytes(3).toString('hex');
const companies: string[] = [];
const NOW = new Date('2026-11-13T08:00:00.000Z');
const step = () => createAccessionDayStep({ prisma, timeZone: 'Asia/Muscat', now: () => NOW });

async function company(name: string, opts: { seeded?: boolean } = {}) {
  const c = await prisma.company.create({ data: { name: `${name} ${tag}`, code: `${name.slice(0, 3).toUpperCase()}${tag}`.slice(0, 10) } });
  companies.push(c.id);
  if (opts.seeded !== false) await prisma.notificationPolicy.create({ data: { companyId: c.id, policy: {}, holidaysSeededAt: new Date('2026-11-10T00:00:00.000Z') } });
  return c.id;
}
const daysOn = async (companyId: string, day: string) => prisma.companyHoliday.findMany({ where: { companyId, day }, select: { name: true, source: true, expected: true, recurring: true } });

let plain = '', ownDayOff = '', everyYear = '', notSeeded = '', removedBefore = '';

beforeAll(async () => {
  await prisma.$connect();
  await prisma.systemSetting.deleteMany({ where: { key: ACCESSION_DAY_KEY } });
  plain = await company('Contoso');
  ownDayOff = await company('Fabrikam');
  await prisma.companyHoliday.create({ data: { companyId: ownDayOff, day: '2027-01-11', name: 'Company day off', source: 'ADMIN' } });
  everyYear = await company('Northwind');
  await prisma.companyHoliday.create({ data: { companyId: everyYear, day: '2024-01-11', name: 'Sultan’s Accession', recurring: true, source: 'ADMIN' } });
  notSeeded = await company('Acme', { seeded: false });
  removedBefore = await company('Tailspin');
  // An administrator deleted a day off on 11 January 2027 (the panel's audit line).
  await prisma.auditLog.create({ data: { action: 'notify.holiday.remove', module: 'notifications', entityId: removedBefore, oldValue: { id: 'h1', day: '2027-01-11', name: ACCESSION_DAY_NAME, recurring: false, source: 'STARTER', expected: false } } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: companies } } });
  await prisma.companyHoliday.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.notificationPolicy.deleteMany({ where: { companyId: { in: companies } } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
  await prisma.systemSetting.deleteMany({ where: { key: ACCESSION_DAY_KEY } });
  await prisma.$disconnect();
});

describe('Accession Day (11 January)', () => {
  it('is in the starter list each year, a fixed date like National Day', () => {
    expect(OMAN_STARTER_HOLIDAYS.filter((h) => h.name === ACCESSION_DAY_NAME)).toEqual([
      { day: '2026-01-11', name: 'Accession Day', expected: false },
      { day: '2027-01-11', name: 'Accession Day', expected: false },
    ]);
  });

  it('is added once to an existing site: each set-up company gets the coming one; a year with its own 11 January day off, a deleted one and a company not set up yet are left alone', async () => {
    const r = await step().run();
    expect(r.already).toBe(false);
    expect(await daysOn(plain, '2027-01-11')).toEqual([{ name: 'Accession Day', source: 'STARTER', expected: false, recurring: false }]);
    // Already past this year: not added afterwards (the list going forward is what matters).
    expect(await daysOn(plain, '2026-01-11')).toEqual([]);
    expect(await daysOn(ownDayOff, '2027-01-11')).toEqual([{ name: 'Company day off', source: 'ADMIN', expected: false, recurring: false }]);
    expect(await daysOn(everyYear, '2027-01-11')).toEqual([]);
    expect(await daysOn(removedBefore, '2027-01-11')).toEqual([]);
    expect(await prisma.companyHoliday.count({ where: { companyId: notSeeded } })).toBe(0);
    const marker = await prisma.systemSetting.findUnique({ where: { key: ACCESSION_DAY_KEY } });
    expect(marker?.value).toMatchObject({ at: NOW.toISOString() });
  });

  it('never twice: the next start-up does nothing, and an administrator who deletes it afterwards keeps it deleted', async () => {
    expect((await step().run()).already).toBe(true);
    expect(await prisma.companyHoliday.count({ where: { companyId: plain, day: '2027-01-11' } })).toBe(1);
    await prisma.companyHoliday.deleteMany({ where: { companyId: plain, day: '2027-01-11' } });
    expect((await step().run()).already).toBe(true);
    expect(await daysOn(plain, '2027-01-11')).toEqual([]);
  });

  it('two servers starting at once add it once', async () => {
    await prisma.systemSetting.deleteMany({ where: { key: ACCESSION_DAY_KEY } });
    const fresh = await company('Woodgrove');
    const results = await Promise.all([step().run(), step().run()]);
    expect(results.filter((x) => !x.already).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.companyHoliday.count({ where: { companyId: fresh, day: '2027-01-11' } })).toBe(1);
  });
});
