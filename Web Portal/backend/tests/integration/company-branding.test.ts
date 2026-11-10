import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createCompanyBranding } from '../../src/modules/companies/company-branding';
import { DEFAULT_COMPANY } from '../../src/modules/companies/default-company';
import { buildMinutesPdf, type MinutesData } from '../../src/modules/meetings/minutes';
import { inspectPdf } from '../../src/lib/pdf-inspect';
import { solidPng } from '../../src/lib/test-images';
import { createEmailService } from '../../src/modules/email/email-service';
import type { SendEmailInput } from '../../src/modules/email/mailer';
import { createWelcomeService } from '../../src/modules/users/welcome-service';
import { createPrismaWelcomeTokenStore } from '../../src/modules/users/prisma-welcome-store';
import { createPrismaUserRepository } from '../../src/modules/users/prisma-user-repository';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';

// Companies (MC1 Task 14): each company's name, logo and sender name on its PDFs and emails.
// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const alphaPng = solidPng(320, 96, [20, 120, 60]);
const stored = new Map<string, Buffer>();
const branding = createCompanyBranding({
  prisma,
  site: { companyName: 'MICO360', timeZone: 'Asia/Muscat', senderName: 'MICO360 Tasks' },
  settings: { companyWeekStart: async () => 0, workingHours: async () => ({ days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }) },
  readImage: async (url) => stored.get(url) ?? null,
  apiBaseUrl: 'https://api.test',
  ttlMs: 0,
});
let w: CompanyWorld;
const outbox: SendEmailInput[] = [];
const email = createEmailService({ transport: { async send(input) { outbox.push(input); return { ok: true, status: 200 }; } } });

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

/** Only the default company is active (every other one archived) while `fn` runs; put back after. */
async function onlyDefaultCompanyActive(fn: (projectId: string) => Promise<void>): Promise<void> {
  await prisma.company.upsert({ where: { id: DEFAULT_COMPANY.id }, update: {}, create: { id: DEFAULT_COMPANY.id, name: DEFAULT_COMPANY.name, code: DEFAULT_COMPANY.code } });
  const others = (await prisma.company.findMany({ where: { status: 'ACTIVE', id: { not: DEFAULT_COMPANY.id } }, select: { id: true } })).map((c) => c.id);
  const p1 = await prisma.project.create({
    data: { code: `P1${w.tag.toUpperCase()}`, name: `Project P1 ${w.tag}`, createdById: w.people.admin, mainCompanyId: DEFAULT_COMPANY.id, companies: { create: { companyId: DEFAULT_COMPANY.id } } },
  });
  await prisma.company.updateMany({ where: { id: { in: others } }, data: { status: 'ARCHIVED' } });
  try {
    await fn(p1.id);
  } finally {
    await prisma.company.updateMany({ where: { id: { in: others } }, data: { status: 'ACTIVE' } });
    await prisma.project.delete({ where: { id: p1.id } });
  }
}

/** A meeting's minutes PDF as the minutes route builds it: the meeting's brand on its footer and header. */
async function minutesPdf(meetingId: string): Promise<Buffer> {
  const m = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
  const project = m.projectId ? await prisma.project.findUniqueOrThrow({ where: { id: m.projectId } }) : null;
  const pdf = await branding.pdf(await branding.forMeeting(meetingId));
  const data: MinutesData = {
    brand: { productName: 'MICO360 Tasks', companyName: pdf.companyName ?? 'MICO360', tagline: 'Tasks', websiteUrl: 'https://mico360.test', supportEmail: 'info@mico360.test', companyAddress: 'Muscat' },
    project: project ? { name: project.name, code: project.code, number: null, color: null, image: null, icon: null, clientName: null, statusLabel: 'Active', ownerName: null, startDate: null, targetDate: null } : null,
    meeting: { title: m.title, statusLabel: 'Scheduled', organizerName: 'Ana', location: null, onlineLink: null, startAt: m.startAt.toISOString(), endAt: null, timeZone: 'Asia/Muscat', description: null },
    attendees: [],
    agenda: [],
    notes: [],
    actionItems: [],
    generatedAt: new Date().toISOString(),
    generatedByName: 'Ana',
    logo: pdf.logo,
  };
  return buildMinutesPdf(data);
}
const imageWidths = (buf: Buffer) => [...inspectPdf(buf).objects.values()].filter((d) => /\/Subtype \/Image/.test(d)).map((d) => Number(/\/Width (\d+)/.exec(d)?.[1]));

