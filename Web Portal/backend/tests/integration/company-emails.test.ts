import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createCompanyBranding, createDocumentBrands } from '../../src/modules/companies/company-branding';
import { createCompanyTime } from '../../src/modules/companies/company-time';
import { createDailyEmailService } from '../../src/modules/daily-emails/daily-email-service';
import { createPrismaDailyEmailRepository } from '../../src/modules/daily-emails/prisma-daily-email-repository';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { createManagementFromPrisma, createWeeklySummaryFromPrisma } from '../../src/modules/management/management-wiring';
import type { EmailContent, TemplateOptions } from '../../src/modules/email/email-templates';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';

// Companies (MC1 Task 16): one morning email and one weekly summary per person, grouped by company,
// branded by their primary company. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const siteHours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const settings = {
  companyWeekStart: async () => 0 as const,
  workingHours: async () => ({ ...siteHours, days: [...siteHours.days] }),
  dailyLimit: async () => 5,
  weeklySummaryEnabled: async () => true,
};
const branding = createCompanyBranding({ prisma, site: { companyName: 'MICO360', timeZone: 'Asia/Muscat', senderName: null }, settings, readImage: async () => null, apiBaseUrl: 'https://api.test', ttlMs: 0 });
const brands = createDocumentBrands(branding, prisma);
const time = createCompanyTime(branding, prisma);
const sources = createPrismaDailyEmailSources(prisma);
const sent: Array<{ to: string; content: EmailContent; opts?: { fromName?: string } }> = [];
const send = async (to: string, content: EmailContent, _template: string, opts?: { fromName?: string }) => {
  sent.push({ to, content, opts });
  return 'sent' as const;
};
const daily = createDailyEmailService({
  repo: createPrismaDailyEmailRepository(prisma),
  people: sources.people,
  tasks: sources.tasks,
  send,
  isConfigured: () => true,
  companyTimeZone: 'Asia/Muscat',
  appUrl: 'https://app.test',
  emailOptions: (userId) => brands.email.person(userId),
});
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

/** The pending morning email a person would get now (sent to the test mailbox, nothing recorded). */
async function pendingOf(userId: string): Promise<{ content: EmailContent; opts?: { fromName?: string } }> {
  sent.length = 0;
  await daily.sendTest(userId);
  return sent.find((s) => /pending tasks/.test(s.content.subject))!;
}

describe('daily emails, one per person, grouped by company', () => {
  it('cat gets ONE daily email, Alpha’s section then Beta’s, with Beta’s name (her primary company)', async () => {
    await prisma.company.update({ where: { id: w.companies.B }, data: { senderName: 'Beta Team' } });
    try {
      const mail = await pendingOf(w.people.cat);
      const html = mail.content.html;
      expect(html.indexOf(`>Alpha ${w.tag}</h2>`)).toBeGreaterThan(-1);
      expect(html.indexOf(`>Alpha ${w.tag}</h2>`)).toBeLessThan(html.indexOf(`>Beta ${w.tag}</h2>`));
      expect(html).toContain(`TA2${w.tag.toUpperCase()}-1`);
      expect(html).toContain(`TB2${w.tag.toUpperCase()}-1`);
      expect(html).toContain(`© ${new Date().getFullYear()} Beta ${w.tag}`);
      expect(mail.opts).toEqual({ fromName: 'Beta Team' });
    } finally {
      await prisma.company.update({ where: { id: w.companies.B }, data: { senderName: null } });
    }
  });

  it('ana’s email never lists a task of a project she can’t see', async () => {
    // Assigned in PB (Beta) and PC (Gamma, archived) too — neither is hers to see.
    await prisma.taskAssignee.createMany({ data: [{ taskId: w.tasks.TB1, userId: w.people.ana }, { taskId: w.tasks.TC1, userId: w.people.ana }] });
    try {
      const mail = await pendingOf(w.people.ana);
      expect(mail.content.html).toContain('ZZALPHA');
      expect(mail.content.html).not.toMatch(/ZZBETA|ZZGAMMA/);
      expect(mail.content.html).not.toContain('</h2>'); // one company: today's email
    } finally {
      await prisma.taskAssignee.deleteMany({ where: { userId: w.people.ana, taskId: { in: [w.tasks.TB1, w.tasks.TC1] } } });
    }
  });

  it('gus, whose only company is archived, gets nothing of it', async () => {
    sent.length = 0;
    expect(await daily.sendTest(w.people.gus)).toEqual({ pending: 'empty', completed: 'empty' });
  });
});

describe('the weekly summary, one per person', () => {
  function weekly() {
    const management = createManagementFromPrisma(prisma, {
      settings: { ...settings, companyWeekStart: async (v?: { id: string; roles: string[] }) => (v ? time.weekStartOfScope(v, null) : 0) },
      timeZone: 'Asia/Muscat',
    });
    return createWeeklySummaryFromPrisma(prisma, {
      management,
      settings,
      send,
      isConfigured: () => true,
      companyTimeZone: 'Asia/Muscat',
      appUrl: 'https://app.test',
      calendarOf: (userId) => time.calendarOf(userId),
      calendars: () => time.calendars(),
      emailOptions: (userId: string): Promise<TemplateOptions | undefined> => brands.email.person(userId),
    });
  }

  it('the week is the primary company’s: cat (Beta, weeks from Monday) runs PB', async () => {
    await prisma.company.update({ where: { id: w.companies.B }, data: { weekStart: 1 } });
    await prisma.project.update({ where: { id: w.projects.PB }, data: { managerId: w.people.cat } });
    try {
      const cat = await weekly().preview(w.people.cat);
      expect(cat).toMatchObject({ weekStart: 1 });
      expect(new Date(`${cat!.week}T12:00:00Z`).getUTCDay()).toBe(1); // a Monday
      expect(cat!.html).toContain(`© ${new Date().getFullYear()} Beta ${w.tag}`);
    } finally {
      await prisma.project.update({ where: { id: w.projects.PB }, data: { managerId: null } });
      await prisma.company.update({ where: { id: w.companies.B }, data: { weekStart: null } });
    }
  });

  it('ben (runs PB; only on PAB’s team) gets one company’s summary — nothing of Alpha', async () => {
    const ben = await weekly().preview(w.people.ben);
    expect(ben).not.toBeNull();
    expect(ben!.html).not.toContain('</h2>');
    expect(ben!.html).not.toMatch(new RegExp(`ZZALPHA|Alpha ${w.tag}|Project PA ${w.tag}`));
  });

  it('an admin’s summary covers every company, a section each', async () => {
    const admin = await weekly().preview(w.people.admin);
    expect(admin!.html).toContain(`>Alpha ${w.tag}</h2>`);
    expect(admin!.html).toContain(`>Beta ${w.tag}</h2>`);
  });
});
