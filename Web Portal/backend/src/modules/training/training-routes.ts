import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import { trainingFileHeaders } from './training-files';
import type { LearnerMode, TrainingLearner } from './training-learner';

/**
 * Taking training over HTTP. Staff routes (/training/*): the guard's route table refuses a client
 * account's session, and the learner service refuses one again. The public certificate check
 * (GET /training/verify/:code) needs no sign-in and answers only the course, the name, the dates and
 * the status — 30 checks a minute per address. The Client portal's routes are in portal-training-routes.ts
 * (the same handlers in client mode).
 */
export interface TrainingRouteDeps {
  learner: TrainingLearner;
  guard: AuthGuard;
  /** Certificate checks per address a minute (default 30). */
  verifyPerMinute?: number;
  /** Ratings, questions and "outdated" reports per person a minute (default 10). */
  feedbackPerMinute?: number;
  /** Progress saves per person a minute (default 240: a video saves every few seconds). */
  progressPerMinute?: number;
  /** Training files per person a minute (default 60). */
  filesPerMinute?: number;
  /** Certificate PDFs per person a minute (default 10). */
  pdfsPerMinute?: number;
}

type Params = { id?: string; code?: string };

/** The handlers both families share, in one mode (staff or client). */
export function learnerHandlers(deps: TrainingRouteDeps, mode: LearnerMode) {
  const { learner, guard } = deps;
  const me = (req: FastifyRequest) => req.user!.id;
  const id = (req: FastifyRequest) => (req.params as Params).id;
  const limit = (max: number) => ({ preHandler: guard.authenticate, config: { rateLimit: { max, timeWindow: '1 minute' } } });
  return {
    signedIn: { preHandler: guard.authenticate },
    progressLimit: limit(deps.progressPerMinute ?? 240),
    feedbackLimit: limit(deps.feedbackPerMinute ?? 10),
    fileLimit: limit(deps.filesPerMinute ?? 60),
    pdfLimit: limit(deps.pdfsPerMinute ?? 10),
    catalogue: async (req: FastifyRequest) => ({ data: await learner.catalogue(me(req), mode, req.query) }),
    course: async (req: FastifyRequest) => ({ data: await learner.course(me(req), mode, id(req)) }),
    start: async (req: FastifyRequest) => ({ data: await learner.start(me(req), mode, id(req)) }),
    lesson: async (req: FastifyRequest) => ({ data: await learner.lesson(me(req), mode, id(req)) }),
    progress: async (req: FastifyRequest) => ({ data: await learner.saveProgress(me(req), mode, id(req), req.body) }),
    complete: async (req: FastifyRequest) => ({ data: await learner.complete(me(req), mode, id(req)) }),
    startAttempt: async (req: FastifyRequest) => ({ data: await learner.startAttempt(me(req), mode, id(req)) }),
    saveAnswers: async (req: FastifyRequest) => ({ data: await learner.saveAnswers(me(req), mode, id(req), req.body) }),
    submit: async (req: FastifyRequest) => ({ data: await learner.submit(me(req), mode, id(req), req.body) }),
    result: async (req: FastifyRequest) => ({ data: await learner.result(me(req), mode, id(req)) }),
    file: async (req: FastifyRequest, reply: FastifyReply) => {
      const f = await learner.file(me(req), mode, id(req));
      return reply.headers(trainingFileHeaders(f)).send(f.content);
    },
    certificatePdf: async (req: FastifyRequest, reply: FastifyReply) => {
      const out = await learner.certificatePdf(me(req), mode, id(req));
      return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${out.fileName}"`).header('Cache-Control', 'no-store').send(out.pdf);
    },
    feedback: async (req: FastifyRequest, reply: FastifyReply) => reply.status(201).send({ data: await learner.feedback(me(req), mode, id(req), req.body) }),
    tour: async (req: FastifyRequest) => ({ data: await learner.tour(me(req), mode, req.body) }),
  };
}

export async function registerTrainingRoutes(app: FastifyInstance, deps: TrainingRouteDeps): Promise<void> {
  const { learner } = deps;
  const h = learnerHandlers(deps, 'staff');
  const me = (req: FastifyRequest) => req.user!.id;

  app.get('/training/access', h.signedIn, async (req) => ({ data: await learner.access(me(req)) }));
  app.get('/training/me', h.signedIn, async (req) => ({ data: await learner.me(me(req), 'staff') }));
  app.get('/training/catalogue', h.signedIn, h.catalogue);
  app.get('/training/learn', h.signedIn, async (req) => ({ data: await learner.learn(me(req), req.query) }));
  app.get('/training/courses/:id', h.signedIn, h.course);
  app.post('/training/courses/:id/start', h.signedIn, h.start);
  app.get('/training/lessons/:id', h.signedIn, h.lesson);
  app.put('/training/lessons/:id/progress', h.progressLimit, h.progress);
  app.post('/training/lessons/:id/complete', h.signedIn, h.complete);
  app.post('/training/lessons/:id/attempts', h.signedIn, h.startAttempt);
  app.put('/training/attempts/:id', h.progressLimit, h.saveAnswers);
  app.post('/training/attempts/:id/submit', h.signedIn, h.submit);
  app.get('/training/attempts/:id', h.signedIn, h.result);
  app.get('/training/files/:id', h.fileLimit, h.file);
  app.get('/training/certificates/:id/pdf', h.pdfLimit, h.certificatePdf);
  app.post('/training/courses/:id/feedback', h.feedbackLimit, h.feedback);
  app.put('/training/tour', h.signedIn, h.tour);

  // Public: anyone with a certificate's code (its PDF's link) — no sign-in, only the five facts.
  app.get(
    '/training/verify/:code',
    { config: { rateLimit: { max: deps.verifyPerMinute ?? 30, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `training-verify:${req.ip}` } } },
    async (req, reply) => reply.header('Cache-Control', 'no-store').send({ data: await learner.verify((req.params as Params).code) }),
  );
}
