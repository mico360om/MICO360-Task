import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { DailyEmailService } from './daily-email-service';
import type { DailyEmailRepository } from './daily-email-repository';

export interface DailyEmailRouteDeps {
  service: Pick<DailyEmailService, 'sendTest'>;
  log: Pick<DailyEmailRepository, 'list'>;
  isConfigured: () => boolean;
  guard: AuthGuard;
}

const logQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['SENDING', 'SENT', 'SKIPPED', 'RETRY', 'FAILED']).optional(),
});

/** One test a minute per person: enough to check the emails, not enough to flood an inbox. */
const TEST_GAP_MS = 60_000;

export async function registerDailyEmailRoutes(app: FastifyInstance, deps: DailyEmailRouteDeps): Promise<void> {
  const lastTest = new Map<string, number>();

  // "Send me a test now": the person's own two emails, whatever their settings (not counted as today's).
  app.post('/notifications/daily-emails/test', { preHandler: deps.guard.authenticate }, async (req, reply) => {
    if (!deps.isConfigured()) {
      return reply.status(503).send({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email isn’t set up on this server yet, so no email can be sent. An administrator needs to add the email (Mailjet) keys.' } });
    }
    const userId = req.user!.id;
    const last = lastTest.get(userId);
    if (last !== undefined && Date.now() - last < TEST_GAP_MS) {
      return reply.status(429).send({ error: { code: 'TOO_SOON', message: 'A test was just sent. Wait a minute before sending another.' } });
    }
    lastTest.set(userId, Date.now());
    return { data: await deps.service.sendTest(userId) };
  });

  // The delivery log for administrators: every morning email, sent, skipped, retrying or failed.
  app.get('/admin/daily-emails', { preHandler: deps.guard.requireRoles('ADMIN') }, async (req) => {
    const q = logQuery.parse(req.query);
    return {
      data: await deps.log.list({ ...(q.day ? { day: q.day } : {}), ...(q.status ? { status: q.status } : {}) }),
      meta: { emailEnabled: deps.isConfigured() },
    };
  });
}
