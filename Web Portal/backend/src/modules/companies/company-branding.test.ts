import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createCompanyBranding, fitLogo } from './company-branding';
import { solidPng } from '../../lib/test-images';

/**
 * Companies (MC1 Task 14): which company's name, logo and sender name a PDF or email carries. The
 * resolver reads a handful of rows; this stand-in holds them in memory.
 */
interface Co { id: string; name: string; status: 'ACTIVE' | 'ARCHIVED'; logoUrl: string | null; senderName: string | null; weekStart: number | null; workingHours: unknown }
function world() {
  const companies = new Map<string, Co>();
  const projects = new Map<string, { mainCompanyId: string | null; companyIds: string[] }>();
  const meetings = new Map<string, { projectId: string | null; companyId: string | null; organizerId: string }>();
  const users = new Map<string, { primaryCompanyId: string | null; companyIds: string[] }>();
  const reads = { company: 0 };
  const prisma = {
    company: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        reads.company++;
        const c = companies.get(where.id);
        return c ? { ...c } : null;
      },
      count: async () => [...companies.values()].filter((c) => c.status === 'ACTIVE').length,
    },
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = projects.get(where.id);
        return p ? { mainCompanyId: p.mainCompanyId, companies: p.companyIds.slice(0, 1).map((companyId) => ({ companyId })) } : null;
      },
    },
    meeting: { findUnique: async ({ where }: { where: { id: string } }) => meetings.get(where.id) ?? null },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        return u ? { primaryCompanyId: u.primaryCompanyId, companies: u.companyIds.filter((id) => companies.get(id)?.status === 'ACTIVE').map((companyId) => ({ companyId })) } : null;
      },
    },
  } as unknown as PrismaClient;
  const add = (id: string, more: Partial<Co> = {}) => companies.set(id, { id, name: `${id} LLC`, status: 'ACTIVE', logoUrl: null, senderName: null, weekStart: null, workingHours: null, ...more });
  return { prisma, companies, projects, meetings, users, reads, add };
}

const SITE_HOURS = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const logo = solidPng(300, 100);
function branding(w: ReturnType<typeof world>, more: { ttlMs?: number; read?: (url: string) => Promise<Buffer | null>; documentPicture?: (raw: Buffer) => Promise<Buffer | null> } = {}) {
  return createCompanyBranding({
    prisma: w.prisma,
    site: { companyName: 'MICO360', timeZone: 'Asia/Muscat', senderName: 'MICO360 Tasks' },
    settings: { companyWeekStart: async () => 0, workingHours: async () => ({ ...SITE_HOURS, days: [...SITE_HOURS.days] }) },
    readImage: more.read ?? (async (url) => (url === '/uploads/companies/a/logo.png' ? logo : null)),
    ...(more.documentPicture ? { documentPicture: more.documentPicture } : {}),
    apiBaseUrl: 'https://api.test/',
    ttlMs: more.ttlMs ?? 0,
  });
}

