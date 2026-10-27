import type { PrismaClient } from '@prisma/client';
import { createPrismaWorkloadStore } from '../planning/prisma-workload-store';
import type { SettingsService } from '../settings/settings-service';
import type { EmailContent } from '../email/email-templates';
import { createManagementService, type ManagementService } from './management-service';
import { createPrismaManagementSource } from './prisma-management-source';
import { createPrismaWeeklySummaryPeople, createPrismaWeeklySummaryRepository } from './prisma-weekly-summary';
import { createWeeklySummaryService, type WeeklySummaryDeps } from './weekly-summary-service';

type Settings = Pick<SettingsService, 'companyWeekStart' | 'workingHours' | 'dailyLimit' | 'weeklySummaryEnabled'>;

/** The Management page's service over the database (the server, and scripts that need it). */
export function createManagementFromPrisma(prisma: PrismaClient, o: { settings: Settings; timeZone: string; now?: () => Date }): ManagementService {
  return createManagementService({
    source: createPrismaManagementSource(prisma, o.timeZone),
    workload: createPrismaWorkloadStore(prisma),
    settings: o.settings,
    timeZone: o.timeZone,
    ...(o.now ? { now: o.now } : {}),
  });
}

/** The weekly management summary over the database: each person's own digest, sent through `send`. */
export function createWeeklySummaryFromPrisma(
  prisma: PrismaClient,
  o: {
    management: ManagementService;
    settings: Settings;
    send: (to: string, content: EmailContent, template: string) => Promise<'sent' | 'suppressed' | void>;
    isConfigured: () => boolean;
    companyTimeZone: string;
    appUrl: string;
    now?: () => Date;
    logger?: WeeklySummaryDeps['logger'];
  },
) {
  return createWeeklySummaryService({
    repo: createPrismaWeeklySummaryRepository(prisma),
    people: createPrismaWeeklySummaryPeople(prisma),
    digest: (viewer, week) => o.management.digest(viewer, week),
    send: o.send,
    isConfigured: o.isConfigured,
    enabled: () => o.settings.weeklySummaryEnabled(),
    calendar: async () => {
      const [weekStart, hours] = await Promise.all([o.settings.companyWeekStart(), o.settings.workingHours()]);
      return { weekStart, workingDays: hours.days };
    },
    companyTimeZone: o.companyTimeZone,
    appUrl: o.appUrl,
    ...(o.now ? { now: o.now } : {}),
    ...(o.logger ? { logger: o.logger } : {}),
  });
}
