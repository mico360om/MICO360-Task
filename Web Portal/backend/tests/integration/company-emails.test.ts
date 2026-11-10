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

/** The daily email a person would get now ("Send me a test": sent to the test mailbox, nothing recorded). */
async function dailyOf(userId: string): Promise<{ content: EmailContent; opts?: { fromName?: string } }> {
  sent.length = 0;
  await daily.sendTest(userId);
  return sent.find((s) => /^Today: /.test(s.content.subject))!;
}

describe('daily emails, one per person, grouped by company', () => {
  it('cat gets ONE daily email, Alpha’s section then Beta’s, with Beta’s name (her primary company)', async () => {
    await prisma.company.update({ where: { id: w.companies.B }, data: { senderName: 'Beta Team' } });
    try {
      const mail = await dailyOf(w.people.cat);
      const html = mail.content.html;
      expect(html.indexOf(`>Alpha ${w.tag}</div>`)).toBeGreaterThan(-1);
      expect(html.indexOf(`>Alpha ${w.tag}</div>`)).toBeLessThan(html.indexOf(`>Beta ${w.tag}</div>`));
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
      const mail = await dailyOf(w.people.ana);
      expect(mail.content.html).toContain('ZZALPHA');
      expect(mail.content.html).not.toMatch(/ZZBETA|ZZGAMMA/);
      expect(mail.content.html).not.toContain(`Alpha ${w.tag}</div>`); // one company: no company headings
    } finally {
      await prisma.taskAssignee.deleteMany({ where: { userId: w.people.ana, taskId: { in: [w.tasks.TB1, w.tasks.TC1] } } });
    }
  });

  it('gus, whose only company is archived, gets nothing of it', async () => {
    sent.length = 0;
    expect(await daily.sendTest(w.people.gus)).toEqual({ daily: 'empty', pending: 'empty', completed: 'empty' });
  });

  it('1.22: today’s meetings — the organizer’s and a guest’s from another company; never someone else’s', async () => {
    const original = await prisma.meeting.findUniqueOrThrow({ where: { id: w.meetings.MA }, select: { startAt: true } });
    await prisma.meeting.updateMany({ where: { id: { in: [w.meetings.MA, w.meetings.MB] } }, data: { startAt: new Date() } });
    try {
      const ana = await dailyOf(w.people.ana);
      expect(ana.content.html).toContain(`/meetings/${w.meetings.MA}`);
      expect(ana.content.html).not.toContain(`/meetings/${w.meetings.MB}`);
      // Bob (Beta) is invited to Alpha's meeting: it is on his day, as a guest's.
      const bob = await dailyOf(w.people.bob);
      expect(bob.content.text.slice(bob.content.text.indexOf('== Today’s meetings'))).toContain('  MA ZZALPHA meeting\n');
      expect(bob.content.html).not.toContain(`/meetings/${w.meetings.MB}`);
    } finally {
      await prisma.meeting.updateMany({ where: { id: { in: [w.meetings.MA, w.meetings.MB] } }, data: { startAt: original.startAt } });
    }
  });

  it('1.22: In your projects (now Overdue and waiting in your projects, under Your projects) — ben runs PB: cat’s overdue Beta task, with her name; nothing of a company he isn’t in', async () => {
    const late = new Date('2026-01-05T00:00:00Z');
    await prisma.task.updateMany({ where: { id: { in: [w.tasks.TB2, w.tasks.TA2, w.tasks.TC1] } }, data: { dueDate: late } });
    try {
      const ben = await dailyOf(w.people.ben);
      const part = ben.content.text.slice(ben.content.text.indexOf('== Overdue and waiting in your projects'));
      expect(part).toContain(`TB2${w.tag.toUpperCase()}-1`);
      expect(part).toMatch(/Assigned to Cat/);
      expect(part).not.toMatch(/ZZALPHA|ZZGAMMA/);
      // Redesign, Your projects: PB (he owns it) with its figures — never a project of a company he isn't in.
      const text = ben.content.text;
      const yours = text.slice(text.indexOf('== Your projects'), text.indexOf('== Overdue and waiting in your projects'));
      expect(yours).toContain(`- Project PB ${w.tag}`);
      expect(yours).toMatch(/1 overdue/);
      expect(yours).not.toMatch(/Project (PA|PC) /);
    } finally {
      await prisma.task.updateMany({ where: { id: { in: [w.tasks.TB2, w.tasks.TA2, w.tasks.TC1] } }, data: { dueDate: null } });
    }
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