describe('company branding', () => {
  it('one active company: today’s brand — no name, the built-in logo, the site’s sender, no company on the client page', async () => {
    const w = world();
    w.add('prolens');
    w.projects.set('P1', { mainCompanyId: 'prolens', companyIds: ['prolens'] });
    const b = branding(w);
    const brand = await b.forProject('P1');
    expect(brand).toMatchObject({ companyId: 'prolens', name: 'MICO360', named: false, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: SITE_HOURS, senderName: null });
    expect(b.emailOptions(brand)).toEqual({ brand: {} });
    expect(await b.pdf(brand)).toEqual({ companyName: null, logo: null });
    expect(b.clientPage(brand)).toBeNull();
  });

  it('one company with a logo and a sender name: those apply, the name still doesn’t', async () => {
    const w = world();
    w.add('prolens', { logoUrl: '/uploads/companies/a/logo.png', senderName: 'Prolens Team' });
    w.projects.set('P1', { mainCompanyId: 'prolens', companyIds: ['prolens'] });
    const b = branding(w);
    const brand = await b.forProject('P1');
    expect(b.emailOptions(brand)).toEqual({
      brand: { logoUrl: 'https://api.test/uploads/companies/a/logo.png', logoBox: { width: 90, height: 30, alt: 'prolens LLC' } },
      fromName: 'Prolens Team',
    });
    expect(await b.pdf(brand)).toEqual({ companyName: null, logo });
    expect(b.clientPage(brand)).toBeNull();
  });

  it('1.23.11: a company logo is made the size the PDF header prints it at, when the picture library can; the email keeps its address', async () => {
    const w = world();
    w.add('prolens', { logoUrl: '/uploads/companies/a/logo.png' });
    w.projects.set('P1', { mainCompanyId: 'prolens', companyIds: ['prolens'] });
    const sized = Buffer.from('sized');
    const documentPicture = vi.fn(async () => sized);
    const b = branding(w, { documentPicture });
    const brand = await b.forProject('P1');
    expect((await b.pdf(brand)).logo).toBe(sized);
    expect(await b.pdfLogo(brand)).toBe(sized);
    expect(documentPicture).toHaveBeenCalledWith(logo);
    expect(b.emailOptions(brand).brand.logoUrl).toBe('https://api.test/uploads/companies/a/logo.png');
    // A sizer that can't: the logo as before.
    const plain = branding(w, { documentPicture: async () => null });
    expect((await plain.pdf(await plain.forProject('P1'))).logo).toBe(logo);
  });

  it('two active companies: each project carries its main company’s name', async () => {
    const w = world();
    w.add('A');
    w.add('B', { senderName: 'Beta Team' });
    w.projects.set('PAB', { mainCompanyId: 'A', companyIds: ['A', 'B'] });
    w.projects.set('PB', { mainCompanyId: null, companyIds: ['B'] }); // no main company recorded: its first company
    const b = branding(w);
    const ab = await b.forProject('PAB');
    expect(ab).toMatchObject({ companyId: 'A', name: 'A LLC', named: true });
    expect(b.emailOptions(ab)).toEqual({ brand: { companyName: 'A LLC' } });
    expect(await b.pdf(ab)).toEqual({ companyName: 'A LLC', logo: null });
    expect(b.clientPage(ab)).toEqual({ name: 'A LLC', logoUrl: null });
    expect(b.emailOptions(await b.forProject('PB'))).toEqual({ brand: { companyName: 'B LLC' }, fromName: 'Beta Team' });
    expect((await b.forProject('nope')).companyId).toBeNull();
  });

  it('an archived second company doesn’t count: one active company is unnamed', async () => {
    const w = world();
    w.add('A');
    w.add('C', { status: 'ARCHIVED' });
    w.projects.set('PC', { mainCompanyId: 'C', companyIds: ['C'] });
    const brand = await branding(w).forProject('PC');
    expect(brand).toMatchObject({ companyId: 'C', named: false, name: 'MICO360' });
  });

  it('a person: their primary company while active, else their oldest active one, else the site', async () => {
    const w = world();
    w.add('A');
    w.add('B');
    w.add('C', { status: 'ARCHIVED' });
    w.users.set('cat', { primaryCompanyId: 'B', companyIds: ['A', 'B'] });
    w.users.set('gus', { primaryCompanyId: 'C', companyIds: ['C', 'A'] });
    w.users.set('admin', { primaryCompanyId: null, companyIds: [] });
    const b = branding(w);
    expect((await b.forPerson('cat')).companyId).toBe('B');
    expect((await b.forPerson('gus')).companyId).toBe('A');
    expect(await b.forPerson('admin')).toMatchObject({ companyId: null, name: 'MICO360', named: false });
    expect((await b.forPerson('nobody')).companyId).toBeNull();
  });

  it('a meeting: its project’s main company, else its own company, else its organizer’s', async () => {
    const w = world();
    w.add('A');
    w.add('B');
    w.projects.set('PA', { mainCompanyId: 'A', companyIds: ['A'] });
    w.users.set('ben', { primaryCompanyId: 'B', companyIds: ['B'] });
    w.meetings.set('MA', { projectId: 'PA', companyId: null, organizerId: 'ben' });
    w.meetings.set('MN_B', { projectId: null, companyId: 'B', organizerId: 'ben' });
    w.meetings.set('MN', { projectId: null, companyId: null, organizerId: 'ben' });
    const b = branding(w);
    expect((await b.forMeeting('MA')).companyId).toBe('A');
    expect((await b.forMeeting('MN_B')).companyId).toBe('B');
    expect((await b.forMeeting('MN')).companyId).toBe('B');
    expect((await b.forMeeting('gone')).companyId).toBeNull();
  });

  it('a cross-project document: the picked company, else the reader’s primary one, else the site', async () => {
    const w = world();
    w.add('A');
    w.add('B');
    w.users.set('cat', { primaryCompanyId: 'B', companyIds: ['A', 'B'] });
    const b = branding(w);
    expect((await b.forScope({ id: 'cat', roles: [] }, 'A')).companyId).toBe('A');
    expect((await b.forScope({ id: 'cat', roles: [] }, null)).companyId).toBe('B');
    expect((await b.forScope({ id: 'admin', roles: ['ADMIN'] }, null)).companyId).toBeNull();
  });

  it('week start and working hours: the company’s own, else the site’s', async () => {
    const w = world();
    w.add('A', { weekStart: 1, workingHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '14:00' } });
    w.add('B', { workingHours: { days: [], start: 'x', end: 'y' } }); // a broken value: the site's
    const b = branding(w);
    expect(await b.forCompany('A')).toMatchObject({ weekStart: 1, workingHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '14:00' } });
    expect(await b.forCompany('B')).toMatchObject({ weekStart: 0, workingHours: SITE_HOURS });
    expect(await b.siteBrand()).toMatchObject({ companyId: null, weekStart: 0, workingHours: SITE_HOURS, timeZone: 'Asia/Muscat' });
  });

  it('a logo that can’t be read: the built-in logo in PDFs and emails', async () => {
    const w = world();
    w.add('A', { logoUrl: '/uploads/companies/gone.png' });
    const b = branding(w);
    const brand = await b.forCompany('A');
    expect(b.emailOptions(brand)).toEqual({ brand: {} });
    expect(await b.pdfLogo(brand)).toBeNull();
  });

  it('company rows are kept for the cache time, then read again', async () => {
    const w = world();
    w.add('A');
    vi.useFakeTimers({ now: new Date('2026-10-31T08:00:00Z') });
    try {
      const b = branding(w, { ttlMs: 30_000 });
      await b.forCompany('A');
      w.companies.get('A')!.senderName = 'Alpha Team';
      expect((await b.forCompany('A')).senderName).toBeNull();
      vi.setSystemTime(new Date('2026-10-31T08:00:31Z'));
      expect((await b.forCompany('A')).senderName).toBe('Alpha Team');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fitLogo', () => {
  it('fits a logo inside the box, keeping its shape', () => {
    expect(fitLogo({ width: 300, height: 100 }, 160, 30)).toEqual({ width: 90, height: 30 });
    expect(fitLogo({ width: 1000, height: 100 }, 160, 30)).toEqual({ width: 160, height: 16 });
    expect(fitLogo({ width: 50, height: 200 }, 160, 30)).toEqual({ width: 8, height: 30 });
  });
});
