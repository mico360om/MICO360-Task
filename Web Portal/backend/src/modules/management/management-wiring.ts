import type { PrismaClient } from '@prisma/client';
import { isAdminRoles, readMyProjectsOnly } from '../companies/company-access';
import { createPrismaWorkloadStore } from '../planning/prisma-workload-store';
import type { SettingsService } from '../settings/settings-service';
import type { EmailContent, TemplateOptions } from '../email/email-templates';
import { createManagementService, type ManagementService, type ManagementSettings } from './management-service';
import type { CompanyCalendar } from '../companies/company-time';
import { createPrismaManagementSource } from './prisma-management-source';
import { createPrismaCompanyGroups, createPrismaWeeklySummaryPeople, createPrismaWeeklySummaryRepository } from './prisma-weekly-summary';
import { createWeeklySummaryService, type WeeklySummaryDeps } from './weekly-summary-service';
import { createHealthExtrasLoader, type ProjectCalendars } from '../project-health/health-extras-loader';
import { createPrismaHealthSource } from '../project-health/prisma-health-source';

/** System Settings — companies: the week start and working days may be asked with the reader (their company's). */
type Settings = Pick<SettingsService, 'dailyLimit' | 'weeklySummaryEnabled'> & ManagementSettings;

/** The Management page's service over the database (the server, and scripts that need it). */
export function createManagementFromPrisma(prisma: PrismaClient, o: { settings: Settings; timeZone: string; now?: () => Date; projectCalendars?: ProjectCalendars }): ManagementService {
  return createManagementService({
    source: createPrismaManagementSource(prisma, o.timeZone),
    workload: createPrismaWorkloadStore(prisma),
    settings: o.settings,
    timeZone: o.timeZone,
    ...(o.now ? { now: o.now } : {}),
    // 1.22 "Show my projects only" (an administrator's own; the page and its PDF, not the weekly email).
    myProjectsOnly: (viewer) => (isAdminRoles(viewer.roles) ? readMyProjectsOnly(prisma, viewer.id) : Promise.resolve(false)),
    // 1.23.5 Project overview & health: weighted completion and the new health facts, in the one rule.
    healthExtras: createHealthExtrasLoader(createPrismaHealthSource(prisma), o.timeZone, o.projectCalendars),
    // Notification & Scheduling centre: "days late" in each project's company's working days.
    ...(o.projectCalendars ? { projectCalendars: o.projectCalendars } : {}),
  });
}

/** The weekly management summary over the database: each person's own digest, sent through `send`. */
export function createWeeklySummaryFromPrisma(
  prisma: PrismaClient,
  o: {
    management: ManagementService;
    settings: Settings;
    send: (to: string, content: EmailContent, template: string, opts?: { fromName?: string }) => Promise<'sent' | 'suppressed' | void>;
    isConfigured: () => boolean;
    companyTimeZone: string;
    appUrl: string;
    now?: () => Date;
    logger?: WeeklySummaryDeps['logger'];
    /** Companies: a person's own week (their primary company's), and every calendar in use. */
    calendarOf?: (userId: string) => Promise<CompanyCalendar>;
    calendars?: () => Promise<CompanyCalendar[]>;
    /** Companies: the person's brand (their primary company's name, logo and sender name). */
    emailOptions?: (userId: string) => Promise<TemplateOptions | undefined>;
  },
) {
  return createWeeklySummaryService({
    repo: createPrismaWeeklySummaryRepository(prisma),
    people: createPrismaWeeklySummaryPeople(prisma),
    digest: (viewer, week, only) => o.management.digest(viewer, week, only),
    // Companies: a section per company when the person's figures span several; their company's brand.
    groups: createPrismaCompanyGroups(prisma),
    ...(o.emailOptions ? { emailOptions: o.emailOptions } : {}),
    send: o.send,
    isConfigured: o.isConfigured,
    enabled: () => o.settings.weeklySummaryEnabled(),
    calendar: async (person) => {
      if (person && o.calendarOf) return o.calendarOf(person.id);
      const [weekStart, hours] = await Promise.all([o.settings.companyWeekStart(), o.settings.workingHours()]);
      return { weekStart, workingDays: hours.days };
    },
    ...(o.calendars ? { calendars: o.calendars } : {}),
    companyTimeZone: o.companyTimeZone,
    appUrl: o.appUrl,
    ...(o.now ? { now: o.now } : {}),
    ...(o.logger ? { logger: o.logger } : {}),
  });
}
