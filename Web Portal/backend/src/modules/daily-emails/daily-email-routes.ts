import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { DailyEmailService } from './daily-email-service';
import type { DailyEmailKind, DailyEmailRepository } from './daily-email-repository';

export interface DailyEmailRouteDeps {
  service: Pick<DailyEmailService, 'sendTest' | 'overview' | 'sendNow' | 'sendFor' | 'preview'>;
  log: Pick<DailyEmailRepository, 'list'>;
  isConfigured: () => boolean;
  guard: AuthGuard;
  /** Administrators' manual sends are recorded in the audit log. */
  audit?: Pick<AuditService, 'record'>;
}

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const kindEnum = z.enum(['PENDING', 'COMPLETED']);
const logQuery = z.object({
  day: dayKey.optional(),
  status: z.enum(['SENDING', 'SENT', 'SKIPPED', 'RETRY', 'FAILED']).optional(),
});
const overviewQuery = z.object({ day: dayKey.optional() });
/** `early`: send it although the person's time today hasn't come (an administrator was asked first). */
const sendBody = z.object({ userId: z.string().min(1).max(64), kind: kindEnum.optional(), resend: z.boolean().optional(), early: z.boolean().optional() });
const previewQuery = z.object({ userId: z.string().min(1).max(64), kind: kindEnum });

/** One test a minute per person: enough to check the emails, not enough to flood an inbox. */
const TEST_GAP_MS = 60_000;
/** "Send today's emails now": one press a minute per administrator. */
const SEND_NOW_GAP_MS = 60_000;
/** One person's email, sent by an administrator: a short gap (for that email) so a double click never sends twice. */
const PERSON_GAP_MS = 30_000;

const KIND_LABEL: Record<DailyEmailKind, string> = { PENDING: 'Pending tasks', COMPLETED: 'Completed yesterday' };
const NOT_CONFIGURED = {
  error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email isn’t set up on this server yet, so no email can be sent. An administrator needs to add the email (Mailjet) keys.' },
};

/** A gap between two actions by the same key (a person, an administrator), kept in memory. */
function gapKeeper(ms: number) {
  const last = new Map<string, number>();
  return {
    /** False while the gap since the last one hasn't passed; else it starts a new gap. */
    take(key: string): boolean {
      return this.takeAll([key]);
    },
    /** All of them, or none: false while any one's gap hasn't passed. */
    takeAll(keys: string[]): boolean {
      const t = Date.now();
      if (keys.some((key) => t - (last.get(key) ?? -Infinity) < ms)) return false;
      for (const key of keys) last.set(key, t);
      return true;
    },
    /** Nothing happened after all: no gap. */
    release(key: string) {
      last.delete(key);
    },
  };
}

