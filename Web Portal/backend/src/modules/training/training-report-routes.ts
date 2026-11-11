import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { attachmentDisposition } from '../clients/portal-routes';
import type { TrainingReports } from './training-report-service';

/**
 * Training reports over HTTP (owner request; R5): administrators (everyone), Training managers (their
 * companies' people) and project managers (their projects' teams, read-only) — the service refuses anyone
 * else (403). Staff routes: a client account's session is refused by the guard's route table.
 */
export interface TrainingReportRouteDeps {
  reports: TrainingReports;
  guard: AuthGuard;
  /** Who printed a file (its footer says so). */
  userName?: (id: string) => Promise<string | null>;
  /** Files a person may download a minute (default 10). */
  filesPerMinute?: number;
}

export async function registerTrainingReportRoutes(app: FastifyInstance, deps: TrainingReportRouteDeps): Promise<void> {
  const { reports, guard } = deps;
  const auth = { preHandler: guard.authenticate };
  const fileLimit = { preHandler: guard.authenticate, config: { rateLimit: { max: deps.filesPerMinute ?? 10, timeWindow: '1 minute' } } };
  const me = (req: FastifyRequest) => req.user!.id;
  const nameOf = async (req: FastifyRequest) => (await deps.userName?.(me(req)).catch(() => null)) ?? null;
  const send = async (req: FastifyRequest, reply: FastifyReply, format: 'xlsx' | 'pdf') => {
    const out = await reports.exportFile(me(req), req.query, format, await nameOf(req));
    return reply.header('Content-Type', out.contentType).header('Content-Disposition', attachmentDisposition(out.fileName)).header('Cache-Control', 'no-store').send(out.body);
  };

  app.get('/training/reports', auth, async (req) => ({ data: await reports.report(me(req), req.query) }));
  app.get('/training/reports/quiz/:lessonId', auth, async (req) => ({ data: await reports.quizReport(me(req), (req.params as { lessonId?: string }).lessonId) }));
  app.get('/training/reports/export.xlsx', fileLimit, async (req, reply) => send(req, reply, 'xlsx'));
  app.get('/training/reports/export.pdf', fileLimit, async (req, reply) => send(req, reply, 'pdf'));
}
