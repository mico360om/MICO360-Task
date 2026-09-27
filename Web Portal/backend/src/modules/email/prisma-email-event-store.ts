import type { PrismaClient, EmailStatus } from '@prisma/client';
import { SUPPRESSING, type EmailEventStore } from './email-webhook-service';
import type { EmailLogStore } from './email-service';

export function createPrismaEmailEventStore(prisma: PrismaClient): EmailEventStore {
  return {
    async record(e) {
      await prisma.emailLog.create({
        data: {
          toAddress: e.toAddress,
          template: 'webhook',
          subject: `event:${e.status}`,
          status: e.status as EmailStatus,
          providerMessageId: e.providerMessageId,
          error: e.detail,
        },
      });
    },
  };
}

/** Records every send attempt (SENT / FAILED) in email_log. */
export function createPrismaEmailLogStore(prisma: PrismaClient): EmailLogStore {
  return {
    async record(e) {
      await prisma.emailLog.create({
        data: {
          toAddress: e.toAddress,
          template: e.template,
          subject: e.subject.slice(0, 191),
          status: e.status,
          providerMessageId: e.providerMessageId,
          error: e.error,
        },
      });
    },
  };
}

export const SUPPRESSION_WINDOW_DAYS = 90;

/**
 * An address is suppressed while it has a hard bounce or spam complaint on record from the last
 * `windowDays` days (T20.5) — suppression expires, so a fixed mailbox gets mail again.
 */
export function createPrismaSuppressionChecker(
  prisma: PrismaClient,
  { windowDays = SUPPRESSION_WINDOW_DAYS, now = () => new Date() }: { windowDays?: number; now?: () => Date } = {},
): (email: string) => Promise<boolean> {
  return async (email: string) => {
    const since = new Date(now().getTime() - windowDays * 86_400_000);
    const count = await prisma.emailLog.count({
      where: { toAddress: email, status: { in: SUPPRESSING as unknown as EmailStatus[] }, createdAt: { gte: since } },
    });
    return count > 0;
  };
}