export async function registerDailyEmailRoutes(app: FastifyInstance, deps: DailyEmailRouteDeps): Promise<void> {
  const tests = gapKeeper(TEST_GAP_MS);
  const sendNows = gapKeeper(SEND_NOW_GAP_MS);
  const personSends = gapKeeper(PERSON_GAP_MS);
  const adminOnly = { preHandler: deps.guard.requireRoles('ADMIN') };

  /** The email has gone already: a problem writing the audit entry must not turn that into an error. */
  const audit = async (req: FastifyRequest, action: string, entityId: string | null, newValue: unknown) => {
    try {
      await deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'daily-emails', action, entityId, newValue });
    } catch {
      /* the send itself stands */
    }
  };

  // "Send me a test now": the person's own two emails, whatever their settings (not counted as today's).
  app.post('/notifications/daily-emails/test', { preHandler: deps.guard.authenticate }, async (req, reply) => {
    if (!deps.isConfigured()) return reply.status(503).send(NOT_CONFIGURED);
    const userId = req.user!.id;
    if (!tests.take(userId)) {
      return reply.status(429).send({ error: { code: 'TOO_SOON', message: 'A test was just sent. Wait a minute before sending another.' } });
    }
    return { data: await deps.service.sendTest(userId) };
  });

  // The delivery log for administrators: every morning email, sent, skipped, retrying or failed.
  app.get('/admin/daily-emails', adminOnly, async (req) => {
    const q = logQuery.parse(req.query);
    return {
      data: await deps.log.list({ ...(q.day ? { day: q.day } : {}), ...(q.status ? { status: q.status } : {}) }),
      meta: { emailEnabled: deps.isConfigured() },
    };
  });

  // A day at a glance: everyone with an email address, each email's state, the day's numbers, when the
  // server last checked and when the next email is due. Without a day: each person's own today.
  app.get('/admin/daily-emails/overview', adminOnly, async (req) => {
    const q = overviewQuery.parse(req.query);
    return { data: { ...(await deps.service.overview(q.day)), emailEnabled: deps.isConfigured() } };
  });

  // "Send today's emails now": everyone's emails that haven't gone today, at once (counted as today's).
  app.post('/admin/daily-emails/send-now', adminOnly, async (req, reply) => {
    if (!deps.isConfigured()) return reply.status(503).send(NOT_CONFIGURED);
    const adminId = req.user!.id;
    if (!sendNows.take(adminId)) {
      return reply.status(429).send({ error: { code: 'TOO_SOON', message: 'Today’s emails were just sent. Wait a minute before sending them again.' } });
    }
    let counts;
    try {
      counts = await deps.service.sendNow();
    } catch (err) {
      sendNows.release(adminId);
      throw err;
    }
    await audit(req, 'daily_email.send_now', null, counts);
    return { data: counts };
  });

  // One person's emails for today, now (or one of them); `resend` also sends one that already went.
  app.post('/admin/daily-emails/send', adminOnly, async (req, reply) => {
    const body = sendBody.parse(req.body);
    if (!deps.isConfigured()) return reply.status(503).send(NOT_CONFIGURED);
    // The gap is for each email (person and email), and only once something actually went.
    const gapKey = (kind: DailyEmailKind) => `${body.userId}|${kind}`;
    const kinds: DailyEmailKind[] = body.kind ? [body.kind] : ['PENDING', 'COMPLETED'];
    if (!personSends.takeAll(kinds.map(gapKey))) {
      const message = body.kind ? 'This email was just sent. Wait half a minute before sending it again.' : 'This person’s emails were just sent. Wait half a minute before sending again.';
      return reply.status(429).send({ error: { code: 'TOO_SOON', message } });
    }
    const releaseAll = () => kinds.forEach((k) => personSends.release(gapKey(k)));
    const resend = body.resend === true;
    const early = body.early === true;
    let sent;
    try {
      sent = await deps.service.sendFor(body.userId, { ...(body.kind ? { kind: body.kind } : {}), resend, ...(early ? { early } : {}) });
    } catch (err) {
      releaseAll();
      throw err;
    }
    if (!sent) {
      releaseAll();
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'That person isn’t active or has no email address.' } });
    }
    for (const r of sent.results) if (r.outcome !== 'sent') personSends.release(gapKey(r.kind));
    if (sent.results.every((r) => r.outcome === 'off')) {
      const message = body.kind
        ? `${sent.name} turned off the “${KIND_LABEL[body.kind]}” email, so it can’t be sent.`
        : `${sent.name} turned off both daily emails, so there’s nothing to send.`;
      return reply.status(409).send({ error: { code: 'EMAIL_TURNED_OFF', message } });
    }
    if (sent.results.every((r) => r.outcome === 'not-yet' || r.outcome === 'off')) {
      const message = `It isn’t ${sent.name}’s time yet (their emails go at ${sent.time}, their time), so nothing was sent.`;
      return reply.status(409).send({ error: { code: 'NOT_YET', message } });
    }
    await audit(req, resend ? 'daily_email.resend' : 'daily_email.send', body.userId, {
      kind: body.kind ?? null,
      resend,
      ...(early ? { early } : {}),
      day: sent.day,
      results: sent.results.map((r) => ({ kind: r.kind, outcome: r.outcome })),
    });
    return { data: sent };
  });

  // The email as it would be sent now: its subject and plain text (never HTML), built fresh.
  app.get('/admin/daily-emails/preview', adminOnly, async (req, reply) => {
    const q = previewQuery.parse(req.query);
    const shown = await deps.service.preview(q.userId, q.kind);
    if (!shown) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'That person isn’t active or has no email address.' } });
    return { data: shown };
  });
}
