import type { PrismaClient, EmailStatus } from '@prisma/client';
import { SUPPRESSING, type EmailEventStore } from './email-webhook-service';

export function createPrismaEmailEventStore(prisma: PrismaClient): EmailEventStore {
  return {
    async record(e) {
      await prisma.emailLog.create({
        data: { toAddress: e.toAddress, template: 'webhook', subject: `event:${e.status}`, status: e.status as EmailStatus, providerMessageId: e.providerMessageId },
      });
    },
  };
}

/** An address is suppressed once it has any hard bounce / spam / block on record (T20.5). */
export function createPrismaSuppressionChecker(prisma: PrismaClient): (email: string) => Promise<boolean> {
  return async (email: string) => {
    const count = await prisma.emailLog.count({
      where: { toAddress: email, status: { in: SUPPRESSING as unknown as EmailStatus[] } },
    });
    return count > 0;
  };
}