describe('company branding', () => {
  it('one active company: the brand is today’s brand, and PDFs keep the built-in logo', async () => {
    await onlyDefaultCompanyActive(async (P1) => {
      const brand = await branding.forProject(P1);
      expect(brand).toMatchObject({ companyId: DEFAULT_COMPANY.id, named: false, name: 'MICO360' });
      expect(branding.emailOptions(brand)).toEqual({ brand: {} }); // resolveBrand() unchanged
      expect(await branding.pdfLogo(brand)).toBeNull();
      expect(branding.clientPage(brand)).toBeNull();
    });
  });

  it('two companies: each project’s PDFs and emails carry its main company', async () => {
    const url = `/uploads/companies/${w.companies.A}/logo.png`;
    stored.set(url, alphaPng);
    await prisma.company.update({ where: { id: w.companies.A }, data: { logoUrl: url } });
    const ma = await minutesPdf(w.meetings.MA);
    expect(inspectPdf(ma).pages.flat().join('\n')).toContain(`Alpha ${w.tag}`);
    expect(imageWidths(ma)).toContain(320);
    const mb = await minutesPdf(w.meetings.MB);
    expect(inspectPdf(mb).pages.flat().join('\n')).toContain(`Beta ${w.tag}`);
    expect(imageWidths(mb)).toEqual([155]); // tpdf: 1.23.11 — the built-in logo (every header carries one; 200 dpi, 155 pixels), not company A's
    expect(await branding.pdfLogo(await branding.forProject(w.projects.PB))).toBeNull(); // no logo → built-in
    expect(await branding.pdfLogo(await branding.forProject(w.projects.PAB))).toEqual(alphaPng); // main company A
    expect(branding.emailOptions(await branding.forProject(w.projects.PA)).brand).toMatchObject({ companyName: `Alpha ${w.tag}`, logoUrl: `https://api.test${url}` });
    expect(branding.clientPage(await branding.forProject(w.projects.PA))).toEqual({ name: `Alpha ${w.tag}`, logoUrl: url });
  });

  it('emails: the welcome email uses the person’s primary company and its sender name', async () => {
    await prisma.company.update({ where: { id: w.companies.B }, data: { senderName: 'Beta Team' } });
    const welcome = createWelcomeService({
      users: createPrismaUserRepository(prisma),
      tokens: createPrismaWelcomeTokenStore(prisma),
      mailer: email,
      appUrl: 'https://app.test',
      emailOptions: async (userId) => branding.emailOptions(await branding.forPerson(userId)),
    });
    await welcome.send(w.people.ben);
    expect(outbox.at(-1)).toMatchObject({ to: `ben.${w.tag}@world.test`, fromName: 'Beta Team' });
    expect(outbox.at(-1)!.html).toContain(`Beta ${w.tag}`);
    await welcome.send(w.people.ana); // Alpha: no sender name of its own → MAIL_FROM's
    expect('fromName' in outbox.at(-1)!).toBe(false);
    expect(outbox.at(-1)!.html).toContain(`Alpha ${w.tag}`);
  });

  it('a meeting without a project uses its company', async () => {
    expect((await branding.forMeeting(w.meetings.MN_B)).companyId).toBe(w.companies.B);
    expect((await branding.forMeeting(w.meetings.MN_A)).companyId).toBe(w.companies.A);
  });

  it('a person whose companies are all archived gets the site’s brand; a reader’s scope is their pick, else their primary company', async () => {
    expect((await branding.forPerson(w.people.gus)).companyId).toBeNull();
    expect((await branding.forScope(w.as.cat, w.companies.A)).companyId).toBe(w.companies.A);
    expect((await branding.forScope(w.as.cat, null)).companyId).toBe(w.companies.B);
    expect((await branding.forScope(w.as.admin, null)).companyId).toBeNull();
  });
});
